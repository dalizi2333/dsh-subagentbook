import { usesActivations, drainDescendants, drainChildren, startLocal } from './host-compat.js';
import { randomUUID } from 'node:crypto';
import { BookError, admitChild, compilePreset, parseBook, freeze, canonical, revision, validateModelOptions } from './book.js';
import { recordStore } from './records.js';
import { hostModules, mountComposition, assertFixedComposition } from './composition.js';
import { artifactRevision } from './artifacts.js';
import { registerToolTeaching } from './tool-teaching.js';
import { instanceView } from './diagnostics-contract.js';
import { activityStore, activityView } from './activity.js';
import { recoveryPacket } from './recovery.js';
import { checkpointStore, stageSnapshot, checkpointExport } from './checkpoints.js';
import { reportExport } from './report-export.js';
import { createRoots } from './roots.js';
import { deliveryOutput, reportStore, reportPage, REPORT_PAGE_CHARS, savedReportStatus } from './reports.js';
import { prepareVerification, assertVerification, assertVerificationSource, verificationView, verificationEnvironment, rollbackVerification } from './verification.js';

export const DELEGATE_TOOL = 'subagentbook';
export const MESSAGE_TOOL = 'subagentbook_message';
export const STOP_TOOL = 'subagentbook_stop';
export const RESULT_TOOL = 'subagentbook_result';
export function createRuntime(ctx, book) {
  const runtimeStartedAt = Date.now();
  ctx.inject(['promptbook'], local => registerToolTeaching(local.promptbook));
  const providers = new Map();
  const managed = new WeakMap();
  const active = new Map();
  const pendingRoutes = new WeakMap();
  const initializing = new Map();
  const reservations = new Map();
  const continuable = new Map();
  const requestSnapshots = new Map();
  ctx.inject(['llmMimo'], local => {
    if (typeof local.llmMimo.registerRequestFieldSource !== 'function') return;
    local.effect(() => local.llmMimo.registerRequestFieldSource({ resolve(frame) {
      if (frame.purpose || !frame.sessionId) return undefined;
      const compiled = requestSnapshots.get(frame.sessionId);
      if (!compiled) return undefined;
      if (frame.provider !== compiled.provider || frame.model !== compiled.model) throw new BookError('MODEL_PINNED', 'Request parameters belong to the original model route');
      return compiled.agentOptions.requestFields?.map(({ path, value, apiFormat }) => ({ path, value, apiFormat }));
    } }), 'subagentbook.request-fields');
  });
  const owners = new WeakMap();
  let closing = false;
  let hostPromise;
  let records;
  let reports;
  const host = () => hostPromise ??= hostModules(ctx);
  let activity;
  let activityPending = Promise.resolve();
  for (const [event, phase] of [['subagent/start', 'active'], ['subagent/end', 'settled']]) {
    ctx.on(event, info => {
      if (!info.provider?.startsWith('subagentbook:')) return;
      activityPending = activityPending.then(async () => {
        const h = await host();
        activity ??= activityStore(h.home.dshHomePath('subagentbook', 'activity'));
        activity.record(info, phase);
      }).catch(() => { ctx.logger.warn('subagentbook: activity persistence unavailable; execution outcome must not be inferred'); });
    });
  }
  let stages, stagePending = Promise.resolve();
  const checkpoints = async () => { const h = await host(); return stages ??= checkpointStore(h.home.dshHomePath('subagentbook', 'checkpoints')); };
  ctx.on('session/event', (session, event) => {
    if (!['step/start', 'request/header', 'assistant/message', 'tool/result', 'step/end', 'turn/end'].includes(event.type)) return;
    const agent = ctx.agents.get(session.id), record = agent && managed.get(agent)?.record;
    if (!record) return;
    const snapshot = stageSnapshot(record, session.snapshotEvents());
    if (!snapshot) return;
    stagePending = stagePending.then(async () => (await checkpoints()).write(snapshot)).catch(() => {
      ctx.logger.warn('subagentbook: stage checkpoint unavailable; native history and final reports remain separate');
    });
  }, { global: true });
  ctx.on('session/flush', () => stagePending, { global: true });
  ctx.effect(() => () => stagePending, 'subagentbook.checkpoint-drain');
  const directory = () => ctx.get('llmMimo')?.listHostedModels() ?? [];
  function assertDependencies() {
    const pb = ctx.get('promptbook'), mimo = ctx.get('llmMimo');
    if (!pb || typeof pb.resolve !== 'function' || typeof pb.resolveOverride !== 'function' || !mimo || typeof mimo.listHostedModels !== 'function') throw new BookError('MISSING_DEPENDENCY', 'Subagentbook requires the host Promptbook and llm-mimo services');
  }
  const compile = (id, provider, model) => { assertDependencies(); return compilePreset(book, id, provider, model, {
    models: directory(), resolveText: (key, modelId, providerId) => ctx.get('promptbook')?.resolve(key, modelId, providerId),
    resolveToolText: (key, modelId, providerId) => ctx.get('promptbook')?.resolveOverride(key, modelId, providerId),
  }); };
  function validateOptions(compiled, options) {
    if (compiled.agentOptions?.requestFields) options = { ...options, requestFields: compiled.agentOptions.requestFields };
    const model = directory().find(row => row.provider === compiled.provider && row.id === compiled.model);
    if (!model) throw new BookError('UNKNOWN_MODEL', `Model ${compiled.provider}/${compiled.model} is unavailable`);
    validateModelOptions(options, model);
    if (options.requestFields?.length && typeof ctx.get('llmMimo')?.registerRequestFieldSource !== 'function') throw new BookError('REQUEST_FIELDS_UNSUPPORTED', 'llm-mimo request field bridge is unavailable');
    ctx.get('llmMimo')?.validateAgentOptions?.(compiled.provider, compiled.model, options);
  }
  function childOptions(parent, compiled, depth, h) {
    const options = h.subagent.resolveChildAgentOptions(parent, { provider: compiled.provider, model: compiled.model,
      maxTokens: compiled.agentOptions.maxTokens, reasoningEffort: compiled.agentOptions.reasoningEffort }, depth);
    for (const key of ['maxTokens', 'reasoningEffort']) if (options[key] === undefined) delete options[key];
    validateOptions(compiled, options);
    return options;
  }
  const assertParent = parent => {
    if (closing || !parent || ctx.agents.get(parent.id) !== parent) throw new BookError('PARENT_UNAVAILABLE', 'Delegating Agent is not live');
  };
  function ownerOf(parent) {
    assertParent(parent);
    let owner = owners.get(parent);
    if (owner) return owner;
    owner = { controller: new AbortController(), operations: new Set() };
    owners.set(parent, owner);
    const agents = ctx.agents;
    const subagents = ctx.subagents;
    const close = (parentDisposal = false) => {
      owner.controller.abort(new BookError('PARENT_UNAVAILABLE', 'The owning parent scope was disposed'));
      // Native descendant drain closes admission and parks settlement notices
      // instead of waking a parent whose loop has already begun disposal.
      if (parentDisposal && agents.get(parent.id) === parent) owner.parentDrain ??= drainDescendants(subagents, [parent]);
      return owner.closing ??= (async () => {
        await Promise.allSettled([...owner.operations]);
        if (owner.parentDrain) await owner.parentDrain;
        else {
          const ids = [...continuable].filter(([, value]) => value.parentId === parent.id).map(([id]) => id);
          if (ids.length && agents.get(parent.id) === parent) await drainChildren(subagents, parent, ids);
        }
      })();
    };
    const detach = parent.ctx.effect(() => () => close(!owner.releasing), 'subagentbook.parent-children');
    ctx.effect(() => async () => { await close(); owner.releasing = true; await detach(); }, 'subagentbook.parent-owner');
    return owner;
  }
  const ownRecord = agent => agent.session.header.agentPreset?.startsWith('subagentbook:') || agent.session.snapshotEvents().some(event => event.type === 'subagentbook/instance' || event.type === 'subagent/descriptor' && event.data.provider?.startsWith('subagentbook:'));
  function parentState(parent, h) {
    const state = managed.get(parent);
    if (state) return { depth: Math.max(state.depth, h.subagent.delegationDepthOf(parent)), ceiling: state.ceiling };
    if (ownRecord(parent)) throw new BookError('RESUME_UNSUPPORTED', 'This book instance needs its original composition; cold resume is not supported yet');
    return { depth: h.subagent.delegationDepthOf(parent), ceiling: null };
  }
  function choices(parent) {
    return (managed.get(parent)?.compiled.delegates ?? (ownRecord(parent) ? [] : book.entryPresets)).filter(id => book.presets.some(p => p.id === id));
  }
  function authorize(parent, presetId) {
    assertParent(parent);
    if (typeof presetId !== 'string' || !presetId.trim()) throw new BookError('INVALID_PRESET', `Missing required preset. Allowed role IDs: ${JSON.stringify(choices(parent))}`);
    if (!choices(parent).includes(presetId)) throw new BookError('DELEGATION_DENIED', `Preset ${presetId} is not an allowed child`);
  }
  function assertAuthority(parent) {
    const realms = ctx.constructor.isolate;
    for (const name of ['fs', 'shell', 'sandbox', 'subprocess', 'sandboxPolicy', 'approval', 'permissionPresets']) {
      if (parent.ctx[realms][name] !== ctx[realms][name]) throw new BookError('AUTHORITY_REALM_UNSUPPORTED', `Parent uses a private ${name} authority realm; delegation cannot inherit it yet`);
    }
  }
  const resolveRoute = (parent, request) => {
    if ((request.provider === undefined) !== (request.model === undefined)) throw new BookError('INVALID_ROUTE', 'Supply provider and model together');
    const saved = managed.get(parent)?.compiled ?? parent.session.requestHeader()?.config ?? pendingRoutes.get(parent);
    return { provider: request.provider ?? saved?.provider ?? parent.options.provider, model: request.model ?? saved?.model ?? parent.options.model };
  };
  const policyOf = (parent, h) => {
    const captured = Object.fromEntries(Object.entries(h.subagent.captureDelegatedPolicyOverrides(parent)).filter(([, value]) => value !== undefined));
    const execution = parent.ctx.get('sandboxPolicy')?.resolve({ session: parent.session });
    return execution ? { ...captured, sandboxMode: execution.mode, workspaceRoot: execution.workspaceRoot } : captured;
  };
  const store = async () => { const h = await host(); return records ??= recordStore(h.home.dshHomePath('subagentbook', 'instances')); };
  const results = async () => { const h = await host(); return reports ??= reportStore(h.home.dshHomePath('subagentbook', 'reports')); };
  function childPolicy(record) {
    assertVerification(record);
    if (record.verification) {
      if (!ctx.get('sandboxPolicy') || !ctx.get('fs') || ctx.get('shell')?.sandboxMode === undefined) throw new BookError('VERIFICATION_UNAVAILABLE', 'Verification copies require the native file policy and confining Bash executor');
      return { ...record.inheritedPolicy, sandboxMode: 'workspace-write', workspaceRoot: record.verification.workspaceRoot, approvalPolicy: 'never' };
    }
    if (record.compiled.actionScope !== 'read-only') return record.inheritedPolicy;
    if (!ctx.get('sandboxPolicy') || !ctx.get('fs') || ctx.get('shell')?.sandboxMode === undefined) throw new BookError('READ_ONLY_UNSUPPORTED', 'Read-only roles require the native file policy and a confining Bash executor');
    return { ...record.inheritedPolicy, sandboxMode: 'read-only' };
  }
  function assertPrompts() {
    assertDependencies();
    if (ctx.get('promptbook') && ctx.get('promptbook').autoInjectionEnabled !== false) throw new BookError('PROMPT_INJECTION_CONFLICT', 'Configure Promptbook autoInject: false for this profile');
  }
  const roots = createRoots({ ctx, host, store, compile, validateOptions, policyOf, assertPrompts, managed, requestSnapshots,
    definition: () => book, isClosing: () => closing });
  async function install(childCtx, child, record, h) {
    const { compiled } = record;
    const effectivePolicy = childPolicy(record);
    const assertLivePolicy = () => {
      assertPrompts();
      assertVerification(record);
      validateOptions(compiled, record.agentOptions ?? compiled.agentOptions);
      const execution = child.ctx.get('sandboxPolicy')?.resolve({ session: child.session });
      if (execution && (execution.mode !== effectivePolicy.sandboxMode || execution.workspaceRoot !== effectivePolicy.workspaceRoot) || child.ctx.get('approval') && child.ctx.get('approval').effectivePolicy(child.session) !== effectivePolicy.approvalPolicy) throw new BookError('PERMISSION_CHANGED', 'Child permissions differ from its effective role snapshot');
      let state = record;
      while (state?.parentId) {
        const parent = ctx.agents.get(state.parentId);
        assertParent(parent); assertAuthority(parent);
        if (canonical(policyOf(parent, h)) !== canonical(state.inheritedPolicy)) throw new BookError('PERMISSION_CHANGED', 'Parent permissions differ from this instance snapshot');
        state = managed.get(parent)?.record;
      }
    };
    await childCtx.plugin({
      name: 'subagentbook-child-composition', inject: ['loader', 'tools', 'systemPrompt'],
      async apply(local) {
        const inheritedTools = local.tools.schemas(child).map(tool => tool.name);
        await mountComposition(local, child, compiled, h);
        const available = new Set(local.tools.schemas(child).map(tool => tool.name));
        for (const name of compiled.tools) if (!available.has(name)) throw new BookError('MISSING_TOOL', `${compiled.presetId} requires unavailable tool ${name}`);
        const allowed = new Set(compiled.tools);
        const mayDelegate = compiled.delegates.length > 0;
        if (mayDelegate) { allowed.add(DELEGATE_TOOL); allowed.add(RESULT_TOOL); }
        if (record.mode === 'continuable' || mayDelegate) { allowed.add(MESSAGE_TOOL); allowed.add(STOP_TOOL); }
        // Native masks apply to ancestor tools; child-local registrations are
        // intentionally outside restrict(). Hide unwanted inherited names and
        // enforce the complete role allowlist with the monotonic guard below.
        const denied = inheritedTools.filter(name => !allowed.has(name) && name !== 'run_code');
        if (denied.length) local.tools.restrict({ deny: denied });
        local.tools.guard(exec => { assertLivePolicy(); return allowed.has(exec.name) ? undefined : `Tool ${exec.name} is not available in this book instance`; });
        local.systemPrompt.section({ name: 'subagentbook:persona', order: 0, complete: true, interpolate: false, text: [compiled.persona, compiled.preference].filter(Boolean).join('\n\n') });
        if (record.verification) local.systemPrompt.context({ name: 'subagentbook:verification', order: 50, text: `Independent verification copy: ${JSON.stringify(record.verification)}. Run builds/tests in this session workspace. The source is outside your write boundary. Ignored files/caches are not copied; rebuild required assets here. Native Bash uses copy-local .verification-cache directories for Java/.NET/Node/Go/Rust/Python caches and relocates absolute environment paths pointing inside the source to this copy. Report exact commands and artifacts; this input fingerprint proves provenance, not test success. Never write fixes back to the source. A changed source requires a new verification instance.` });
        local.on('agent/request', async (_request, next) => {
          assertLivePolicy();
          const result = await next();
          if (result.provider !== compiled.provider || result.model !== compiled.model) throw new BookError('MODEL_PINNED', 'Create a new book instance to change its model/composition');
          return result;
        });
        local.on('system-prompt/assemble', async (_assembly, _context, next) => {
          const result = await next();
          if (result.variables.provider !== compiled.provider || result.variables.model !== compiled.model) throw new BookError('MODEL_PINNED', 'Create a new book instance to change its model/composition');
          result.tools = result.tools.filter(tool => allowed.has(tool.name));
          for (const tool of result.tools) if (compiled.teaching[tool.name] !== undefined) tool.description = compiled.teaching[tool.name];
          for (const tool of result.tools) if (tool.name === MESSAGE_TOOL && record.mode === 'continuable') tool.description += ` Direct parent sessionId: ${JSON.stringify(record.parentId)}.`;
          return result;
        });
      },
    });
    managed.set(child, { depth: record.depth, ceiling: record.ceiling, compiled, record });
    if (compiled.agentOptions.requestFields?.length) requestSnapshots.set(child.session.id, compiled);
    if (record.mode === 'continuable') continuable.set(child.id, { child, parentId: record.parentId });
    childCtx.effect(() => () => { managed.delete(child); continuable.delete(child.id); requestSnapshots.delete(child.session.id); }, 'subagentbook.instance');
  }

  // Cordis's documented service-read waterfall keeps the native factory and
  // manager as owners. Only book creations/resumes augment unpublished setup.
  ctx.on('internal/get', (_reader, name, _error, next) => {
    const service = next();
    if (name === 'shell' && service) return new Proxy(service, { get(target, key) {
      if (key !== 'resolve') { const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value; }
      return request => {
        const agent = ctx.agents.get(request.sandboxPolicy?.sessionId), record = agent && managed.get(agent)?.record;
        if (!record?.verification) return target.resolve(request);
        assertVerification(record);
        return target.resolve({ ...request, env: verificationEnvironment(record, request.env) });
      };
    } });
    if (name !== 'agents') return service;
    return new Proxy(service, { get(target, key) {
      if (key !== 'create' && key !== 'resume') return Reflect.get(target, key);
      return async options => {
        const pending = key === 'create' ? reservations.get(options.sessionId) : undefined;
        if (key === 'create' && !pending) return target.create(options);
        const h = await host();
        let snapshot = pending?.record;
        if (key === 'resume' && typeof options.resumeSessionId === 'string' && /^[a-zA-Z0-9_-]+$/.test(options.resumeSessionId)) snapshot = (await store()).read(options.resumeSessionId);
        if (snapshot?.mode === 'root') {
          const nativeSetup = options.setup;
          return target.resume({ ...options, agentOptions: snapshot.agentOptions, async setup(rootCtx, agent) {
            const nativeCommit = await nativeSetup?.(rootCtx, agent);
            const commit = await roots.restore(agent, snapshot, options);
            return { commit() { nativeCommit?.commit(); options.signal?.throwIfAborted(); commit(); } };
          } });
        }
        const activate = async () => {
          if ((snapshot?.mode === 'continuable' || pending?.record.mode === 'one-shot')) {
            assertPrompts(); assertParent(options.parentAgent); assertAuthority(options.parentAgent);
            assertFixedComposition(snapshot.compiled);
            if (snapshot.parentId !== options.parentAgent.id) throw new BookError('UNAUTHORIZED', 'Only the exact live direct parent can resume this book instance');
            const lineage = parentState(options.parentAgent, h);
            if (lineage.depth + 1 !== snapshot.depth || lineage.ceiling !== null && (snapshot.ceiling === null || snapshot.ceiling > lineage.ceiling)) throw new BookError('INVALID_INSTANCE', 'The snapshot cannot relax its live parent lineage');
            if (!directory().some(m => m.provider === snapshot.compiled.provider && m.id === snapshot.compiled.model)) throw new BookError('UNKNOWN_MODEL', 'The original model route is unavailable');
            validateOptions(snapshot.compiled, snapshot.agentOptions);
            if (canonical(policyOf(options.parentAgent, h)) !== canonical(snapshot.inheritedPolicy)) throw new BookError('PERMISSION_CHANGED', 'Parent permissions differ from this instance snapshot; create a new instance');
            if (await artifactRevision(snapshot.compiled, h) !== snapshot.artifactRevision) throw new BookError('ARTIFACT_CHANGED', 'Original plugin code is unavailable or changed; create a new instance');
          }
          const nativeSetup = options.setup;
          return target[key]({ ...options,
            ...(pending ? { meta: pending.meta } : {}),
            ...((snapshot?.mode === 'continuable' || pending?.record.mode === 'one-shot') ? { agentOptions: snapshot.agentOptions } : {}),
            async setup(childCtx, child) {
              const nativeCommit = await nativeSetup?.(childCtx, child);
              const descriptor = h.subagent.foldSubagentDescriptor(child.session.snapshotEvents());
              if (!descriptor?.provider.startsWith('subagentbook:')) {
                if ((snapshot?.mode === 'continuable' || pending?.record.mode === 'one-shot')) throw new BookError('INVALID_INSTANCE', 'Book snapshot has no matching durable descriptor');
                return nativeCommit;
              }
              if (!snapshot || (snapshot.mode !== 'continuable' && !(pending && snapshot.mode === 'one-shot')) || descriptor.mode !== 'continuable') throw new BookError('RESUME_UNSUPPORTED', 'This book history has no supported continuable snapshot');
              const { compiled } = snapshot;
              if (descriptor.provider !== `subagentbook:${compiled.presetId}` || descriptor.agentProvider !== compiled.provider || descriptor.agentModel !== compiled.model || child.session.header.parentSession !== snapshot.parentId || child.session.header.delegationDepth !== snapshot.depth) throw new BookError('INVALID_INSTANCE', 'Book snapshot and durable session identity disagree');
              if (!Number.isSafeInteger(snapshot.depth) || snapshot.depth < 1 || snapshot.ceiling !== null && (!Number.isSafeInteger(snapshot.ceiling) || snapshot.ceiling < snapshot.depth)) throw new BookError('INVALID_INSTANCE', 'Invalid durable book depth');
              await install(childCtx, child, snapshot, h);
              // Cold histories already carry the effective role policy. Do not
              // overwrite later permission changes and silently bless them.
              if (pending) h.subagent.appendDelegatedPolicyOverrides(child.session, childPolicy(snapshot));
              if (await artifactRevision(compiled, h) !== snapshot.artifactRevision) throw new BookError('ARTIFACT_CHANGED', 'Plugin code changed during activation');
              if (pending) await assertVerificationSource(snapshot, options.signal);
              return { commit() {
                nativeCommit?.commit();
                assertParent(options.parentAgent); assertAuthority(options.parentAgent);
                options.signal?.throwIfAborted();
                validateOptions(compiled, snapshot.agentOptions);
                if (canonical(policyOf(options.parentAgent, h)) !== canonical(snapshot.inheritedPolicy)) throw new BookError('PERMISSION_CHANGED', 'Parent permissions changed during activation');
                if (pending) {
                  authorize(options.parentAgent, compiled.presetId);
                  admitChild(pending.inheritedState, ctx.subagents.resolveMaxDepth(), compiled.maxNestedDepth);
                  records.write(snapshot);
                }
              } };
            },
          });
        };
        if (snapshot?.mode !== 'continuable' && pending?.record.mode !== 'one-shot') return activate();
        const controller = new AbortController();
        const owner = ownerOf(options.parentAgent);
        options = { ...options, signal: AbortSignal.any([options.signal ?? new AbortController().signal, controller.signal, owner.controller.signal]) };
        const operation = activate();
        owner.operations.add(operation);
        initializing.set(operation, controller);
        try { return await operation; } finally { initializing.delete(operation); owner.operations.delete(operation); }
      };
    } });
  }, { global: true });

  async function providerStart(presetId, request) {
    authorize(request.parent, presetId);
    const h = await host();
    records ??= recordStore(h.home.dshHomePath('subagentbook', 'instances'));
    const route = resolveRoute(request.parent, request.agentOptions ?? {});
    const compiled = compile(presetId, route.provider, route.model);
    if (ctx.get('promptbook') && ctx.get('promptbook').autoInjectionEnabled !== false) throw new BookError('PROMPT_INJECTION_CONFLICT', 'Configure Promptbook autoInject: false for this profile');
    const parent = request.parent;
    // Independent tool scopes must not fall back to a less constrained host
    // executor when the parent uses private authority realms. That bridge is
    // not implemented, so refuse this composition explicitly.
    assertAuthority(parent);
    const inheritedState = parentState(parent, h);
    const state = admitChild(inheritedState, ctx.subagents.resolveMaxDepth(), compiled.maxNestedDepth);
    const inheritedPolicy = policyOf(parent, h);
    const childId = randomUUID();
    const meta = { ...h.subagent.childSessionMeta(parent, state.depth, false) };
    delete meta.agentPreset; // The durable book descriptor owns identity, not the parent's native preset.
    const agentOptions = childOptions(parent, compiled, state.depth, h);
    const verification = compiled.actionScope === 'verification-copy' ? await prepareVerification(inheritedPolicy, childId, request.signal, ctx.get('sandbox')) : undefined;
    if (verification) meta.cwd = verification.workspaceRoot;
    const record = freeze({
      version: 1, instanceId: childId, parentId: parent.id,
      rootId: managed.get(parent)?.record.rootId ?? parent.id,
      ...state, compiled, inheritedPolicy, agentOptions, ...(verification ? { verification } : {}),
    });
    let committed = false;
    let recordWritten = false;
    const handle = await parent.ctx.agents.create({
      sessionId: childId, parentAgent: parent, meta, signal: request.signal,
      agentOptions,
      async setup(childCtx, child) {
        await install(childCtx, child, record, h);
        await assertVerificationSource(record, request.signal);
        h.subagent.appendDelegatedPolicyOverrides(child.session, childPolicy(record));
        childCtx.effect(() => () => { if (recordWritten && !committed) records.remove(childId); }, 'subagentbook.record-rollback');
        return { commit() {
          authorize(parent, presetId);
          assertAuthority(parent);
          if (request.signal.aborted) throw new BookError('ABORTED', 'Delegation cancelled before publication');
          admitChild(inheritedState, ctx.subagents.resolveMaxDepth(), compiled.maxNestedDepth);
          validateOptions(compiled, agentOptions);
          const latestPolicy = policyOf(parent, h);
          if (JSON.stringify(latestPolicy) !== JSON.stringify(inheritedPolicy)) throw new BookError('PERMISSION_CHANGED', 'Parent permissions changed during child preparation; delegate again using the current policy');
          records.write(record); recordWritten = true;
          child.session.append('subagent/descriptor', request.descriptor);
          committed = true;
        } };
      },
    }).catch(async error => { if (recordWritten) records.remove(childId); await rollbackVerification(record, ctx.get('sandbox')); throw error; });
    if (closing) { await handle.dispose(); throw new BookError('PARENT_UNAVAILABLE', 'Book was unloaded during child creation'); }
    const child = handle.agent;
    let cancelled = false;
    let disposing;
    const cancel = () => { cancelled = true; child.cancel({ kind: 'parent' }); };
    request.signal.addEventListener('abort', cancel, { once: true });
    if (request.signal.aborted) cancel();
    const result = (async () => {
      try {
        if (!cancelled) { child.followup(h.llm.createUserMessage({ content: request.prompt, source: { kind: 'user' } })); await child.whenIdle(); }
        const events = child.session.snapshotEvents();
        const end = h.agent.foldConsumedWork(events).end;
        const reasons = { completed: 'completed', 'max-tokens': 'max-tokens', aborted: 'aborted', blocked: 'refusal' };
        const recorded = reasons[end?.data.reason?.kind] ?? 'error';
        const output = deliveryOutput(h.subagent.finalAssistantOutput(events));
        const stopReason = cancelled && recorded !== 'completed' ? 'aborted' : recorded;
        const page = stopReason === 'completed' ? reportPage((await results()).write(childId, parent.id, output)) : undefined;
        const { text: _pageText, ...report } = page ?? {};
        return { output, stopReason, ...(page ? { report } : {}),
          ...(record.verification ? { verification: await verificationView(record) } : {}) };
      } finally { request.signal.removeEventListener('abort', cancel); }
    })();
    const run = { id: childId, localAgent: child, result, dispose: () => disposing ??= (async () => {
      request.signal.removeEventListener('abort', cancel); cancel();
      const outcomes = await Promise.allSettled([handle.dispose(), result]);
      active.delete(childId);
      if (outcomes[0].status === 'rejected') throw outcomes[0].reason;
    })() };
    active.set(childId, run);
    return run;
  }

  async function trackedStart(id, request) {
    const controller = new AbortController();
    const operation = providerStart(id, { ...request, signal: AbortSignal.any([request.signal, controller.signal]) });
    initializing.set(operation, controller);
    try { return await operation; } finally { initializing.delete(operation); }
  }

  ctx.on('agent/created', async ({ agent }) => {
    await roots.created(agent);
    if (ownRecord(agent) && !managed.has(agent)) throw new BookError('RESUME_UNSUPPORTED', 'This book history has no supported continuable snapshot');
  }, { global: true });

  function validateBook(input) {
    const candidate = parseBook(input);
    const models = directory();
    for (const preset of candidate.presets) {
      if (!providers.has(preset.id) && ctx.subagents.getProvider(`subagentbook:${preset.id}`)) throw new BookError('DUPLICATE_PROVIDER', `Provider subagentbook:${preset.id} is already owned by another plugin`);
      for (const route of preset.models) {
        const model = models.find(row => row.provider === route.provider && row.id === route.model);
        if (!model) continue; // Unavailable definitions stay editable, but cannot run.
        // agentOptions itself is a top-level replacement, not a nested merge.
        const effective = route.overrides?.agentOptions ?? preset.defaults.agentOptions ?? {};
        const budget = model.budget?.defaultMaxTokens ?? model.defaultMaxTokens;
        const resolved = { ...effective, ...(effective.maxTokens === undefined && Number.isSafeInteger(budget) && budget > 0 ? { maxTokens: budget } : {}) };
        validateOptions({ provider: route.provider, model: route.model }, resolved);
      }
    }
    return candidate;
  }
  function registerPreset(id) { return ctx.subagents.registerProvider({
    name: `subagentbook:${id}`, inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    start: request => trackedStart(id, request),
    async prepareContinuable(request) {
      const pending = reservations.get(request.sessionId);
      if (!pending || pending.record.compiled.presetId !== id || pending.record.parentId !== request.parent.id) throw new BookError('UNPREPARED_INSTANCE', 'Start continuable book instances through subagentbook.startContinuable');
      authorize(request.parent, id); request.signal.throwIfAborted();
      return {};
    },
  }); }
  function updateBook(input) {
    if (closing) throw new BookError('BOOK_CLOSED', 'The book runtime is closing');
    const candidate = validateBook(input);
    const added = new Map();
    try {
      for (const preset of candidate.presets) if (!providers.has(preset.id)) added.set(preset.id, registerPreset(preset.id));
    } catch (error) { for (const dispose of added.values()) dispose(); throw error; }
    book = candidate;
    for (const [id, dispose] of providers) if (!book.presets.some(p => p.id === id)) { dispose(); providers.delete(id); }
    for (const [id, dispose] of added) providers.set(id, dispose);
    roots.changed();
    return book;
  }
  updateBook(book);
  async function startManaged(parent, request, mode) {
      if (!['continuable', 'one-shot'].includes(mode)) throw new BookError('INVALID_INSTANCE', 'Unknown activation delivery mode');
      authorize(parent, request.presetId); assertAuthority(parent); assertPrompts();
      if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new BookError('EMPTY_TASK', 'A child task is required');
      const controller = new AbortController();
      const owner = ownerOf(parent);
      const signal = AbortSignal.any([request.signal ?? new AbortController().signal, controller.signal, owner.controller.signal]);
      const operation = (async () => {
        const h = await host(); await store();
        const route = resolveRoute(parent, request);
        const compiled = compile(request.presetId, route.provider, route.model);
        const inheritedState = parentState(parent, h);
        const state = admitChild(inheritedState, ctx.subagents.resolveMaxDepth(), compiled.maxNestedDepth);
        const childId = randomUUID();
        const meta = { ...h.subagent.childSessionMeta(parent, state.depth, false) }; delete meta.agentPreset;
        const agentOptions = childOptions(parent, compiled, state.depth, h);
        const inheritedPolicy = policyOf(parent, h);
        const verification = compiled.actionScope === 'verification-copy' ? await prepareVerification(inheritedPolicy, childId, signal, ctx.get('sandbox')) : undefined;
        if (verification) meta.cwd = verification.workspaceRoot;
        let record;
        try { record = freeze({ version: 1, mode, instanceId: childId, parentId: parent.id, rootId: managed.get(parent)?.record.rootId ?? parent.id, ...state, compiled, agentOptions, inheritedPolicy, ...(verification ? { verification } : {}), artifactRevision: await artifactRevision(compiled, h) }); }
        catch (error) { if (verification) await rollbackVerification({ verification, compiled, inheritedPolicy, instanceId: childId }, ctx.get('sandbox')); throw error; }
        reservations.set(childId, { record, meta, inheritedState });
        try {
          const activation = await startLocal(ctx.subagents, { delivery: mode === 'one-shot' ? 'caller' : 'parent', provider: `subagentbook:${compiled.presetId}`, childId, label: request.label ?? book.presets.find(p => p.id === compiled.presetId).name, signal,
            request: { parent, ...(verification ? { cwd: verification.workspaceRoot } : {}), prompt: [{ type: 'text', text: request.prompt }], agentOptions } });
          if (mode !== 'one-shot') return activation;
          const localAgent = ctx.agents.get(childId);
          const cancel = () => { activation.dispose().catch(() => {}); };
          signal.addEventListener('abort', cancel, { once: true });
          if (signal.aborted) cancel();
          const result = activation.result.then(async value => {
            const output = deliveryOutput(value.output);
            const page = value.stopReason === 'completed' ? reportPage((await results()).write(childId, parent.id, output)) : undefined;
            const { text: _text, ...report } = page ?? {};
            return { ...value, output, ...(page ? { report } : {}), ...(record.verification ? { verification: await verificationView(record) } : {}) };
          });
          const run = { id: childId, localAgent, result, dispose: activation.dispose };
          active.set(childId, run);
          result.finally(() => { signal.removeEventListener('abort', cancel); active.delete(childId); }).catch(() => {});
          return run;
        } catch (error) { records.remove(childId); await rollbackVerification(record, ctx.get('sandbox')); throw error; }
        finally { reservations.delete(childId); }
      })();
      initializing.set(operation, controller);
      owner.operations.add(operation);
      try { return await operation; } finally { initializing.delete(operation); owner.operations.delete(operation); }
  }
  const api = {
    status: 'ready',
    definition: () => book,
    validateBook,
    updateBook,
    preview: (input, id, provider, model) => { assertDependencies(); return compilePreset(parseBook(input), id, provider, model, {
      models: directory(), resolveText: (key, modelId, providerId) => ctx.get('promptbook')?.resolve(key, modelId, providerId),
      resolveToolText: (key, modelId, providerId) => ctx.get('promptbook')?.resolveOverride(key, modelId, providerId),
    }); },
    listPresets: () => book.presets.map(preset => ({ id: preset.id, name: preset.name, description: preset.description ?? '', models: preset.models.map(({ provider, model }) => ({ provider, model })) })),
    compile,
    rootGuard: (agent, name) => roots.guard(agent, name),
    installRootCatalog: () => roots.installCatalog(),
    rootReady: () => roots.ready(),
    instance: agent => managed.get(agent)?.record,
    async inspectInstance(id) {
      const record = (await store()).read(id);
      const view = instanceView(record);
      if (!view) return view;
      await activityPending;
      await stagePending;
      const h = await host();
      activity ??= activityStore(h.home.dshHomePath('subagentbook', 'activity'));
      let state;
      try { state = activityView({ liveStatus: ctx.agents.get(id)?.status, settlement: activity.read(id), runtimeStartedAt, events: ctx.get('sessions')?.get(id)?.snapshotEvents() }); }
      catch { state = { state: 'unknown', source: 'unavailable' }; }
      reports ??= reportStore(h.home.dshHomePath('subagentbook', 'reports'));
      let checkpoint;
      try { const value = (await checkpoints()).read(id, record.parentId); checkpoint = value ? { available: true, seq: value.seq, at: JSON.parse(value.text).source.at } : { available: false }; }
      catch { checkpoint = { available: false }; }
      return { ...view, checkpoint, activity: state, report: savedReportStatus(reports, record), ...(record.verification ? { verification: await verificationView(record) } : {}), effectiveCeiling: Math.min(record.ceiling ?? Infinity, ctx.subagents.resolveMaxDepth()), bookChanged: record.compiled.bookRevision !== revision(book) };
    },
    async prepareRecovery(id) {
      const record = (await store()).read(id);
      if (!record) throw new BookError('RECOVERY_UNAVAILABLE', 'No book instance is available');
      const view = await api.inspectInstance(id);
      return recoveryPacket(record, (await checkpoints()).read(id, record.parentId), view);
    },
    async exportCheckpoint(id) {
      const record = (await store()).read(id);
      if (!record) throw new BookError('CHECKPOINT_UNAVAILABLE', 'No book instance is available');
      await stagePending;
      return checkpointExport((await checkpoints()).read(id, record.parentId));
    },
    async readInstance(id) { const h = await host(); records ??= recordStore(h.home.dshHomePath('subagentbook', 'instances')); return records.read(id); },
    // Authenticated owner UI/offline export, not a model tool. Parent-scoped
    // model access remains enforced separately by readResult below.
    async exportReport(id) {
      const record = (await store()).read(id);
      if (!record || ['root', 'continuable'].includes(record.mode)) throw new BookError('REPORT_UNAVAILABLE', 'An existing one-shot book report is required');
      return reportExport(record, (await results()).read(id, record.parentId));
    },
    async readResult(parent, request) {
      assertParent(parent); assertAuthority(parent);
      const h = await host();
      const snapshot = (await store()).read(request.sessionId);
      if (!snapshot || snapshot.parentId !== parent.id) throw new BookError('UNAUTHORIZED', 'Results require the original live direct parent of a one-shot book child');
      if (canonical(snapshot.inheritedPolicy) !== canonical(policyOf(parent, h))) throw new BookError('PERMISSION_CHANGED', 'Parent permissions differ from this result snapshot');
      if (request.kind !== undefined && !['final', 'checkpoint'].includes(request.kind)) throw new BookError('INVALID_REPORT_KIND', 'Use final or checkpoint');
      const isCheckpoint = request.kind === 'checkpoint';
      if (!isCheckpoint && ['continuable', 'root'].includes(snapshot.mode)) throw new BookError('REPORT_UNAVAILABLE', 'Final results require a one-shot child');
      if (isCheckpoint) await stagePending;
      const saved = isCheckpoint ? (await checkpoints()).read(request.sessionId, parent.id) : (await results()).read(request.sessionId, parent.id);
      if (!saved) throw new BookError('CHECKPOINT_UNAVAILABLE', 'No saved stage checkpoint is available');
      assertParent(parent); assertAuthority(parent);
      if (canonical(snapshot.inheritedPolicy) !== canonical(policyOf(parent, h))) throw new BookError('PERMISSION_CHANGED', 'Parent permissions changed while reading the saved result');
      return { ...reportPage(saved, request.offset, request.limit, request.sha256), ...(isCheckpoint ? { kind: 'checkpoint', final: false, seq: saved.seq } : {}) };
    },
    startContinuable: (parent, request) => startManaged(parent, request, 'continuable'),
    async sendMessage(sender, targetId, content, options = {}) {
      assertParent(sender);
      if (typeof content !== 'string' || !content.trim()) throw new BookError('EMPTY_TASK', 'A message is required');
      const snapshot = (await store()).read(targetId);
      const own = managed.get(sender)?.record;
      const toParent = own?.mode === 'continuable' && own.parentId === targetId;
      if (!toParent && (snapshot?.mode !== 'continuable' || snapshot.parentId !== sender.id)) throw new BookError('UNAUTHORIZED', 'Messages require a book direct child or its live direct parent');
      if (!toParent && canonical(snapshot.inheritedPolicy) !== canonical(policyOf(sender, await host()))) throw new BookError('PERMISSION_CHANGED', 'Parent permissions differ from this instance snapshot');
      assertParent(sender);
      return ctx.subagents.sendMessage(sender, targetId, [{ type: 'text', text: content }], { signal: options.signal ?? new AbortController().signal });
    },
    async interrupt(parent, targetId) {
      assertParent(parent);
      const snapshot = (await store()).read(targetId);
      if (snapshot?.mode !== 'continuable' || snapshot.parentId !== parent.id) throw new BookError('UNAUTHORIZED', 'Only the live direct parent can stop this book child');
      ctx.subagents.interrupt(targetId, { kind: 'ancestor', agent: parent });
    },
    async start(parent, request) {
      authorize(parent, request.presetId);
      const route = resolveRoute(parent, request);
      compile(request.presetId, route.provider, route.model);
      if (typeof request.prompt !== 'string' || !request.prompt.trim()) throw new BookError('EMPTY_TASK', 'A child task is required');
      if (usesActivations(ctx.subagents)) return startManaged(parent, request, 'one-shot');
      return ctx.subagents.start(`subagentbook:${request.presetId}`, {
        parent, signal: request.signal ?? new AbortController().signal,
        label: request.label ?? book.presets.find(p => p.id === request.presetId).name,
        prompt: [{ type: 'text', text: request.prompt }], agentOptions: route,
      });
    },
  };
  ctx.on('agent/request', async (payload, next) => roots.request(payload.agent, await next()), { global: true });
  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    let result = await next();
    if (await roots.prepare(result, context)) result = await ctx.systemPrompt.assemble(context);
    const parent = context.agent;
    if (!parent) return result;
    if (ownRecord(parent) && !managed.has(parent)) throw new BookError('RESUME_UNSUPPORTED', 'Cold resume of a book instance is not supported yet');
    if (typeof result.variables.provider === 'string' && typeof result.variables.model === 'string') pendingRoutes.set(parent, { provider: result.variables.provider, model: result.variables.model });
    const permitted = choices(parent);
    const current = managed.get(parent);
    const limit = ctx.subagents.resolveMaxDepth();
    const canDelegate = permitted.length > 0 && (current?.depth ?? parent.session.header.delegationDepth ?? 0) < Math.min(limit, current?.ceiling ?? Infinity);
    result.tools = result.tools.filter(tool => tool.name !== DELEGATE_TOOL || canDelegate);
    const hasResult = parent.session.snapshotEvents().some(e => {
      if (e.type !== 'subagent/catalog') return false;
      try { const saved = records?.read(e.data.childId); return saved?.parentId === parent.id; } catch { return false; }
    });
    result.tools = result.tools.filter(tool => tool.name !== RESULT_TOOL || canDelegate || hasResult);
    const canControl = current?.record.mode === 'continuable' || parent.session.snapshotEvents().some(e => {
      if (e.type !== 'subagent/catalog' || e.data.mode !== 'continuable') return false;
      try { return records?.read(e.data.childId)?.mode === 'continuable'; } catch { return false; }
    });
    result.tools = result.tools.filter(tool => ![MESSAGE_TOOL, STOP_TOOL].includes(tool.name) || canControl);
    for (const tool of result.tools) if (tool.name === MESSAGE_TOOL && current?.record.mode !== 'continuable') tool.description = 'Send a follow-up message to your continuable book direct child. Use the returned childId as sessionId. Returns after inbox acceptance; execution continues in the background.';
    for (const tool of result.tools) if (tool.name === DELEGATE_TOOL) {
      tool.parameters = { ...tool.parameters, properties: { ...tool.parameters.properties, preset: { type: 'string', enum: permitted } } };
      tool.description = 'Delegate a task to a registered role preset. The child uses its configured model-specific tools and persona and receives only this task. By default wait for its one-shot final delivery text; if report.nextOffset is not null, use subagentbook_result with sessionId, sha256 and the returned offset until nextOffset is null. Reasoning stays in the child history. background:true creates a continuable conversation and returns at inbox acceptance. Follow up with subagentbook_message; completion is reported automatically.\n' + permitted.map(id => {
        const p = book.presets.find(preset => preset.id === id);
        return `${id}: ${p.description || p.name}; models: ${p.models.map(m => {
          const scope = m.overrides?.actionScope ?? p.defaults.actionScope ?? 'inherit';
          const detail = scope === 'verification-copy' ? 'automatic independent Git copy; source read-only; build/test in the provided child workspace; do not ask it to create another copy; requires a writable direct parent' : scope === 'read-only' ? 'source read-only' : 'inherits parent file permissions';
          return `${m.provider}/${m.model} [${scope}: ${detail}]`;
        }).join(', ')}`;
      }).join('\n');
    }
    return result;
  }, { global: true });
  ctx.tools.register({
    name: DELEGATE_TOOL, description: 'Delegate a task using a registered Subagentbook preset.',
    parameters: { type: 'object', additionalProperties: false, required: ['preset', 'prompt'], properties: {
      preset: { type: 'string' }, prompt: { type: 'string' }, label: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, background: { type: 'boolean' },
    } },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (args.background === true) {
        const activation = await api.startContinuable(exec.agent, { presetId: args.preset, prompt: args.prompt, label: args.label, provider: args.provider, model: args.model, signal: exec.signal });
        // Host activation handles own lifecycle promises/functions; tools expose only the receipt.
        return { childId: activation.childId, ...(activation.messageId === undefined ? {} : { messageId: activation.messageId }) };
      }
      const run = await api.start(exec.agent, { presetId: args.preset, prompt: args.prompt, label: args.label, provider: args.provider, model: args.model, signal: exec.signal });
      try {
        const result = await run.result;
        if (result.stopReason !== 'completed') throw new BookError('CHILD_FAILED', `Child ${run.id} ended with ${result.stopReason}`);
        const page = await api.readResult(exec.agent, { sessionId: run.id });
        return { ...result, sessionId: run.id, output: page.text ? [{ type: 'text', text: page.text }] : [] };
      } finally { await run.dispose(); }
    },
  });
  ctx.tools.register({
    name: RESULT_TOOL, description: `Read the immutable final delivery text of your one-shot direct child, including after it is disposed. Use sessionId and the nextOffset/sha256 from its result. Reads at most ${REPORT_PAGE_CHARS} UTF-16 characters per call; follow nextOffset until null. Use kind:checkpoint to read the latest provisional stage checkpoint of a direct child (one-shot or continuable); it may change and is never a final report. No host file path is needed. This is a report, not permission or proof of successful tests.`,
    parameters: { type: 'object', additionalProperties: false, required: ['sessionId'], properties: {
      sessionId: { type: 'string' }, kind: { type: 'string', enum: ['final', 'checkpoint'] }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: REPORT_PAGE_CHARS }, sha256: { type: 'string' },
    } },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: (args, exec) => api.readResult(exec.agent, args),
  });
  for (const [name, description, action] of [
    [MESSAGE_TOOL, 'Send a follow-up message to your continuable book child, or report to your direct parent. Returns after inbox acceptance; execution continues in the background.', async (args, exec) => ({ messageId: await api.sendMessage(exec.agent, args.sessionId, args.message, { signal: exec.signal }) })],
    [STOP_TOOL, 'Interrupt the current work of your continuable book direct child. The conversation remains available for later messages.', async (args, exec) => { await api.interrupt(exec.agent, args.sessionId); return { interrupted: args.sessionId }; }],
  ]) ctx.tools.register({ name, description,
    parameters: { type: 'object', additionalProperties: false, required: name === MESSAGE_TOOL ? ['sessionId', 'message'] : ['sessionId'], properties: { sessionId: { type: 'string' }, ...(name === MESSAGE_TOOL ? { message: { type: 'string' } } : {}) } },
    output: { schema: { type: 'object' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }, execute: action,
  });
  ctx.effect(() => async () => {
    closing = true;
    await roots.close();
    for (const controller of initializing.values()) controller.abort();
    await Promise.allSettled([...initializing.keys()]);
    const owners = new Map();
    for (const [id, value] of continuable) {
      const parent = ctx.agents.get(value.parentId);
      if (parent) { if (!owners.has(parent)) owners.set(parent, []); owners.get(parent).push(id); }
    }
    await Promise.all([...owners].map(([parent, ids]) => drainChildren(ctx.subagents, parent, ids)));
    const outcomes = await Promise.allSettled([...active.values()].map(run => run.dispose()));
    const failures = outcomes.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'Book child disposal failed');
  }, 'subagentbook.runs');
  return api;
}

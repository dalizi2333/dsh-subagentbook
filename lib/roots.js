import { BookError, canonical, fixedToolPlugins, freeze } from './book.js';
import { artifactRevision } from './artifacts.js';
import { TASK_TOOL_NAMES } from './definition.js';
import { assertFixedComposition } from './composition.js';

export const ROOT_PREFIX = 'subagentbook-root:';
export const rootPresetId = id => ROOT_PREFIX + Buffer.from(id).toString('base64url');

export function createRoots({ ctx, host, store, compile, validateOptions, policyOf, assertPrompts, managed, requestSnapshots, definition, isClosing }) {
  const live = new Map(), listeners = new Set();
  let catalogReady = Promise.resolve(), loadedHost;
  const getHost = async () => loadedHost ??= await host();
  const rootPolicy = (agent, h) => ({ ...policyOf(agent, h), ...(agent.ctx.get('approval') ? { approvalPolicy: agent.ctx.get('approval').effectivePolicy(agent.session) } : {}) });
  const marker = agent => ctx.get('agentPresets')?.serviceFor(agent, 'subagentbookRoot');
  const nativeId = agent => ctx.get('sessionProjections')?.stateOf(agent.session, 'agentPreset') ?? agent.session.header.agentPreset;
  const isRoot = agent => typeof nativeId(agent) === 'string' && nativeId(agent).startsWith(ROOT_PREFIX);
  const fingerprint = (record, h) => artifactRevision({ ...record.compiled, plugins: fixedToolPlugins(record.rootTools) }, h);
  const effective = record => record.effectivePolicy;
  function assertPolicy(agent, record, h) {
    if (isClosing()) throw new BookError('BOOK_CLOSED', 'The root book runtime is closing');
    assertPrompts(); validateOptions(record.compiled, record.agentOptions);
    if (nativeId(agent) !== rootPresetId(record.compiled.presetId) || agent.session.header.cwd !== record.effectivePolicy.workspaceRoot ||
      canonical(rootPolicy(agent, h)) !== canonical(effective(record))) throw new BookError('PERMISSION_CHANGED', 'Root identity, workspace or permissions differ from the frozen instance');
  }
  function bind(agent, record) {
    managed.set(agent, { depth: 0, ceiling: null, compiled: record.compiled, record });
    live.set(agent.id, agent);
    if (record.compiled.agentOptions.requestFields?.length) requestSnapshots.set(agent.id, record.compiled);
    agent.ctx.effect(() => () => { managed.delete(agent); requestSnapshots.delete(agent.id); live.delete(agent.id); }, 'subagentbook.root-instance');
  }
  async function prepare(assembly, context) {
    const agent = context.agent;
    if (!agent || !isRoot(agent) || managed.get(agent)?.record.mode === 'continuable') return;
    const entry = marker(agent);
    if (!entry || rootPresetId(entry.presetId) !== nativeId(agent)) throw new BookError('ROOT_UNAVAILABLE', 'This root role has no supported native composition');
    const h = await getHost();
    let refreshPolicy = false;
    let record = managed.get(agent)?.record;
    if (!record) {
      if (!context.signal) { assembly.variables.subagentbook_root_persona = ''; assembly.tools = []; return; }
      if (agent.session.header.parentSession || (agent.session.header.delegationDepth ?? 0) !== 0 || h.subagent.foldSubagentDescriptor(agent.session.snapshotEvents())) throw new BookError('ROOT_LINEAGE', 'A book root cannot adopt a child or fork history');
      const storage = await store();
      if (storage.read(agent.id) || agent.session.requestHeader()) throw new BookError('INVALID_INSTANCE', 'This root history requires its original frozen snapshot');
      assertPrompts();
      const compiled = compile(entry.presetId, assembly.variables.provider, assembly.variables.model);
      if (compiled.actionScope === 'verification-copy') throw new BookError('VERIFICATION_UNAVAILABLE', 'Verification-copy roles must be delegated by a writable runner, not selected as roots');
      if (compiled.tools.some(tool => !entry.tools.includes(tool))) throw new BookError('ROOT_COMPOSITION_CHANGED', 'Recreate this blank session to load the updated role tools');
      const inheritedPolicy = rootPolicy(agent, h);
      if (compiled.actionScope === 'read-only' && (!ctx.get('sandboxPolicy') || !ctx.get('fs') || ctx.get('shell')?.sandboxMode === undefined)) throw new BookError('READ_ONLY_UNSUPPORTED', 'Read-only roots require the native confining executor');
      const effectivePolicy = compiled.actionScope === 'read-only' ? { ...inheritedPolicy, sandboxMode: 'read-only', approvalPolicy: 'never' } : inheritedPolicy;
      const agentOptions = { provider: compiled.provider, model: compiled.model, ...compiled.agentOptions };
      delete agentOptions.requestFields;
      validateOptions(compiled, agentOptions);
      const candidate = { version: 1, mode: 'root', instanceId: agent.id, rootId: agent.id, depth: 0, ceiling: null,
        compiled, rootTools: [...entry.tools], inheritedPolicy, effectivePolicy, agentOptions };
      const code = await fingerprint(candidate, h);
      context.signal.throwIfAborted();
      if (canonical(compiled) !== canonical(compile(entry.presetId, compiled.provider, compiled.model)) || canonical(rootPolicy(agent, h)) !== canonical(inheritedPolicy) || canonical(marker(agent)) !== canonical(entry)) throw new BookError('ROOT_CHANGED', 'Role or authority changed while preparing this root; retry');
      record = freeze({ ...candidate, artifactRevision: code });
      // Role selection only narrows the native user-selected policy.
      if (compiled.actionScope === 'read-only' && canonical(inheritedPolicy) !== canonical(effectivePolicy)) {
        h.subagent.appendDelegatedPolicyOverrides(agent.session, effectivePolicy); refreshPolicy = true;
      }
      storage.write(record); bind(agent, record);
    }
    assertPolicy(agent, record, h);
    if (assembly.variables.provider !== record.compiled.provider || assembly.variables.model !== record.compiled.model) throw new BookError('MODEL_PINNED', 'Start a new root conversation to change this book instance model');
    assembly.variables.subagentbook_root_persona = [record.compiled.persona, record.compiled.preference].filter(Boolean).join('\n\n');
    const allowed = allowedTools(record);
    assembly.tools = assembly.tools.filter(tool => allowed.has(tool.name));
    for (const tool of assembly.tools) if (record.compiled.teaching[tool.name] !== undefined) tool.description = record.compiled.teaching[tool.name];
    return refreshPolicy;
  }
  function allowedTools(record) {
    return new Set([...record.compiled.tools, ...(record.compiled.delegates.length ? ['subagentbook', 'subagentbook_result', 'subagentbook_message', 'subagentbook_stop'] : [])]);
  }
  return {
    isRoot,
    prepare,
    async request(agent, result) {
      const record = managed.get(agent)?.record;
      if (record?.mode !== 'root') return result;
      const h = await getHost(); assertPolicy(agent, record, h);
      if (result.provider !== record.compiled.provider || result.model !== record.compiled.model) throw new BookError('MODEL_PINNED', 'Start a new root conversation to change this book instance model');
      const { maxTokens: _budget, reasoningEffort: _effort, ...base } = result;
      return { ...base, ...record.agentOptions };
    },
    guard(agent, name) {
      const state = managed.get(agent)?.record;
      if (state && state.mode !== 'root') return undefined;
      if (!state) return 'The book root has not prepared a model-specific instance';
      if (isClosing()) return 'The root book runtime is closing';
      if (!loadedHost) return 'The root runtime is not prepared';
      assertPolicy(agent, state, loadedHost);
      return allowedTools(state).has(name) ? undefined : `Tool ${name} is not available in this book root`;
    },
    async restore(agent, record, options) {
      const h = await getHost(); assertPrompts(); assertFixedComposition(record.compiled);
      if (!Array.isArray(record.rootTools) || record.rootTools.some(name => !TASK_TOOL_NAMES.includes(name)) || record.compiled.tools.some(name => !record.rootTools.includes(name)) ||
        record.compiled.actionScope === 'read-only' && (record.effectivePolicy?.sandboxMode !== 'read-only' || record.effectivePolicy?.approvalPolicy !== 'never')) throw new BookError('INVALID_INSTANCE', 'Invalid root capability or permission snapshot');
      if (options.parentAgent || record.depth !== 0 || record.ceiling !== null || record.rootId !== agent.id || record.parentId !== undefined || agent.session.header.parentSession ||
        (agent.session.header.delegationDepth ?? 0) !== 0 || h.subagent.foldSubagentDescriptor(agent.session.snapshotEvents()) || nativeId(agent) !== rootPresetId(record.compiled.presetId)) throw new BookError('INVALID_INSTANCE', 'Root snapshot and durable native identity disagree');
      const entry = marker(agent);
      if (!entry || entry.presetId !== record.compiled.presetId || record.compiled.tools.some(tool => !entry.tools.includes(tool))) throw new BookError('ROOT_UNAVAILABLE', 'Original root capabilities are unavailable');
      if (await fingerprint(record, h) !== record.artifactRevision) throw new BookError('ARTIFACT_CHANGED', 'Original root plugin code is unavailable or changed');
      assertPolicy(agent, record, h); bind(agent, record);
      return () => assertPolicy(agent, record, h);
    },
    async created(agent) {
      if (!isRoot(agent) || managed.has(agent)) return;
      if (!marker(agent) || agent.session.requestHeader() || agent.session.header.parentSession) throw new BookError('INVALID_INSTANCE', 'This root history has no supported frozen snapshot');
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    changed() { for (const listener of listeners) listener(); },
    ready: () => catalogReady,
    installCatalog() {
      ctx.inject(['agentPresets'], async local => {
        const catalog = new Map();
        let stopped = false;
        const refresh = async () => {
          const storage = await store();
          const history = storage.roots();
          const roles = new Map(history.map(record => [record.compiled.presetId, { name: `${record.compiled.name} · 历史会话`, historical: true, tools: [] }]));
          for (const preset of definition().presets) {
            if (preset.models.every(route => (route.overrides?.actionScope ?? preset.defaults.actionScope) === 'verification-copy')) continue;
            roles.set(preset.id, { name: preset.name, historical: false, tools: preset.models.flatMap(route => route.overrides?.tools ?? preset.defaults.tools) });
          }
          for (const record of history) roles.get(record.compiled.presetId).tools.push(...record.rootTools);
          for (const [id, role] of roles) {
            const tools = [...new Set(role.tools)].sort();
            const signature = canonical({ ...role, tools });
            if (catalog.get(id)?.signature === signature) continue;
            await catalog.get(id)?.dispose(); catalog.delete(id);
            if (stopped) return;
            const dispose = await local.agentPresets.register({ id: rootPresetId(id), name: role.name,
              description: role.historical ? '仅恢复原根会话；此角色已从当前书删除。' : '子代理书根角色；模型使用原有选择器，首次请求后固定实例。',
              plugins: [...fixedToolPlugins(tools), { id: 'book-root', name: new URL('./root-preset.js', import.meta.url).href,
                isolate: { subagentbookRoot: true }, config: { presetId: id, tools } }] });
            catalog.set(id, { signature, dispose });
          }
          for (const [id, entry] of catalog) if (!roles.has(id)) { await entry.dispose(); catalog.delete(id); }
        };
        const schedule = () => { catalogReady = catalogReady.catch(() => {}).then(refresh); catalogReady.catch(error => local.logger.warn(`Book root catalog: ${error.message}`)); return catalogReady; };
        const off = this.subscribe(schedule);
        local.effect(() => async () => { stopped = true; off(); await catalogReady.catch(() => {}); await Promise.all([...catalog.values()].map(entry => entry.dispose())); }, 'subagentbook.root-catalog');
        await schedule();
      });
    },
    async close() { for (const agent of live.values()) agent.cancel({ kind: 'parent' }); await Promise.allSettled([...live.values()].map(agent => agent.whenIdle())); },
  };
}

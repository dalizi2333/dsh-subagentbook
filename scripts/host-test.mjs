import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { runtimeRequire, linkRuntime } from './runtime-path.mjs';
import { teachingFixture } from './teaching-fixture.mjs';

const require = runtimeRequire();
const activationHost = require('@deepseek-ai/dsh/package.json').version === '0.2.1-rc.5';
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { boot } = await load('@deepseek-ai/dsh-app-boot');
const { installModelSelection } = await load('@deepseek-ai/dsh-agent');
const { LlmAdapter } = await load('@deepseek-ai/dsh-llm');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const home = mkdtempSync(join(tmpdir(), 'subagentbook-host-'));
linkRuntime(home, require);
const oldHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
const captured = [];
const instances = [];
const checks = [];
const longReport = 'HEAD\n' + '引用\"与换行\n🧪'.repeat(10000) + '\nTAIL';
let prepared;
let release;
let declaredOutputLimit = 8192;
const teaching = teachingFixture({ 'tool.bash': { default: 'fixture Bash teaching' }, 'tool.bash.only': { flash: 'fixture solo Bash teaching' } });
let importFailure = false;
let releasePin;
async function waitWire(predicate) { const deadline=Date.now()+10000; while(!predicate()) { if(Date.now()>deadline)throw new Error('Fixture request did not start');await new Promise(resolve=>setTimeout(resolve,5)); } }
let modelDirectory;
class Adapter extends LlmAdapter {
  providerInfo(id) { return { id, name: 'Offline fixture' }; }
  async resolveModel(provider, id) { return { provider, id, name: id, contextWindow: 131072, maxTokens: 8192 }; }
  async listModels(provider) { return ['flash', 'pro'].map(id => ({ provider, id, name: id })); }
  async *stream(options) {
    captured.push(options);
    const prompt = options.messages.filter(m => m.role === 'user').flatMap(m => m.content).find(block => block.type === 'text')?.text ?? '';
    if (prompt === 'pin-wait') await new Promise(resolve=>{releasePin=resolve; options.signal.addEventListener('abort',resolve,{once:true});});
    if (prompt === 'fail') { yield { type: 'finish', reason: { kind: 'max-tokens' } }; return; }
    if (prompt === 'wait') {
      await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
      yield { type: 'finish', reason: { kind: 'aborted' } }; return;
    }
    if (['chain', 'delegate-wait'].includes(prompt) && !options.messages.some(m => m.role === 'tool') && options.tools.some(t => t.name === 'subagentbook')) {
      const id = `delegate-${captured.length}`;
      const args = JSON.stringify({ preset: 'worker', prompt: prompt === 'delegate-wait' ? 'wait' : 'chain' });
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'tool-call-delta', index: 0, id, name: 'subagentbook', argumentsDelta: args };
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'subagentbook', arguments: args } };
      yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
    }
    if (prompt === 'long-report') {
      yield { type: 'block-start', index: 0, blockType: 'reasoning' };
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'PRIVATE_THINKING_MUST_STAY_IN_CHILD' } };
      yield { type: 'block-start', index: 1, blockType: 'text' };
      yield { type: 'block-end', index: 1, block: { type: 'text', text: longReport } };
      yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    const result = 'fixture complete';
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: result };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: result } };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
const modelRows = marker => ['flash', 'pro'].map(model => ({ provider: 'fixture', model, overrides: {
  persona: { text: `persona:${marker}:${model}` }, tools: model === 'pro' ? ['bash', 'read'] : ['bash'],
} }));
const book = { version: 1, entryPresets: ['worker', 'zero', 'limited', 'slow'], presets: [
  { id: 'worker', name: 'Worker', defaults: { delegates: ['worker'] }, models: modelRows('worker') },
  { id: 'zero', name: 'Leaf', defaults: { maxNestedDepth: 0, delegates: ['worker'] }, models: modelRows('zero') },
  { id: 'limited', name: 'Limited', defaults: { maxNestedDepth: 1, delegates: ['worker'] }, models: modelRows('limited') },
  { id: 'slow', name: 'Slow', defaults: { persona: { text: 'slow' }, tools: ['bash'] }, models: [{ provider: 'fixture', model: 'pro' }] },
] };
const config = [
  ...['typert-registry', 'llm', 'session', 'session-projection', 'session-query', 'sandbox-policy', 'fs-sandbox', 'user-approval', 'agent', 'tools', 'system-prompt', ...(require('@deepseek-ai/dsh/package.json').version === '0.2.1-rc.5' ? ['working-directory'] : []), 'agent-loop', 'subagent'].map(id => ({ id: id === 'typert-registry' ? 'typert' : id, name: `@deepseek-ai/dsh-${id}`, ...(id === 'subagent' ? { config: { maxDepth: 3 } } : {}) })),
  { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' },
  { id: 'sandbox', name: '@deepseek-ai/dsh-sandbox-local' },
  { id: 'bash-sandbox', name: '@deepseek-ai/dsh-bash-sandbox', config: { timeoutMs: 60000 } },
  { id: 'shell-env', name: '@deepseek-ai/dsh-shell-env', config: { dshHome: home } },
  { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
  { id: 'preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'native-fixture' } },
  { id: 'native-preset', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'native-fixture', name: 'Native preset fixture', plugins: [
    { id: 'native-fs', name: '@deepseek-ai/dsh-tool-fs' },
  ] } },
  { id: 'adapter', name: 'cordis:book-adapter' },
  { id: 'book', name: pathToFileURL(join(root, 'lib/index.js')).href, config: { bookJson: JSON.stringify(book) } },
];
const file = join(home, 'cordis.yml');
writeFileSync(file, yaml.dump(config));
let ctx;
let parent;
const report = name => { checks.push(name); console.log(`  PASS ${name}`); };
try {
  ctx = await boot('subagentbook-host', file, [], ctx => {
    ctx.provide('llmMimo', modelDirectory = { listHostedModels: () => ['flash', 'pro'].map(id => ({ provider: 'fixture', id, budget: { contextWindow: 131072, defaultMaxTokens: 8192, maxOutputTokens: declaredOutputLimit } })) });
    ctx.provide('promptbook', teaching);
    ctx.loader.builtins['book-adapter'] = { inject: ['llm'], apply: ctx => { ctx.llm.registerAdapter(['fixture'], new Adapter()); } };
  }, pathToFileURL(require.resolve('@deepseek-ai/dsh/package.json')).href);
  // Fault injection lives in this trusted host test, never in book JSON.
  const owner = ctx.loader.resolve('include').subtree.resolve('book').parent.tree;
  const nativeImport = owner.import.bind(owner);
  owner.import = async (name, ...args) => {
    if (name === '@deepseek-ai/dsh-tool-bash') {
      if (importFailure) { importFailure = false; throw new Error('fixture import failure'); }
      if (prepared) { const notify = prepared; prepared = undefined; notify(); await new Promise(resolve => { release = resolve; }); }
    }
    return nativeImport(name, ...args);
  };
  const api = ctx.get('subagentbook');
  assert.equal(api.status, 'ready');
  parent = await ctx.get('agents').create({ sessionId: 'root-fixture', agentOptions: { provider: 'fixture', model: 'pro' }, meta: { cwd: home },
    async setup(childCtx) { await ctx.get('agentPresets').mount(childCtx, 'native-fixture'); } });
  assert.equal(ctx.get('agentPresets').composedPreset(parent.agent.ctx), 'native-fixture');
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  const resolveOverride = teaching.resolveOverride; teaching.resolveOverride = undefined;
  await assert.rejects(api.start(parent.agent, { presetId: 'worker', prompt: 'missing dependency' }), { code: 'MISSING_DEPENDENCY' });
  assert.equal(captured.length, 0); teaching.resolveOverride = resolveOverride;
  const listHostedModels = modelDirectory.listHostedModels; modelDirectory.listHostedModels = undefined;
  await assert.rejects(api.start(parent.agent, { presetId: 'worker', prompt: 'missing model directory' }), { code: 'MISSING_DEPENDENCY' });
  assert.equal(captured.length, 0); modelDirectory.listHostedModels = listHostedModels;
  report('missing mandatory Promptbook or llm-mimo contract refuses creation before model dispatch');
  const run = await api.start(parent.agent, { presetId: 'worker', prompt: 'report' });
  instances.push(run.localAgent);
  const record = api.instance(run.localAgent);
  assert.ok(record, 'unpublished setup installed the snapshot before activation acceptance');
  assert.equal((await run.result).stopReason, 'completed');
  const request = captured.at(-1);
  assert.ok(['bash', 'glob', 'read', 'grep', 'edit', 'write', 'web_search', 'web_fetch'].every(name => teaching.definition(`tool.${name}`)));
  assert.ok(teaching.definition('tool.bash.only'));
  assert.deepEqual(request.tools.map(tool => tool.name).sort(), ['bash', 'read', 'subagentbook', 'subagentbook_result']);
  assert.ok(request.messages.some(m => m.role === 'system' && m.content.some(b => b.text === 'persona:worker:pro')));
  assert.equal(request.tools.find(t => t.name === 'bash').description, 'fixture Bash teaching');
  if(activationHost) assert.equal(ctx.agents.get(run.id), undefined, 'native activation tears down before delivering the result');
  else assert.equal(ctx.agents.get(run.id), run.localAgent);
  assert.deepEqual(await api.readInstance(run.id), record);
  const shown = await api.inspectInstance(run.id);
  assert.equal(shown.persona, record.compiled.persona);
  assert.deepEqual(shown.tools, record.compiled.tools);
  assert.equal(shown.bookChanged, false);
  assert.equal(shown.effectiveCeiling, 3);
  assert.equal(await api.inspectInstance('missing-instance'), null);
  await assert.rejects(api.inspectInstance('../escape'), { code: 'INVALID_INSTANCE' });
  report('read-only instance diagnostics use the original record and reject path traversal');
  const exportedReport = await api.exportReport(run.id);
  assert.equal(exportedReport.text, (await run.result).output.filter(block => block.type === 'text').map(block => block.text).join('\n\n'));
  assert.equal(exportedReport.parentId, parent.agent.id);
  assert.equal(exportedReport.source.role, 'worker');
  assert.equal(exportedReport.sha256, (await api.readResult(parent.agent, { sessionId: run.id })).sha256);
  await assert.rejects(api.exportReport('../escape'), { code: 'INVALID_INSTANCE' });
  await assert.rejects(api.exportReport('missing-instance'), { code: 'REPORT_UNAVAILABLE' });
  report('owner export preserves the saved delivery and source; model result access keeps its direct-parent guard');


  await assert.rejects(api.start(parent.agent, { prompt: 'missing preset' }), error => error.code === 'INVALID_PRESET' && /Allowed role IDs.*worker/.test(error.message));
  const invoke = (agent, name, args) => ctx.get('tools').execute({ agent, name, callId: `reports-${Date.now()}`, arguments: args, signal: new AbortController().signal });
  const missingPreset = await invoke(parent.agent, 'subagentbook', { prompt: 'missing preset' });
  assert.equal(missingPreset.isError, true); assert.match(JSON.stringify(missingPreset), /Missing required preset.*Allowed role IDs/);
  const delivered = await invoke(parent.agent, 'subagentbook', { preset: 'worker', prompt: 'long-report' });
  assert.equal(delivered.isError, false, JSON.stringify(delivered));
  assert.ok(JSON.stringify(delivered.value).length < 30000);
  assert.ok(delivered.value.output.every(b => b.type === 'text'));
  assert.ok(!JSON.stringify(delivered.value).includes('PRIVATE_THINKING'));
  let assembled = delivered.value.output.map(b => b.text).join('');
  const { sessionId } = delivered.value; const hash = delivered.value.report.sha256;
  let offset = delivered.value.report.nextOffset;
  while (offset !== null) {
    const page = await invoke(parent.agent, 'subagentbook_result', { sessionId, offset, sha256: hash });
    assert.equal(page.isError, false, JSON.stringify(page)); assert.ok(JSON.stringify(page.value).length < 30000);
    assembled += page.value.text; offset = page.value.nextOffset;
  }
  assert.equal(assembled, longReport); assert.equal(hash, createHash('sha256').update(longReport).digest('hex'));
  assert.equal(ctx.agents.get(sessionId), undefined, 'one-shot child has been disposed before page reads');
  await assert.rejects(api.readResult(run.localAgent, { sessionId, kind: 'checkpoint' }), { code: activationHost ? 'PARENT_UNAVAILABLE' : 'UNAUTHORIZED' });
  await assert.rejects(api.readResult(run.localAgent, { sessionId }), { code: activationHost ? 'PARENT_UNAVAILABLE' : 'UNAUTHORIZED' });
  const foreign=await ctx.agents.create({sessionId:'foreign-live-parent',meta:{cwd:home},agentOptions:{provider:'fixture',model:'pro'}});
  try { for(const kind of ['checkpoint','final']) await assert.rejects(api.readResult(foreign.agent,{sessionId,kind}),{code:'UNAUTHORIZED'}); } finally { await foreign.dispose(); }
  await assert.rejects(api.readResult(parent.agent, { sessionId: '../escape' }), { code: 'INVALID_INSTANCE' });
  await assert.rejects(api.readResult(parent.agent, { sessionId, sha256: 'wrong' }), { code: 'REPORT_UNAVAILABLE' });
  await assert.rejects(api.readResult(parent.agent, { sessionId, offset: -1 }), { code: 'INVALID_REPORT_PAGE' });
  parent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  await assert.rejects(api.readResult(parent.agent, { sessionId, kind: 'checkpoint' }), { code: 'PERMISSION_CHANGED' });
  await assert.rejects(api.readResult(parent.agent, { sessionId }), { code: 'PERMISSION_CHANGED' });
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  const reportFile = join(home, 'subagentbook/reports', `${sessionId}.json`), savedReport = readFileSync(reportFile);
  writeFileSync(reportFile, '{}'); await assert.rejects(api.readResult(parent.agent, { sessionId }), { code: 'REPORT_UNAVAILABLE' }); writeFileSync(reportFile, savedReport);
  assert.equal((await api.readResult(parent.agent, { sessionId })).sha256, hash);
  report('bounded delivery omits reasoning; the original authorized parent pages back the complete report after child disposal, with hash, ownership and policy checks');

  assert.equal(record.depth, 1); assert.equal(record.compiled.presetId, 'worker');
  assert.ok(run.localAgent.session.snapshotEvents().some(e => e.type === 'subagent/descriptor'));
  assert.ok(parent.agent.session.snapshotEvents().some(e => e.type === 'subagent/catalog'));
  const denied = await ctx.get('tools').execute({ agent: run.localAgent, callId: 'denied', name: 'write', arguments: {}, signal: new AbortController().signal });
  assert.equal(denied.isError, true); assert.ok(!existsSync(join(home, 'must-not-exist.txt')));
  assert.equal(ctx.get('sandboxPolicy').resolve({ session: run.localAgent.session }).mode, 'read-only');
  assert.equal(ctx.get('approval').effectivePolicy(run.localAgent.session), 'never');
  const target = await ctx.get('fs').resolve(join(home, 'must-not-exist.txt'));
  await assert.rejects(ctx.get('fs').writeText(target, 'forbidden', undefined, undefined, ctx.get('sandboxPolicy').resolve({ session: run.localAgent.session })), { code: 'FS_SANDBOX_DENIED' });
  report('actual filesystem capability enforces inherited read-only policy and child approval is never');
  report('first wire persona/tool teaching, native descriptor/catalog, and hidden-tool execution denial');
  await run.dispose();
  const readonlyBook = structuredClone(book);
  readonlyBook.entryPresets.push('inspector');
  readonlyBook.presets.push({ id: 'inspector', name: 'Inspector', defaults: {
    persona: { text: 'readonly inspector' }, tools: ['bash', 'read', 'write'], actionScope: 'read-only', delegates: ['worker'],
  }, models: [{ provider: 'fixture', model: 'pro' }] });
  api.updateBook(readonlyBook);
  parent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  const scoped = await api.start(parent.agent, { presetId: 'inspector', prompt: 'wait' });

  assert.equal(api.instance(scoped.localAgent).inheritedPolicy.sandboxMode, 'workspace-write');
  assert.equal(ctx.get('sandboxPolicy').resolve({ session: scoped.localAgent.session }).mode, 'read-only');
  const noWrite = await ctx.get('tools').execute({ agent: scoped.localAgent, callId: 'readonly-bash', name: 'bash', arguments: {
    command: 'printf forbidden > must-not-exist.txt', description: 'Probe actual role write denial', workdir: home,
  }, signal: new AbortController().signal });
  assert.equal(noWrite.value?.sandbox?.denied, true); assert.notEqual(noWrite.value?.exitCode, 0); assert.ok(!existsSync(join(home, 'must-not-exist.txt')));
  const noEscalation = await ctx.get('tools').execute({ agent: scoped.localAgent, callId: 'readonly-escalation', name: 'bash', arguments: {
    command: 'printf forbidden > must-not-exist.txt', description: 'Probe requested escalation from a restricted role', workdir: home,
    sandbox_permissions: 'workspace-write', justification: 'This is a negative permission test',
  }, signal: new AbortController().signal });
  assert.ok(noEscalation.isError || noEscalation.value?.exitCode !== 0);
  assert.ok(!existsSync(join(home, 'must-not-exist.txt')));
  await assert.rejects(ctx.get('fs').writeText(target, 'forbidden', undefined, undefined,
    ctx.get('sandboxPolicy').resolve({ session: scoped.localAgent.session })), { code: 'FS_SANDBOX_DENIED' });
  const descendant = await api.start(scoped.localAgent, { presetId: 'worker', prompt: 'report' });
  await descendant.result;
  assert.equal(ctx.get('sandboxPolicy').resolve({ session: descendant.localAgent.session }).mode, 'read-only');
  await descendant.dispose();
  scoped.localAgent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  const changedScope = await ctx.get('tools').execute({ agent: scoped.localAgent, callId: 'scope-escalation', name: 'bash',
    arguments: { command: 'printf forbidden > must-not-exist.txt', description: 'Probe changed child policy' }, signal: new AbortController().signal });
  assert.ok(changedScope.isError); assert.ok(!existsSync(join(home, 'must-not-exist.txt')));
  await scoped.dispose();
  const settleRole = async id => {
    const deadline = Date.now() + 10000;
    while (ctx.agents.get(id)) { if (Date.now() > deadline) throw new Error('Role did not settle'); await new Promise(r => setTimeout(r, 5)); }
    await parent.agent.whenIdle();
  };
  const background = await api.startContinuable(parent.agent, { presetId: 'inspector', prompt: 'report' });
  await settleRole(background.childId);
  await api.sendMessage(parent.agent, background.childId, 'wait');
  const restoredScope = ctx.agents.get(background.childId);
  assert.equal(ctx.get('sandboxPolicy').resolve({ session: restoredScope.session }).mode, 'read-only');
  assert.equal(api.instance(restoredScope).inheritedPolicy.sandboxMode, 'workspace-write');
  const coldWrite = await ctx.get('tools').execute({ agent: restoredScope, callId: 'cold-readonly', name: 'bash',
    arguments: { command: 'printf forbidden > must-not-exist.txt', description: 'Cold-restored role denial', workdir: home }, signal: new AbortController().signal });
  assert.equal(coldWrite.value?.sandbox?.denied, true); assert.ok(!existsSync(join(home, 'must-not-exist.txt')));
  api.interrupt(parent.agent, background.childId); await settleRole(background.childId);
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  await assert.rejects(api.sendMessage(parent.agent, background.childId, 'stale parent'), { code: 'PERMISSION_CHANGED' });
  api.updateBook(book);
  report('role-only permission narrowing enforces Bash/FS denial, descendants, warm guards, cold resume and parent revocation');

  // Exercise the shipped fallback role on an equivalent writable depth-0 parent.
  const urBook = JSON.parse(readFileSync(join(root, 'examples/ur-team.json'), 'utf8'));
  assert.deepEqual(urBook.presets.find(p => p.id === 'developer').defaults.delegates, ['runner', 'review-relay']);
  urBook.entryPresets = ['review-relay'];
  for (const role of urBook.presets) role.models = [{ provider: 'fixture', model: 'pro' }];
  api.updateBook(urBook);
  parent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  const relay = await api.start(parent.agent, { presetId: 'review-relay', prompt: 'wait' });
  assert.equal((await api.inspectInstance(relay.id)).permission.mode, 'read-only');
  const relayWrite = await ctx.get('tools').execute({ agent: relay.localAgent, callId: 'relay-write', name: 'bash',
    arguments: { command: 'printf forbidden > must-not-exist.txt', description: 'Check fallback write denial', workdir: home }, signal: new AbortController().signal });
  assert.equal(relayWrite.value?.sandbox?.denied, true);
  assert.ok(!existsSync(join(home, 'must-not-exist.txt')));
  for (const forbidden of ['runner', 'verifier', 'developer']) await assert.rejects(api.start(relay.localAgent, { presetId: forbidden, prompt: 'report' }), { code: 'DELEGATION_DENIED' });
  const chief = await api.start(relay.localAgent, { presetId: 'chief', prompt: 'wait' });
  const perspective = await api.start(chief.localAgent, { presetId: 'correctness', prompt: 'wait' });
  assert.equal((await api.inspectInstance(perspective.id)).permission.mode, 'read-only');
  assert.equal(api.instance(perspective.localAgent).depth, 3);
  await perspective.dispose(); await chief.dispose(); await relay.dispose();
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  api.updateBook(book);
  report('shipped fallback relay denies real Bash writes and writable/verification delegations; review chain fits depth 3');

  assert.deepEqual(await api.readInstance(run.id), record);
  const history = await ctx.get('sessionPersistence').open(run.id, 'read');
  try { assert.ok((await history.read()).events.some(e => e.type === 'subagent/descriptor')); } finally { await history.close(); }
  const wireBeforeResume = captured.length;
  await assert.rejects(ctx.get('agents').resume({ resumeSessionId: run.id, agentOptions: { provider: 'fixture', model: 'pro' } }), { code: 'RESUME_UNSUPPORTED' });
  assert.equal(captured.length, wireBeforeResume);
  report('durable book sidecar and native history can be read; unsupported cold resume fails before dispatch');

  const [pro, flash] = await Promise.all(['pro', 'flash'].map(model => api.start(parent.agent, { presetId: 'worker', provider: 'fixture', model, prompt: 'wait' })));
  await waitWire(()=>captured.some(w=>w.model==='flash' && w.messages.some(m=>m.role==='user' && m.content.some(b=>b.text==='wait'))));
  assert.equal(api.instance(flash.localAgent).compiled.sources.teaching.bash.key, 'tool.bash.only');
  assert.equal(captured.findLast(w => w.model === 'flash').tools.find(t => t.name === 'bash').description, 'fixture solo Bash teaching');
  const outputs = await Promise.all([pro, flash].map((run, index) => ctx.get('tools').execute({ agent: run.localAgent, callId: 'identity', name: 'bash', arguments: { command: `printf '%s' '${index}'`, description: 'Print the model marker for verification' }, signal: new AbortController().signal })));
  assert.ok(outputs.every(result => !result.isError));
  assert.notDeepEqual(outputs[0].content, outputs[1].content);
  assert.notEqual(ctx.get('tools').get('bash', pro.localAgent), ctx.get('tools').get('bash', flash.localAgent));
  assert.notEqual(api.instance(pro.localAgent).compiled.compositionRevision, api.instance(flash.localAgent).compiled.compositionRevision);
  assert.deepEqual(ctx.get('tools').schemas(flash.localAgent).map(t => t.name).sort(), ['bash', 'subagentbook', 'subagentbook_message', 'subagentbook_result', 'subagentbook_stop']);
  await Promise.all([pro.dispose(), flash.dispose()]);
  report('concurrent model variants have independent compositions and tool masks');

  const zero = await api.start(parent.agent, { presetId: 'zero', prompt: 'wait' });

  assert.equal((await api.inspectInstance(zero.id)).report.state, 'unavailable');
  await waitWire(()=>captured.some(w=>w.sessionId===zero.id));
  assert.ok(!captured.find(w=>w.sessionId===zero.id).tools.some(t => t.name === 'subagentbook'));
  await assert.rejects(api.start(zero.localAgent, { presetId: 'worker', prompt: 'report' }), { code: 'DEPTH_LIMIT' });
  await zero.dispose();
  const zeroFinal=await api.start(parent.agent,{presetId:'zero',prompt:'report'}); await zeroFinal.result;
  assert.equal((await api.inspectInstance(zeroFinal.id)).report.state,'available');
  await zeroFinal.dispose();
  report('zero local depth works but cannot delegate; only completed deliveries have a final report');

  const chainStart = captured.length;
  const chain = await api.start(parent.agent, { presetId: 'worker', prompt: 'chain' });
  assert.equal((await chain.result).stopReason, 'completed');
  const chainRequests = captured.slice(chainStart);
  assert.equal(chainRequests.length, 5); // Three first turns, then two tool-result turns.
  assert.equal(chainRequests.filter(r => !r.tools.some(t => t.name === 'subagentbook')).length, 1);
  await chain.dispose(); report('real agent loop reaches the native three-generation limit');

  const maximum = ctx.loader.resolve('include').subtree.resolve('subagent');
  const setMaximum = value => maximum.update({ ...maximum.options, config: { maxDepth: value } });
  const limited = await api.start(parent.agent, { presetId: 'limited', prompt: 'wait' });
   await setMaximum(8);
  const leaf = await api.start(limited.localAgent, { presetId: 'worker', model: 'flash', provider: 'fixture', prompt: 'wait' });

  assert.equal(api.instance(leaf.localAgent).ceiling, 2);
  await assert.rejects(api.start(leaf.localAgent, { presetId: 'worker', prompt: 'report' }), { code: 'DEPTH_LIMIT' });
  await Promise.all([leaf.dispose(), limited.dispose()]); await setMaximum(3);
  report('raising root limit and switching descendant model cannot relax an ancestor ceiling');
  const before = ctx.get('agents').list().length;
  const ready = new Promise(resolve => { prepared = resolve; });
  const pending = api.start(parent.agent, { presetId: 'slow', prompt: 'report' });
  pending.catch(() => {});
  await ready; await setMaximum(0); release();
  await assert.rejects(pending, { code: 'DEPTH_LIMIT' });
  assert.equal(ctx.get('agents').list().length, before);
  await setMaximum(3); report('live DSH limit is rechecked at publication; failed setup leaves no live child');

  const policyReady = new Promise(resolve => { prepared = resolve; });
  const policyPending = api.start(parent.agent, { presetId: 'slow', prompt: 'report' }); policyPending.catch(() => {});
  await policyReady; parent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' }); release();
  await assert.rejects(policyPending, { code: 'PERMISSION_CHANGED' });
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  report('permission changes during asynchronous setup reject stale publication');

  const capabilityReady = new Promise(resolve => { prepared = resolve; });
  const capabilityPending = api.start(parent.agent, { presetId: 'slow', prompt: 'report' }); capabilityPending.catch(() => {});
  await capabilityReady; declaredOutputLimit = 100; release();
  await assert.rejects(capabilityPending, { code: 'MODEL_BUDGET_EXCEEDED' });
  assert.equal(ctx.get('agents').list().length, before); declaredOutputLimit = 8192;
  report('a lowered declared model ceiling during setup rejects publication and rolls back the child');

  const failedTool = await ctx.get('tools').execute({ agent: parent.agent, callId: 'failed-child', name: 'subagentbook', arguments: { preset: 'worker', prompt: 'fail' }, signal: new AbortController().signal });
  assert.equal(failedTool.isError, true);
  assert.ok(JSON.stringify(failedTool.content).includes('max-tokens'));
  assert.equal(ctx.get('agents').list().length, before);
  report('child token-limit failure reaches the parent as an error and disposes the child');

  importFailure = true;
  await assert.rejects(api.start(parent.agent, { presetId: 'slow', prompt: 'report' }));
  assert.equal(ctx.get('agents').list().length, before);
  report('plugin activation failure rolls back the unpublished composition');

  const pin = await api.start(parent.agent, { presetId: 'worker', prompt: 'pin-wait' });
  await waitWire(()=>!!releasePin);
  const wireCount = captured.length;
  const disposeSelection = installModelSelection(pin.localAgent.ctx, { current: { provider: 'fixture', model: 'flash' } });
  const { createUserMessage } = await load('@deepseek-ai/dsh-llm');
  pin.localAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'changed model' }], source: { kind: 'user' } }));
  releasePin();
  await pin.localAgent.whenIdle();
  assert.equal(captured.length, wireCount);
  disposeSelection(); await pin.dispose();
  report('model change rejected before dispatch on a pinned child');

  const selected = await ctx.get('agents').create({ sessionId: 'selected-root', agentOptions: { provider: 'fixture', model: 'pro' }, meta: { cwd: home } });
  const disposeSelected = installModelSelection(selected.agent.ctx, { current: { provider: 'fixture', model: 'flash' } });
  const selectedStart = captured.length;
  selected.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'chain' }], source: { kind: 'user' } }));
  await selected.agent.whenIdle();
  assert.ok(captured.slice(selectedStart).length > 1);
  assert.ok(captured.slice(selectedStart).every(wire => wire.model === 'flash'));
  disposeSelected(); await selected.dispose();
  report('delegation follows the dispatched parent route instead of its original model options');

  const controller = new AbortController();
  const waiting = await api.start(parent.agent, { presetId: 'worker', prompt: 'wait', signal: controller.signal });
  controller.abort(); assert.equal((await waiting.result).stopReason, 'aborted');
  await waiting.dispose(); assert.equal(ctx.get('agents').get(waiting.id), undefined);
  report('cancellation and holder disposal drain child work and registrations');
  const caller = await ctx.get('agents').create({ sessionId: 'cancel-root', agentOptions: { provider: 'fixture', model: 'pro' }, meta: { cwd: home } });
  const childCreated = new Promise(resolve => {
    const off = ctx.on('agent/created', ({ agent }) => { if (agent.session.header.parentSession === caller.agent.id) { off(); resolve(); } }, { global: true });
  });
  caller.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'delegate-wait' }], source: { kind: 'user' } }));
  await childCreated;
  assert.equal(ctx.get('agents').list().length, 3);
  caller.agent.cancel({ kind: 'parent' }); await caller.agent.whenIdle();
  assert.equal(ctx.get('agents').list().length, 2);
  await caller.dispose();
  report('cancelling the parent Agent aborts and drains its model-invoked child');

  const atUnload = await api.start(parent.agent, { presetId: 'worker', prompt: 'wait' });
  const unloadReady = new Promise(resolve => { prepared = resolve; });
  const pendingUnload = api.start(parent.agent, { presetId: 'slow', prompt: 'report' }); pendingUnload.catch(() => {});
  await unloadReady;
  const bookEntry = ctx.loader.resolve('include').subtree.resolve('book');
  const unloading = bookEntry.fiber.dispose(); release();
  const [unloaded, preparation] = await Promise.allSettled([unloading, pendingUnload]);
  assert.equal(unloaded.status, 'fulfilled'); assert.equal(preparation.status, 'rejected');
  assert.equal((await atUnload.result).stopReason, 'aborted');
  assert.equal(ctx.get('agents').get(atUnload.id), undefined);
  report('unloading the book drains active and preparing children while the root stays live');
  await parent.dispose(); parent = undefined;
  await ctx.fiber.dispose(); ctx = undefined;
  writeFileSync(join(home, 'report.json'), JSON.stringify({ baseline: '0.2.0-rc.2', checks, modelRequests: captured.length, externalRequests: 0 }, null, 2));
  console.log(`PASS host integration: ${checks.length} groups, ${captured.length} offline model requests, no external requests`);
  rmSync(home, { recursive: true, force: true });
} catch (error) {
  console.error(error); console.error(`Host diagnostics retained: ${home}`);
  throw error;
} finally {
  release?.(); await parent?.dispose(); await ctx?.fiber.dispose();
  if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome;
}

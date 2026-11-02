import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { runtimeRequire, runtimeModulesRoot } from './runtime-path.mjs';
import { recordStore } from '../lib/records.js';
import { teachingFixture } from './teaching-fixture.mjs';
const require = runtimeRequire();
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { boot } = await load('@deepseek-ai/dsh-app-boot');
const { LlmAdapter } = await load('@deepseek-ai/dsh-llm');
const { installModelSelection } = await load('@deepseek-ai/dsh-agent');
const crashMode = process.argv[2] === '--crash';
const workerId = process.argv[2] === '--restore' ? process.argv[4] : undefined;
const home = workerId || crashMode ? process.argv[3] : mkdtempSync(join(tmpdir(), 'subagentbook-continuation-'));
if (!workerId && !crashMode) symlinkSync(runtimeModulesRoot(require), join(home, 'node_modules'), 'dir');
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
const wires = [], checks = [];
let ctx, parent;
let modelAvailable = true;
let workerRequests = 0;
let currentTeaching = 'original teaching';
class Adapter extends LlmAdapter {
  providerInfo(id) { return { id, name: 'Offline fixture' }; }
  async resolveModel(provider, id) { return { provider, id, name: id, contextWindow: 131072, maxTokens: 8192 }; }
  async *stream(options) {
    wires.push(options);
    const user = options.messages.filter(m => m.role === 'user' && m.source?.kind !== 'runtime-context').at(-1);
    const prompt = user?.content.filter(b => b.type === 'text').at(-1)?.text ?? '';
    if (prompt === 'activity-failure') throw new Error('offline activity failure');
    if (prompt === 'wait') {
      await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
      yield { type: 'finish', reason: { kind: 'aborted' } }; return;
    }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: `answer:${prompt}` };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: `answer:${prompt}` } };
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
const book = { version: 1, entryPresets: ['worker'], presets: [{ id: 'worker', name: 'Worker', defaults: {
  persona: { text: 'original persona' }, tools: ['read'],
  delegates: ['worker'], maxNestedDepth: 0, agentOptions: { maxTokens: 1234 },
}, models: [{ provider: 'fixture', model: 'pro' }] }] };
book.presets.push({ ...structuredClone(book.presets[0]), id: 'branch', name: 'Branch', defaults: { ...structuredClone(book.presets[0].defaults), maxNestedDepth: 1 } });
book.entryPresets.push('branch');
const file = join(home, 'cordis.yml');
function writeConfig(definition) {
  writeFileSync(join(home, 'teaching-fixture.json'), JSON.stringify(currentTeaching));
  writeFileSync(file, yaml.dump([
    ...['typert-registry', 'llm', 'session', 'session-projection', 'session-query', 'sandbox-policy', 'fs-sandbox', 'user-approval', 'agent', 'tools', 'system-prompt', ...(require('@deepseek-ai/dsh/package.json').version === '0.2.1-rc.5' ? ['working-directory'] : []), 'agent-loop', 'subagent'].map(id => ({ id, name: `@deepseek-ai/dsh-${id}`, ...(id === 'subagent' ? { config: { maxDepth: 3 } } : {}) })),
    { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'adapter', name: 'cordis:continuation-adapter' },
    { id: 'book', name: pathToFileURL(resolve('lib/index.js')).href, config: { bookJson: JSON.stringify(definition) } },
  ]));
}
async function start(resume = false) {
  ctx = await boot('continuation-test', file, [], ctx => {
    ctx.provide('llmMimo', { listHostedModels: () => modelAvailable ? [{ provider: 'fixture', id: 'pro' }] : [] });
    ctx.provide('promptbook', teachingFixture({ 'tool.read': { default: JSON.parse(readFileSync(join(home, 'teaching-fixture.json'), 'utf8')) } }));
    ctx.loader.builtins['continuation-adapter'] = { inject: ['llm'], apply: ctx => ctx.llm.registerAdapter(['fixture'], new Adapter()) };
  }, pathToFileURL(require.resolve('@deepseek-ai/dsh/package.json')).href);
  parent = await ctx.agents[resume ? 'resume' : 'create']({ ...(resume ? { resumeSessionId: 'root' } : { sessionId: 'root', meta: { cwd: home } }), agentOptions: { provider: 'fixture', model: 'pro' } });
  if (!resume) parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
}
const check = name => { checks.push(name); console.log(`  PASS ${name}`); };
async function settled(id) {
  const deadline = Date.now() + 10000;
  while (ctx.agents.get(id)) { if (Date.now() > deadline) throw new Error(`Child ${id} did not settle`); await new Promise(resolve => setTimeout(resolve, 5)); }
  await parent.agent.whenIdle();
}
async function events(id) { const h = await ctx.get('sessionPersistence').open(id, 'read'); try { return (await h.read()).events; } finally { await h.close(); } }
const api = () => ctx.get('subagentbook');
try {
  if (crashMode) {
    await start(true);
    const child = await api().startContinuable(parent.agent, { presetId: 'worker', prompt: 'wait' });
    const deadline = Date.now() + 10000;
    while (!wires.some(w => w.messages.some(m => m.role === 'user' && m.content.some(b => b.text === 'wait')))) {
      if (Date.now() > deadline) throw new Error('Crash fixture never started');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal((await api().inspectInstance(child.childId)).activity.state, 'running');
    await assert.rejects(api().prepareRecovery(child.childId), {code:'RECOVERY_UNAVAILABLE'});
    const shot = await api().start(parent.agent, { presetId: 'worker', prompt: 'wait' }); shot.result.catch(()=>{});
    const stage = await api().readResult(parent.agent, {sessionId:child.childId,kind:'checkpoint'});
    assert.equal(stage.final, false);
    assert.equal(JSON.parse(stage.text).task.text, 'wait');
    const stageDeadline = Date.now() + 10000;
    while (!(await api().inspectInstance(shot.id)).checkpoint.available) {
      if (Date.now() > stageDeadline) throw new Error('Accepted one-shot never produced its first public stage');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    writeFileSync(join(home, 'crashed-child.json'), JSON.stringify({id:child.childId,shot:shot.id}));
    process.kill(process.pid, 'SIGKILL');
    await new Promise(()=>{});
  } else if (workerId) {
    await start(true);
    await api().sendMessage(parent.agent, workerId, 'fresh process'); await settled(workerId);
    const restored = wires.find(w => w.messages.some(m => m.role === 'user' && m.content.some(b => b.text === 'fresh process')));
    assert.ok(restored.messages.some(m => m.role === 'system' && m.content.some(b => b.text === 'original persona')));
    assert.equal(restored.tools.find(t => t.name === 'read').description, 'original teaching');
    assert.equal(restored.maxTokens, 1234);
    assert.equal((await api().readInstance(workerId)).ceiling, 1);
    await parent.dispose(); parent = undefined; await ctx.fiber.dispose(); ctx = undefined;
    console.log(`PASS independent process cold restoration: ${wires.length} offline requests`);
  } else {
  writeConfig(book); await start();
  await assert.rejects(parent.agent.ctx.agents.resume({ resumeSessionId: 'missing.native', agentOptions: { provider: 'fixture', model: 'pro' } }), { name: 'SessionPersistenceNotFoundError' });
  check('native non-book restoration retains native diagnostics for opaque session ids');
  const first = await api().startContinuable(parent.agent, { presetId: 'worker', prompt: 'first' });
  await settled(first.childId);
  const initialActivity = (await api().inspectInstance(first.childId)).activity;
  assert.equal(initialActivity.state, 'completed', JSON.stringify(initialActivity));
  const failed = await api().startContinuable(parent.agent, { presetId: 'worker', prompt: 'activity-failure' });
  await settled(failed.childId);
  const failureView = (await api().inspectInstance(failed.childId)).activity;
  assert.equal(failureView.state, 'failed');
  assert.equal(failureView.reason, 'error');
  check('native completion and failure survive child disposal in diagnostic sidecars');
  const record = await api().readInstance(first.childId);
  assert.equal(record.depth, 1); assert.equal(record.ceiling, 1); assert.equal(record.mode, 'continuable');
  assert.equal(record.agentOptions.maxTokens, 1234);
  let history = await events(first.childId);
  assert.equal(history.find(e => e.type === 'subagent/descriptor').data.mode, 'continuable');
  const initialWire = wires.find(w => w.messages.some(m => m.role === 'user' && m.content.some(b => b.text === 'first')));
  assert.ok(initialWire.messages.some(m => m.role === 'system' && m.content.some(b => b.text === 'original persona')));
  assert.deepEqual(initialWire.tools.map(t => t.name).sort(), ['read', 'subagentbook_message', 'subagentbook_stop']);
  assert.ok(parent.agent.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.source?.kind === 'subagent-settled'));
  check('background acceptance, original composition, leaf controls and native parent settlement notice');
  await api().sendMessage(parent.agent, first.childId, 'second'); await settled(first.childId);
  history = await events(first.childId);
  assert.equal(history.filter(e => e.type === 'subagent/descriptor').length, 1);
  assert.ok(history.some(e => e.type === 'assistant/message' && e.data.message.content.some(b => b.text === 'answer:second')));
  check('cold message through the native manager retains identity and full prior conversation');
  const maximum = ctx.loader.resolve('include').subtree.resolve('subagent');
  await maximum.update({ ...maximum.options, config: { maxDepth: 0 } });
  await api().sendMessage(parent.agent, first.childId, 'below lowered H'); await settled(first.childId);
  await assert.rejects(api().startContinuable(parent.agent, { presetId: 'worker', prompt: 'new' }), { code: 'DEPTH_LIMIT' });
  check('lowering H blocks new children but allows same-depth continuation');
  const other = await ctx.agents.create({ sessionId: 'other', meta: { cwd: home }, agentOptions: { provider: 'fixture', model: 'pro' } });
  await assert.rejects(api().sendMessage(other.agent, first.childId, 'forbidden'), { code: 'UNAUTHORIZED' });
  await assert.rejects(api().interrupt(other.agent, first.childId), { code: 'UNAUTHORIZED' });
  await other.dispose();
  parent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  await assert.rejects(api().sendMessage(parent.agent, first.childId, 'changed permission'), { code: 'PERMISSION_CHANGED' });
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  check('wrong direct parent and changed permission snapshot reject before model dispatch');
  const browserReceipt = await ctx.subagents.prompt({ requestId: 'browser-fixture-1', parentSessionId: parent.agent.id, childSessionId: first.childId, mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: 'browser message' }], clientTimeZone: 'Asia/Shanghai' }, new AbortController().signal);
  assert.ok(browserReceipt.messageId); await settled(first.childId);
  assert.ok((await events(first.childId)).some(e => e.type === 'user/message' && e.data.source?.rpcId === 'browser-fixture-1'));
  check('native browser control preserves request identity and timezone through cold continuation');
  const accepted = await Promise.all(['concurrent A', 'concurrent B'].map(text => api().sendMessage(parent.agent, first.childId, text)));
  assert.notEqual(accepted[0], accepted[1]); await settled(first.childId);
  history = await events(first.childId);
  for (const text of ['concurrent A', 'concurrent B']) assert.ok(JSON.stringify(history).includes(text));
  check('concurrent messages use native per-child admission without duplicate live activations');
  await api().sendMessage(parent.agent, first.childId, 'wait');
  const live = ctx.agents.get(first.childId);
  assert.ok(live); assert.equal(api().instance(live).ceiling, 1);
  await assert.rejects(api().startContinuable(live, { presetId: 'worker', prompt: 'escape' }), { code: 'DEPTH_LIMIT' });
  assert.deepEqual(ctx.subagents.interruptByParent(first.childId, parent.agent.id, 'continuable'), { accepted: true }); await settled(first.childId);
  assert.ok((await events(first.childId)).some(e => e.type === 'turn/end' && e.data.reason.kind === 'aborted'));
  await api().sendMessage(parent.agent, first.childId, 'after stop'); await settled(first.childId);
  check('native browser stop reaches the owner, preserves conversation and cannot reset ancestor C');
  await api().sendMessage(parent.agent, first.childId, 'wait');
  const child = ctx.agents.get(first.childId);
  const beforePin = wires.length;
  const unpin = installModelSelection(child.ctx, { current: { provider: 'fixture', model: 'flash' } });
  child.cancel({ kind: 'parent' }, { keepInbox: true }); await child.whenIdle();
  await api().sendMessage(parent.agent, first.childId, 'pin check'); await settled(first.childId); unpin();
  assert.equal(wires.length, beforePin + 1); // Parent settlement only; Flash never dispatched.
  assert.equal((await api().readInstance(first.childId)).compiled.model, 'pro');
  check('pinned continuable model rejects a warm model switch before dispatch');
  await api().sendMessage(parent.agent, first.childId, 'wait');
  parent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  const beforeRevocation = wires.length;
  const receipt = await ctx.subagents.prompt({ requestId: 'browser-permission-change', parentSessionId: parent.agent.id, childSessionId: first.childId, mode: 'continuable', delivery: 'queue', content: [{ type: 'text', text: 'denied after change' }] }, new AbortController().signal);
  assert.ok(receipt.messageId);
  ctx.agents.get(first.childId).cancel({ kind: 'parent' }, { keepInbox: true });
  await ctx.agents.get(first.childId).whenIdle();
  // Wake the parked inbox: the next child request must fail without touching the adapter.
  await ctx.subagents.sendMessage(parent.agent, first.childId, [{ type: 'text', text: 'wake permission check' }], { signal: new AbortController().signal });
  await settled(first.childId);
  assert.ok(!wires.slice(beforeRevocation).some(w => w.messages.some(m => m.role === 'user' && m.content.some(b => ['denied after change', 'wake permission check'].includes(b.text)))));
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  check('warm native/browser delivery cannot dispatch or execute with changed parent permissions');
  const snapshotStore = recordStore(join(home, 'subagentbook', 'instances'));
  const originalSnapshot = snapshotStore.read(first.childId);
  snapshotStore.write({ ...originalSnapshot, artifactRevision: 'old-installation' });
  await assert.rejects(api().sendMessage(parent.agent, first.childId, 'changed code'), error => error.code === 'NOT_RESUMABLE' && error.cause?.code === 'ARTIFACT_CHANGED');
  snapshotStore.write(originalSnapshot);
  check('a mismatching executable fingerprint prevents cold activation');
  modelAvailable = false;
  await assert.rejects(api().sendMessage(parent.agent, first.childId, 'missing model route'));
  modelAvailable = true;
  check('missing exact model route refuses activation');
  await maximum.update({ ...maximum.options, config: { maxDepth: 3 } });
  const foreground = await api().start(parent.agent, { presetId: 'branch', prompt: 'wait' });
  // Hold the parent turn open: rc.5 tears down before a result resolves.
  const nested = await api().startContinuable(foreground.localAgent, { presetId: 'worker', prompt: 'wait' });
  const nestedRecord = await api().readInstance(nested.childId);
  assert.equal(nestedRecord.depth, 2); assert.equal(nestedRecord.ceiling, 2);
  const steering = await ctx.get('tools').execute({ agent: foreground.localAgent, callId: 'foreground-controls', name: 'subagentbook_message', arguments: { sessionId: nested.childId, message: 'intermediate ping' }, signal: new AbortController().signal });
  assert.ok(!steering.isError);
  await foreground.dispose();
  assert.equal(ctx.agents.get(nested.childId), undefined);
  const foregroundHistory = await events(foreground.id);
  assert.ok(foregroundHistory.some(e => e.type === 'turn/end'));
  check('one-shot parent can steer and drain a background descendant with inherited permissions/C');
  await api().sendMessage(parent.agent, first.childId, 'wait');
  await parent.dispose(); parent = undefined;
  const drainDeadline = Date.now() + 10000;
  while (ctx.agents.get(first.childId)) { if (Date.now() > drainDeadline) throw new Error('Disposed parent left a live child'); await new Promise(resolve => setTimeout(resolve, 5)); }
  check('destroying the live parent stops and drains its background branch');
  await ctx.fiber.dispose(); ctx = undefined;
  const updated = structuredClone(book); updated.presets[0].defaults.persona.text = 'new persona'; currentTeaching = 'new teaching';
  writeConfig(updated);
  const worker = spawnSync(process.execPath, [resolve('scripts/continuation-test.mjs'), '--restore', home, first.childId], { encoding: 'utf8', env: process.env, timeout: 30000 });
  assert.equal(worker.status, 0, worker.stdout + worker.stderr);
  workerRequests = Number(worker.stdout.match(/restoration: (\d+) offline requests/)?.[1] ?? 0);
  check('independent Node process restores the original executable composition and snapshot');
  const crash = spawnSync(process.execPath, [resolve('scripts/continuation-test.mjs'), '--crash', home], { encoding: 'utf8', env: process.env, timeout: 30000 });
  assert.equal(crash.signal, 'SIGKILL', crash.stdout + crash.stderr);
  const crashed = JSON.parse(readFileSync(join(home, 'crashed-child.json'), 'utf8')).id;
  writeConfig({ version: 1, entryPresets: [], presets: [] });
  await start(true);
  const beforeInspect = wires.length;
  const recovered = await api().inspectInstance(crashed);
  assert.equal(recovered.activity.state, 'interrupted');
  assert.equal(recovered.activity.reason, 'previous-runtime-unsettled');
  assert.equal(recovered.report, undefined);
  assert.equal(recovered.checkpoint.available, true);
  const recovery = await api().prepareRecovery(crashed);
  assert.equal(recovery.dispatched, false);
  assert.equal(recovery.targetSessionId, 'root');
  assert.ok(recovery.text.includes('wait'));
  const stagePage = await api().readResult(parent.agent, {sessionId:crashed,kind:'checkpoint'});
  assert.equal(JSON.parse(stagePage.text).task.text, 'wait');
  const crashedShot = JSON.parse(readFileSync(join(home, 'crashed-child.json'), 'utf8')).shot;
  const shotView = await api().inspectInstance(crashedShot);
  assert.equal(shotView.checkpoint.available, true);
  assert.equal(shotView.report.state, 'unavailable');
  await assert.rejects(api().readResult(parent.agent, {sessionId:crashedShot}), {code:'REPORT_UNAVAILABLE'});
  const exportStage = await api().exportCheckpoint(crashedShot);
  assert.equal(exportStage.format, 'subagentbook-checkpoint-v1');
  assert.equal(exportStage.final, false);
  assert.equal(wires.length, beforeInspect, 'Inspecting crash recovery must not dispatch a request');
  check('SIGKILL during a real native child run is diagnosed after restart without automatic dispatch');
  await api().sendMessage(parent.agent, crashed, 'continue after crash'); await settled(crashed);
  assert.equal((await api().inspectInstance(crashed)).activity.state, 'completed');
  const continuedStage = await api().exportCheckpoint(crashed);
  assert.ok(JSON.parse(continuedStage.text).latestRequest.text.includes('continue after crash'));
  api().updateBook(updated);
  const successor = await api().start(parent.agent, {presetId:'worker',prompt:(await api().prepareRecovery(crashedShot)).text});
  const successorResult = await successor.result;
  assert.equal(successorResult.stopReason, 'completed');
  assert.equal((await api().inspectInstance(successor.id)).report.state, 'available');
  assert.equal((await api().readResult(parent.agent,{sessionId:successor.id})).sha256, successorResult.report.sha256);
  assert.equal((await api().inspectInstance(crashedShot)).report.state, 'unavailable');
  await successor.dispose();
  api().updateBook({version:1,entryPresets:[],presets:[]});
  check('the interrupted continuable resumes; an explicitly delegated one-shot successor saves a separate final report');

  const before = wires.length;
  await api().sendMessage(parent.agent, first.childId, 'after restart'); await settled(first.childId);
  const restored = wires.slice(before).find(w => w.messages.some(m => m.role === 'user' && m.content.some(b => b.text === 'after restart')));
  assert.ok(restored.messages.some(m => m.role === 'system' && m.content.some(b => b.text === 'original persona')));
  assert.equal(restored.tools.find(t => t.name === 'read').description, 'original teaching');
  assert.equal(restored.maxTokens, 1234);
  assert.equal((await api().readInstance(first.childId)).ceiling, 1);
  check('removed presets do not replace a saved conversation; old persona/teaching/budget/d/C restored');
  const path = join(home, 'subagentbook', 'instances', `${first.childId}.json`);
  const saved = readFileSync(path, 'utf8');
  const corrupt = JSON.parse(saved); corrupt.depth = 0; writeFileSync(path, JSON.stringify(corrupt));
  await assert.rejects(api().sendMessage(parent.agent, first.childId, 'corrupt'), { code: 'INVALID_INSTANCE' });
  const { createUserMessage } = await load('@deepseek-ai/dsh-llm');
  parent.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'healthy root with damaged child' }], source: { kind: 'user' } }));
  await parent.agent.whenIdle();
  assert.ok(wires.some(w => w.messages.some(m => m.role === 'user' && m.content.some(b => b.text === 'healthy root with damaged child'))));
  writeFileSync(path, saved); rmSync(path);
  await assert.rejects(api().sendMessage(parent.agent, first.childId, 'missing'), { code: 'UNAUTHORIZED' });
  // The browser/native gateway must also fail rather than reconstruct latest defaults.
  await assert.rejects(ctx.subagents.sendMessage(parent.agent, first.childId, [{ type: 'text', text: 'missing native' }], { signal: new AbortController().signal }));
  writeFileSync(path, saved);
  check('corrupt or missing sidecar refuses both book and native/browser continuation');
  await api().sendMessage(parent.agent, first.childId, 'wait');
  const entry = ctx.loader.resolve('include').subtree.resolve('book');
  await entry.fiber.dispose();
  assert.equal(ctx.agents.get(first.childId), undefined); assert.ok(ctx.agents.get('root'));
  check('book unload drains manager-owned children while preserving the host parent');
  console.log(`PASS continuation: ${checks.length} groups, ${wires.length + workerRequests + 2} offline requests across isolated processes, no external requests`);
  await parent.dispose(); parent = undefined; await ctx.fiber.dispose(); ctx = undefined;
  rmSync(home, { recursive: true, force: true });
  }
} catch (error) { console.error(`Diagnostics retained: ${home}`); throw error; }
finally { await parent?.dispose(); await ctx?.fiber.dispose(); if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome; }

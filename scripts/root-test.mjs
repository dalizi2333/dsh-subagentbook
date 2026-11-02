import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { runtimeRequire, linkRuntime } from './runtime-path.mjs';
import { teachingFixture } from './teaching-fixture.mjs';
import { rootPresetId } from '../lib/roots.js';
import { recordStore } from '../lib/records.js';
const require = runtimeRequire(), load = name => import(pathToFileURL(require.resolve(name)).href);
const { boot } = await load('@deepseek-ai/dsh-app-boot');
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm');
const { installModelSelection } = await load('@deepseek-ai/dsh-agent');
const home = mkdtempSync(join(tmpdir(), 'subagentbook-root-'));
linkRuntime(home, require);
const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = home;
const root = resolve(import.meta.dirname, '..'), captured = [], checks = [], fieldSources = new Set();
const report = message => { checks.push(message); console.log(`  PASS ${message}`); };
const textOf = message => typeof message.content === 'string' ? message.content : message.content.filter(block => block.type === 'text').map(block => block.text).join('');
const models = ['pro', 'flash'].map(id => ({ provider: 'fixture', id, apiFormat: 'chat', requestFieldsVersion: 1, budget: { contextWindow: 32768, defaultMaxTokens: id === 'pro' ? 4096 : 2048, maxOutputTokens: 8192 } }));
class Adapter extends LlmAdapter {
  providerInfo(id) { return { id, name: 'Offline root fixture' }; }
  async listModels(provider) { return models.map(model => ({ provider, id: model.id, name: model.id })); }
  async resolveModel(provider, id) { return { provider, id, name: id, context: { contextWindow: 32768 }, defaultMaxTokens: 2048 }; }
  async *stream(options) {
    const requestFields = [...fieldSources].flatMap(source => source.resolve({ provider: options.provider, model: options.model, sessionId: options.sessionId, purpose: options.purpose }) ?? []);
    captured.push({ ...options, requestFields });
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'root fixture complete' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
const originalBook = { version: 1, entryPresets: ['worker'], presets: [{ id: 'worker', name: 'Book Worker',
  defaults: { persona: { text: 'root:pro' }, tools: ['bash', 'read'], delegates: ['worker'], maxNestedDepth: 0,
    agentOptions: { maxTokens: 3072, requestFields: [{ path: 'thinking.budget_tokens', type: 'number', value: 2048, apiFormat: 'chat' }] } },
  models: [{ provider: 'fixture', model: 'pro' }, { provider: 'fixture', model: 'flash', overrides: {
    persona: { text: 'root:flash {{literal}}' }, tools: ['bash', 'write'], actionScope: 'read-only', agentOptions: { maxTokens: 1024 },
  } }] }] };
let book = structuredClone(originalBook), ctx, driver, handle, extraHandle, success = false;
const configFile = join(home, 'cordis.yml');
function config() { return [
  ...['typert-registry', 'llm', 'session', 'session-projection', 'session-query', 'sandbox-policy', 'fs-sandbox', 'user-approval', 'agent', 'tools', 'system-prompt', ...(require('@deepseek-ai/dsh/package.json').version === '0.2.1-rc.5' ? ['working-directory'] : []), 'agent-loop', 'subagent'].map(id => ({ id, name: `@deepseek-ai/dsh-${id}`, ...(id === 'subagent' ? { config: { maxDepth: 3 } } : {}) })),
  { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' }, { id: 'sandbox', name: '@deepseek-ai/dsh-sandbox-local' },
  { id: 'bash-sandbox', name: '@deepseek-ai/dsh-bash-sandbox', config: { timeoutMs: 10000 } },
  { id: 'shell-env', name: '@deepseek-ai/dsh-shell-env', config: { dshHome: home } },
  { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
  { id: 'preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'standard' } },
  { id: 'standard', name: '@deepseek-ai/dsh-agent-preset', config: { id: 'standard', name: 'Standard', plugins: [] } },
  { id: 'adapter', name: 'cordis:root-adapter' },
  { id: 'book', name: pathToFileURL(join(root, 'lib/index.js')).href, config: { bookJson: JSON.stringify(book) } },
]; }
async function start() {
  writeFileSync(configFile, yaml.dump(config()));
  ctx = await boot('subagentbook-roots', configFile, [], ctx => {
    ctx.provide('llmMimo', { listHostedModels: () => models, registerRequestFieldSource(source) { fieldSources.add(source); return () => fieldSources.delete(source); } });
    ctx.provide('promptbook', teachingFixture({ 'tool.bash.only': { flash: 'solo bash teaching' } }));
    ctx.loader.builtins['root-adapter'] = { inject: ['llm', 'agents'], apply(ctx) { driver = ctx; ctx.llm.registerAdapter(['fixture'], new Adapter()); } };
  }, pathToFileURL(require.resolve('@deepseek-ai/dsh/package.json')).href);
  await ctx.get('subagentbook').rootReady();
}
const setup = selection => async (agentCtx, agent) => {
  installModelSelection(agentCtx, selection ?? { current: { provider: agent.options.provider, model: agent.options.model } });
  await ctx.get('agentPresets').mount(agentCtx, rootPresetId('worker'));
};
async function send(agent, text = 'root probe') {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })); await agent.whenIdle();
}
const sidecar = id => join(home, 'subagentbook', 'instances', `${id}.json`);
try {
  await start();
  const api = ctx.get('subagentbook');
  assert.ok((await ctx.get('agentPresets').list()).some(row => row.id === rootPresetId('worker') && row.name === 'Book Worker'));
  const selection = { current: { provider: 'fixture', model: 'flash' } };
  handle = await driver.agents.create({ sessionId: 'root-model-choice', meta: { cwd: home, agentPreset: rootPresetId('worker') },
    agentOptions: { provider: 'fixture', model: 'pro' }, setup: setup(selection) });
  handle.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  await send(handle.agent);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].model, 'flash');
  assert.equal(captured[0].maxTokens, 1024);
  assert.deepEqual(captured[0].requestFields, []);
  assert.deepEqual(captured[0].tools.map(t => t.name).sort(), ['bash', 'subagentbook', 'subagentbook_result', 'write']);
  assert.ok(captured[0].messages.some(m => m.role === 'system' && textOf(m) === 'root:flash {{literal}}'));
  const original = api.instance(handle.agent);
  assert.equal(original.mode, 'root'); assert.equal(original.depth, 0); assert.equal(original.ceiling, null);
  assert.equal((await api.inspectInstance(handle.agent.id)).mode, 'root');
  assert.equal(ctx.get('sandboxPolicy').resolve({ session: handle.agent.session }).mode, 'read-only');
  assert.equal(ctx.get('approval').effectivePolicy(handle.agent.session), 'never');
  assert.ok(captured[0].messages.some(m => m.role === 'user' && textOf(m).includes('read-only')));
  report('native role selection freezes the final model route at depth zero, with exact Persona/tools/budget and fresh read-only context');
  const denied = await ctx.get('tools').execute({ agent: handle.agent, callId: 'root-write-denied', name: 'bash', arguments: {
    command: 'printf forbidden > root-must-not-exist.txt', description: 'Root permission negative test', workdir: home,
  }, signal: new AbortController().signal });
  assert.ok(denied.isError || denied.value?.exitCode !== 0); assert.ok(!existsSync(join(home, 'root-must-not-exist.txt')));
  const hidden = await ctx.get('tools').execute({ agent: handle.agent, callId: 'root-hidden-tool', name: 'read', arguments: {}, signal: new AbortController().signal });
  assert.equal(hidden.isError, true);
  report('actual root Bash writes and hidden model tools are denied');
  const pendingSelection = { current: { provider: 'fixture', model: 'unknown' } };
  extraHandle = await driver.agents.create({ sessionId: 'root-retry-choice', meta: { cwd: home, agentPreset: rootPresetId('worker') },
    agentOptions: { provider: 'fixture', model: 'pro' }, setup: setup(pendingSelection) });
  const beforeRetry = captured.length;
  await send(extraHandle.agent, 'unsupported model');
  assert.equal(captured.length, beforeRetry); assert.equal(existsSync(sidecar(extraHandle.agent.id)), false);
  pendingSelection.current = { provider: 'fixture', model: 'pro' };
  await send(extraHandle.agent, 'corrected model');
  assert.equal(captured.length, beforeRetry + 1); assert.equal(captured.at(-1).model, 'pro');
  assert.equal(captured.at(-1).maxTokens, 3072);
  assert.deepEqual(captured.at(-1).requestFields, [{ path: 'thinking.budget_tokens', value: 2048, apiFormat: 'chat' }]);
  assert.ok(captured.at(-1).messages.some(m => m.role === 'system' && textOf(m) === 'root:pro'));
  const source = [...fieldSources][0];
  assert.equal(source.resolve({ sessionId: extraHandle.agent.id, provider: 'fixture', model: 'pro', purpose: 'compression' }), undefined);
  assert.equal(source.resolve({ sessionId: 'ordinary-root', provider: 'fixture', model: 'pro' }), undefined);
  await extraHandle.dispose(); extraHandle = undefined;
  report('an unsupported first model leaves no snapshot; correction uses the Pro role and session-scoped request fields');
  await assert.rejects(driver.agents.create({ sessionId: 'root-unsupported-fork', meta: { cwd: home, parentSession: handle.agent.id, agentPreset: rootPresetId('worker') },
    agentOptions: { provider: 'fixture', model: 'flash' }, setup: setup() }), { code: 'INVALID_INSTANCE' });
  assert.equal(existsSync(sidecar('root-unsupported-fork')), false);
  report('a native fork identity cannot silently adopt a new root snapshot');
  const savedLimit = ctx.get('subagents').config.maxDepth;
  ctx.get('subagents').config.maxDepth = 0;
  await assert.rejects(api.start(handle.agent, { presetId: 'worker', prompt: 'native zero limit' }));
  ctx.get('subagents').config.maxDepth = savedLimit;
  const child = await api.start(handle.agent, { presetId: 'worker', prompt: 'child probe' });
  await child.result; assert.equal((await api.readInstance(child.id)).depth, 1); await child.dispose();
  report('a root ignores its child-only local depth field and delegates its first child at native depth one');
  const frozenCount = captured.length;
  handle.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  await send(handle.agent, 'changed permission'); assert.equal(captured.length, frozenCount);
  handle.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  report('native root depth revocation and changed root authority are rechecked before delegation or model dispatch');
  const beforeSwitch = captured.length;
  selection.current = { provider: 'fixture', model: 'pro' }; await send(handle.agent, 'wrong model');
  assert.equal(captured.length, beforeSwitch);
  selection.current = { provider: 'fixture', model: 'flash' };
  const changed = structuredClone(book); changed.presets[0].models[1].overrides.persona.text = 'future Persona';
  api.updateBook(changed); await api.rootReady(); await send(handle.agent, 'old snapshot');
  assert.ok(captured.at(-1).messages.some(m => m.role === 'system' && textOf(m) === original.compiled.persona));
  report('warm model switching is refused before dispatch and changed book text does not rewrite an existing root');
  await handle.dispose(); handle = undefined;
  await ctx.fiber.dispose(); ctx = undefined;
  book = { version: 1, entryPresets: [], presets: [] }; await start();
  assert.ok((await ctx.get('agentPresets').list()).some(row => row.id === rootPresetId('worker')));
  extraHandle = await driver.agents.resume({ resumeSessionId: 'root-retry-choice', agentOptions: { provider: 'fixture', model: 'flash' }, setup: setup() });
  await send(extraHandle.agent, 'restored Pro parameters');
  assert.equal(captured.at(-1).model, 'pro');
  assert.deepEqual(captured.at(-1).requestFields, [{ path: 'thinking.budget_tokens', value: 2048, apiFormat: 'chat' }]);
  await extraHandle.dispose(); extraHandle = undefined;
  report('cold root restore keeps its original custom request parameters');
  handle = await driver.agents.resume({ resumeSessionId: 'root-model-choice', agentOptions: { provider: 'fixture', model: 'pro' }, setup: setup() });
  await send(handle.agent, 'restored root');
  assert.equal(captured.at(-1).model, 'flash');
  assert.ok(captured.at(-1).messages.some(m => m.role === 'system' && textOf(m) === original.compiled.persona));
  assert.equal(ctx.get('subagentbook').instance(handle.agent).depth, 0);
  assert.equal((await ctx.get('subagentbook').readResult(handle.agent, { sessionId: child.id })).text, 'root fixture complete');
  report('a new host restores a deleted root role and reads its disposed child report from the original parent identity');
  await handle.dispose(); handle = undefined;
  const saved = readFileSync(sidecar('root-model-choice'), 'utf8');
  const corrupt = JSON.parse(saved); corrupt.compiled.persona = 'tampered'; writeFileSync(sidecar('root-model-choice'), JSON.stringify(corrupt));
  await assert.rejects(driver.agents.resume({ resumeSessionId: 'root-model-choice', setup: setup() }), { code: 'INVALID_INSTANCE' });
  writeFileSync(sidecar('root-model-choice'), saved);
  rmSync(sidecar('root-model-choice'));
  await assert.rejects(driver.agents.resume({ resumeSessionId: 'root-model-choice', setup: setup() }), { code: 'INVALID_INSTANCE' });
  writeFileSync(sidecar('root-model-choice'), saved);
  report('corrupt and missing root sidecars fail closed without replacing the history');
  const storage = recordStore(join(home, 'subagentbook', 'instances'));
  storage.write({ ...JSON.parse(saved), artifactRevision: '0'.repeat(64) });
  await assert.rejects(driver.agents.resume({ resumeSessionId: 'root-model-choice', setup: setup() }), { code: 'ARTIFACT_CHANGED' });
  writeFileSync(sidecar('root-model-choice'), saved);
  handle = await driver.agents.resume({ resumeSessionId: 'root-model-choice', setup: setup() });
  const beforeUnload = captured.length;
  await ctx.loader.resolve('include').subtree.resolve('book').fiber.dispose();
  await send(handle.agent, 'after book unload'); assert.equal(captured.length, beforeUnload);
  const unavailable = await ctx.get('tools').execute({ agent: handle.agent, callId: 'closed-root', name: 'bash', arguments: {
    command: 'printf forbidden > root-must-not-exist.txt', description: 'Book unload negative test', workdir: home,
  }, signal: new AbortController().signal });
  assert.equal(unavailable.isError, true); assert.ok(!existsSync(join(home, 'root-must-not-exist.txt')));
  report('changed code fingerprint and book-service unload cannot fall back to an unguarded root');
  console.log(`PASS roots: ${checks.length} groups, ${captured.length} offline requests`);
  success = true;
} catch (error) { console.error(error); console.error(`Root diagnostics retained: ${home}`); throw error; }
finally {
  if (handle) await handle.dispose(); if (extraHandle) await extraHandle.dispose(); if (ctx) await ctx.fiber.dispose();
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
  if (success) rmSync(home, { recursive: true, force: true });
}

// Offline acceptance through the real profile ConfigEditor / settings write path.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { runtimeRequire } from './runtime-path.mjs';
import { toolsFor, pipelineModels } from './pipeline-config.mjs';
import { teachingFixture } from './teaching-fixture.mjs';

const require = runtimeRequire();
const load = name => import(pathToFileURL(require.resolve(name)).href);
const { boot, readProfilePatches, createRuntimeResolution, PluginPackages } = await load('@deepseek-ai/dsh-app-boot');
const { prepareProfile, INSTALL_ANCHOR, PROFILE_ROOT_FILENAME } = await import(pathToFileURL(join(dirname(require.resolve('@deepseek-ai/dsh/package.json')), 'lib/profile-boot.js')).href);
const { provideCmdline } = await load('@deepseek-ai/dsh-cmdline');
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm');
const home = mkdtempSync(join(tmpdir(), 'subagentbook-settings-'));
const previousHome = process.env.DSH_HOME;
process.env.DSH_HOME = home;
let ctx, parent;
const wires = [];
let releaseNative;
const requestFieldSources = new Set();
const checks = [];
const teachingEntries = Object.fromEntries(['bash', 'glob', 'read', 'grep', 'edit', 'write', 'web_search', 'web_fetch'].map(name => [`tool.${name}`, { fixture: `localized:${name}` }]));
teachingEntries['tool.bash.only'] = { pro: 'localized:solo-bash' };
let teaching = teachingFixture(teachingEntries);
let promptConfig;
if (process.env.DSH_PROMPTBOOK_ENTRY) {
  const { createPromptbook } = await import(pathToFileURL(resolve(process.env.DSH_PROMPTBOOK_ENTRY)).href);
  const registryFile = join(home, 'promptbook-registry.json'); const layersDir = join(home, 'promptbook-models');
  mkdirSync(layersDir); writeFileSync(registryFile, '{}');
  promptConfig = { entriesJson: JSON.stringify(teachingEntries) };
  teaching = createPromptbook({ registryFile, layersDir, config: promptConfig });
  teaching.autoInjectionEnabled = false;
}
let modelData = { provider: 'fixture', id: 'pro', budget: { contextWindow: 131072, defaultMaxTokens: 2048, maxOutputTokens: 4096 }, reasoning: { efforts: [{ id: 'standard', name: 'Standard' }, { id: 'deep', name: 'Deep' }, { id: 'parent-only', name: 'Parent' }], defaultEffort: 'standard' } };
class Adapter extends LlmAdapter {
  providerInfo(id) { return { id, name: 'Offline settings' }; }
  async resolveModel(provider, id) { return { provider, id, name: id, context: { contextWindow: modelData.budget.contextWindow }, defaultMaxTokens: modelData.budget.defaultMaxTokens, reasoning: modelData.reasoning }; }
  async *stream(options) {
    const requestFields = [...requestFieldSources].flatMap(source => source.resolve({ provider: options.provider, model: options.model, sessionId: options.sessionId, purpose: options.purpose }) ?? []);
    wires.push({ ...options, ...(requestFields.length ? { requestFields } : {}) });
    const prompt = options.messages.filter(m => m.role === 'user' && m.source?.kind !== 'runtime-context').at(-1)?.content.find(b => b.type === 'text')?.text;
    if (prompt === 'native plugin preflight') await new Promise(resolve => { releaseNative = resolve; options.signal.addEventListener('abort', resolve, {once:true}); });
    if (prompt === 'wait') {
      await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
      yield { type: 'finish', reason: { kind: 'aborted' } }; return;
    }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
const role = id => ({ id, name: id, defaults: { persona: { text: 'original persona' }, tools: [], delegates: ['worker'], maxNestedDepth: 1 }, models: [{ provider: 'fixture', model: 'pro' }] });
const empty = { version: 1, entryPresets: [], presets: [] };
const original = { version: 1, entryPresets: ['worker'], presets: [role('worker')] };
const check = name => { checks.push(name); console.log(`  PASS ${name}`); };
const describe = () => ctx.settings.describe().find(row => row.ns === 'subagentbook');
const write = (book, rev = describe().revision) => ctx.settings.update('subagentbook', { bookJson: JSON.stringify(book) }, rev);
async function idle(id) {
  const deadline = Date.now() + 10000;
  while (ctx.agents.get(id)) { if (Date.now() > deadline) throw new Error('Offline child did not settle'); await new Promise(resolve => setTimeout(resolve, 5)); }
  await parent.agent.whenIdle();
}
try {
  const profile = prepareProfile('settings-test', true, 'headless');
  writeFileSync(profile.patchPath, yaml.dump([
    { id: 'headless-startup', disabled: true }, { id: 'headless-runner', disabled: true },
    { id: 'session-title-llm', disabled: true },
    { id: 'subagent', config: { maxDepth: 3 } },
    { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
    { insert: [
      { id: 'offline-adapter', name: 'cordis:settings-adapter' },
      { id: 'subagentbook', name: pathToFileURL(resolve('lib/index.js')).href, config: { bookJson: JSON.stringify(empty) } },
    ] },
  ]));
  const profileContext = { name: 'settings-test', dir: profile.dir, patchPath: profile.patchPath, installAnchor: INSTALL_ANCHOR, startedBundles: profile.layers.map(layer => layer.packageName), cwd: home, home, overlays: [] };
  const resolution = await createRuntimeResolution({ installAnchor: INSTALL_ANCHOR, profile });
  ctx = await boot('settings-test', join(profile.dir, PROFILE_ROOT_FILENAME), readProfilePatches('dsh', profileContext), async ctx => {
    ctx.provide('profileContext', profileContext);
    ctx.provide('llmMimo', { listHostedModels: () => [{ ...structuredClone(modelData), apiFormat: 'chat', requestFieldsVersion: 1 }], registerRequestFieldSource(source) { requestFieldSources.add(source); return () => requestFieldSources.delete(source); } });
    ctx.provide('promptbook', teaching);
    await ctx.plugin(PluginPackages, { resolution });
    provideCmdline(ctx, { args: [], exit: () => {} });
    ctx.loader.builtins['settings-adapter'] = { inject: ['llm'], apply: ctx => ctx.llm.registerAdapter(['fixture'], new Adapter()) };
  });
  const api = ctx.get('subagentbook');
  assert.ok(api && ctx.settings);
  assert.ok(['tool.bash', 'tool.glob', 'tool.read', 'tool.grep', 'tool.edit', 'tool.write', 'tool.web_search', 'tool.web_fetch', 'tool.bash.only'].every(key => teaching.definition(key)?.fallback));
  check('consumer activation registers all eight teaching keys and the Bash-only key');
  parent = await ctx.agents.create({ sessionId: 'settings-root', meta: { cwd: home }, agentOptions: { provider: 'fixture', model: 'pro', reasoningEffort: 'parent-only', maxTokens: 777 } });
  await write(original);
  assert.equal(ctx.get('subagentbook'), api);
  assert.ok(ctx.subagents.getProvider('subagentbook:worker'));
  assert.equal(api.compile('worker', 'fixture', 'pro').persona, 'original persona');
  check('empty book becomes delegatable through a persistent settings write without runtime remount');

  const first = await api.startContinuable(parent.agent, { presetId: 'worker', prompt: 'wait' });
  const oldChild = ctx.agents.get(first.childId);
  const oldLiveRecord = api.instance(oldChild);
  const oldRecord = await api.readInstance(first.childId);
  assert.equal(oldRecord.agentOptions.maxTokens, 2048);
  assert.equal(oldRecord.agentOptions.reasoningEffort, undefined);
  check('same-route children use target model defaults instead of inheriting the parent role effort/budget');
  const changed = structuredClone(original);
  changed.presets[0].defaults.persona.text = 'updated persona';
  changed.presets[0].defaults.maxNestedDepth = 0;
  changed.presets.push(role('new-role'));
  changed.entryPresets.push('new-role');
  const beforeRevision = describe().revision;
  await write(changed, beforeRevision);
  assert.equal(ctx.get('subagentbook'), api);
  assert.equal(ctx.agents.get(first.childId), oldChild);
  assert.equal(api.instance(oldChild), oldLiveRecord);
  assert.deepEqual(await api.readInstance(first.childId), oldRecord);
  assert.equal(oldRecord.ceiling, 2);
  check('saving during active background work preserves its Agent, snapshot and ancestor ceiling');

  const second = await api.startContinuable(parent.agent, { presetId: 'worker', prompt: 'fresh' });
  await idle(second.childId);
  assert.equal((await api.readInstance(second.childId)).compiled.persona, 'updated persona');
  assert.equal((await api.readInstance(second.childId)).ceiling, 1);
  assert.ok(wires.some(w => w.messages.some(m => m.role === 'system' && m.content.some(b => b.text === 'updated persona'))));
  check('future instances receive the updated Persona and local depth through actual request assembly');

  const bytes = readFileSync(profile.patchPath, 'utf8');
  await assert.rejects(write(original, beforeRevision), { code: 'SETTINGS_CONFLICT' });
  const invalid = structuredClone(changed); invalid.presets[0].defaults.delegates = ['unknown'];
  await assert.rejects(write(invalid), { code: 'INVALID_BOOK' });
  const legacyPlugins = structuredClone(changed); legacyPlugins.presets[0].defaults.plugins = [{ id: 'arbitrary', name: 'arbitrary-plugin' }];
  await assert.rejects(write(legacyPlugins), { code: 'INVALID_BOOK' });
  assert.equal(readFileSync(profile.patchPath, 'utf8'), bytes);
  assert.equal(api.definition().presets[0].defaults.persona.text, 'updated persona');
  check('stale drafts and structurally invalid writes preserve the profile file and effective definition');

  const collision = ctx.subagents.registerProvider({ name: 'subagentbook:collision', start() {} });
  const colliding = structuredClone(changed); colliding.presets.push(role('collision'));
  await assert.rejects(write(colliding), { code: 'DUPLICATE_PROVIDER' });
  assert.equal(readFileSync(profile.patchPath, 'utf8'), bytes); collision();
  check('foreign provider collisions are rejected before persistence');

  for (const agentOptions of [{ maxTokens: 4097 }, { reasoningEffort: 'High' }]) {
    const invalid = structuredClone(changed); invalid.presets[0].defaults.agentOptions = agentOptions;
    await assert.rejects(write(invalid), { code: agentOptions.maxTokens ? 'MODEL_BUDGET_EXCEEDED' : 'UNSUPPORTED_EFFORT' });
    assert.equal(readFileSync(profile.patchPath, 'utf8'), bytes);
  }
  check('unsupported efforts and excessive declared budgets fail before persistence');
  const capabilityBook = structuredClone(changed);
  capabilityBook.presets[0].defaults.agentOptions = { maxTokens: 3000, reasoningEffort: 'deep' };
  await write(capabilityBook);
  const warm = await api.start(parent.agent, { presetId: 'worker', prompt: 'capability warm' }); await warm.result;
  assert.equal(wires.at(-1).maxTokens, 3000); assert.equal(wires.at(-1).reasoningEffort, 'deep');
  modelData.reasoning.efforts = modelData.reasoning.efforts.filter(row => row.id !== 'deep');
  const beforeWarm = wires.length;
  warm.localAgent.followup(createUserMessage({ content: [{ type: 'text', text: 'blocked stale effort' }], source: { kind: 'user' } }));
  await warm.localAgent.whenIdle(); assert.equal(wires.length, beforeWarm); await warm.dispose();
  modelData.reasoning.efforts.push({ id: 'deep', name: 'Deep' });
  check('valid explicit options reach the wire; removed effort blocks a warm follow-up before adapter dispatch');
  const cold = await api.startContinuable(parent.agent, { presetId: 'worker', prompt: 'capability cold' }); await idle(cold.childId);
  modelData.reasoning.efforts = modelData.reasoning.efforts.filter(row => row.id !== 'deep');
  const beforeCold = wires.length;
  await assert.rejects(api.sendMessage(parent.agent, cold.childId, 'blocked cold effort'));
  assert.equal(wires.length, beforeCold); modelData.reasoning.efforts.push({ id: 'deep', name: 'Deep' });
  await write(changed);
  check('removed effort blocks cold continuation before any model request');

  await write(empty);
  assert.equal(ctx.subagents.getProvider('subagentbook:worker'), undefined);
  assert.equal(ctx.subagents.getProvider('subagentbook:new-role'), undefined);
  assert.equal(ctx.agents.get(first.childId), oldChild);
  await assert.rejects(api.start(oldChild, { presetId: 'worker', prompt: 'denied' }), { code: 'DELEGATION_DENIED' });
  check('removing all roles removes providers and new delegation without draining an existing instance');

  await api.interrupt(parent.agent, first.childId); await idle(first.childId);
  await api.sendMessage(parent.agent, first.childId, 'old conversation'); await idle(first.childId);
  assert.equal((await api.readInstance(first.childId)).compiled.persona, 'original persona');
  const restored = wires.find(w => w.messages.some(m => m.role === 'user' && m.content.some(b => b.text === 'old conversation')));
  assert.ok(restored.messages.some(m => m.role === 'system' && m.content.some(b => b.text === 'original persona')));
  check('deleted-role cold continuation retains its original Persona and native lifecycle controls');

  await write(changed);
  const branch = await api.start(parent.agent, { presetId: 'new-role', prompt: 'wait' });
  const widened = structuredClone(changed); widened.presets.push(role('extra')); widened.presets[1].defaults.delegates.push('extra');
  await write(widened);
  await assert.rejects(api.start(branch.localAgent, { presetId: 'extra', prompt: 'denied' }), { code: 'DELEGATION_DENIED' });
  await branch.dispose();
  const persisted = yaml.load(readFileSync(profile.patchPath, 'utf8')).findLast(row => row.id === 'subagentbook' && row.config);
  assert.deepEqual(JSON.parse(persisted.config.bookJson), widened);
  assert.deepEqual(JSON.parse(describe().value.bookJson), api.definition());
  check('live definition updates cannot widen an existing parent delegate grant; persisted and effective books agree');

  // Exercise the paid acceptance's actual plugin combinations before API spend.
  const native = { version: 1, entryPresets: [], presets: [] };
  for (const target of pipelineModels) for (const role of ['planner', 'executor', 'reviewer']) {
    const id = `${role}-${target}`; const tools = toolsFor(role, target);
    native.entryPresets.push(id);
    native.presets.push({ id, name: id, defaults: { persona: { text: 'Offline native tools fixture' }, tools, delegates: [], maxNestedDepth: 0 }, models: [{ provider: 'fixture', model: 'pro' }] });
  }
  await write(native);
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  writeFileSync(join(home, 'native-tools-probe.txt'), 'subagentbook native search probe\n');
  for (const preset of native.presets) {
    const child = await api.start(parent.agent, { presetId: preset.id, prompt: 'native plugin preflight' });
    try {
      const deadline = Date.now()+10000;
      while(!releaseNative) { if(Date.now()>deadline)throw new Error('Native fixture did not start'); await new Promise(resolve=>setTimeout(resolve,5)); }
      assert.deepEqual(wires.at(-1).tools.map(tool => tool.name).sort(), [...preset.defaults.tools].sort());
      const schemas = ctx.tools.schemas(child.localAgent);
      for (const tool of wires.at(-1).tools) {
        const solo = tool.name === 'bash' && preset.defaults.tools.length === 1;
        assert.equal(tool.description, solo ? 'localized:solo-bash' : `localized:${tool.name}`);
        assert.deepEqual(tool.parameters, schemas.find(schema => schema.name === tool.name).parameters);
      }
      if (preset.defaults.tools.includes('glob')) {
        for (const [name, args] of [['glob', { pattern: '*.txt', path: home }], ['grep', { pattern: 'native search probe', path: home }]]) {
          const result = await ctx.tools.execute({ agent: child.localAgent, callId: `native-${name}`, name, arguments: args, signal: new AbortController().signal });
          assert.ok(!result.isError, JSON.stringify(result));
          assert.match(JSON.stringify(result.content), /native-tools-probe/);
        }
      }
    } finally { releaseNative?.(); releaseNative=undefined; assert.equal((await child.result).stopReason, 'completed'); await child.dispose(); }
  }
  check('all six native plugin combinations resolve teaching automatically with unchanged schemas; packaged glob/grep really execute');

  const soloPreset = native.presets.find(preset => preset.defaults.tools.length === 1);
  teachingEntries['tool.bash.only'].pro = '';
  if (promptConfig) promptConfig.entriesJson = JSON.stringify(teachingEntries);
  const nativeOnly = await api.start(parent.agent, { presetId: soloPreset.id, prompt: 'blank exits takeover' });
  try {
    await nativeOnly.result;
    assert.equal(wires.at(-1).tools.find(tool => tool.name === 'bash').description, ctx.tools.schemas(nativeOnly.localAgent).find(tool => tool.name === 'bash').description);
    assert.equal((await api.readInstance(nativeOnly.id)).compiled.sources.teaching.bash.mode, 'native');
  } finally { await nativeOnly.dispose(); }
  check('explicit blank Bash-only teaching preserves the real native description instead of falling back to common Bash');

  const parameters = structuredClone(original);
  const firstFields = [{ path: 'thinking.budget_tokens', type: 'number', value: 1024, apiFormat: 'chat', name: 'Reasoning budget', min: 0, max: 4096, step: 128 }];
  parameters.presets[0].defaults.agentOptions = { requestFields: firstFields };
  await write(parameters);
  const child = await api.start(parent.agent, { presetId: 'worker', prompt: 'fields one-shot' });
  await child.result;
  assert.deepEqual(wires.at(-1).requestFields, [{ path: 'thinking.budget_tokens', value: 1024, apiFormat: 'chat' }]);
  assert.equal(wires.at(-1).requestFields[0].min, undefined, 'UI settings are not request data');
  await child.dispose();
  const long = await api.startContinuable(parent.agent, { presetId: 'worker', prompt: 'fields initial' });
  await idle(long.childId);
  parameters.presets[0].defaults.agentOptions.requestFields[0].value = 2048;
  await write(parameters);
  await api.sendMessage(parent.agent, long.childId, 'fields cold continuation'); await idle(long.childId);
  const continuedFields = wires.findLast(wire => wire.sessionId === long.childId);
  assert.ok(continuedFields.messages.some(message => message.role === 'user' && message.content.some(block => block.text === 'fields cold continuation')));
  assert.equal(continuedFields.requestFields?.[0]?.value, 1024, 'cold continuation keeps the original parameters');
  const fresh = await api.start(parent.agent, { presetId: 'worker', prompt: 'fields future instance' }); await fresh.result;
  assert.equal(wires.at(-1).requestFields[0].value, 2048); await fresh.dispose();
  assert.ok([...requestFieldSources].every(source => source.resolve({ provider: 'fixture', model: 'pro', sessionId: parent.agent.session.id }) === undefined));
  assert.ok(wires.filter(wire => wire.sessionId === parent.agent.session.id).every(wire => wire.requestFields === undefined));
  const wrong = structuredClone(parameters); wrong.presets[0].defaults.agentOptions.requestFields[0].apiFormat = 'responses';
  await assert.rejects(write(wrong));
  check('request fields reach only exact child sessions, omit UI metadata, and retain snapshots across cold continuation');
  await parent.dispose(); parent = undefined; await ctx.fiber.dispose(); ctx = undefined;
  assert.equal(requestFieldSources.size, 0, 'source registrations are disposed with the plugin');
  rmSync(home, { recursive: true, force: true });
  console.log(`PASS settings integration: ${checks.length} groups, ${wires.length} offline requests`);
} catch (error) {
  console.error(`Diagnostics retained: ${home}`); throw error;
} finally {
  await parent?.dispose(); await ctx?.fiber.dispose();
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
}

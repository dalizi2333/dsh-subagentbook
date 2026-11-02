import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseBook, compilePreset, admitChild, revision, fixedToolPlugins } from '../lib/book.js';
import { registerToolTeaching } from '../lib/tool-teaching.js';
import { teachingFixture } from '../scripts/teaching-fixture.mjs';

const definition = () => ({ version: 1, entryPresets: ['worker'], presets: [{
  id: 'worker', name: 'Worker', defaults: { persona: { key: 'worker' }, tools: ['bash'], plugins: [], delegates: ['worker'] },
  models: [{ provider: 'p', model: 'flash' }, { provider: 'p', model: 'pro', overrides: { tools: ['bash', 'read'], maxNestedDepth: 1 } }],
}] });
const models = [{ provider: 'p', id: 'flash' }, { provider: 'p', id: 'pro' }];

test('fixed providers depend on actual tools, not a configurable plugin list', () => {
  assert.deepEqual(fixedToolPlugins([]), []);
  assert.deepEqual(fixedToolPlugins(['read']).map(row => row.name), ['@deepseek-ai/dsh-tool-fs']);
  assert.deepEqual(fixedToolPlugins(['grep']).map(row => row.name), ['@deepseek-ai/dsh-tool-fs-search']);
  const book = definition(); book.presets[0].defaults.tools = ['bash', 'glob', 'read', 'grep', 'edit', 'write', 'web_search', 'web_fetch'];
  const compiled = compilePreset(parseBook(book), 'worker', 'p', 'flash', { models, resolveText: () => 'Persona' });
  assert.equal(compiled.plugins.length, 4);
  assert.deepEqual(compiled.plugins[0].config, { enableRunInBackground: false, promoteOnTimeout: false });
  assert.deepEqual(compiled.plugins[2].config, { sampleOverCapGlobResults: false });
  assert.throws(() => compiled.plugins.push({ name: 'untrusted' }), TypeError);
  assert.ok(!Object.hasOwn(parseBook(book).presets[0].defaults, 'plugins'));
});

test('empty legacy plugin rows normalize away; nonempty and unsupported controls are refused', () => {
  const book = definition(); book.presets[0].models[1].overrides.plugins = [];
  assert.ok(!Object.hasOwn(parseBook(book).presets[0].models[1].overrides, 'plugins'));
  for (const disabled of [false, true]) {
    book.presets[0].models[1].overrides.plugins = [{ id: 'custom', name: 'some-plugin', disabled }];
    assert.throws(() => parseBook(book), /plugin composition is no longer configurable/);
  }
  delete book.presets[0].models[1].overrides.plugins;
  book.presets[0].defaults.tools.push('custom');
  assert.throws(() => parseBook(book), /unsupported task tool/);
});

test('only task tools select Bash-only teaching; preference and managed delegation do not', () => {
  const book = definition();
  const entries = { 'tool.bash.only': 'solo', 'tool.bash': 'ordinary', 'tool.read': 'reader' };
  const options = { models, resolveText: () => 'Persona', resolveToolText: key => entries[key] };
  const solo = compilePreset(parseBook(book), 'worker', 'p', 'flash', options);
  assert.deepEqual(solo.teaching, { bash: 'solo' }); assert.equal(solo.sources.teaching.bash.key, 'tool.bash.only');
  book.presets[0].models[1].overrides.toolPreference = 'bash';
  book.presets[0].models[1].overrides.preferencePrompt = { text: 'Bash preference' };
  const multiple = compilePreset(parseBook(book), 'worker', 'p', 'pro', options);
  assert.deepEqual(multiple.teaching, { bash: 'ordinary', read: 'reader' });
  assert.equal(multiple.sources.teaching.bash.key, 'tool.bash');
  entries['tool.bash'] = 'later'; assert.equal(multiple.teaching.bash, 'ordinary');
  assert.equal(compilePreset(parseBook(book), 'worker', 'p', 'pro', options).teaching.bash, 'later');
});

test('localized absence falls back to common Bash, explicit blank exits takeover, and empty tools do not inject', () => {
  const book = definition();
  const entries = { 'tool.bash': 'ordinary' };
  const options = { models, resolveText: () => 'Persona', resolveToolText: key => entries[key] };
  let compiled = compilePreset(parseBook(book), 'worker', 'p', 'flash', options);
  assert.equal(compiled.teaching.bash, 'ordinary'); assert.equal(compiled.sources.teaching.bash.resolvedKey, 'tool.bash');
  entries['tool.bash.only'] = '';
  compiled = compilePreset(parseBook(book), 'worker', 'p', 'flash', options);
  assert.deepEqual(compiled.teaching, {}); assert.equal(compiled.sources.teaching.bash.mode, 'native');
  assert.deepEqual(compilePreset(parseBook(book), 'worker', 'p', 'pro', { ...options, resolveToolText: undefined }).teaching, {});
  book.presets[0].defaults.tools = [];
  assert.deepEqual(compilePreset(parseBook(book), 'worker', 'p', 'flash', options).sources.teaching, {});
});

test('registration preserves existing Promptbook definitions and does not turn display fallback into teaching', () => {
  const pb = teachingFixture();
  pb.register('tool.bash', { label: 'owner label', fallback: 'owner fallback' });
  registerToolTeaching(pb); registerToolTeaching(pb);
  assert.deepEqual(pb.definition('tool.bash'), { label: 'owner label', fallback: 'owner fallback' });
  for (const key of ['tool.bash', 'tool.glob', 'tool.read', 'tool.grep', 'tool.edit', 'tool.write', 'tool.web_search', 'tool.web_fetch', 'tool.bash.only']) {
    assert.ok(pb.definition(key).fallback); assert.equal(pb.resolveOverride(key, 'flash', 'p'), undefined);
  }
});

test('old empty teaching normalizes away; authored legacy teaching requires explicit migration', () => {
  const book = definition(); book.presets[0].defaults.teaching = {}; book.presets[0].models[1].overrides.teaching = {};
  const parsed = parseBook(book);
  assert.ok(!Object.hasOwn(parsed.presets[0].defaults, 'teaching'));
  assert.ok(!Object.hasOwn(parsed.presets[0].models[1].overrides, 'teaching'));
  assert.ok(Object.hasOwn(book.presets[0].defaults, 'teaching'), 'Caller input stays unchanged');
  book.presets[0].defaults.teaching = { bash: { text: 'keep this authored text' } };
  assert.throws(() => parseBook(book), /migrate non-empty teaching/);
});

test('packaged candidates retain model-authored texts and compile only for exact hosted routes', () => {
  const book = parseBook(JSON.parse(readFileSync(new URL('../examples/role-candidates-v1.json', import.meta.url), 'utf8')));
  const authors = JSON.parse(readFileSync(new URL('../examples/role-candidates-v1.authorship.json', import.meta.url), 'utf8'));
  const models = authors.records.map(row => ({ provider: 'mimo', id: row.model }));
  for (const author of authors.records) {
    assert.equal(createHash('sha256').update(author.text).digest('hex'), author.textSha256);
    const texts = JSON.parse(author.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); assert.equal(author.finish.kind, 'stop');
    for (const preset of book.presets) {
      const compiled = compilePreset(book, preset.id, 'mimo', author.model, { models });
      assert.equal(compiled.persona, texts[preset.id]);
      assert.deepEqual(compiled.delegates, []); assert.equal(compiled.maxNestedDepth, 0);
      assert.throws(() => compilePreset(book, preset.id, 'other', author.model, { models }), { code: 'UNKNOWN_ROUTE' });
    }
  }
});

test('exact route, resolved prompt and immutable revisions are model-specific', () => {
  const book = parseBook(definition());
  const options = { models, resolveText: (key, model, provider) => `${key}:${provider}:${model}` };
  const flash = compilePreset(book, 'worker', 'p', 'flash', options);
  const pro = compilePreset(book, 'worker', 'p', 'pro', options);
  assert.deepEqual(flash.tools, ['bash']); assert.deepEqual(pro.tools, ['bash', 'read']);
  assert.equal(pro.persona, 'worker:p:pro'); assert.equal(pro.maxNestedDepth, 1);
  assert.equal(flash.presetRevision, pro.presetRevision); assert.notEqual(flash.compositionRevision, pro.compositionRevision);
  assert.throws(() => pro.tools.push('write'), TypeError);
  assert.throws(() => compilePreset(book, 'worker', 'other', 'pro', options), { code: 'UNKNOWN_ROUTE' });
  assert.throws(() => compilePreset(book, 'worker', 'p', 'pro', { ...options, models: [{ provider: 'other', id: 'pro' }] }), { code: 'UNHOSTED_MODEL' });
  assert.throws(() => compilePreset(book, 'worker', 'p', 'pro', { models }), { code: 'MISSING_PROMPT' });
  assert.equal(revision({ b: 2, a: 1 }), revision({ a: 1, b: 2 }));
});

test('reject invalid declarations instead of silently widening capability', () => {
  const invalid = [
    b => b.presets.push(b.presets[0]),
    b => b.entryPresets.push('missing'),
    b => b.presets[0].defaults.delegates.push('missing'),
    b => b.presets[0].models.push({ provider: 'p', model: 'flash' }),
    b => b.presets[0].defaults.tools.push('subagent_fork'),
    b => b.presets[0].defaults.maxNestedDepth = -1,
    b => b.presets[0].defaults.actionScope = 'workspace-write',
    b => b.presets[0].defaults.plugins = [{ id: 'x', name: 'some-plugin', config: { apiKey: 'credential' } }],
    b => b.presets[0].defaults.plugins = [{ id: 'x', name: 'some-plugin', config: { __jsExpr: 'process.env' } }],
    b => b.presets[0].defaults.toolPreference = 'bash',
    b => b.presets[0].defaults.teaching = { write: { text: 'hidden' } },
  ];
  for (const mutate of invalid) { const b = definition(); mutate(b); assert.throws(() => parseBook(b), { code: 'INVALID_BOOK' }); }
});

test('live host limit and ancestor branch ceiling remain separate', () => {
  const root = { depth: 0, ceiling: null };
  const child = admitChild(root, 3, 5);
  const grandchild = admitChild(child, 3, 8);
  const leaf = admitChild(grandchild, 3);
  assert.equal(leaf.depth, 3);
  assert.throws(() => admitChild(leaf, 3, 99), { code: 'DEPTH_LIMIT' });
  assert.equal(admitChild(leaf, 9).depth, 4);
  const limited = admitChild(root, 3, 1);
  const limitedLeaf = admitChild(limited, 9, 8);
  assert.equal(limitedLeaf.ceiling, 2);
  assert.throws(() => admitChild(limitedLeaf, 9), { code: 'DEPTH_LIMIT' });
  assert.throws(() => admitChild(child, 1), { code: 'DEPTH_LIMIT' });
  const zero = admitChild(root, 3, 0);
  assert.equal(zero.depth, 1); assert.throws(() => admitChild(zero, 3), { code: 'DEPTH_LIMIT' });
  for (const bad of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => admitChild(root, 3, bad));
  assert.throws(() => admitChild(root, 3, Number.MAX_SAFE_INTEGER), /overflow/);
});

test('declared output/context ceilings are enforced without turning a default into a hard limit', () => {
  const book = definition(); book.presets[0].defaults.agentOptions = { maxTokens: 200 };
  const model = { provider: 'p', id: 'flash', budget: { contextWindow: 1000, defaultMaxTokens: 100, maxOutputTokens: 200 } };
  const options = { models: [model], resolveText: () => 'Persona' };
  assert.equal(compilePreset(parseBook(book), 'worker', 'p', 'flash', options).agentOptions.maxTokens, 200);
  book.presets[0].defaults.agentOptions.maxTokens = 201;
  assert.throws(() => compilePreset(parseBook(book), 'worker', 'p', 'flash', options), { code: 'MODEL_BUDGET_EXCEEDED' });
  delete model.budget.maxOutputTokens;
  assert.equal(compilePreset(parseBook(book), 'worker', 'p', 'flash', options).agentOptions.maxTokens, 201);
  book.presets[0].defaults.agentOptions.maxTokens = 1001;
  assert.throws(() => compilePreset(parseBook(book), 'worker', 'p', 'flash', options), { code: 'MODEL_BUDGET_EXCEEDED' });
  delete book.presets[0].defaults.agentOptions.maxTokens;
  const compiled = compilePreset(parseBook(book), 'worker', 'p', 'flash', options);
  assert.equal(compiled.agentOptions.maxTokens, 100);
  assert.ok(compiled.capabilityCheck.warnings.some(w => w.includes('not a hard ceiling')));
});

test('opaque efforts belong to their exact route and a model override replaces all Agent options', () => {
  const book = definition(); book.presets[0].defaults.agentOptions = { maxTokens: 200, reasoningEffort: 'chat-level' };
  book.presets[0].models[1].overrides.agentOptions = { maxTokens: 300 };
  const models = [{ provider: 'p', id: 'flash', reasoning: { efforts: [{ id: 'chat-level', name: 'High' }] } }, { provider: 'p', id: 'pro', reasoning: { efforts: [{ id: 'responses-level', name: 'High' }] } }];
  const options = { models, resolveText: () => 'Persona' };
  assert.equal(compilePreset(parseBook(book), 'worker', 'p', 'flash', options).agentOptions.reasoningEffort, 'chat-level');
  assert.equal(compilePreset(parseBook(book), 'worker', 'p', 'pro', options).agentOptions.reasoningEffort, undefined);
  book.presets[0].models[1].overrides.agentOptions.reasoningEffort = 'chat-level';
  assert.throws(() => compilePreset(parseBook(book), 'worker', 'p', 'pro', options), { code: 'UNSUPPORTED_EFFORT' });
  book.presets[0].models[1].overrides.agentOptions.reasoningEffort = 'High';
  assert.throws(() => compilePreset(parseBook(book), 'worker', 'p', 'pro', options), { code: 'UNSUPPORTED_EFFORT' });
});

test('role file scope supports inheritance and narrowing, never an access grant', () => {
  const b = definition(); b.presets[0].defaults.actionScope = 'read-only';
  assert.equal(compilePreset(parseBook(b), 'worker', 'p', 'flash', { models, resolveText: () => 'persona' }).actionScope, 'read-only');
  for (const mode of ['workspace-write', 'danger-full-access', '', null]) {
    b.presets[0].defaults.actionScope = mode; assert.throws(() => parseBook(b), /cannot grant additional access/);
  }
});

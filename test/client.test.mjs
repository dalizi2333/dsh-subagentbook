import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { compilePreset, parseBook } from '../lib/book.js';
let definition;
vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
  window: { __ModuleLoader__: { load: value => { definition = value; } } }, structuredClone,
});
const client = definition.factory(name => name === 'react' ? { createElement() {} } : {});
const book = { version: 1, entryPresets: ['worker'], presets: [{ id: 'worker', name: 'Worker', defaults: {
  persona: { key: 'persona.worker' }, tools: ['bash', 'read'], maxNestedDepth: 2,
}, models: [{ provider: 'fixture', model: 'pro' }, { provider: 'fixture', model: 'flash', overrides: { tools: [], teaching: {}, maxNestedDepth: 0 } }] }] };
const json = value => JSON.parse(JSON.stringify(value));
function scope(value, revision = 1) {
  const listeners = new Set();
  let snapshot = { status: 'ready', value, writable: true, revision };
  const calls = [];
  return { calls, getSnapshot: () => snapshot, subscribe: callback => { listeners.add(callback); return () => listeners.delete(callback); },
    replace(value) { snapshot = { ...snapshot, value, revision: snapshot.revision + 1 }; for (const callback of listeners) callback(); },
    async mutate(ops, expected) { calls.push({ ops, expected }); if (expected !== snapshot.revision) return false; this.replace({ bookJson: ops[0].value }); return true; },
  };
}
const modelScope = () => scope({ customProviders: { fixture: { modelsJson: JSON.stringify([{ id: 'pro' }, { id: 'flash' }]) } } });
const promptScope = () => scope({ registryJson: JSON.stringify({ 'persona.worker': { fallback: 'fallback' } }), entriesJson: JSON.stringify({ 'persona.worker': { pro: 'Pro Persona', default: 'default Persona' } }) });
test('team import preserves draft edits and pending gates, persists atomically and remains editable', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.edit('persona', JSON.stringify({ text: 'User draft' }));
  editor.tagInput('tools', 'not-confirmed');
  assert.equal(editor.addTeam('missing', 'pro'), undefined);
  assert.equal(editor.getSnapshot().book.presets.length, 1);
  assert.equal(editor.addTeam('fixture', 'pro'), 'ur.developer');
  assert.equal(editor.getSnapshot().book.presets[0].defaults.persona.text, 'User draft');
  assert.equal(editor.getSnapshot().canSave, false, 'adding a team cannot bypass pending inputs');
  editor.select('worker'); editor.tagInput('tools', '');
  editor.select('ur.developer'); editor.edit('persona', JSON.stringify({ text: 'Customized team root' }));
  assert.equal(await editor.save(), true);
  assert.equal(parseBook(target.getSnapshot().value.bookJson).presets.length, 11);
  assert.equal(editor.getSnapshot().effective.persona.text, 'Customized team root');
  assert.equal(editor.addTeam('fixture', 'flash'), 'ur-2.developer');
  editor.discard(); assert.equal(editor.getSnapshot().book.presets.length, 11);
  editor.dispose();
});
const optionDirectory = () => scope({ modelControlsViewJson: JSON.stringify([
  { provider: 'fixture', id: 'pro', budget: { contextWindow: 1000, defaultMaxTokens: 100 }, reasoning: { efforts: [{ id: 'default', name: 'Default' }, { id: 'shared', name: 'Shared' }, { id: 'pro-only', name: 'Pro' }], defaultEffort: 'default' } },
  { provider: 'fixture', id: 'flash', budget: { contextWindow: 800, maxOutputTokens: 500, defaultMaxTokens: 80 }, reasoning: { efforts: [{ id: 'default', name: 'Default' }, { id: 'shared', name: 'Shared' }, { id: 'flash-only', name: 'Flash' }], defaultEffort: 'default' } },
]) });

test('graphical model options preserve the other selection and persist opaque IDs rather than labels', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, optionDirectory(), promptScope());
  editor.select('worker', 0);
  editor.option('maxTokens', 600); editor.option('reasoningEffort', 'pro-only');
  assert.equal(editor.getSnapshot().canSave, true, 'model default 100 is not an output ceiling');
  assert.deepEqual(json(editor.getSnapshot().effective.agentOptions), { maxTokens: 600, reasoningEffort: 'pro-only' });
  assert.equal(await editor.save(), true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].models[0].overrides.agentOptions, { maxTokens: 600, reasoningEffort: 'pro-only' });
  editor.option('maxTokens', undefined);
  assert.deepEqual(json(editor.getSnapshot().effective.agentOptions), { reasoningEffort: 'pro-only' });
  editor.option('maxTokens', 200); editor.option('reasoningEffort', undefined);
  assert.deepEqual(json(editor.getSnapshot().effective.agentOptions), { maxTokens: 200 });
  editor.undo('agentOptions');
  assert.equal(editor.getSnapshot().dirty, false);
  editor.dispose();
});

function requestDirectory() {
  const rows = JSON.parse(optionDirectory().getSnapshot().value.modelControlsViewJson).map(model => ({ ...model, apiFormat: 'chat', requestFieldsVersion: 1,
    reasoningControls: { parameter: 'thinking.type', offParameter: 'thinking.type', stops: [{ id: 'shared', kind: 'level', value: 'enabled' }] } }));
  return scope({ modelControlsViewJson: JSON.stringify(rows) });
}
test('added API fields retain typed values and editable slider settings without erasing other options', async () => {
  const target = scope({ bookJson: JSON.stringify(book) }), editor = client.createEditor(target, requestDirectory(), promptScope());
  editor.option('maxTokens', 200); editor.option('reasoningEffort', 'shared');
  editor.requestField(-1);
  assert.equal(editor.getSnapshot().canSave, false, 'the empty path cannot be saved');
  editor.requestField(0, { name: 'Reasoning budget', path: 'thinking.budget_tokens', value: 8192, min: 0, max: 32768, step: 1024 });
  assert.equal(await editor.save(), true);
  const options = parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.agentOptions;
  assert.equal(options.maxTokens, 200); assert.equal(options.reasoningEffort, 'shared');
  assert.deepEqual(options.requestFields[0], { name: 'Reasoning budget', path: 'thinking.budget_tokens', apiFormat: 'chat', type: 'number', value: 8192, min: 0, max: 32768, step: 1024 });
  editor.requestField(0, { min: 9000 }); assert.equal(editor.getSnapshot().canSave, false);
  editor.undo('agentOptions');
  editor.requestField(0, null); assert.equal(await editor.save(), true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.agentOptions, { maxTokens: 200, reasoningEffort: 'shared', requestFields: [] });
  editor.dispose();
});

test('API field conflicts and format drift remain explicit and fence persistence', async () => {
  const models = requestDirectory(), target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, models, promptScope());
  editor.option('reasoningEffort', 'shared'); editor.requestField(-1);
  editor.requestField(0, { path: 'thinking.type', type: 'string', value: 'adaptive' });
  assert.equal(editor.getSnapshot().canSave, false); assert.match(Object.values(editor.getSnapshot().fieldErrors).join(), /conflicts/);
  editor.option('reasoningEffort', undefined); assert.equal(await editor.save(), true);
  for (const path of ['model', 'tools.x', 'max_tokens', 'a.__proto__.x', 'bad..path']) {
    editor.requestField(0, { path }); assert.equal(await editor.save(), false);
  }
  editor.requestField(0, { path: 'thinking.type' });
  editor.requestField(-1); editor.requestField(1, { path: 'thinking', type: 'boolean', value: false });
  assert.equal(editor.getSnapshot().canSave, false); editor.requestField(1, null);
  const rows = JSON.parse(models.getSnapshot().value.modelControlsViewJson); rows[1].apiFormat = 'responses';
  models.replace({ modelControlsViewJson: JSON.stringify(rows) });
  assert.equal(editor.getSnapshot().optionControls.apiFormat, undefined);
  assert.equal(editor.getSnapshot().effective.agentOptions.requestFields[0].apiFormat, 'chat');
  editor.option('maxTokens', 100); assert.equal(await editor.save(), false);
  assert.match(Object.values(editor.getSnapshot().fieldErrors).join(), /responses/);
  editor.dispose();
});

test('common controls intersect exact inheriting routes and retain whole-field replacement', () => {
  const editor = client.createEditor(scope({ bookJson: JSON.stringify(book) }), optionDirectory(), promptScope());
  let state = editor.getSnapshot();
  assert.equal(state.optionControls.limit, 500);
  assert.equal(state.optionControls.defaultBudget, undefined);
  assert.deepEqual(json(state.optionControls.efforts).map(e => e.id), ['default', 'shared']);
  editor.option('maxTokens', 400); editor.option('reasoningEffort', 'shared');
  editor.select('worker', 0); editor.option('maxTokens', 600);
  assert.deepEqual(json(editor.getSnapshot().effective.agentOptions), { maxTokens: 600, reasoningEffort: 'shared' });
  editor.select('worker', -1);
  assert.equal(editor.getSnapshot().optionControls.limit, 500);
  assert.equal(editor.getSnapshot().optionControls.defaultBudget, 80);
  assert.deepEqual(json(editor.getSnapshot().optionControls.efforts).map(e => e.id), ['default', 'shared', 'flash-only']);
  editor.select('worker', 1); editor.option('reasoningEffort', undefined);
  editor.option('maxTokens', undefined);
  assert.deepEqual(json(editor.getSnapshot().effective.agentOptions), {});
  editor.inherit('agentOptions');
  assert.deepEqual(json(editor.getSnapshot().effective.agentOptions), { maxTokens: 400, reasoningEffort: 'shared' });
  editor.dispose();
});

test('invalid numbers, route-specific efforts and live capability changes fence all saves', async () => {
  const target = scope({ bookJson: JSON.stringify(book) }), models = optionDirectory();
  const editor = client.createEditor(target, models, promptScope());
  for (const value of [0, -1, 1.5, '1e3', Number.MAX_SAFE_INTEGER + 1, 501]) {
    editor.option('maxTokens', value);
    assert.equal(editor.getSnapshot().canSave, false, `reject ${value}`);
    assert.equal(await editor.save(), false);
  }
  editor.option('maxTokens', 400); editor.option('reasoningEffort', 'pro-only');
  assert.equal(editor.getSnapshot().rowStates.agentOptions.status, 'invalid');
  assert.match(Object.values(editor.getSnapshot().fieldErrors).join(), /flash/);
  assert.equal(await editor.save(), false); assert.equal(target.calls.length, 0);
  editor.option('reasoningEffort', 'shared'); assert.equal(await editor.save(), true);
  const updated = JSON.parse(models.getSnapshot().value.modelControlsViewJson);
  updated[1].reasoning.efforts = [{ id: 'default', name: 'Default' }];
  models.replace({ modelControlsViewJson: JSON.stringify(updated) });
  assert.equal(editor.getSnapshot().effective.agentOptions.reasoningEffort, 'shared', 'a stale selection must remain visible');
  assert.equal(editor.getSnapshot().rowStates.agentOptions.status, 'invalid');
  editor.select('worker', 0); editor.metadata('Renamed', '', true);
  assert.equal(editor.getSnapshot().canSave, false, 'another model cannot hide invalid inherited options');
  editor.select('worker', -1); editor.option('reasoningEffort', undefined);
  assert.equal(await editor.save(), true); editor.dispose();
});

test('undisclosed limits and missing routes never borrow a guessed slider bound or effort vocabulary', async () => {
  const models = optionDirectory();
  const rows = JSON.parse(models.getSnapshot().value.modelControlsViewJson);
  delete rows[1].budget.contextWindow; delete rows[1].budget.maxOutputTokens;
  models.replace({ modelControlsViewJson: JSON.stringify(rows) });
  const editor = client.createEditor(scope({ bookJson: JSON.stringify(book) }), models, promptScope());
  assert.equal(editor.getSnapshot().optionControls.limit, undefined);
  editor.option('maxTokens', 400); assert.equal(editor.getSnapshot().canSave, true);
  assert.equal(await editor.save(), true);
  models.replace({ modelControlsViewJson: JSON.stringify(rows.slice(0, 1)) });
  assert.equal(editor.getSnapshot().optionControls.complete, false);
  assert.deepEqual(json(editor.getSnapshot().optionControls.efforts), []);
  assert.equal(editor.getSnapshot().optionControls.limit, undefined);
  editor.option('maxTokens', 300); assert.equal(await editor.save(), false);
  editor.option('maxTokens', undefined); assert.equal(await editor.save(), true);
  editor.dispose();
});

test('single client entry shares parsing and resolved configuration with the host', () => {
  assert.equal(definition.id, '@mimo-codex/dsh-subagentbook');
  assert.deepEqual(json(client.parseBook(book)), parseBook(book));
  const models = json(client.hostedModels(modelScope().getSnapshot()));
  const resolveText = (key, model, provider) => client.resolvePrompt(key, model, provider, promptScope().getSnapshot().value);
  for (const model of ['pro', 'flash']) {
    const actual = json(client.resolvePreset(client.parseBook(book), 'worker', 'fixture', model, { models, resolveText }));
    // The host result is frozen; compare a detached projection instead.
    const projected = Object.fromEntries(Object.entries(compilePreset(parseBook(book), 'worker', 'fixture', model, { models, resolveText })).filter(([key]) => !key.endsWith('Revision')));
    assert.deepEqual(actual, projected);
  }
});

test('drafts survive role scope changes and model arrays/zero replace common values', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.select('worker', 1);
  assert.deepEqual(json(editor.getSnapshot().preview.tools), []);
  assert.equal(editor.getSnapshot().preview.maxNestedDepth, 0);
  editor.edit('tools', 'bash'); editor.edit('maxNestedDepth', '1');
  editor.select('worker', -1); assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash', 'read']);
  editor.select('worker', 1); assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash']);
  assert.equal(await editor.save(), true);
  const saved = parseBook(target.getSnapshot().value.bookJson);
  assert.deepEqual(saved.presets[0].models[1].overrides.tools, ['bash']);
  assert.equal(saved.presets[0].models[1].overrides.maxNestedDepth, 1);
  assert.equal(editor.getSnapshot().dirty, false); editor.dispose();
});

test('stale draft carries its original fence and survives refusal until explicitly discarded', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.edit('tools', 'bash, read, write');
  const external = structuredClone(book); external.presets[0].name = 'Changed elsewhere'; target.replace({ bookJson: JSON.stringify(external) });
  assert.equal(await editor.save(), false);
  assert.equal(target.calls[0].expected, 1);
  assert.equal(editor.getSnapshot().dirty, true);
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash', 'read', 'write']);
  assert.equal(parseBook(target.getSnapshot().value.bookJson).presets[0].name, 'Changed elsewhere');
  editor.discard(); assert.equal(editor.getSnapshot().preset.name, 'Changed elsewhere'); editor.dispose();
});

test('invalid JSON is rejected and tool changes no longer require editing a teaching map', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.edit('agentOptions', '['); assert.equal(await editor.save(), false); assert.equal(target.calls.length, 0);
  editor.undo('agentOptions'); editor.edit('tools', 'bash');
  assert.equal(await editor.save(), true);
  assert.ok(!Object.hasOwn(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults, 'teaching'));
  editor.dispose();
});

test('clearing a model field restores common configuration and explicit empty values remain valid', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.select('worker', 1); editor.inherit('tools');
  assert.deepEqual(json(editor.getSnapshot().preview.tools), ['bash', 'read']);
  assert.equal(editor.getSnapshot().preview.maxNestedDepth, 0);
  assert.equal(await editor.save(), true);
  assert.ok(!Object.hasOwn(parseBook(target.getSnapshot().value.bookJson).presets[0].models[1].overrides, 'tools'));
  editor.dispose();
});

test('deleting a model variant discards its invalid field draft while preserving other variants', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.select('worker', 1); editor.edit('agentOptions', '['); editor.deleteRoute();
  assert.equal(await editor.save(), true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].models.map(m => m.model), ['pro']);
  editor.dispose();
});

test('removed plugin controls cannot be reintroduced through the draft editor', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.edit('plugins', '[{"name":"arbitrary-plugin"}]');
  assert.match(editor.getSnapshot().error, /Unknown editable field plugins/);
  assert.equal(editor.getSnapshot().dirty, false); assert.equal(target.calls.length, 0);
  editor.dispose();
});

test('tool tags confirm valid batches and reject unknown or duplicate entries without partially adding tools', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  const key = `${editor.getSnapshot().selectionKey}\u0000tools`;
  editor.tagInput('tools', 'write, nonexistent');
  assert.equal(editor.confirmTags('tools'), false);
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash', 'read']);
  assert.deepEqual(json(editor.getSnapshot().tagInputs[key].issue), { kind: 'unknown', names: ['nonexistent'] });
  assert.equal(await editor.save(), false); assert.equal(target.calls.length, 0);
  editor.tagInput('tools', 'write, write'); assert.equal(editor.confirmTags('tools'), false);
  assert.deepEqual(json(editor.getSnapshot().tagInputs[key].issue), { kind: 'duplicate', names: ['write'] });
  editor.tagInput('tools', 'write read'); assert.equal(editor.confirmTags('tools'), false);
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash', 'read']);
  editor.tagInput('tools', 'write, web_search'); assert.equal(editor.confirmTags('tools'), true);
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash', 'read', 'write', 'web_search']);
  assert.equal(editor.getSnapshot().tagInputs[key], undefined);
  assert.equal(await editor.save(), true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.tools, ['bash', 'read', 'write', 'web_search']);
  editor.dispose();
});

test('unconfirmed tool input fences all draft saves and survives scope changes and tag deletion', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  const commonKey = `${editor.getSnapshot().selectionKey}\u0000tools`;
  assert.equal(editor.confirmTags('tools'), false); assert.equal(editor.getSnapshot().dirty, false);
  editor.tagInput('tools', 'write');
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash', 'read']);
  assert.deepEqual(json(editor.getSnapshot().preview.tools), ['bash', 'read']);
  assert.equal(editor.getSnapshot().preview.persona, 'Pro Persona');
  assert.equal(await editor.save(), false); assert.equal(target.calls.length, 0);
  editor.select('worker', 1); editor.tagInput('tools', 'bash'); editor.confirmTags('tools');
  assert.equal(await editor.save(), false); assert.equal(target.calls.length, 0);
  editor.select('worker', -1);
  assert.equal(editor.getSnapshot().tagInputs[commonKey].text, 'write');
  editor.removeTag('tools', 'read');
  assert.equal(editor.getSnapshot().tagInputs[commonKey].text, 'write');
  assert.equal(await editor.save(), false);
  editor.blurTagInput('tools'); assert.equal(editor.getSnapshot().tagInputs[commonKey].issue.kind, 'pending');
  editor.confirmTags('tools'); assert.equal(await editor.save(), true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.tools, ['bash', 'write']);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].models[1].overrides.tools, ['bash']);
  editor.dispose();
});

test('tag undo, inherit, variant deletion and discard clear only the appropriate pending input', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.removeTag('tools', 'bash'); editor.removeTag('tools', 'read');
  assert.deepEqual(json(editor.getSnapshot().effective.tools), []);
  assert.equal(await editor.save(), true);
  editor.tagInput('tools', 'nope'); editor.confirmTags('tools'); editor.undo('tools');
  assert.equal(Object.keys(editor.getSnapshot().tagInputs).length, 0);
  editor.select('worker', 1); editor.tagInput('tools', 'nope'); editor.confirmTags('tools'); editor.inherit('tools');
  assert.equal(Object.keys(editor.getSnapshot().tagInputs).length, 0);
  assert.ok(!Object.hasOwn(editor.getSnapshot().route.overrides, 'tools'));
  editor.tagInput('tools', 'nope'); editor.deleteRoute();
  assert.equal(Object.keys(editor.getSnapshot().tagInputs).length, 0);
  assert.equal(await editor.save(), true);
  editor.tagInput('tools', 'write'); editor.discard();
  assert.equal(Object.keys(editor.getSnapshot().tagInputs).length, 0); assert.equal(editor.getSnapshot().dirty, false);
  editor.dispose();
});

test('raw tool edits also validate names and duplicates before altering the confirmed list', () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.edit('tools', 'bash, nope');
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash', 'read']);
  assert.match(Object.values(editor.getSnapshot().fieldErrors)[0], /Unsupported tools: nope/);
  editor.edit('tools', 'bash, bash');
  assert.match(Object.values(editor.getSnapshot().fieldErrors)[0], /Duplicate tool name/);
  editor.undo('tools'); assert.equal(Object.keys(editor.getSnapshot().fieldErrors).length, 0);
  editor.dispose();
});

const delegateBook = () => ({ ...structuredClone(book), presets: [...structuredClone(book.presets), {
  id: 'reviewer', name: 'Reviewer', defaults: { persona: { text: 'Review' }, tools: [] }, models: [{ provider: 'fixture', model: 'flash' }],
}] });
test('role tags validate the current book atomically, reject duplicates, and keep exact IDs', async () => {
  const target = scope({ bookJson: JSON.stringify(delegateBook()) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  const key = `${editor.getSnapshot().selectionKey}\u0000delegates`;
  editor.tagInput('delegates', 'worker, missing'); assert.equal(editor.confirmTags('delegates'), false);
  assert.deepEqual(json(editor.getSnapshot().effective.delegates), []);
  assert.deepEqual(json(editor.getSnapshot().tagInputs[key].issue), { kind: 'unknown', names: ['missing'] });
  assert.equal(await editor.save(), false); assert.equal(target.calls.length, 0);
  editor.tagInput('delegates', 'worker worker'); assert.equal(editor.confirmTags('delegates'), false);
  assert.equal(editor.getSnapshot().tagInputs[key].issue.kind, 'duplicate');
  editor.tagInput('delegates', 'worker reviewer'); assert.equal(editor.confirmTags('delegates'), true);
  assert.deepEqual(json(editor.getSnapshot().effective.delegates), ['worker', 'reviewer'], 'self and another-model roles remain legal');
  assert.equal(editor.getSnapshot().preview.persona, 'Pro Persona');
  assert.equal(await editor.save(), true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.delegates, ['worker', 'reviewer']);
  editor.tagInput('delegates', 'reviewer'); assert.equal(editor.confirmTags('delegates'), false);
  editor.undo('delegates'); editor.removeTag('delegates', 'worker'); editor.removeTag('delegates', 'reviewer');
  assert.equal(await editor.save(), true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.delegates, []);
  editor.dispose();
});

test('tools and role pending tags fence all saves independently across model scopes', async () => {
  const target = scope({ bookJson: JSON.stringify(delegateBook()) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  const common = `${editor.getSnapshot().selectionKey}\u0000delegates`;
  editor.tagInput('tools', 'write'); editor.tagInput('delegates', 'worker');
  editor.blurTagInput('delegates'); assert.equal(editor.getSnapshot().tagInputs[common].issue.kind, 'pending');
  assert.equal(editor.getSnapshot().rowStates.delegates.status, 'pending');
  assert.equal(editor.getSnapshot().preview.persona, 'Pro Persona');
  editor.select('worker', 1); editor.tagInput('delegates', 'reviewer'); editor.confirmTags('delegates');
  assert.equal(await editor.save(), false);
  editor.select('worker', -1); editor.confirmTags('delegates');
  assert.equal(editor.getSnapshot().tagInputs[common], undefined);
  assert.equal(await editor.save(), false, 'confirming roles cannot clear the pending tool');
  editor.confirmTags('tools'); assert.equal(await editor.save(), true);
  const saved = parseBook(target.getSnapshot().value.bookJson);
  assert.deepEqual(saved.presets[0].defaults.delegates, ['worker']);
  assert.deepEqual(saved.presets[0].models[1].overrides.delegates, ['reviewer']);
  assert.deepEqual(saved.presets[0].defaults.tools, ['bash', 'read', 'write']);
  editor.select('worker', 1); editor.tagInput('delegates', 'missing'); editor.confirmTags('delegates'); editor.inherit('delegates');
  assert.deepEqual(json(editor.getSnapshot().effective.delegates), ['worker']);
  assert.equal(Object.keys(editor.getSnapshot().tagInputs).length, 0);
  editor.tagInput('delegates', 'pending'); editor.deleteRoute();
  assert.equal(Object.keys(editor.getSnapshot().tagInputs).length, 0);
  editor.tagInput('delegates', 'pending'); editor.discard(); assert.equal(editor.getSnapshot().dirty, false);
  editor.dispose();
});

test('role deletion rechecks confirmed and pending tags rather than accepting stale candidates', async () => {
  const target = scope({ bookJson: JSON.stringify(delegateBook()) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.tagInput('delegates', 'reviewer'); editor.confirmTags('delegates'); assert.equal(await editor.save(), true);
  editor.tagInput('delegates', 'worker'); editor.select('reviewer'); editor.deletePreset();
  assert.equal(editor.getSnapshot().rowStates.delegates.status, 'invalid');
  assert.equal(await editor.save(), false);
  editor.removeTag('delegates', 'reviewer');
  assert.equal(await editor.save(), false, 'removing a stale chip must preserve the pending role');
  editor.tagInput('delegates', 'reviewer'); assert.equal(editor.confirmTags('delegates'), false);
  assert.match(Object.values(editor.getSnapshot().fieldErrors).join(), /Unknown roles/);
  editor.tagInput('delegates', 'worker'); editor.confirmTags('delegates'); assert.equal(await editor.save(), true);
  editor.edit('delegates', 'missing'); assert.equal(await editor.save(), false);
  assert.deepEqual(json(editor.getSnapshot().effective.delegates), ['worker']);
  editor.undo('delegates'); editor.edit('delegates', 'worker worker'); assert.equal(await editor.save(), false);
  editor.undo('delegates'); editor.dispose();
});

test('saved, inherited and built-in rows have distinct states and only changed rows offer batch save', () => {
  const editor = client.createEditor(scope({ bookJson: JSON.stringify(book) }), modelScope(), promptScope());
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'saved');
  assert.equal(editor.getSnapshot().rowStates.tools.canSave, false);
  assert.equal(editor.getSnapshot().rowStates.tools.canUndo, false);
  assert.equal(editor.getSnapshot().rowStates.agentOptions.status, 'default');
  editor.select('worker', 0);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'inherited');
  editor.select('worker', 1);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'saved');
  assert.equal(editor.getSnapshot().rowStates.maxNestedDepth.status, 'saved');
  editor.edit('tools', 'write');
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'changed');
  assert.equal(editor.getSnapshot().rowStates.tools.canSave, true);
  assert.equal(editor.getSnapshot().rowStates.maxNestedDepth.canSave, false);
  assert.equal(editor.getSnapshot().rowStates.maxNestedDepth.canUndo, false);
  editor.dispose();
});

test('returning to stored values clears ghost drafts and releases the old revision fence', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.undo('tools'); assert.equal(editor.getSnapshot().dirty, false);
  editor.select('worker', 0); editor.undo('tools');
  assert.equal(editor.getSnapshot().dirty, false);
  assert.ok(!Object.hasOwn(editor.getSnapshot().route, 'overrides'));
  editor.tagInput('tools', 'write'); editor.tagInput('tools', '');
  assert.equal(editor.getSnapshot().dirty, false);
  editor.edit('tools', 'bash'); editor.undo('tools');
  assert.equal(editor.getSnapshot().dirty, false);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'inherited');
  const external = structuredClone(book); external.presets[0].defaults.tools = ['read'];
  target.replace({ bookJson: JSON.stringify(external) });
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['read']);
  editor.select('worker', -1); editor.edit('tools', 'write'); editor.edit('tools', 'read');
  assert.equal(editor.getSnapshot().dirty, false); assert.equal(await editor.save(), false);
  assert.equal(target.calls.length, 0);
  editor.edit('tools', 'bash'); assert.equal(await editor.save(), true);
  assert.equal(target.calls[0].expected, 2); editor.dispose();
});

test('pending and invalid input gate batch save while schema errors and failures never appear saved', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.tagInput('tools', 'write');
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'pending');
  assert.equal(editor.getSnapshot().canSave, false);
  editor.tagInput('tools', 'nope'); editor.confirmTags('tools');
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'invalid');
  assert.equal(editor.getSnapshot().rowStates.tools.canUndo, true);
  editor.undo('tools'); assert.equal(editor.getSnapshot().rowStates.tools.status, 'saved');
  editor.edit('persona', JSON.stringify({ key: '' }));
  assert.equal(editor.getSnapshot().rowStates.persona.status, 'invalid');
  assert.ok(editor.getSnapshot().schemaError); assert.equal(editor.getSnapshot().canSave, false);
  assert.equal(await editor.save(), false); assert.equal(target.calls.length, 0);
  editor.undo('persona'); assert.equal(editor.getSnapshot().dirty, false);
  editor.dispose();
});

test('unsaved common values are not presented as saved inheritance and row undo cannot erase other fields', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.edit('tools', 'write'); editor.select('worker', 0);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'changed');
  assert.equal(editor.getSnapshot().rowStates.tools.canUndo, false);
  editor.edit('tools', 'bash'); editor.edit('maxNestedDepth', '1'); editor.undo('tools');
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['write']);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'changed');
  assert.equal(editor.getSnapshot().rowStates.tools.canUndo, false);
  assert.equal(editor.getSnapshot().rowStates.maxNestedDepth.canSave, true);
  assert.equal(await editor.save(), true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.tools, ['write']);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'inherited');
  assert.equal(editor.getSnapshot().rowStates.maxNestedDepth.status, 'saved');
  editor.dispose();
});

test('pending persistence reports saving, rejected persistence retains failed rows and retry resets controls', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const mutate = target.mutate.bind(target);
  let release;
  target.mutate = async (...args) => { target.calls.push({ args }); return new Promise(resolve => { release = resolve; }); };
  const editor = client.createEditor(target, modelScope(), promptScope());
  editor.edit('tools', 'write');
  const saving = editor.save();
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'saving');
  assert.equal(editor.getSnapshot().canSave, false);
  assert.equal(await editor.save(), false); assert.equal(target.calls.length, 1);
  release(false); assert.equal(await saving, false);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'failed');
  assert.equal(editor.getSnapshot().rowStates.tools.canSave, true);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.tools, ['bash', 'read']);
  target.mutate = mutate; assert.equal(await editor.save(), true);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'saved');
  assert.equal(editor.getSnapshot().rowStates.tools.canSave, false);
  assert.equal(editor.getSnapshot().rowStates.tools.canUndo, false);
  assert.equal(editor.getSnapshot().dirty, false);
  assert.equal(editor.getSnapshot().error, ''); editor.dispose();
});

test('Promptbook pending package deletion is reflected in the preview without deleting a GUI override', () => {
  const docs = { registryJson: JSON.stringify({ role: { fallback: 'fallback' } }), layersJson: JSON.stringify({ pro: { role: 'package' } }), packOpsJson: JSON.stringify({ deletions: [{ key: 'role', candidate: 'pro' }] }) };
  assert.equal(client.resolvePrompt('role', 'pro', 'fixture', docs), 'fallback');
  docs.entriesJson = JSON.stringify({ role: { pro: 'GUI text' } });
  assert.equal(client.resolvePrompt('role', 'pro', 'fixture', docs), 'GUI text');
});

test('automatic tool teaching preview matches host localized resolution and updates with tools/model', () => {
  const entries = { 'tool.bash': { default: 'common Bash' }, 'tool.bash.only': { pro: 'solo Pro' }, 'tool.read': { fixture: 'provider Read' } };
  const docs = { ...promptScope().getSnapshot().value, registryJson: JSON.stringify({ 'persona.worker': { fallback: 'Persona' }, ...Object.fromEntries(Object.keys(entries).map(key => [key, { fallback: 'display fallback' }])) }), entriesJson: JSON.stringify({ 'persona.worker': { default: 'Persona' }, ...entries }) };
  const target = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(target, modelScope(), scope(docs));
  assert.deepEqual(json(editor.getSnapshot().preview.teaching), { bash: 'common Bash', read: 'provider Read' });
  editor.edit('tools', 'bash');
  const actual = json(editor.getSnapshot().preview);
  const expected = compilePreset(parseBook(editor.getSnapshot().book), 'worker', 'fixture', 'pro', {
    models: json(client.hostedModels(modelScope().getSnapshot())),
    resolveText: (key, model, provider) => client.resolvePrompt(key, model, provider, docs),
    resolveToolText: (key, model, provider) => client.resolveToolPrompt(key, model, provider, docs),
  });
  assert.deepEqual(actual.teaching, { bash: 'solo Pro' }); assert.deepEqual(actual.sources, expected.sources);
  assert.equal(client.resolveToolPrompt('tool.read', 'pro', 'other', docs), undefined);
  entries['tool.bash.only'].pro = ''; docs.entriesJson = JSON.stringify(entries);
  assert.equal(client.resolveToolPrompt('tool.bash.only', 'pro', 'fixture', docs), '');
  editor.dispose();
});

test('file scope uses the common draft, save and model inheritance controls', async () => {
  const settings = scope({ bookJson: JSON.stringify(book) });
  const editor = client.createEditor(settings, scope({ modelsJson: JSON.stringify([{id:'pro'}, {id:'flash'}]), customProviders: {}, provider: 'fixture' }), scope({}));
  editor.select('worker'); editor.edit('actionScope', 'read-only');
  assert.equal(editor.getSnapshot().effective.actionScope, 'read-only');
  assert.equal(editor.getSnapshot().rowStates.actionScope.status, 'changed');
  editor.edit('actionScope', 'danger-full-access');
  assert.equal(editor.getSnapshot().canSave, false);
  editor.edit('actionScope', 'read-only'); await editor.save();
  assert.equal(editor.getSnapshot().rowStates.actionScope.status, 'saved');
  editor.select('worker', 1); editor.edit('actionScope', 'inherit');
  assert.equal(editor.getSnapshot().effective.actionScope, 'inherit');
  editor.inherit('actionScope');
  assert.equal(editor.getSnapshot().effective.actionScope, 'read-only');
});

test('server refusal keeps its reason, draft and revision fence; conflict recovery is not an overwrite', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  let response = { ok: false, error: { code: 'settings/rejected', message: 'Provider subagentbook:worker is already registered' } };
  const calls = [];
  const ctx = { configForms: { describe: () => ({ acceptView(view) { target.replace(view.value); } }) }, remote: { settings: {
    async mutate(ns, ops, revision) { calls.push({ ns, ops, revision }); return response; },
    async describe() { return { ok: true, value: { namespaces: [{ ns: 'subagentbook', value: target.getSnapshot().value }] } }; },
  } } };
  const editor = client.createEditor(client.settingsWriter(ctx, target), modelScope(), promptScope());
  editor.edit('tools', 'bash');
  assert.equal(await editor.save(), false);
  assert.equal(editor.getSnapshot().errorCode, 'settings/rejected');
  assert.match(editor.getSnapshot().error, /already registered/);
  assert.equal(editor.getSnapshot().rowStates.tools.status, 'failed');
  assert.deepEqual(json(editor.getSnapshot().effective.tools), ['bash']);
  assert.deepEqual(parseBook(target.getSnapshot().value.bookJson).presets[0].defaults.tools, ['bash', 'read']);
  response = { ok: false, error: { code: 'settings/conflict', message: 'Expected revision 1; actual revision 2' } };
  assert.equal(await editor.save(), false);
  assert.equal(editor.getSnapshot().errorCode, 'settings/conflict');
  assert.equal(calls[0].revision, calls[1].revision, 'recovery does not silently rebase an old draft');
  response = { ok: true, value: { value: { bookJson: calls[0].ops[0].value } } };
  assert.equal(await editor.save(), true);
  assert.equal(editor.getSnapshot().dirty, false);
  assert.equal(editor.getSnapshot().error, '');
  assert.equal(editor.getSnapshot().errorCode, '');
  editor.dispose();
});

test('failed recovery read cannot replace the original settings refusal', async () => {
  const target = scope({ bookJson: JSON.stringify(book) });
  const writer = client.settingsWriter({ remote: { settings: {
    async mutate() { return { ok: false, error: { code: 'settings/rejected', message: 'Native schema refused actionScope' } }; },
    async describe() { throw new Error('disconnected during recovery'); },
  } } }, target);
  await assert.rejects(writer.mutate([], 1), { code: 'settings/rejected', message: 'Native schema refused actionScope' });
});

test('one-shot presentation corrects only authenticated modes without mutating native catalog state', () => {
  const state = { projectionsBySession: { root: { values: { subagentCatalog: [
    { id: 'book', mode: 'continuable' }, { id: 'native', mode: 'continuable' },
    { id: 'continued', mode: 'continuable' },
  ] } } } };
  const result = client.presentBookCatalogs(state, { book: 'one-shot', continued: 'continuable' });
  assert.equal(result.projectionsBySession.root.values.subagentCatalog[0].mode, 'one-shot');
  assert.equal(state.projectionsBySession.root.values.subagentCatalog[0].mode, 'continuable');
  assert.equal(result.projectionsBySession.root.values.subagentCatalog[1], state.projectionsBySession.root.values.subagentCatalog[1]);
  assert.equal(client.presentBookCatalogs(state, {}), state);
});

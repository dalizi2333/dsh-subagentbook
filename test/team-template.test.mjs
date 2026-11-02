import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addExpertTeam } from '../lib/team-template.js';
import { EMPTY_BOOK, resolvePreset } from '../lib/definition.js';

test('team is a complete isolated graph with exact routes, narrow review permissions and one entry', () => {
  const { book, entryId } = addExpertTeam(EMPTY_BOOK, 'local', 'pro');
  assert.equal(book.presets.length, 10);
  assert.deepEqual(book.entryPresets, [entryId]);
  assert.equal(entryId, 'ur.developer');
  for (const preset of book.presets) {
    assert.deepEqual(preset.models, [{ provider: 'local', model: 'pro' }]);
    assert.ok(preset.defaults.delegates.every(id => book.presets.some(p => p.id === id)));
    const compiled = resolvePreset(book, preset.id, 'local', 'pro', { models: [{ provider: 'local', id: 'pro' }] });
    assert.equal(compiled.agentOptions.reasoningEffort, undefined);
    assert.equal(compiled.agentOptions.maxTokens, undefined);
  }
  const role = id => book.presets.find(p => p.id === `ur.${id}`).defaults;
  assert.equal(role('verifier').actionScope, 'verification-copy');
  for (const id of ['chief', 'completeness', 'correctness', 'impact', 'expert', 'docs', 'review-relay']) assert.equal(role(id).actionScope, 'read-only');
  assert.deepEqual(role('developer').delegates, ['ur.runner', 'ur.review-relay']);
  assert.deepEqual(role('chief').delegates, ['ur.completeness', 'ur.correctness', 'ur.impact']);
});

test('repeated additions preserve authored roles and use separate internal delegation graphs', () => {
  const first = addExpertTeam(EMPTY_BOOK, 'a', 'pro').book;
  first.presets[0].defaults.persona = { text: 'User edited' };
  const before = structuredClone(first);
  const second = addExpertTeam(first, 'b', 'flash');
  assert.deepEqual(first, before, 'pure construction must not mutate its input');
  assert.equal(second.entryId, 'ur-2.developer');
  assert.deepEqual(second.book.presets.slice(0, 10), before.presets);
  assert.ok(second.book.presets.slice(10).every(p => p.defaults.delegates.every(id => id.startsWith('ur-2.'))));
  assert.throws(() => addExpertTeam(first, '', 'pro'), /model/);
  assert.deepEqual(first, before);
});

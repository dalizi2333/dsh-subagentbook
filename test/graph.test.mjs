import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = { structuredClone };
vm.runInNewContext(['logic', 'graph'].map(part => readFileSync(new URL(`../src/client/${part}.js`, import.meta.url), 'utf8')).join('\n') + '\nglobalThis.makeGraph = roleGraph;', context);
const graph = (book, route) => JSON.parse(JSON.stringify(context.makeGraph(book, route)));
const role = (id, delegates = [], models = [{ provider: 'fixture', model: 'pro' }]) => ({ id, name: id, defaults: { tools: ['bash'], delegates }, models });

test('role map separates common edges and exact model replacements without inventing routes', () => {
  const book = { entryPresets: ['a'], presets: [role('a', ['b'], [{ provider: 'fixture', model: 'pro', overrides: { delegates: [] } }, { provider: 'other', model: 'pro' }]), role('b', ['a'], [{ provider: 'other', model: 'pro' }])] };
  const before = JSON.stringify(book);
  const common = graph(book);
  assert.deepEqual(common.edges.map(edge => [edge.from, edge.to]), [['a', 'b'], ['b', 'a']]);
  assert.deepEqual(graph(book, JSON.stringify(['fixture', 'pro'])).edges, [], 'an explicit empty override replaces common delegates');
  const exact = graph(book, JSON.stringify(['other', 'pro']));
  assert.deepEqual(exact.edges.map(edge => [edge.from, edge.to]), [['a', 'b'], ['b', 'a']]);
  book.presets[0].models[0].overrides.delegates.push('b');
  const missing = graph(book, JSON.stringify(['fixture', 'pro']));
  assert.deepEqual(missing.edges, [{ from: 'a', to: 'b', unavailable: true }]);
  assert.equal(missing.nodes[1].routeIndex, -1);
  assert.equal(missing.nodes[1].available, false);
  book.presets[0].models[0].overrides.delegates.pop();
  assert.equal(JSON.stringify(book), before, 'viewing the map never mutates the book');
});

test('cycles, self delegation, shared children, deleted draft references and islands retain distinct finite nodes', () => {
  const book = { entryPresets: ['a', 'island'], presets: [role('a', ['a', 'b', 'c', 'deleted']), role('b', ['a', 'c']), role('c'), role('island')] };
  const view = graph(book);
  assert.equal(view.nodes.length, 4); assert.equal(view.edges.length, 5);
  const positions = new Set();
  for (const node of view.nodes) {
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    assert.ok(node.x > 68 && node.x + 68 < view.width);
    assert.ok(node.y >= 21 && node.y + 21 < view.height);
    positions.add(`${node.x}/${node.y}`);
  }
  assert.equal(positions.size, 4);
  assert.deepEqual(graph(book), view, 'selection and re-render do not randomize positions');
  assert.deepEqual(view.cycles, [['a', 'b']]);
  assert.deepEqual(view.edges.filter(edge => edge.cycle).map(edge => [edge.from, edge.to]), [['a', 'a'], ['a', 'b'], ['b', 'a']]);
  assert.equal(view.nodes.find(node => node.id === 'c').cycle, undefined, 'outgoing edges from a cycle are not themselves cyclic');
  assert.deepEqual(graph({ entryPresets: [], presets: [] }), { nodes: [], edges: [], cycles: [], width: 500, height: 180 });
});

test('ordinary shared children are acyclic and self-delegation is diagnosed independently', () => {
  const book = { entryPresets: ['a'], presets: [role('a', ['b', 'c']), role('b', ['d']), role('c', ['d']), role('d')] };
  assert.deepEqual(graph(book).cycles, []);
  book.presets[3].defaults.delegates = ['d'];
  const view = graph(book);
  assert.deepEqual(view.cycles, [['d']]);
  assert.deepEqual(view.edges.filter(edge => edge.cycle).map(edge => [edge.from, edge.to]), [['d', 'd']]);
});

test('the explicitly possible union detects mixed-model cycles without changing exact views or losing route provenance', () => {
  const pro = { provider: 'fixture', model: 'pro' }, flash = { provider: 'fixture', model: 'flash' };
  const book = { entryPresets: ['a'], presets: [role('a', [], [{ ...pro, overrides: { delegates: ['b'] } }, flash]), role('b', [], [pro, { ...flash, overrides: { delegates: ['a'] } }])] };
  assert.deepEqual(graph(book).cycles, []);
  assert.deepEqual(graph(book, JSON.stringify(['fixture', 'pro'])).cycles, []);
  assert.deepEqual(graph(book, JSON.stringify(['fixture', 'flash'])).cycles, []);
  const all = graph(book, '*');
  assert.deepEqual(all.cycles, [['a', 'b']]);
  assert.deepEqual(all.edges.map(edge => edge.scopes), [[JSON.stringify(['fixture', 'pro'])], [JSON.stringify(['fixture', 'flash'])]]);
  assert.ok(all.nodes.every(node => node.routeIndex === -1 && node.available));
  assert.deepEqual(all.nodes.map(node => node.cycleRouteIndex), [0, 1], 'warning navigation selects a model variant that contributes a cyclic outgoing edge');
});

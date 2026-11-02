import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { artifactRevision } from '../lib/artifacts.js';
import { compilePreset, parseBook } from '../lib/book.js';
import { assertFixedComposition } from '../lib/composition.js';

const compiled = () => compilePreset(parseBook({ version: 1, entryPresets: ['leaf'], presets: [{ id: 'leaf', name: 'Leaf', defaults: { persona: { text: 'Fixture' }, tools: ['read'] }, models: [{ provider: 'fixture', model: 'pro' }] }] }), 'leaf', 'fixture', 'pro', { models: [{ provider: 'fixture', id: 'pro' }] });

test('persisted components cannot replace fixed providers or introduce unsupported tools', () => {
  const original = compiled(); assertFixedComposition(original);
  for (const change of [value => value.plugins.push({ name: 'arbitrary-plugin' }), value => value.plugins[0].config = { arbitrary: true }, value => value.tools.push('custom')]) {
    const value = structuredClone(original); change(value);
    assert.throws(() => assertFixedComposition(value), { code: 'INVALID_INSTANCE' });
  }
});

test('code fingerprint follows actual fixed provider files, not just its declared package name', async () => {
  const home = mkdtempSync(join(tmpdir(), 'book-artifacts-'));
  const require = createRequire(import.meta.url);
  try {
    const makePackage = (folder, name) => {
      const dir = join(home, folder); mkdirSync(dir);
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module' }));
      writeFileSync(join(dir, 'index.js'), 'export const marker = 1;\n'); return dir;
    };
    const provider = makePackage('fs', '@deepseek-ai/dsh-tool-fs');
    const runtime = makePackage('runtime', '@deepseek-ai/dsh');
    const host = { servicePlugins: [],
      resolvePlugin: async name => name === '@deepseek-ai/dsh-tool-fs' ? pathToFileURL(join(provider, 'index.js')).href : name === '@deepseek-ai/dsh/package.json' ? pathToFileURL(join(runtime, 'package.json')).href : name.startsWith('file:') ? name : pathToFileURL(require.resolve(name)).href,
    };
    const original = await artifactRevision(compiled(), host);
    writeFileSync(join(provider, 'index.js'), 'export const marker = 2;\n');
    assert.notEqual(await artifactRevision(compiled(), host), original);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('instance diagnostics reflect the frozen record and exclude transport/plugin configuration', async () => {
  const { instanceView } = await import('../lib/diagnostics-contract.js');
  const record = { instanceId: 'child', parentId: 'parent', mode: 'continuable', depth: 2, ceiling: 3,
    compiled: { ...compiled(), presetId: 'leaf', actionScope: 'read-only', agentOptions: { maxTokens: 3000 },
      transport: { apiKey: 'must-not-leak' }, plugins: [{ name: 'private-path' }] },
    inheritedPolicy: { sandboxMode: 'workspace-write', workspaceRoot: '/fixture', approvalPolicy: 'never', secret: 'must-not-leak' },
    agentOptions: { maxTokens: 4096, reasoningEffort: 'saved-effort' }, apiKey: 'must-not-leak' };
  const view = instanceView(record);
  assert.equal(view.permission.mode, 'read-only');
  assert.equal(view.permission.workspaceRoot, '/fixture');
  assert.equal(view.maxTokens, 4096);
  assert.equal(view.reasoningEffort, 'saved-effort');
  assert.equal(view.role, 'leaf');
  assert.equal(view.ceiling, 3);
  assert.ok(!JSON.stringify(view).includes('must-not-leak'));
  assert.ok(!JSON.stringify(view).includes('private-path'));
  assert.equal(instanceView(undefined), null);
});

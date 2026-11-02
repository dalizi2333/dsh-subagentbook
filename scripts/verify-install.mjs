import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function verifyInstall(packageRoot = root) {
  const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.name, '@mimo-codex/dsh-subagentbook');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.main, pkg.exports['.']);
  for (const entry of Object.values(pkg.exports)) {
    assert.equal(typeof entry, 'string', 'Extend the gate before adding conditional exports.');
    assert.ok(entry.startsWith('./') && !entry.includes('..'), `Unsafe export: ${entry}`);
    assert.ok(existsSync(resolve(packageRoot, entry)), `Missing exported file: ${entry}`);
  }
  for (const entry of pkg.files) {
    assert.ok(existsSync(resolve(packageRoot, entry)), `Missing declared files entry: ${entry}`);
  }

  const { default: yaml } = await import('js-yaml');
  const patch = yaml.load(readFileSync(resolve(packageRoot, pkg.dsh.bundle.patch), 'utf8'));
  assert.deepEqual(patch, [{ insert: [{ id: 'subagentbook', name: pkg.name }] }]);

  const plugin = await import(pathToFileURL(resolve(packageRoot, pkg.exports['.'])).href);
  let client;
  vm.runInNewContext(readFileSync(resolve(packageRoot, pkg.exports['./client']), 'utf8'), { window: { __ModuleLoader__: { load: definition => { client = definition; } } }, structuredClone });
  assert.equal(client.id, pkg.name);
  const exports = client.factory(() => ({}));
  assert.equal(typeof exports.apply, 'function');
  assert.equal(typeof exports.resolvePreset, 'function');
  assert.deepEqual(Array.from(exports.inject), ['slots', 'locale', 'configForms', 'remote', 'remote.settings']);
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.equal(plugin.name, 'subagentbook');
  assert.equal(typeof plugin.apply, 'function');
  const { Context } = await import('@deepseek-ai/cordis');
  const ctx = new Context();
  let activated = false;
  try {
    for (const service of ['loader', 'agents', 'tools', 'systemPrompt', 'subagents']) ctx.provide(service, service === 'tools' ? { register() {} } : {});
    await ctx.plugin(plugin);
    await ctx.plugin({
      name: 'subagentbook-install-consumer',
      inject: ['subagentbook'],
      apply(consumer) {
        assert.equal(consumer.subagentbook.status, 'ready');
        assert.deepEqual(consumer.subagentbook.listPresets(), []);
        activated = true;
      },
    });
    assert.ok(activated, 'The real Cordis consumer did not receive the service.');
  } finally {
    await ctx.fiber.dispose();
  }
  console.log(`  PASS manifest, activation patch and Cordis loading: ${packageRoot}`);
  return pkg;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyInstall();
}

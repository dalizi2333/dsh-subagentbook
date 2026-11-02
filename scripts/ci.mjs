import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { root, verifyInstall } from './verify-install.mjs';

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const supportedRuntimes = pkg.peerDependencies['@deepseek-ai/dsh'].split('||').map(value => value.trim());
let testedRuntime;
const dsh = process.env.DSH_RUNTIME_BIN ?? 'dsh';
let home;
let phase = 'baseline';
const checked = [];

function run(command, args, options = {}) {
  const env = { ...process.env, ...options.env };
  if (command === 'npm') {
    // New npm versions export a global-only allow-scripts option from npm run.
    // Project installs reject that inherited flag; --ignore-scripts stays explicit.
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
    }
  }
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
    env,
  });
  if (result.error || result.status !== 0) {
    if (home) {
      writeFileSync(join(home, `${phase}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
    }
    console.error(result.stdout ?? '', result.stderr ?? '');
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error?.message ?? `exit ${result.status}`}`);
  }
  return result.stdout;
}

function collectRows(value, rows = []) {
  if (!value || typeof value !== 'object') return rows;
  if (!Array.isArray(value) && value.id === 'subagentbook') rows.push(value);
  for (const item of Object.values(value)) collectRows(item, rows);
  return rows;
}

async function verifyProfile(profile, source, packed) {
  const env = { ...process.env, DSH_HOME: home };
  phase = `${profile}-create`;
  run(dsh, [profile, '--from-default-profile', 'headless', '--dump-config'], { env });
  phase = `${profile}-install`;
  run(dsh, ['plugin', '--profile', profile, 'add', source], { env });
  phase = `${profile}-compose`;
  const config = run(dsh, ['--profile', profile, '--dump-config'], { env });
  const { default: yaml } = await import('js-yaml');
  // DSH dumps !!js scalars. Preserve their text for inspection; never evaluate it.
  const schema = yaml.JSON_SCHEMA.extend([
    new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: value => ({ __jsExpr: value }) }),
  ]);
  const rows = collectRows(yaml.load(config, { schema }));
  assert.equal(rows.length, 1, 'The composed profile must have one Subagentbook row.');
  assert.equal(rows[0].name, pkg.name);
  assert.notEqual(rows[0].disabled, true);

  const profileRoot = join(home, 'profiles', profile);
  const profilePkg = JSON.parse(readFileSync(join(profileRoot, 'package.json'), 'utf8'));
  assert.ok(profilePkg.dsh.profile.bundles.includes(pkg.name), 'Bundle was not selected.');
  assert.ok(profilePkg.dependencies[pkg.name], 'Profile has no plugin dependency.');
  const installedRoot = realpathSync(join(profileRoot, 'node_modules', pkg.name));
  if (packed) assert.notEqual(installedRoot, realpathSync(root), 'Tarball installed as the checkout.');
  else assert.equal(installedRoot, realpathSync(root), 'Local directory did not resolve to the checkout.');
  const installedPkg = await verifyInstall(installedRoot);
  assert.equal(installedPkg.version, pkg.version);
  checked.push({ profile, source: packed ? 'npm-tarball' : 'local-checkout', version: installedPkg.version });
  console.log(`  PASS official installation and selected activation layer: ${profile}`);
}

try {
  const version = run(dsh, ['--version'], { timeout: 30_000 }).trim();
  assert.ok(supportedRuntimes.includes(version), `Select a supported runtime with DSH_RUNTIME_BIN; got ${version}.`);
  testedRuntime = version;
  console.log(`DSH validation runtime: ${version}`);
  home = mkdtempSync(join(tmpdir(), 'dsh-subagentbook-ci-'));
  console.log(`Temporary DSH_HOME: ${home}`);

  phase = 'dependencies';
  run('npm', ['ci', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund']);
  phase = 'module';
  console.log(run('node', ['scripts/build-client.mjs', '--check']));
  await verifyInstall();

  phase = 'unit';
  console.log(run('npm', ['test']));
  phase = 'host';
  console.log(run('node', ['scripts/host-test.mjs']));
  phase = 'roots';
  console.log(run('node', ['scripts/root-test.mjs']));
  phase = 'verification';
  console.log(run('node', ['scripts/verification-test.mjs']));
  phase = 'continuation';
  console.log(run('node', ['scripts/continuation-test.mjs']));
  phase = 'settings';
  console.log(run('node', ['scripts/settings-test.mjs']));

  phase = 'gui';
  console.log(run('npm', ['run', 'test:gui'], { timeout: 360_000 }));

  phase = 'pack';
  const [artifact] = JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', home]));
  const paths = new Set(artifact.files.map(file => file.path));
  for (const path of ['package.json', 'LICENSE', 'README.md', 'AGENTS.md', 'lib/index.js', 'cordis.patch.yml', 'examples/role-candidates-v1.json', 'examples/role-candidates-v1.authorship.json', 'docs/role-candidates.md']) {
    assert.ok(paths.has(path), `Missing packed file: ${path}`);
  }
  for (const path of paths) {
    assert.ok(!/^(node_modules|log|scripts|\.git(?:hub)?)\//.test(path), `Unexpected packed development file: ${path}`);
    assert.ok(!/(?:^|\/)\.env(?:\.|$)/.test(path), `Unexpected packed environment file: ${path}`);
  }
  console.log(`  PASS npm artifact: ${artifact.filename} (${artifact.files.length} files)`);
  await verifyProfile('checkout', root, false);
  await verifyProfile('packed', `file:${resolve(home, artifact.filename)}`, true);

  console.log(`PASS installability: ${JSON.stringify({ runtime: testedRuntime, checked, modelRequests: 0 })}`);
  rmSync(home, { recursive: true, force: true });
} catch (error) {
  if (home) {
    writeFileSync(join(home, 'diagnostics.json'), JSON.stringify({ phase, runtime: testedRuntime, supportedRuntimes, checked, error: error.message }, null, 2));
    console.error(`Diagnostics retained: ${home}`);
  }
  console.error(`FAIL (${phase}): ${error.message}`);
  process.exitCode = 1;
}

// Isolated real DSH web host for deterministic browser tests. No paid services.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { runtimeRequire } from './runtime-path.mjs';
runtimeRequire();
const root = resolve(import.meta.dirname, '..');
const run = resolve(process.argv[2]);
mkdirSync(run, { recursive: true });
const home = join(run, 'dsh-home'), workspace = join(run, 'workspace');
mkdirSync(workspace, { recursive: true });
const env = { ...process.env, DSH_HOME: home };
for (const key of Object.keys(env)) if (['display', 'wayland_display', 'npm_config_allow_scripts'].includes(key.toLowerCase())) delete env[key];
const dsh = process.env.DSH_RUNTIME_BIN ?? 'dsh';
function cmd(args) {
  const result = spawnSync(dsh, args, { env, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}
if (!process.argv.includes('--resume')) {
writeFileSync(join(workspace, 'value.mjs'), 'export const value = 2;\n');
writeFileSync(join(workspace, 'test.mjs'), "import {value} from './value.mjs'; if(value !== 3) throw Error('wrong value'); console.log('TEST_PASS');\n");
writeFileSync(join(workspace, '.gitignore'), 'build/\n.gradle/\n');
for (const args of [['init', '-q'], ['add', '.'], ['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'base']]) {
  const result = spawnSync('git', ['-C', workspace, ...args], { env: { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('GUI Git fixture failed: ' + result.stderr);
}
writeFileSync(join(workspace, 'value.mjs'), 'export const value = 3;\n');
cmd(['gui-ci', '--from-default-profile', 'web', '--dump-config']);
cmd(['plugin', '--profile', 'gui-ci', 'add', root]);
writeFileSync(join(home, 'profiles/gui-ci/cordis.patch.yml'), yaml.dump([
  { id: 'session-title-llm', disabled: true }, { id: 'subagent', config: { maxDepth: 3 } },
  { id: 'agent-default-model', config: { provider: 'fixture', model: 'pro' } },
  { insert: [
    { id: 'llm-mimo', name: pathToFileURL(join(root, 'scripts/gui-model-fixture.mjs')).href },
    { id: 'promptbook', name: pathToFileURL(join(root, 'scripts/gui-prompt-fixture.mjs')).href },
  ] },
]));
}
let output = '';
const child = spawn(dsh, ['--profile', 'gui-ci', '--host', '127.0.0.1', '--port', '0', '--no-open'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
const log = chunk => {
  output += String(chunk);
  writeFileSync(join(run, 'server.log'), output.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'));
  const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/);
  if (match) writeFileSync(join(run, 'ready.json'), JSON.stringify({ url: match[0], workspace }));
};
child.stdout.on('data', log); child.stderr.on('data', log);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child.kill(signal); });
child.on('exit', code => { if (!stopping) process.exitCode = code || 1; });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });

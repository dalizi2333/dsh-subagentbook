// Explicit, paid local acceptance. Never run by CI.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { runtimeRequire } from './runtime-path.mjs';

const argv = process.argv.slice(2);
const continuation = argv.includes('--continuation');
if (continuation) argv.splice(argv.indexOf('--continuation'), 1);
if (argv.length !== 2 || argv[0] !== '--provider-snapshot') throw new Error('Usage: npm run preview -- --provider-snapshot <private-provider.json>');
const snapshot = JSON.parse(readFileSync(resolve(argv[1]), 'utf8'));
if (!snapshot.id || !snapshot.config?.baseURL || !snapshot.key) throw new Error('Snapshot must contain id, config.baseURL, and key');
runtimeRequire(); // Reject a different baseline before creating anything.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = join(root, continuation ? 'log/subagentbook-01/local-artifacts' : 'log/subagentbook-00/local-artifacts', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(run, { recursive: true, mode: 0o700 });
const task = mkdtempSync(join(tmpdir(), 'subagentbook-task-'));
symlinkSync(task, join(run, 'workspace'), 'dir');
writeFileSync(join(task, 'sample.txt'), 'nonce=book-7c39a\nnumbers=19,23\n');
const home = join(run, 'dsh-home');
const dsh = process.env.DSH_RUNTIME_BIN ?? 'dsh';
const env = { ...process.env, DSH_HOME: home };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
function command(args) {
  const result = spawnSync(dsh, args, { env, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw new Error(`DSH setup failed: ${result.stderr}`);
}
command(['preview', '--from-default-profile', 'web', '--dump-config']);
for (const directory of [root, join(root, '../dsh-llm-mimo'), join(root, '../dsh-promptbook')]) command(['plugin', '--profile', 'preview', 'add', directory]);
const provider = snapshot.id;
const ref = 'SUBAGENTBOOK_ACCEPTANCE_KEY';
const models = ['mimo-v2.6-flash', 'mimo-v2.6-pro'].map(id => ({ id, name: id, contextWindow: 1048576, maxTokens: 131072, inputModalities: ['text'] }));
const presets = [['inspector', 'mimo-v2.6-pro', 'read', 'INSPECTOR'], ['executor', 'mimo-v2.6-flash', 'bash', 'EXECUTOR']].map(([id, model, tool, marker]) => ({
  id, name: marker, description: `Independently inspect a small local fixture (${tool}).`,
  defaults: { persona: { key: `acceptance.${id}` }, tools: [tool], delegates: [], maxNestedDepth: 0, agentOptions: { maxTokens: 8192 },
  },
  models: [{ provider, model }],
}));
const entries = Object.fromEntries(presets.map(p => [p.defaults.persona.key, { default: `You are ${p.name}. Complete only the delegated tiny local verification task. Use the available tool to read the actual file, calculate carefully, and report the nonce and sum with marker ${p.name}. Keep the answer concise.` }]));
const patches = [
  { id: 'agent-default-model', config: { provider, model: 'mimo-v2.6-flash' } },
  { id: 'subagent', config: { maxDepth: 3 } }, { id: 'session-title-llm', disabled: true },
  { id: 'session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
  { id: 'llm-mimo', config: { baseURL: snapshot.config.baseURL, apiFormat: 'chat', apiKeyEnv: ref, modelsJson: JSON.stringify(models), customProviders: { [provider]: { displayName: 'Subagentbook acceptance', baseURL: snapshot.config.baseURL, apiFormat: 'chat', apiKeyEnv: ref, modelsJson: JSON.stringify(models) } }, maxTokens: 8192 } },
  { id: 'promptbook', config: { autoInject: false, entriesJson: JSON.stringify(entries), registryJson: JSON.stringify(Object.fromEntries(presets.map(p => [p.defaults.persona.key, { label: p.name, fallback: p.name }])))} },
  { id: 'subagentbook', config: { bookJson: JSON.stringify({ version: 1, entryPresets: presets.map(p => p.id), presets }) } },
  { insert: [{ id: 'book-acceptance', name: pathToFileURL(join(root, continuation ? 'scripts/preview-continuation-driver.mjs' : 'scripts/preview-driver.mjs')).href, config: { workspace: task, provider, report: join(run, 'report.json') } }] },
];
writeFileSync(join(home, 'profiles/preview/cordis.patch.yml'), yaml.dump(patches));
console.log(`Isolated acceptance artifacts: ${run}`);
console.log(`Workspace: ${task}. Ctrl+C stops the preview; artifacts are retained.`);
let child;
let stopping = false;
const stop = () => { stopping = true; child?.kill('SIGINT'); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
const launch = () => {
  child = spawn(dsh, ['--profile', 'preview', '--host', '127.0.0.1', '--port', '0', '--no-open'], { env: { ...env, [ref]: snapshot.key }, stdio: 'inherit' });
  return new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
};
const waitReport = async filename => {
  const deadline = Date.now() + 600000;
  while (!existsSync(filename)) {
    if (stopping) throw new Error('Acceptance cancelled');
    if (existsSync(filename + '.error')) throw new Error(readFileSync(filename + '.error', 'utf8'));
    if (child.exitCode !== null || child.signalCode || Date.now() > deadline) throw new Error('Acceptance did not finish before process exit or timeout');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return JSON.parse(readFileSync(filename, 'utf8'));
};
try {
  let exited = launch();
  if (continuation) {
    const first = await waitReport(join(run, 'report.json'));
    if (stopping) throw new Error('Acceptance cancelled');
    child.kill('SIGINT'); await exited;
    if (stopping) throw new Error('Acceptance cancelled');
    const driver = patches.at(-1).insert[0];
    driver.config.resumeParentId = first.parent;
    driver.config.childId = first.childId;
    driver.config.report = join(run, 'restart-report.json');
    writeFileSync(join(home, 'profiles/preview/cordis.patch.yml'), yaml.dump(patches));
    exited = launch();
    await waitReport(driver.config.report);
    console.log('PASS real continuable creation, follow-up and new-process restoration. Preview stays open.');
  }
  const outcome = await exited;
  process.exitCode = outcome.signal ? 130 : outcome.code ?? 1;
} catch (error) { const cancelled = stopping; stop(); if (!cancelled) console.error(error.message); process.exitCode = cancelled ? 130 : 1; }
finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }

// Isolated GUI preview. No credentials; model endpoints are deliberately offline.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { runtimeRequire } from './runtime-path.mjs';
runtimeRequire();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requestFields = process.argv.includes('--request-fields');
const modelOptions = requestFields || process.argv.includes('--model-options');
const plan = requestFields ? 'subagentbook-10' : modelOptions ? 'subagentbook-09' : process.argv.includes('--save-state') ? 'subagentbook-07' : process.argv.includes('--tool-tags') ? 'subagentbook-06' : process.argv.includes('--fixed-tools') ? 'subagentbook-05' : process.argv.includes('--tool-teaching') ? 'subagentbook-04' : 'subagentbook-02';
const run = join(root, `log/${plan}/local-artifacts`, new Date().toISOString().replace(/[:.]/g, '-'));
const home = join(run, 'dsh-home');
mkdirSync(run, { recursive: true });
const dsh = process.env.DSH_RUNTIME_BIN ?? 'dsh';
const env = { ...process.env, DSH_HOME: home };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'npm_config_allow_scripts') delete env[key];
function command(args) {
  const result = spawnSync(dsh, args, { env, encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) throw new Error(`Preview setup failed: ${result.stderr}`);
}
command(['preview', '--from-default-profile', 'web', '--dump-config']);
// Promptbook registration writes its installed registry. Keep previews private
// so neither registered defaults nor GUI edits write into the source package.
const promptSource = join(root, '../dsh-promptbook');
const promptCopy = join(run, 'promptbook');
mkdirSync(promptCopy);
const promptPackage = JSON.parse(readFileSync(join(promptSource, 'package.json'), 'utf8'));
for (const file of ['package.json', ...promptPackage.files]) cpSync(join(promptSource, file), join(promptCopy, file), { recursive: true });
symlinkSync(join(promptSource, 'node_modules'), join(promptCopy, 'node_modules'), 'dir');
for (const directory of [root, join(root, '../dsh-llm-mimo'), promptCopy]) command(['plugin', '--profile', 'preview', 'add', directory]);
const models = ['mimo-v2.6-flash', 'mimo-v2.6-pro'].map(id => ({ id, name: id, contextWindow: 1048576, maxTokens: 131072, inputModalities: ['text'] }));
if (modelOptions) {
  const { mimoReasoningPresets } = await import('../../dsh-llm-mimo/lib/model-controls.js');
  for (const model of models) model.reasoningControlsByFormat = mimoReasoningPresets(model.id);
}
const presets = ['inspector', 'executor'].map((id, index) => ({ id, name: index ? '执行者' : '检查者', description: index ? '根据明确计划实现功能' : '检查源码与计划',
  defaults: { persona: { key: `role.${id}` }, tools: modelOptions && !index ? ['bash', 'glob', 'read', 'grep', 'edit', 'write', 'web_search', 'web_fetch'] : [index ? 'bash' : 'read'], delegates: [], maxNestedDepth: 0 },
  models: [{ provider: 'mimo', model: index ? 'mimo-v2.6-flash' : 'mimo-v2.6-pro' }],
}));
writeFileSync(join(home, 'profiles/preview/cordis.patch.yml'), yaml.dump([
  { id: 'session-title-llm', disabled: true }, { id: 'subagent', config: { maxDepth: 3 } },
  { id: 'agent-default-model', config: { provider: 'mimo', model: 'mimo-v2.6-pro' } },
  { id: 'llm-mimo', config: { baseURL: 'http://127.0.0.1:1/v1', apiFormat: 'chat', apiKeyEnv: 'SUBAGENTBOOK_GUI_NO_KEY', modelsJson: JSON.stringify(models), customProviders: {} } },
  { id: 'promptbook', config: { autoInject: false,
    registryJson: JSON.stringify(Object.fromEntries(presets.map(p => [p.defaults.persona.key, { label: p.name, fallback: p.description }]))),
    entriesJson: JSON.stringify(Object.fromEntries(presets.map(p => [p.defaults.persona.key, { default: `You are the ${p.id}. Complete the assigned task using the available tools.` }]))),
  } },
  { id: 'subagentbook', config: { bookJson: JSON.stringify({ version: 1, entryPresets: presets.map(p => p.id), presets }) } },
]));
delete env.SUBAGENTBOOK_GUI_NO_KEY;
writeFileSync(join(root, `log/${plan}/local-env.md`), `# Local GUI preview\n\nArtifacts: ${run}\n\nDSH_HOME: ${home}\n\nProfile: preview\n\nPromptbook copy: ${promptCopy}\n\nSubagentbook/llm-mimo load the workspace sources; Promptbook is a private package copy. No API credentials or paid requests.\n`);
console.log(`GUI artifacts: ${run}`);
const child = spawn(dsh, ['--profile', 'preview', '--host', '127.0.0.1', '--port', '0', '--no-open'], { env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('exit', code => { process.exitCode = code ?? 130; });

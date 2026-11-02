import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { runtimeRequire, runtimeModulesRoot } from './runtime-path.mjs';
import { teachingFixture } from './teaching-fixture.mjs';
const require = runtimeRequire(), load = name => import(pathToFileURL(require.resolve(name)).href);
const { boot } = await load('@deepseek-ai/dsh-app-boot');
const { LlmAdapter, createUserMessage } = await load('@deepseek-ai/dsh-llm');
const root = resolve(import.meta.dirname, '..');
const run = mkdtempSync(join(homedir(), '.subagentbook-verification-test-'));
const home = join(run, 'dsh-home'), source = join(run, 'source'); mkdirSync(home); mkdirSync(source);
symlinkSync(runtimeModulesRoot(require), join(home, 'node_modules'), 'dir');
const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = home;
const git = args => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
const multiLanguage = process.env.SUBAGENTBOOK_VERIFY_MULTILANG === '1';
git(['init', '-q']); git(['config', 'user.name', 'Offline fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
writeFileSync(join(source, 'value.mjs'), 'export const value = 2;\n');
writeFileSync(join(source, 'deleted.txt'), 'tracked deletion');
writeFileSync(join(source, 'test.mjs'), "import { value } from './value.mjs'; if(value !== 3) throw Error('wrong value'); console.log('TEST_PASS');\n");
if (multiLanguage) {
  const major = Number(execFileSync('dotnet', ['--version'], { encoding: 'utf8' }).split('.')[0]);
  execFileSync('javac', ['-version']);
  mkdirSync(join(source, 'tiny'));
  writeFileSync(join(source, 'tiny/Tiny.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net${major}.0</TargetFramework></PropertyGroup></Project>\n`);
  writeFileSync(join(source, 'tiny/Program.cs'), 'System.Console.WriteLine("DOTNET_COPY_PASS");\n');
  writeFileSync(join(source, 'Tiny.java'), 'class Tiny { public static void main(String[] args) { System.out.println("JAVA_COPY_PASS"); } }\n');
}
writeFileSync(join(source, '.gitignore'), 'build/\n.gradle/\n'); git(['add', '.']); git(['commit', '-qm', 'base']);
writeFileSync(join(source, 'value.mjs'), 'export const value = 3;\n');
git(['add', 'value.mjs']); rmSync(join(source, 'deleted.txt'));
const originalIndex = readFileSync(join(source, '.git/index'));
writeFileSync(join(source, 'new.txt'), 'untracked input'); mkdirSync(join(source, '.gradle')); writeFileSync(join(source, '.gradle/cache'), 'do not duplicate');
const original = readFileSync(join(source, 'value.mjs'), 'utf8');
const previousArtifact = process.env.SUBAGENTBOOK_VERIFY_ARTIFACT_PATH;
process.env.SUBAGENTBOOK_VERIFY_ARTIFACT_PATH = join(source, 'value.mjs');
const captured = [], checks = [], handles = [];
let ctx, driver, parent, success = false;
const report = message => { checks.push(message); console.log(`  PASS ${message}`); };
class Adapter extends LlmAdapter {
  async resolveModel(provider, id) { return { provider, id, name: id, contextWindow: 32768, maxTokens: 2048 }; }
  async *stream(options) { captured.push(options);
    const prompt=options.messages.filter(m=>m.role==='user' && m.source?.kind!=='runtime-context').at(-1)?.content.find(b=>b.type==='text')?.text;
    if (['independent tests','parallel first verification','new source verification'].includes(prompt)) await new Promise(resolve=>{ if(options.signal.aborted)resolve();else options.signal.addEventListener('abort',resolve,{once:true}); }); yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'block-end', index: 0, block: { type: 'text', text: 'offline verification fixture' } }; yield { type: 'finish', reason: { kind: 'stop' } }; }
}
const book = { version: 1, entryPresets: ['verify'], presets: [{ id: 'verify', name: 'Verifier', defaults: {
  persona: { text: 'Independent verifier' }, tools: ['bash', 'write', 'read'], delegates: [], actionScope: 'verification-copy', maxNestedDepth: 0,
}, models: [{ provider: 'fixture', model: 'pro' }] }] };
const config = join(home, 'cordis.yml');
async function start() {
  writeFileSync(config, yaml.dump([
    ...['typert-registry', 'llm', 'session', 'session-projection', 'session-query', 'sandbox-policy', 'fs-sandbox', 'user-approval', 'agent', 'tools', 'system-prompt', ...(require('@deepseek-ai/dsh/package.json').version === '0.2.1-rc.5' ? ['working-directory'] : []), 'agent-loop', 'subagent'].map(id => ({ id, name: `@deepseek-ai/dsh-${id}` })),
    { id: 'subprocess', name: '@deepseek-ai/dsh-subprocess-local' }, { id: 'sandbox', name: '@deepseek-ai/dsh-sandbox-local' },
    { id: 'bash-sandbox', name: '@deepseek-ai/dsh-bash-sandbox', config: { timeoutMs: 10000 } },
    { id: 'shell-env', name: '@deepseek-ai/dsh-shell-env', config: { dshHome: home } },
    { id: 'persistence', name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: join(home, 'sessions'), compression: 'none' } },
    { id: 'adapter', name: 'cordis:verify-adapter' },
    { id: 'book', name: pathToFileURL(join(root, 'lib/index.js')).href, config: { bookJson: JSON.stringify(book) } },
  ]));
  ctx = await boot('verification-test', config, [], ctx => {
    ctx.provide('llmMimo', { listHostedModels: () => [{ provider: 'fixture', id: 'pro' }] }); ctx.provide('promptbook', teachingFixture());
    ctx.loader.builtins['verify-adapter'] = { inject: ['llm', 'agents'], apply(ctx) { driver = ctx; ctx.llm.registerAdapter(['fixture'], new Adapter()); } };
  }, pathToFileURL(require.resolve('@deepseek-ai/dsh/package.json')).href);
}
const bash = async (agent, command) => ctx.get('tools').execute({ agent, name: 'bash', callId: `verify-${Date.now()}`, arguments: { command, timeoutMs: 30000, workdir: agent.session.header.cwd, description: 'Offline verification test' }, signal: new AbortController().signal });
const text = result => JSON.stringify(result);
try {
  await start();
  parent = await driver.agents.create({ sessionId: 'verify-parent', meta: { cwd: source }, agentOptions: { provider: 'fixture', model: 'pro' } });
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  await assert.rejects(ctx.get('subagentbook').start(parent.agent, { presetId: 'verify', prompt: 'deny read-only grant' }), { code: 'VERIFICATION_UNAVAILABLE' });
  assert.equal(existsSync(join(source, '.subagentbook-verification')), false);
  report('a read-only parent cannot create or grant a writable verification copy');
  parent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  const api = ctx.get('subagentbook');
  const initialStatus = git(['status', '--porcelain']);
  const originalGitignore = readFileSync(join(source, '.gitignore'));
  const originalConfig = readFileSync(join(source, '.git/config'));
  const originalExclude = readFileSync(join(source, '.git/info/exclude'));
  const [first, parallel] = await Promise.all(['independent tests', 'parallel first verification'].map(prompt => api.start(parent.agent, { presetId: 'verify', prompt })));
  handles.push(first, parallel);
  const deadline=Date.now()+10000; while(captured.length<2) { if(Date.now()>deadline)throw new Error('Verification fixtures not running');await new Promise(resolve=>setTimeout(resolve,5)); }
  const parallelCopy = api.instance(parallel.localAgent).verification.workspaceRoot;
  assert.notEqual(parallelCopy, api.instance(first.localAgent).verification.workspaceRoot);
  await parallel.dispose(); handles.splice(handles.indexOf(parallel), 1);
  // Keep subsequent failure-count checks focused on the original published copy.
  rmSync(resolve(parallelCopy, '..'), { recursive: true });
  assert.equal(git(['status', '--porcelain']), initialStatus);
  assert.deepEqual(readFileSync(join(source, '.gitignore')), originalGitignore);
  assert.deepEqual(readFileSync(join(source, '.git/config')), originalConfig);
  assert.deepEqual(readFileSync(join(source, '.git/info/exclude')), originalExclude);
  assert.match(git(['check-ignore', '.subagentbook-verification/owner.json']), /owner.json/);
  report('parallel first verification creates independent copies without Git/index/config or project-ignore noise');
  const record = api.instance(first.localAgent), copy = record.verification.workspaceRoot;
  assert.notEqual(copy, source); assert.equal(first.localAgent.session.header.cwd, copy);
  assert.equal(readFileSync(join(copy, 'value.mjs'), 'utf8'), original);
  assert.equal(readFileSync(join(copy, 'new.txt'), 'utf8'), 'untracked input'); assert.equal(existsSync(join(copy, '.gradle')), false);
  assert.equal(existsSync(join(copy, 'deleted.txt')), false); assert.deepEqual(readFileSync(join(source, '.git/index')), originalIndex);
  assert.equal(execFileSync('git', ['-C', copy, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim(), '/dev/null');
  assert.ok(captured.at(-1).messages.some(m => JSON.stringify(m).includes('Independent verification copy:')));
  report('a model-visible independent Git copy captures dirty/untracked input, without ignored caches or source Git configuration');
  const built = await bash(first.localAgent, 'mkdir -p build && node test.mjs > build/result.txt');
  assert.equal(built.isError, false, text(built)); assert.equal(readFileSync(join(copy, 'build/result.txt'), 'utf8').trim(), 'TEST_PASS');
  assert.equal(existsSync(join(source, 'build')), false);
  report('the actual native Bash executor runs tests and writes fresh artifacts only in the copy');
  const cache = await bash(first.localAgent, `node -e 'const fs=require("node:fs"); for(const key of ["GRADLE_USER_HOME","DOTNET_CLI_HOME","NUGET_PACKAGES","GOCACHE"]) { fs.mkdirSync(process.env[key],{recursive:true}); fs.writeFileSync(process.env[key]+"/probe","cache"); }'`);
  assert.equal(cache.isError, false, text(cache)); assert.equal(existsSync(join(copy, '.verification-cache/nuget/probe')), true);
  assert.equal(existsSync(join(source, '.verification-cache')), false);
  const artifactPath = await bash(first.localAgent, 'node -p process.env.SUBAGENTBOOK_VERIFY_ARTIFACT_PATH');
  assert.equal(artifactPath.value.stdout.text.trim(), join(copy, 'value.mjs'));
  report('native Bash redirects build caches and source artifact environment paths into the verification copy');
  if (multiLanguage) {
    const compiled = await bash(first.localAgent, 'dotnet build tiny/Tiny.csproj -c Release -p:NuGetAudit=false -v:q && dotnet tiny/bin/Release/net*/Tiny.dll > build/dotnet.txt && javac -d build Tiny.java && java -cp build Tiny > build/java.txt');
    assert.equal(compiled.isError, false, text(compiled)); assert.equal(compiled.value.exitCode, 0, text(compiled));
    assert.match(readFileSync(join(copy, 'build/dotnet.txt'), 'utf8'), /DOTNET_COPY_PASS/); assert.match(readFileSync(join(copy, 'build/java.txt'), 'utf8'), /JAVA_COPY_PASS/);
    assert.equal(existsSync(join(source, 'tiny/bin')), false);
    report('installed .NET and Java really compile and execute in the confined copy with copy-local caches');
  }
  const denied = await bash(first.localAgent, `printf forbidden > '${source}/value.mjs'`);
  assert.ok(denied.isError || denied.value?.exitCode !== 0); assert.equal(readFileSync(join(source, 'value.mjs'), 'utf8'), original);
  const fsDenied = await ctx.get('tools').execute({ agent: first.localAgent, name: 'write', callId: 'deny-source-fs', arguments: { file_path: join(source, 'must-not-create.txt'), content: 'forbidden' }, signal: new AbortController().signal });
  assert.equal(fsDenied.isError, true);
  assert.match(text(fsDenied), /FS_SANDBOX_DENIED|file access denied/); assert.equal(existsSync(join(source, 'must-not-create.txt')), false);
  const link = await bash(first.localAgent, `ln -s '${source}/value.mjs' escape && printf forbidden > escape`);
  assert.ok(link.isError || link.value?.exitCode !== 0); assert.equal(readFileSync(join(source, 'value.mjs'), 'utf8'), original);
  const hardlink = await bash(first.localAgent, `ln '${source}/value.mjs' hardescape && printf forbidden > hardescape`);
  assert.ok(hardlink.isError || hardlink.value?.exitCode !== 0); assert.equal(readFileSync(join(source, 'value.mjs'), 'utf8'), original);
  report('Bash, file writes and a copy-local symlink cannot modify the reviewed source');
  const intact = await api.inspectInstance(first.id); assert.equal(intact.permission.workspaceRoot, copy); assert.equal(intact.permission.mode, 'workspace-write');
  assert.equal(intact.verification.sourceCurrent, true); assert.equal(intact.verification.copyInputsUnchanged, true);
  await bash(first.localAgent, "printf 'modified copy' > value.mjs");
  assert.equal((await api.inspectInstance(first.id)).verification.copyInputsUnchanged, false);
  assert.equal(readFileSync(join(source, 'value.mjs'), 'utf8'), original);
  writeFileSync(join(source, 'new.txt'), 'new source revision');
  assert.equal((await api.inspectInstance(first.id)).verification.sourceCurrent, false);
  report('provenance distinguishes changed copy inputs from a later source revision and never auto-applies mutations');
  const second = await api.start(parent.agent, { presetId: 'verify', prompt: 'new source verification' }); handles.push(second);
  const nextDeadline=Date.now()+10000; while(captured.length<3) { if(Date.now()>nextDeadline)throw new Error('Second fixture not running');await new Promise(resolve=>setTimeout(resolve,5)); }
  assert.notEqual(api.instance(second.localAgent).verification.inputRevision, record.verification.inputRevision);
  assert.notEqual(api.instance(second.localAgent).verification.workspaceRoot, copy);
  report('new verification instances use separate directories and the current source revision');

  const internalIgnore = join(source, '.subagentbook-verification/.gitignore'), ignoreContent = readFileSync(internalIgnore);
  writeFileSync(internalIgnore, 'user rules\n');
  await assert.rejects(api.start(parent.agent, { presetId: 'verify', prompt: 'refuse unknown ignore rules' }), /ignore rules are not owned/);
  assert.equal(readFileSync(internalIgnore, 'utf8'), 'user rules\n'); writeFileSync(internalIgnore, ignoreContent);
  git(['add', '-f', '--', '.subagentbook-verification/.gitignore']);
  try { await assert.rejects(api.start(parent.agent, { presetId: 'verify', prompt: 'refuse tracked management paths' }), /must not be tracked/); }
  finally { writeFileSync(join(source, '.git/index'), originalIndex); }
  report('foreign ignore rules and tracked management paths are refused without overwriting user data');

  symlinkSync(join(source, 'value.mjs'), join(source, 'source-link'));
  await assert.rejects(api.start(parent.agent, { presetId: 'verify', prompt: 'refuse source link' }));
  rmSync(join(source, 'source-link'));
  assert.equal(readdirSync(join(source, '.subagentbook-verification')).filter(n => !['owner.json', '.gitignore'].includes(n)).length, 2);
  report('unsupported source links fail with no published copy or leftover partial instance');
  const temporarySource = mkdtempSync(join(tmpdir(), 'verification-source-denied-'));
  const temporaryParent = await driver.agents.create({ sessionId: 'temporary-source-parent', meta: { cwd: temporarySource }, agentOptions: { provider: 'fixture', model: 'pro' } });
  try {
    temporaryParent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
    await assert.rejects(api.start(temporaryParent.agent, { presetId: 'verify', prompt: 'deny writable temporary source' }), /native writable temporary root/);
    assert.equal(existsSync(join(temporarySource, '.subagentbook-verification')), false);
  } finally { await temporaryParent.dispose(); rmSync(temporarySource, { recursive: true, force: true }); }
  report('sources in native writable temporary roots are refused instead of claiming read protection');
  const owner = ctx.loader.resolve('include').subtree.resolve('book').parent.tree, nativeImport = owner.import.bind(owner);
  let prepared, release;
  const paused = new Promise(resolve => { prepared = resolve; });
  const pauseImport = async (name, ...args) => {
    if (name === '@deepseek-ai/dsh-tool-bash' && prepared) { const notify = prepared; prepared = undefined; notify(); await new Promise(resolve => { release = resolve; }); }
    return nativeImport(name, ...args);
  };
  owner.import = pauseImport;
  const stale = api.start(parent.agent, { presetId: 'verify', prompt: 'race source publication' });
  await paused; writeFileSync(join(source, 'new.txt'), 'changed during publication'); release();
  await assert.rejects(stale, /Source changed before verification publication/);
  owner.import = nativeImport;
  assert.equal(readdirSync(join(source, '.subagentbook-verification')).filter(n => !['owner.json', '.gitignore'].includes(n)).length, 2);
  report('source changes during unpublished setup reject activation and remove the unused copy');
  const cancelledReady = new Promise(resolve => { prepared = resolve; }); owner.import = pauseImport;
  const controller = new AbortController();
  const cancelled = api.start(parent.agent, { presetId: 'verify', prompt: 'cancel unpublished copy', signal: controller.signal });
  await cancelledReady; controller.abort(); release(); await assert.rejects(cancelled); owner.import = nativeImport;
  assert.equal(readdirSync(join(source, '.subagentbook-verification')).filter(n => !['owner.json', '.gitignore'].includes(n)).length, 2);
  report('cancellation after snapshot creation rolls back the unused verification copy');
  const background = await api.startContinuable(parent.agent, { presetId: 'verify', prompt: 'background verification' });
  const child = driver.agents.get(background.childId); await child.whenIdle(); const backgroundRecord = api.instance(child);
  for (const handle of handles.splice(0)) await handle.dispose(); await parent.dispose(); parent = undefined;
  await ctx.fiber.dispose(); ctx = undefined;
  await start(); parent = await driver.agents.resume({ resumeSessionId: 'verify-parent' });
  await ctx.get('subagentbook').sendMessage(parent.agent, background.childId, 'continue frozen verification');
  const restored = driver.agents.get(background.childId); await restored.whenIdle();
  assert.equal(restored.session.header.cwd, backgroundRecord.verification.workspaceRoot);
  assert.equal(ctx.get('subagentbook').instance(restored).verification.inputRevision, backgroundRecord.verification.inputRevision);
  assert.ok(text(await bash(restored, 'node test.mjs')).includes('TEST_PASS'));
  report('a new host resumes the same background copy, identity and original provenance');
  const manifest = backgroundRecord.verification.manifestPath, saved = readFileSync(manifest);
  writeFileSync(manifest, '{}'); const before = captured.length;
  restored.followup(createUserMessage({ content: [{ type: 'text', text: 'tampered provenance' }], source: { kind: 'user' } })); await restored.whenIdle();
  assert.equal(captured.length, before); writeFileSync(manifest, saved);
  parent.agent.session.append('sandbox/mode', { mode: 'read-only', source: 'user' });
  await assert.rejects(ctx.get('subagentbook').sendMessage(parent.agent, background.childId, 'revoked parent'), { code: 'PERMISSION_CHANGED' });
  report('changed provenance and parent revocation refuse further execution');
  parent.agent.session.append('sandbox/mode', { mode: 'workspace-write', source: 'user' });
  await parent.dispose(); parent = undefined; await ctx.fiber.dispose(); ctx = undefined;
  rmSync(backgroundRecord.verification.workspaceRoot, { recursive: true });
  await start(); parent = await driver.agents.resume({ resumeSessionId: 'verify-parent' });
  const beforeMissing = captured.length;
  await assert.rejects(ctx.get('subagentbook').sendMessage(parent.agent, background.childId, 'missing original copy'));
  assert.equal(captured.length, beforeMissing); assert.deepEqual(readFileSync(join(source, '.git/index')), originalIndex);
  report('cold restore refuses a missing original copy and never re-snapshots current source');
  success = true; console.log(`PASS verification: ${checks.length} groups, ${captured.length} offline requests`);
} catch (error) { console.error(`Verification artifacts retained: ${run}`); throw error; }
finally {
  for (const handle of handles) await handle.dispose(); if (parent) await parent.dispose(); if (ctx) await ctx.fiber.dispose();
  if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
  if (previousArtifact === undefined) delete process.env.SUBAGENTBOOK_VERIFY_ARTIFACT_PATH; else process.env.SUBAGENTBOOK_VERIFY_ARTIFACT_PATH = previousArtifact;
  if (success) rmSync(run, { recursive: true, force: true });
}

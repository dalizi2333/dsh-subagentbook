import { constants, lstatSync, realpathSync, readFileSync, mkdirSync, writeFileSync, linkSync, rmSync } from 'node:fs';
import { lstat, realpath, mkdir, open, chmod, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute, sep, delimiter } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { BookError, revision } from './book.js';

const execute = promisify(execFile);
const STORE = '.subagentbook-verification';
const OWNER = '{"owner":"subagentbook-verification","version":1}\n';
const IGNORE = '# Subagentbook managed verification evidence; keep outside project changes.\n*\n';
const MAX_FILES = 20000, MAX_BYTES = 256 * 1024 * 1024;
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => { const name = relative(root, path); return name === '' || !isAbsolute(name) && name !== '..' && !name.startsWith(`..${sep}`); };
const fail = message => { throw new BookError('VERIFICATION_UNAVAILABLE', message); };
async function git(root, args, signal) {
  const result = await execute('git', ['-c', 'core.hooksPath=' + (process.platform === 'win32' ? 'NUL' : '/dev/null'), '-c', 'core.fsmonitor=false', '-C', root, ...args],
    { env: gitEnv, encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 30000, signal });
  return result.stdout;
}
function names(buffer) {
  const text = buffer.toString('utf8');
  if (!buffer.equals(Buffer.from(text))) fail('Verification requires UTF-8 Git paths');
  return [...new Set(text.split('\0').filter(Boolean))].sort().filter(name => {
    if (name === STORE || name.startsWith(`${STORE}/`)) return false;
    if (name.split('/').some(part => ['.', '..', '.git'].includes(part)) || isAbsolute(name)) fail('Invalid verification input path');
    return true;
  });
}
async function input(root, name) {
  const path = join(root, name);
  let stat;
  try { stat = await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || await realpath(path) !== path) fail(`Verification input must be a regular file without symlink ancestors: ${name}`);
  if (stat.size > MAX_BYTES) fail(`Verification input exceeds ${MAX_BYTES} bytes`);
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const chunks = []; let size = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(64 * 1024), { bytesRead } = await file.read(chunk, 0, chunk.length);
      if (!bytesRead) break;
      size += bytesRead; if (size > MAX_BYTES) fail(`Verification input exceeds ${MAX_BYTES} bytes`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const bytes = Buffer.concat(chunks, size);
    return { path: name, mode: stat.mode & 0o777, bytes: bytes.length, sha256: hash(bytes), data: bytes };
  } finally { await file.close(); }
}
async function collect(root, signal) {
  if (await realpath(root) !== root) fail('Verification source identity changed');
  const top = (await git(root, ['rev-parse', '--show-toplevel'], signal)).toString().trim();
  if (await realpath(top) !== root) fail('Verification requires the session workspace to be a Git repository root');
  const head = (await git(root, ['rev-parse', '--verify', 'HEAD'], signal)).toString().trim();
  const paths = names(await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], signal));
  if (paths.length > MAX_FILES) fail(`Verification input exceeds ${MAX_FILES} files`);
  const files = []; let bytes = 0;
  for (const name of paths) {
    signal?.throwIfAborted();
    const row = await input(root, name);
    if (!row) continue; // A tracked deletion is part of the snapshot.
    bytes += row.bytes;
    if (bytes > MAX_BYTES) fail(`Verification input exceeds ${MAX_BYTES} bytes`);
    const { data, ...metadata } = row; files.push(metadata);
  }
  return { head, files, bytes, inputRevision: revision({ head, files }) };
}
function publishText(directory, file, text) {
  const temporary = join(directory, `.init-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    try { linkSync(temporary, file); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { rmSync(temporary, { force: true }); }
}
async function ownedStore(sourceRoot, signal) {
  const directory = join(sourceRoot, STORE), marker = join(directory, 'owner.json');
  let created = false;
  try { mkdirSync(directory, { mode: 0o700 }); created = true; }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) fail('Verification management directory is not owned by Subagentbook');
  if (created) publishText(directory, marker, OWNER);
  // Another confined worker may have just made the first shared directory.
  // Wait only for its atomic owner publication; never adopt an unowned folder.
  for (let attempt = 0; ; attempt++) {
    try {
      if (!lstatSync(marker).isFile() || realpathSync(marker) !== marker || readFileSync(marker, 'utf8') !== OWNER) fail('Verification management directory is not owned by Subagentbook');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT' || attempt >= 49) throw error;
      await delay(10, undefined, { signal });
    }
  }
  const ignore = join(directory, '.gitignore');
  // Lowest-level ignore includes itself. No source Git metadata or tracked
  // ignore file is changed, including when the source is a linked worktree.
  publishText(directory, ignore, IGNORE);
  if (!lstatSync(ignore).isFile() || realpathSync(ignore) !== ignore || readFileSync(ignore, 'utf8') !== IGNORE) fail('Verification ignore rules are not owned by Subagentbook');
  return directory;
}
async function buildVerification(parentPolicy, instanceId, signal) {
  if (!['workspace-write', 'danger-full-access'].includes(parentPolicy.sandboxMode)) fail('A read-only parent cannot grant a writable verification copy; delegate directly from the writable runner');
  const sourceRoot = await realpath(parentPolicy.workspaceRoot);
  // workspace-write also admits platform temp roots. A source there would not
  // be protected consistently by all native file/shell providers.
  for (const temp of new Set(['/tmp', tmpdir()])) {
    let canonical;
    try { canonical = await realpath(temp); } catch { continue; }
    if (within(canonical, sourceRoot) || within(sourceRoot, canonical)) fail('Verification source cannot overlap a native writable temporary root');
  }
  const before = await collect(sourceRoot, signal);
  if ((await git(sourceRoot, ['ls-files', '--', STORE], signal)).length) fail('Verification management paths must not be tracked project files');
  const directory = join(await ownedStore(sourceRoot, signal), instanceId), workspaceRoot = join(directory, 'workspace');
  await mkdir(directory, { mode: 0o700 });
  try {
    // Local transport copies Git objects, never source config/hooks/alternates
    // or hardlinks. The independent index starts at HEAD; working edits follow.
    await git(sourceRoot, ['-c', 'protocol.file.allow=always', 'clone', '--quiet', '--no-local', '--no-hardlinks', '--no-checkout', '--single-branch', '--depth', '1', '--', sourceRoot, workspaceRoot], signal);
    if ((await git(workspaceRoot, ['rev-parse', 'HEAD'], signal)).toString().trim() !== before.head) fail('Source HEAD changed while cloning');
    await git(workspaceRoot, ['remote', 'remove', 'origin'], signal);
    await git(workspaceRoot, ['config', 'core.hooksPath', process.platform === 'win32' ? 'NUL' : '/dev/null'], signal);
    await git(workspaceRoot, ['read-tree', 'HEAD'], signal);
    const exclude = await open(join(workspaceRoot, '.git/info/exclude'), 'a');
    try { await exclude.writeFile('\n/.verification-cache/\n'); } finally { await exclude.close(); }
    for (const expected of before.files) {
      signal?.throwIfAborted();
      const row = await input(sourceRoot, expected.path);
      if (!row || row.sha256 !== expected.sha256 || row.mode !== expected.mode) fail('Source changed while making the verification copy');
      const destination = join(workspaceRoot, row.path);
      await mkdir(resolve(destination, '..'), { recursive: true });
      if (await realpath(resolve(destination, '..')) !== resolve(destination, '..')) fail('Verification destination was replaced');
      const file = await open(destination, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0), row.mode);
      try { await file.writeFile(row.data); } finally { await file.close(); }
      await chmod(destination, row.mode);
    }
    if ((await collect(sourceRoot, signal)).inputRevision !== before.inputRevision) fail('Source changed while making the verification copy');
    const manifest = { version: 1, sourceRoot, workspaceRoot, ...before, createdAt: new Date().toISOString() };
    const manifestPath = join(directory, 'manifest.json'), data = JSON.stringify(manifest, null, 2) + '\n';
    const file = await open(manifestPath, 'wx', 0o600);
    try { await file.writeFile(data); } finally { await file.close(); }
    return { version: 1, sourceRoot, workspaceRoot, manifestPath, manifestSha256: hash(data),
      inputRevision: before.inputRevision, sourceHead: before.head, fileCount: before.files.length, bytes: before.bytes, createdAt: manifest.createdAt };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
export function assertVerification(record) {
  const v = record.verification;
  if (record.compiled.actionScope !== 'verification-copy') {
    if (v) fail('Unexpected verification capability in a non-verification role');
    return;
  }
  if (!['workspace-write', 'danger-full-access'].includes(record.inheritedPolicy?.sandboxMode) || !v || v.version !== 1 || v.sourceRoot !== realpathSync(record.inheritedPolicy.workspaceRoot) ||
    v.workspaceRoot !== join(v.sourceRoot, STORE, record.instanceId, 'workspace') ||
    v.manifestPath !== join(v.sourceRoot, STORE, record.instanceId, 'manifest.json') ||
    !lstatSync(v.workspaceRoot).isDirectory() || realpathSync(v.workspaceRoot) !== v.workspaceRoot ||
    realpathSync(v.manifestPath) !== v.manifestPath) fail('The original verification copy or provenance is unavailable or changed');
  const data = readFileSync(v.manifestPath);
  if (hash(data) !== v.manifestSha256) fail('The original verification provenance changed');
  return JSON.parse(data.toString('utf8'));
}
export function verificationEnvironment(record, environment = {}) {
  const v = record.verification, cache = join(v.workspaceRoot, '.verification-cache');
  const mapped = {};
  for (const [key, value] of Object.entries({ ...process.env, ...environment })) {
    if (typeof value === 'string' && isAbsolute(value) && !value.includes(delimiter) && within(v.sourceRoot, resolve(value))) mapped[key] = join(v.workspaceRoot, relative(v.sourceRoot, resolve(value)));
  }
  return { ...environment, ...mapped, XDG_CACHE_HOME: cache, DOTNET_CLI_HOME: join(cache, 'dotnet'), NUGET_PACKAGES: join(cache, 'nuget'),
    GRADLE_USER_HOME: join(cache, 'gradle'), NPM_CONFIG_CACHE: join(cache, 'npm'), GOCACHE: join(cache, 'go-build'), GOMODCACHE: join(cache, 'go-mod'),
    CARGO_HOME: join(cache, 'cargo'), CARGO_TARGET_DIR: join(v.workspaceRoot, 'target'), PIP_CACHE_DIR: join(cache, 'pip'), UV_CACHE_DIR: join(cache, 'uv') };
}
export async function verificationView(record) {
  if (!record.verification) return undefined;
  const v = record.verification;
  try {
    const manifest = assertVerification(record);
    const current = await collect(v.sourceRoot);
    const files = [];
    for (const original of manifest.files) { const row = await input(v.workspaceRoot, original.path); const { data, ...metadata } = row ?? { path: original.path, missing: true }; files.push(metadata); }
    return { ...v, checkedAt: new Date().toISOString(), sourceCurrent: current.inputRevision === v.inputRevision, copyInputsUnchanged: revision({ head: manifest.head, files }) === v.inputRevision };
  } catch (error) { return { ...v, sourceCurrent: false, copyInputsUnchanged: false, error: error.message }; }
}
export async function assertVerificationSource(record, signal) {
  if (!record.verification) return;
  assertVerification(record);
  if ((await collect(record.verification.sourceRoot, signal)).inputRevision !== record.verification.inputRevision) fail('Source changed before verification publication; start a new verification instance');
}
async function removeVerification(record) {
  if (!record?.verification) return;
  assertVerification(record);
  await rm(resolve(record.verification.workspaceRoot, '..'), { recursive: true, force: true });
}
async function worker(sandbox, policy, command, data, signal) {
  if (!sandbox?.confine) fail('Verification requires the native confining executor');
  const confined = await sandbox.confine([process.execPath, fileURLToPath(import.meta.url), command, JSON.stringify(data)],
    { mode: 'workspace-write', workspaceRoot: policy.workspaceRoot }, signal);
  if (confined.enforcement !== 'full') fail('Verification requires complete native filesystem confinement');
  const task = execute(confined.argv[0], confined.argv.slice(1), { cwd: policy.workspaceRoot, env: gitEnv, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 90000, signal, detached: process.platform !== 'win32' });
  const stop = () => { if (process.platform !== 'win32' && task.child?.pid) try { process.kill(-task.child.pid, 'SIGKILL'); } catch {} };
  signal?.addEventListener('abort', stop, { once: true });
  try { return JSON.parse((await task).stdout); }
  finally { signal?.removeEventListener('abort', stop); stop(); }
}
export async function prepareVerification(policy, instanceId, signal, sandbox) {
  if (typeof instanceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(instanceId)) fail('Invalid verification identity');
  if (!['workspace-write', 'danger-full-access'].includes(policy.sandboxMode)) fail('Delegate verification directly from a writable runner, not a read-only parent');
  signal?.throwIfAborted();
  try { return await worker(sandbox, policy, '--prepare', { policy, instanceId }, signal); }
  catch (error) {
    await worker(sandbox, policy, '--abandon', { policy, instanceId }).catch(() => {});
    throw error;
  }
}
export const rollbackVerification = (record, sandbox) => record.verification ? worker(sandbox, record.inheritedPolicy, '--rollback', record) : undefined;
if (process.argv[1] === fileURLToPath(import.meta.url) && ['--prepare', '--rollback', '--abandon'].includes(process.argv[2])) {
  try {
    const data = JSON.parse(process.argv[3]);
    let result;
    if (process.argv[2] === '--prepare') result = await buildVerification(data.policy, data.instanceId);
    else if (process.argv[2] === '--rollback') result = await removeVerification(data);
    else {
      if (!/^[a-zA-Z0-9_-]+$/.test(data.instanceId)) fail('Invalid verification identity');
      const source = await realpath(data.policy.workspaceRoot);
      const directory = join(source, STORE);
      try { if (realpathSync(directory) !== directory || readFileSync(join(directory, 'owner.json'), 'utf8') !== OWNER) fail('Invalid verification management directory'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await rm(join(directory, data.instanceId), { recursive: true, force: true });
    }
    process.stdout.write(JSON.stringify(result ?? null));
  } catch (error) { process.stderr.write(`${error.code ?? 'VERIFICATION_UNAVAILABLE'}: ${error.message}\n`); process.exitCode = 1; }
}

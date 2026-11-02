import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`Git checkpoint command failed: ${args[0]}`);
  return result.stdout;
}
const sha = value => createHash('sha256').update(value).digest('hex');
const inside = path => path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);

// Content provenance, not a review verdict or an authorization mechanism.
export function snapshotInputs(directory) {
  const root = realpathSync(directory);
  if (realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()) !== root) throw new Error('Select the Git workspace root');
  const names = [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort();
  const files = names.map(path => {
    const full = resolve(root, path);
    if (!inside(relative(root, full))) throw new Error('Input outside workspace');
    let stat;
    try { stat = lstatSync(full); } catch (error) { if (error.code === 'ENOENT') return { path, deleted: true }; throw error; }
    if (!stat.isFile() || realpathSync(full) !== full) throw new Error(`Unsupported input: ${path}`);
    return { path, mode: stat.mode & 0o777, sha256: sha(readFileSync(full)) };
  });
  const inputs = { version: 1, root, head: git(root, ['rev-parse', 'HEAD']).trim(), files };
  return { ...inputs, revision: sha(JSON.stringify(inputs)) };
}
export function freezeInputs(directory, destination) {
  const snapshot = snapshotInputs(directory), output = resolve(destination);
  const local = relative(snapshot.root, output);
  // An in-tree receipt must not become part of its own reviewed input set.
  if (inside(local)) {
    const ignored = spawnSync('git', ['-C', snapshot.root, 'check-ignore', '--no-index', '--quiet', '--', local]);
    if (ignored.status !== 0 || snapshot.files.some(file => file.path === local)) throw new Error('Store the checkpoint outside the workspace or in an untracked ignored evidence directory');
  }
  writeFileSync(output, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return snapshot;
}
export function checkInputs(directory, checkpoint) {
  const previous = JSON.parse(readFileSync(checkpoint, 'utf8'));
  const { revision, ...inputs } = previous;
  if (previous.version !== 1 || typeof revision !== 'string' || sha(JSON.stringify(inputs)) !== revision) throw new Error('Invalid checkpoint');
  const current = snapshotInputs(directory);
  if (previous.root !== current.root) throw new Error('Checkpoint belongs to another workspace');
  return { unchanged: current.revision === revision, reviewedRevision: revision, currentRevision: current.revision };
}

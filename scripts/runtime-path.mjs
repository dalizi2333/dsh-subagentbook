import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { basename, delimiter, dirname, join, resolve } from 'node:path';

export function runtimeRequire() {
  const target = process.env.DSH_RUNTIME_BIN ?? 'dsh';
  const bin = target.includes('/') ? resolve(target) : process.env.PATH.split(delimiter).map(dir => join(dir, target)).find(existsSync);
  if (!bin || !existsSync(bin)) throw new Error('Set DSH_RUNTIME_BIN to the Development baseline CLI.');
  const require = createRequire(realpathSync(bin));
  if (!['0.2.0-rc.2', '0.2.1-rc.5'].includes(require('@deepseek-ai/dsh/package.json').version)) throw new Error('Host tests require a supported DSH matrix version.');
  return require;
}

// Global npm installs keep DSH dependencies under the package itself; local
// installs hoist them. Resolve an actual host module rather than assuming either.
export function runtimeModulesRoot(require) {
  let dir = dirname(require.resolve('@deepseek-ai/dsh-app-boot'));
  while (basename(dir) !== 'node_modules') {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('Cannot locate host node_modules.');
    dir = parent;
  }
  return dir;
}

// Private fixture overlay also exposes the CLI package itself, which is a
// sibling of (rather than inside) its dependencies in global npm layouts.
export function linkRuntime(home, require) {
  const modules = join(home, 'node_modules');
  const source = runtimeModulesRoot(require);
  mkdirSync(modules, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      mkdirSync(join(modules, entry.name), { recursive: true });
      for (const name of readdirSync(join(source, entry.name)))
        symlinkSync(join(source, entry.name, name), join(modules, entry.name, name), 'dir');
    } else symlinkSync(join(source, entry.name), join(modules, entry.name), 'dir');
  }
  const dsh = join(modules, '@deepseek-ai/dsh');
  if (!existsSync(dsh)) symlinkSync(dirname(require.resolve('@deepseek-ai/dsh/package.json')), dsh, 'dir');
}

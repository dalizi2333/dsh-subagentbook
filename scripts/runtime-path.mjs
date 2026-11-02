import { createRequire } from 'node:module';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';

export function runtimeRequire() {
  const target = process.env.DSH_RUNTIME_BIN ?? 'dsh';
  const bin = target.includes('/') ? resolve(target) : process.env.PATH.split(delimiter).map(dir => join(dir, target)).find(existsSync);
  if (!bin || !existsSync(bin)) throw new Error('Set DSH_RUNTIME_BIN to the Development baseline CLI.');
  const require = createRequire(realpathSync(bin));
  if (!['0.2.0-rc.2', '0.2.1-rc.5'].includes(require('@deepseek-ai/dsh/package.json').version)) throw new Error('Host tests require a supported DSH matrix version.');
  return require;
}

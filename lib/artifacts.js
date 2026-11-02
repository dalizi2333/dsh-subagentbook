import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { BookError, revision } from './book.js';

// Verify installed code, including declared runtime dependencies, rather than
// interpreting a matching book JSON revision as a matching executable plugin.
// Changed/missing artifacts require a new instance; this is not an archive.
export async function artifactRevision(compiled, host) {
  const packages = new Map();
  const builtins = {};
  function digest(directory) {
    const hash = createHash('sha256');
    const visit = (path, prefix = '') => {
      for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith('.') || ['node_modules', 'log', 'docs', 'test', 'tests', 'scripts', 'examples'].includes(entry.name)) continue;
        const relative = `${prefix}${entry.name}`;
        if (entry.isDirectory()) visit(join(path, entry.name), `${relative}/`);
        else if (/\.(?:[cm]?[jt]s|json|ya?ml|css|html|wasm|node|so|dylib|dll|exe|bin|sh|py)$/.test(entry.name)) hash.update(relative).update('\0').update(readFileSync(join(path, entry.name))).update('\0');
      }
    };
    visit(directory); return hash.digest('hex');
  }
  function describe(value) {
    if (typeof value === 'function') return String(value);
    if (Array.isArray(value)) return value.map(describe);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, describe(item)]));
    return value;
  }
  async function pin(name, from) {
    if (name.startsWith('cordis:')) {
      builtins[name] = describe(await host.importPlugin(name));
      return;
    }
    let url;
    try { url = await host.resolvePlugin(name, from); }
    catch (error) {
      // Some dependency packages intentionally export only subpaths. Their
      // installed manifest still pins all those entry points.
      if (!from || !['ERR_PACKAGE_PATH_NOT_EXPORTED', 'ERR_MODULE_NOT_FOUND'].includes(error.code)) throw error;
      const location = createRequire(from).resolve.paths(name)?.map(path => join(path, name, 'package.json')).find(existsSync);
      if (!location) throw error;
      url = pathToFileURL(location).href;
    }
    if (!url?.startsWith('file:')) throw new BookError('ARTIFACT_UNAVAILABLE', `Cannot pin plugin ${name}`);
    const entry = realpathSync(fileURLToPath(url));
    let directory = dirname(entry);
    while (!existsSync(join(directory, 'package.json'))) {
      if (directory === parse(directory).root) throw new BookError('ARTIFACT_UNAVAILABLE', `Plugin ${name} has no package manifest`);
      directory = dirname(directory);
    }
    if (packages.has(directory)) return;
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    packages.set(directory, { name: pkg.name ?? directory, version: pkg.version ?? '', digest: digest(directory) });
    const optional = new Set(Object.keys(pkg.optionalDependencies ?? {}));
    for (const dependency of Object.keys(pkg.dependencies ?? {}).sort()) {
      try { await pin(dependency, pathToFileURL(join(directory, 'package.json')).href); }
      catch (error) { if (!optional.has(dependency) && !pkg.peerDependenciesMeta?.[dependency]?.optional) throw error; }
    }
  }
  const rows = async list => {
    for (const row of list) {
      if (row.disabled) continue;
      if (row.group) await rows(row.config); else await pin(row.name);
    }
  };
  await rows(compiled.plugins);
  for (const name of new Set(host.servicePlugins)) await pin(name);
  await pin(new URL('./index.js', import.meta.url).href);
  // Factory, permissions and prompt assembly also participate in reconstruction.
  await pin('@deepseek-ai/dsh/package.json');
  return revision({ packages: [...packages.values()].sort((a, b) => `${a.name}@${a.version}:${a.digest}`.localeCompare(`${b.name}@${b.version}:${b.digest}`)), builtins });
}

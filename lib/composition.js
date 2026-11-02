import { BookError, canonical, fixedToolPlugins } from './book.js';
import { TASK_TOOL_NAMES } from './definition.js';

// Use the host's loader and scope identities, not a second copy in node_modules.
export async function hostModules(ctx) {
  const names = ['@deepseek-ai/cordis-plugin-loader', '@deepseek-ai/dsh-scope', '@deepseek-ai/dsh-subagent', '@deepseek-ai/dsh-agent', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-home-paths'];
  const owner = ctx.fiber.entry?.parent.tree ?? ctx.loader;
  const importPlugin = name => owner.import(name);
  const [loader, scope, subagent, agent, llm, home] = await Promise.all(names.map(importPlugin));
  const resolvePlugin = async (name, parentURL = owner.ctx.baseUrl) => {
    const internal = ctx.loader.internal;
    if (!internal) throw new BookError('ARTIFACT_UNAVAILABLE', 'The host module resolver is unavailable');
    const result = internal.version === 'v2' ? internal.resolveSync(parentURL, { specifier: name, attributes: {} }) : await internal.resolve(name, parentURL, {});
    return typeof result === 'string' ? result : result.url;
  };
  const servicePlugins = ['llmMimo', 'promptbook', 'sandboxPolicy', 'approval', 'permissionPresets', 'fs', 'shell', 'sandbox', 'subprocess', 'workingDirectory'].map(name => ctx.reflect.store[ctx[ctx.constructor.isolate][name]]?.fiber?.entry?.options?.name).filter(Boolean);
  return { loader, scope, subagent, agent, llm, home, importPlugin, resolvePlugin, servicePlugins };
}

function within(fiber, root) {
  for (;;) {
    if (fiber === root) return true;
    const parent = fiber.parent.fiber;
    if (parent === fiber) return false;
    fiber = parent;
  }
}
export function assertFixedComposition(compiled) {
  if (!Array.isArray(compiled.tools) || compiled.tools.some(name => !TASK_TOOL_NAMES.includes(name)) || canonical(compiled.plugins) !== canonical(fixedToolPlugins(compiled.tools))) throw new BookError('INVALID_INSTANCE', 'Saved tool components differ from the fixed tool mapping; create a new instance');
}

export async function mountComposition(ctx, child, compiled, host) {
  assertFixedComposition(compiled);
  // Native continuable setup may already have joined this Agent to its
  // parent's native preset. Register the role's fixed tools on the Agent's
  // existing scope; only the original binder may change its parent link.
  // The child-owned fiber still isolates disposal from parents and siblings.
  const key = host.scope.scopeOf(child.ctx);
  if (!key) throw new BookError('PLUGIN_ISOLATION', 'Book composition requires an Agent scope');
  const standing = host.scope.createScope(ctx, key);
  ctx.effect(() => () => standing.dispose(), 'subagentbook.composition-scope');
  // Match the host's in-memory preset tree without publishing model variants
  // into the native preset roster. The child handle owns the whole tree.
  class BookTree extends host.loader.EntryTree {
    constructor(treeCtx) {
      const owner = treeCtx.fiber.entry;
      const subtree = owner?.subtree;
      const subgroup = owner?.subgroup;
      super(treeCtx);
      if (owner) {
        if (subtree === undefined) delete owner.subtree; else owner.subtree = subtree;
        if (subgroup === undefined) delete owner.subgroup; else owner.subgroup = subgroup;
      }
    }
    import(name) { return host.importPlugin(name); }
    write() {}
  }
  const tree = new BookTree(standing.ctx);
  ctx.effect(() => () => tree.root.stop(), 'subagentbook.composition-tree');
  await tree.root.update(fixedToolPlugins(compiled.tools));
  await tree.await();
  for (const entry of tree.entries()) {
    if (entry.disabled) continue;
    if (!entry.fiber) throw new BookError('PLUGIN_LOAD', `Plugin ${entry.options.id} did not start`);
    await entry.fiber.await();
    const missing = Object.keys(entry.fiber.inject).filter(name => entry.fiber.ctx.get(name) === undefined);
    if (missing.length) throw new BookError('PLUGIN_DEPENDENCY', `${entry.options.id} is waiting for ${missing.join(', ')}`);
  }
  const store = ctx.reflect.store;
  const symbols = ctx.root[ctx.constructor.isolate];
  const inheritedServices = new Set(['agents', 'subagents', 'llm', 'llmMimo', 'promptbook', 'loader', 'sessions', 'sessionProjections', 'tools', 'systemPrompt', 'credentials', 'sandboxPolicy', 'approval', 'permissionPresets', 'fs', 'shell', 'sandbox', 'subprocess', 'workingDirectory']);
  for (const symbol of Object.getOwnPropertySymbols(store)) {
    const impl = store[symbol];
    if (impl && within(impl.fiber, standing.ctx.fiber) && inheritedServices.has(impl.name)) throw new BookError('PLUGIN_AUTHORITY', `Child composition cannot replace inherited execution service ${impl.name}`);
    if (impl && within(impl.fiber, standing.ctx.fiber) && symbols[impl.name] === symbol) {
      throw new BookError('PLUGIN_ISOLATION', `Child service ${impl.name} requires an isolate realm`);
    }
  }
}

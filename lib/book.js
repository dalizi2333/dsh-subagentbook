import { createHash } from 'node:crypto';
import { canonical, freeze, resolvePreset } from './definition.js';
export { BookError, depth, canonical, freeze, parseBook, admitChild, EMPTY_BOOK, validateModelOptions, fixedToolPlugins } from './definition.js';

export const revision = value => createHash('sha256').update(canonical(value)).digest('hex');
export function compilePreset(book, presetId, provider, model, dependencies) {
  const compiled = resolvePreset(book, presetId, provider, model, dependencies);
  return freeze({ ...compiled,
    bookRevision: revision(book),
    presetRevision: revision(book.presets.find(p => p.id === presetId)),
    compositionRevision: revision({ provider, model, plugins: compiled.plugins, tools: compiled.tools, agentOptions: compiled.agentOptions }),
    promptRevision: revision({ persona: compiled.persona, preference: compiled.preference, teaching: compiled.teaching }),
  });
}

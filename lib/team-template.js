import team from '../examples/ur-team.json' with { type: 'json' };
import { parseBook } from './definition.js';

// Pure construction: validate the whole addition before changing the editor.
// Each import owns its names, so no existing role or delegation is overwritten.
export function addExpertTeam(book, provider, model) {
  const current = parseBook(book);
  if (typeof provider !== 'string' || !provider.trim() || typeof model !== 'string' || !model.trim()) throw new Error('Choose an available model');
  let namespace = 'ur', n = 1;
  const occupied = new Set(current.presets.map(row => row.id));
  while (team.presets.some(row => occupied.has(`${namespace}.${row.id}`))) namespace = `ur-${++n}`;
  const id = value => `${namespace}.${value}`;
  const presets = team.presets.map(row => ({
    ...structuredClone(row), id: id(row.id),
    defaults: { ...structuredClone(row.defaults), delegates: (row.defaults.delegates ?? []).map(id) },
    // The template carries no credentials, request budgets or private effort IDs.
    // Each role can acquire its own exact routes through the normal editor.
    models: [{ provider, model }],
  }));
  const entryId = id('developer');
  return { book: structuredClone(parseBook({ ...current, presets: [...current.presets, ...presets], entryPresets: [...current.entryPresets, entryId] })), entryId, namespace };
}

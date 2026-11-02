// Provisional tool choices, shared by the paid acceptance and offline host gate.
export const pipelineModels = ['mimo-v2.6-pro', 'mimo-v2.6-flash'];
export const allTools = ['bash', 'glob', 'read', 'grep', 'edit', 'write', 'web_search', 'web_fetch'];
export const toolsFor = (role, model) => role === 'planner' ? ['bash', 'web_search', 'web_fetch'] : role === 'reviewer' && model === 'mimo-v2.6-pro' ? [...allTools] : ['bash'];
export { fixedToolPlugins as pluginsFor } from '../lib/definition.js';

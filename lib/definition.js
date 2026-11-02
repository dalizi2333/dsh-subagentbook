export class BookError extends Error {
  constructor(code, message) { super(message); this.name = 'BookError'; this.code = code; }
}
const fail = (at, message) => { throw new BookError('INVALID_BOOK', `${at}: ${message}`); };
const object = (value, at) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(at, 'expected an object');
  return value;
};
const text = (value, at) => {
  if (typeof value !== 'string' || !value.trim()) fail(at, 'expected a non-empty string');
  return value;
};
const keys = (value, allowed, at) => {
  object(value, at);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(at, `unknown field ${key}`);
};
const names = (value, at) => {
  if (!Array.isArray(value)) fail(at, 'expected an array');
  const result = value.map((item, i) => text(item, `${at}[${i}]`));
  if (new Set(result).size !== result.length) fail(at, 'duplicate name');
  return result;
};
export function depth(value, at = 'depth') {
  if (!Number.isSafeInteger(value) || value < 0) fail(at, 'expected a non-negative safe integer');
  return value;
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function json(value, at) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach((v, i) => json(v, `${at}[${i}]`)); return; }
  object(value, at);
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor', '__jsExpr'].includes(key)) fail(at, `forbidden key ${key}`);
    if (/^(?:api_?key|access_?token|refresh_?token|password|secret)$/i.test(key)) fail(at, 'use credential references, not inline credentials');
    json(item, `${at}.${key}`);
  }
}
function prompt(value, at) {
  keys(value, ['text', 'key'], at);
  if (Object.keys(value).length !== 1) fail(at, 'select exactly one of text/key');
  if ('key' in value) text(value.key, `${at}.key`);
  else if (typeof value.text !== 'string') fail(at, 'text must be a string');
}
export const TASK_TOOL_NAMES = Object.freeze(['bash', 'glob', 'read', 'grep', 'edit', 'write', 'web_search', 'web_fetch']);
// Trusted implementation policy, derived only from declared tool names.
export function fixedToolPlugins(tools) {
  return [
    ...(tools.includes('bash') ? [{ id: 'bash', name: '@deepseek-ai/dsh-tool-bash', config: { enableRunInBackground: false, promoteOnTimeout: false } }] : []),
    ...(tools.some(name => ['read', 'edit', 'write'].includes(name)) ? [{ id: 'fs', name: '@deepseek-ai/dsh-tool-fs' }] : []),
    ...(tools.some(name => ['glob', 'grep'].includes(name)) ? [{ id: 'search', name: '@deepseek-ai/dsh-tool-fs-search', config: { sampleOverCapGlobResults: false } }] : []),
    ...(tools.some(name => ['web_search', 'web_fetch'].includes(name)) ? [{ id: 'web-tools', name: '@deepseek-ai/dsh-tool-web' }] : []),
  ];
}
export function toolTeachingKey(name, tools) {
  if (!TASK_TOOL_NAMES.includes(name)) return undefined;
  return name === 'bash' && tools.length === 1 ? 'tool.bash.only' : `tool.${name}`;
}
function resolveTeaching(tools, model, provider, resolveToolText) {
  const teaching = {}, sources = {};
  for (const name of tools) {
    const key = toolTeachingKey(name, tools);
    if (!key) continue;
    let selected = key;
    let value = resolveToolText?.(key, model, provider);
    if (value === undefined && key === 'tool.bash.only') {
      selected = 'tool.bash'; value = resolveToolText?.(selected, model, provider);
    }
    if (value !== undefined && typeof value !== 'string') throw new BookError('MISSING_PROMPT', `Invalid tool prompt ${selected} for ${provider}/${model}`);
    sources[name] = { key, resolvedKey: value === undefined ? null : selected, mode: value === undefined || value === '' ? 'native' : 'promptbook' };
    if (typeof value === 'string' && value !== '') teaching[name] = value;
  }
  return { teaching, sources };
}
const fields = ['persona', 'tools', 'delegates', 'maxNestedDepth', 'toolPreference', 'preferencePrompt', 'actionScope', 'agentOptions'];
const forbiddenTools = new Set(['subagent', 'subagent_fork', 'subagentbook', 'subagentbook_message', 'subagentbook_stop', 'send_message', 'interrupt_agent']);
const managedRequestRoots = new Set(['model', 'messages', 'input', 'system', 'instructions', 'tools', 'tool_choice', 'stream', 'stream_options', 'max_tokens', 'max_completion_tokens', 'max_output_tokens']);
function requestFields(config, at) {
  if (!Array.isArray(config)) fail(at, 'expected an array');
  const paths = [];
  for (const [i, field] of config.entries()) {
    const where = `${at}[${i}]`;
    keys(field, ['name', 'path', 'type', 'value', 'apiFormat', 'min', 'max', 'step'], where);
    text(field.path, `${where}.path`);
    const parts = field.path.split('.');
    if (parts.some(part => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(part) || ['__proto__', 'prototype', 'constructor'].includes(part) || /^(?:api_?key|access_?token|refresh_?token|password|secret)$/i.test(part)) || managedRequestRoots.has(parts[0])) fail(where, `invalid or managed request field ${field.path}`);
    if (paths.some(path => path === field.path || path.startsWith(`${field.path}.`) || field.path.startsWith(`${path}.`))) fail(where, `duplicate or conflicting request field ${field.path}`);
    paths.push(field.path);
    if (!['chat', 'anthropic', 'responses'].includes(field.apiFormat)) fail(where, 'select an exact API format');
    if (!['number', 'string', 'boolean'].includes(field.type) || typeof field.value !== field.type || field.type === 'number' && !Number.isFinite(field.value)) fail(where, 'value must match the scalar field type');
    if (field.name !== undefined && typeof field.name !== 'string') fail(where, 'name must be a string');
    for (const key of ['min', 'max', 'step']) if (field[key] !== undefined && (field.type !== 'number' || typeof field[key] !== 'number' || !Number.isFinite(field[key]))) fail(where, `invalid slider ${key}`);
    if (field.step !== undefined && field.step <= 0 || field.min !== undefined && field.max !== undefined && field.min >= field.max) fail(where, 'slider range/step is invalid');
    if (field.min !== undefined && field.value < field.min || field.max !== undefined && field.value > field.max) fail(where, 'value is outside the configured slider range');
  }
}
function settings(config, at, partial = false) {
  object(config, at);
  if (Object.hasOwn(config, 'plugins')) {
    if (!Array.isArray(config.plugins) || config.plugins.length) fail(at, 'plugin composition is no longer configurable; review and migrate non-empty plugins before removing the field');
    delete config.plugins;
  }
  // Old empty maps contain no prose to migrate. Never silently drop authored text.
  if (Object.hasOwn(config, 'teaching')) {
    if (Object.keys(object(config.teaching, `${at}.teaching`)).length) fail(at, 'tool teaching moved to Promptbook; migrate non-empty teaching before removing it');
    delete config.teaching;
  }
  keys(config, fields, at);
  if (!partial || 'persona' in config) prompt(config.persona, `${at}.persona`);
  if (!partial || 'tools' in config) for (const name of names(config.tools, `${at}.tools`)) {
    if (forbiddenTools.has(name)) fail(at, `delegation tool ${name} is managed by Subagentbook`);
    if (!TASK_TOOL_NAMES.includes(name)) fail(at, `unsupported task tool ${name}; extend the fixed tool mapping first`);
  }
  if ('delegates' in config) names(config.delegates, `${at}.delegates`);
  if ('maxNestedDepth' in config) depth(config.maxNestedDepth, `${at}.maxNestedDepth`);
  if ('actionScope' in config && !['inherit', 'read-only', 'verification-copy'].includes(config.actionScope)) fail(at, 'actionScope must be inherit, read-only or verification-copy; roles cannot grant additional access');
  if ('toolPreference' in config && !['free', 'bash'].includes(config.toolPreference)) fail(at, 'toolPreference must be free or bash');
  if ('preferencePrompt' in config) prompt(config.preferencePrompt, `${at}.preferencePrompt`);
  if ('agentOptions' in config) {
    keys(config.agentOptions, ['maxTokens', 'reasoningEffort', 'requestFields'], `${at}.agentOptions`);
    if ('maxTokens' in config.agentOptions && depth(config.agentOptions.maxTokens) === 0) fail(at, 'maxTokens must be positive');
    if ('reasoningEffort' in config.agentOptions) text(config.agentOptions.reasoningEffort, `${at}.reasoningEffort`);
    if ('requestFields' in config.agentOptions) requestFields(config.agentOptions.requestFields, `${at}.requestFields`);
  }
}

export function parseBook(input) {
  const book = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  json(book, 'book');
  keys(book, ['version', 'entryPresets', 'presets'], 'book');
  if (book.version !== 1) fail('book', 'unsupported version');
  names(book.entryPresets, 'book.entryPresets');
  if (!Array.isArray(book.presets)) fail('book.presets', 'expected an array');
  const ids = new Set();
  for (const preset of book.presets) {
    keys(preset, ['id', 'name', 'description', 'defaults', 'models'], 'preset');
    text(preset.id, 'preset.id'); text(preset.name, `${preset.id}.name`);
    if (ids.has(preset.id)) fail(preset.id, 'duplicate preset');
    ids.add(preset.id);
    if (preset.description !== undefined && typeof preset.description !== 'string') fail(preset.id, 'description must be a string');
    settings(preset.defaults, `${preset.id}.defaults`, true);
    if (!Array.isArray(preset.models) || !preset.models.length) fail(preset.id, 'at least one exact model route is required');
    const routes = new Set();
    for (const route of preset.models) {
      keys(route, ['provider', 'model', 'overrides'], `${preset.id}.models`);
      text(route.provider, 'provider'); text(route.model, 'model');
      const key = canonical([route.provider, route.model]);
      if (routes.has(key)) fail(preset.id, 'duplicate model route');
      routes.add(key);
      settings(route.overrides ?? {}, `${preset.id}/${route.provider}/${route.model}.overrides`, true);
      const merged = { delegates: [], toolPreference: 'free', actionScope: 'inherit', ...preset.defaults, ...route.overrides };
      settings(merged, `${preset.id}/${route.model}`);
      if (merged.toolPreference === 'bash' && (!merged.tools.includes('bash') || !merged.preferencePrompt)) fail(preset.id, 'bash preference requires Bash and an explicit preference prompt');
    }
  }
  for (const id of book.entryPresets) if (!ids.has(id)) fail('entryPresets', `unknown preset ${id}`);
  for (const preset of book.presets) for (const route of preset.models) {
    for (const id of (route.overrides?.delegates ?? preset.defaults.delegates ?? [])) if (!ids.has(id)) fail(preset.id, `unknown delegate ${id}`);
  }
  return freeze(book);
}

export function validateModelOptions(options, model) {
  if (options.requestFields !== undefined) requestFields(options.requestFields, 'requestFields');
  if (options.requestFields?.length) {
    if (model.requestFieldsVersion !== 1) throw new BookError('REQUEST_FIELDS_UNSUPPORTED', 'Update llm-mimo to use custom request fields');
    const mapping = model.reasoningControls, stop = mapping?.stops?.find(item => item.id === options.reasoningEffort);
    const selectedPath = stop && stop.kind !== 'omit' ? stop.kind === 'off' ? mapping.offParameter : mapping.parameter : undefined;
    for (const field of options.requestFields) {
      if (field.apiFormat !== model.apiFormat) throw new BookError('REQUEST_FIELD_FORMAT', `${field.path} belongs to ${field.apiFormat}, current route uses ${model.apiFormat}`);
      if (selectedPath && (field.path === selectedPath || field.path.startsWith(`${selectedPath}.`) || selectedPath.startsWith(`${field.path}.`))) throw new BookError('REQUEST_FIELD_CONFLICT', `${field.path} conflicts with the selected reasoning level; use model default or another field`);
    }
  }
  const budget = model.budget ?? {};
  const contextWindow = budget.contextWindow ?? model.context?.contextWindow ?? model.contextWindow;
  const maxOutputTokens = budget.maxOutputTokens ?? model.maxOutputTokens;
  for (const [name, value] of Object.entries({ contextWindow, maxOutputTokens, defaultMaxTokens: budget.defaultMaxTokens ?? model.defaultMaxTokens })) {
    if (value !== undefined && value !== null && (!Number.isSafeInteger(value) || value <= 0)) throw new BookError('INVALID_MODEL_CAPABILITY', `${model.provider}/${model.id}: invalid advertised ${name}`);
  }
  if (options.maxTokens !== undefined) {
    if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens <= 0) throw new BookError('INVALID_BUDGET', 'Output budget must be a positive safe integer');
    for (const [kind, limit] of [['context', contextWindow], ['output', maxOutputTokens]]) {
      if (Number.isSafeInteger(limit) && limit > 0 && options.maxTokens > limit) throw new BookError('MODEL_BUDGET_EXCEEDED', `${model.provider}/${model.id}: output budget ${options.maxTokens} exceeds declared ${kind} capacity ${limit}`);
    }
  }
  if (options.reasoningEffort !== undefined && (!Array.isArray(model.reasoning?.efforts) || !model.reasoning.efforts.some(effort => effort.id === options.reasoningEffort))) throw new BookError('UNSUPPORTED_EFFORT', `${model.provider}/${model.id}: reasoning effort ${options.reasoningEffort} is not advertised for this route/format`);
  return { contextWindow: contextWindow ?? null, maxOutputTokens: maxOutputTokens ?? null,
    defaultMaxTokens: budget.defaultMaxTokens ?? model.defaultMaxTokens ?? null,
    warnings: [ ...(!Number.isSafeInteger(contextWindow) ? ['Context capacity is not disclosed'] : []), ...(!Number.isSafeInteger(maxOutputTokens) ? ['A hard output ceiling is not disclosed; the default budget is not a hard ceiling'] : []) ],
  };
}

export function resolvePreset(book, presetId, provider, model, { models, resolveText, resolveToolText } = {}) {
  const preset = book.presets.find(row => row.id === presetId);
  if (!preset) throw new BookError('UNKNOWN_PRESET', `Unknown preset ${presetId}`);
  const route = preset.models.find(row => row.provider === provider && row.model === model);
  if (!route) throw new BookError('UNKNOWN_ROUTE', `No ${presetId} configuration for ${provider}/${model}`);
  const modelInfo = Array.isArray(models) && models.find(row => row.provider === provider && row.id === model);
  if (!modelInfo) throw new BookError('UNHOSTED_MODEL', `Model directory does not contain ${provider}/${model}`);
  const config = { delegates: [], toolPreference: 'free', actionScope: 'inherit', agentOptions: {}, ...preset.defaults, ...route.overrides };
  const resolve = ref => {
    const value = 'text' in ref ? ref.text : resolveText?.(ref.key, model, provider);
    if (typeof value !== 'string') throw new BookError('MISSING_PROMPT', `Missing prompt ${ref.key} for ${provider}/${model}`);
    return value;
  };
  const persona = resolve(config.persona);
  if (!persona.trim()) throw new BookError('EMPTY_PERSONA', `Empty persona for ${presetId}`);
  const agentOptions = { ...config.agentOptions };
  const defaultBudget = modelInfo.budget?.defaultMaxTokens ?? modelInfo.defaultMaxTokens;
  if (agentOptions.maxTokens === undefined && Number.isSafeInteger(defaultBudget) && defaultBudget > 0) agentOptions.maxTokens = defaultBudget;
  const capabilityCheck = validateModelOptions(agentOptions, modelInfo);
  const toolText = resolveTeaching(config.tools, model, provider, resolveToolText);
  const compiled = {
    presetId, name: preset.name, description: preset.description ?? '', provider, model,
    persona, preference: config.toolPreference === 'bash' ? resolve(config.preferencePrompt) : '',
    teaching: toolText.teaching,
    tools: config.tools, plugins: fixedToolPlugins(config.tools), delegates: config.delegates,
    maxNestedDepth: config.maxNestedDepth ?? null, agentOptions, capabilityCheck,
    actionScope: config.actionScope,
    sources: { persona: config.persona, preference: config.preferencePrompt ?? null, teaching: toolText.sources },
  };
  return freeze(structuredClone(compiled));
}

export function admitChild(parent, hostLimit, localLimit = null) {
  depth(parent.depth); depth(hostLimit, 'DSH maxDepth');
  if (parent.ceiling !== null) depth(parent.ceiling, 'ancestor ceiling');
  if (localLimit !== null) depth(localLimit, 'maxNestedDepth');
  if (parent.depth === Number.MAX_SAFE_INTEGER) throw new BookError('DEPTH_LIMIT', 'Delegation depth overflow');
  const next = parent.depth + 1;
  if (next > Math.min(hostLimit, parent.ceiling ?? Infinity)) throw new BookError('DEPTH_LIMIT', 'Delegation exceeds the inherited depth limit');
  if (localLimit !== null && next > Number.MAX_SAFE_INTEGER - localLimit) throw new BookError('INVALID_BOOK', 'Branch ceiling overflow');
  return freeze({ depth: next, ceiling: localLimit === null ? parent.ceiling : Math.min(parent.ceiling ?? Infinity, next + localLimit) });
}

export const EMPTY_BOOK = freeze({ version: 1, entryPresets: [], presets: [] });

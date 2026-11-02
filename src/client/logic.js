// Promptbook mirror contract, adapted from dsh-promptbook/src/client/logic.js (MIT).
const safeParse = raw => { try { return typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return undefined; } };
// The baseline ConfigForm intentionally returns a boolean. Keep the public
// settings endpoint and shared mirror, but retain the refusal for this editor.
function settingsWriter(ctx, scope) {
  return {
    getSnapshot: () => scope.getSnapshot(),
    subscribe: listener => scope.subscribe(listener),
    async mutate(ops, expectedRevision) {
      if (!scope.getSnapshot().writable) throw Object.assign(new Error('Configuration is read-only'), { code: 'settings/readonly' });
      const response = await ctx.remote.settings.mutate('subagentbook', structuredClone(ops), expectedRevision);
      if (response.ok) { ctx.configForms.describe().acceptView(response.value); return true; }
      // Recover the current view without rebasing the user's stale draft fence.
      try {
        const latest = await ctx.remote.settings.describe();
        const view = latest.ok && latest.value.namespaces.find(row => row.ns === 'subagentbook');
        if (view) ctx.configForms.describe().acceptView(view);
      } catch { /* The original refusal remains the actionable error. */ }
      throw Object.assign(new Error(response.error.message), { code: response.error.code });
    },
  };
}
function hostedModels(snapshot) {
  if (snapshot?.status !== 'ready') return [];
  const value = snapshot.value ?? {};
  const advertised = safeParse(value.modelControlsViewJson);
  if (Array.isArray(advertised) && advertised.length) return advertised.filter(row => typeof row?.provider === 'string' && typeof row?.id === 'string').map(row => ({ ...row, name: row.name || row.id, providerName: row.provider }));
  return [{ provider: 'mimo', ...value }, ...Object.entries(value?.customProviders ?? {}).map(([provider, entry]) => ({ ...entry, provider }))]
    .flatMap(entry => {
      const models = safeParse(entry.modelsJson);
      return Array.isArray(models) ? models.filter(m => typeof m?.id === 'string').map(m => ({ provider: entry.provider, id: m.id, name: m.name || m.id, providerName: entry.displayName || entry.provider })) : [];
    });
}
function resolvePrompt(key, model, provider, docs) {
  const registry = safeParse(docs?.registryJson) ?? {};
  if (typeof registry[key]?.fallback !== 'string') return undefined;
  return resolveToolPrompt(key, model, provider, docs) ?? registry[key].fallback;
}
function resolveToolPrompt(key, model, provider, docs) {
  const registry = safeParse(docs?.registryJson) ?? {};
  if (typeof registry[key]?.fallback !== 'string') return undefined;
  const gui = safeParse(docs?.entriesJson) ?? {};
  const layers = safeParse(docs?.layersJson) ?? {};
  const deletions = safeParse(docs?.packOpsJson)?.deletions ?? [];
  const chain = [...new Set([model, provider, 'default'].filter(Boolean))];
  for (const id of chain) {
    if (gui[key]?.[id] !== undefined) return gui[key][id];
    if (layers.__overrides__?.[key]?.[id] !== undefined) return layers.__overrides__[key][id];
  }
  for (const id of chain) {
    if (id === 'default') break;
    if (Array.isArray(deletions) && deletions.some(row => row?.key === key && row.candidate === id)) continue;
    if (layers[id]?.[key] !== undefined) return layers[id][key];
  }
  return undefined;
}
const FIELD_DEFAULTS = { delegates: [], toolPreference: 'free', actionScope: 'inherit', agentOptions: {} };
const FIELD_NAMES = ['persona', 'tools', 'toolPreference', 'preferencePrompt', 'actionScope', 'delegates', 'maxNestedDepth', 'agentOptions'];
const listFields = new Set(['tools', 'delegates']);
const promptFields = new Set(['persona', 'preferencePrompt']);
function fieldString(field, value) {
  if (value === undefined || value === null) return '';
  if (listFields.has(field)) return value.join(', ');
  if (field === 'toolPreference' || field === 'actionScope' || field === 'maxNestedDepth') return String(value);
  return JSON.stringify(value, null, 2);
}
function tagChoices(field, book) {
  if (!listFields.has(field)) throw new Error(`Unknown tag field ${field}`);
  return field === 'tools' ? TASK_TOOL_NAMES : book.presets.map(preset => preset.id);
}
function fieldParse(field, raw, book) {
  if (listFields.has(field)) {
    const names = raw.split(/[\s,]+/).filter(Boolean);
    const unknown = names.filter(name => !tagChoices(field, book).includes(name));
    if (unknown.length) throw new Error(`${field === 'tools' ? 'Unsupported tools' : 'Unknown roles'}: ${[...new Set(unknown)].join(', ')}`);
    if (new Set(names).size !== names.length) throw new Error(`Duplicate ${field === 'tools' ? 'tool' : 'role'} name`);
    return names;
  }
  if (field === 'toolPreference' || field === 'actionScope') return raw;
  if (field === 'maxNestedDepth') { if (!raw.trim()) return undefined; const value = Number(raw); depth(value); return value; }
  return JSON.parse(raw);
}
function createEditor(scope, mimoScope, promptScope) {
  const listeners = new Set();
  let draft, baseline, fence, busy = false, error = '', errorCode = '', saveFailed = false, version = 0;
  let presetId = '', routeIndex = -1;
  const rawFields = {}, fieldErrors = {}, tagInputs = {};
  let state;
  const stored = () => parseBook(scope.getSnapshot().value?.bookJson ?? EMPTY_BOOK);
  const hasChanges = () => Boolean(draft && canonical(draft) !== canonical(baseline))
    || Object.keys(fieldErrors).length > 0 || Object.values(tagInputs).some(input => input.text.trim());
  function projection() {
    let book;
    try { book = draft ?? stored(); } catch (e) { book = EMPTY_BOOK; error = e.message; }
    if (!book.presets.some(p => p.id === presetId)) { presetId = book.presets[0]?.id ?? ''; routeIndex = -1; }
    const preset = book.presets.find(p => p.id === presetId);
    if (routeIndex >= (preset?.models.length ?? 0)) routeIndex = -1;
    const route = routeIndex >= 0 ? preset?.models[routeIndex] : undefined;
    const selectionKey = canonical([presetId, route?.provider ?? '', route?.model ?? '']);
    const effective = preset ? { ...FIELD_DEFAULTS, ...preset.defaults, ...route?.overrides } : {};
    const modelRows = hostedModels(mimoScope.getSnapshot());
    const previewRoute = route ?? preset?.models[0];
    const errors = { ...fieldErrors };
    for (const [key, input] of Object.entries(tagInputs)) if (input.text.trim()) {
      const tools = key.endsWith('\u0000tools');
      errors[key] = input.issue?.kind === 'unknown' ? `${tools ? 'Unsupported tools' : 'Unknown roles'}: ${input.issue.names.join(', ')}`
        : input.issue?.kind === 'duplicate' ? `Duplicate ${tools ? 'tools' : 'roles'}: ${input.issue.names.join(', ')}`
          : `Confirm ${tools ? 'tool names' : 'role IDs'} with Enter or clear the input before saving`;
    }
    for (const candidate of book.presets) for (const route of [null, ...candidate.models]) {
      const value = (route ? route.overrides : candidate.defaults)?.delegates;
      const missing = Array.isArray(value) ? value.filter(id => !book.presets.some(preset => preset.id === id)) : [];
      if (missing.length) errors[`${canonical([candidate.id, route?.provider ?? '', route?.model ?? ''])}\u0000delegates`] = `Unknown roles: ${missing.join(', ')}`;
    }
    const missingDelegates = Array.isArray(effective.delegates) ? effective.delegates.filter(id => !book.presets.some(preset => preset.id === id)) : [];
    if (missingDelegates.length) errors[`${selectionKey}\u0000delegates`] = `Unknown roles: ${missingDelegates.join(', ')}`;
    let schemaError = '';
    try { parseBook(book); } catch (e) { schemaError = e.message; }
    const capabilityErrors = schemaError ? {} : optionIssues(book, modelRows);
    Object.assign(errors, capabilityErrors);
    const dirty = hasChanges();
    const canSave = dirty && scope.getSnapshot().writable && !busy && !schemaError && Object.keys(errors).length === 0;
    const originalPreset = (baseline ?? book).presets.find(p => p.id === presetId);
    const originalRoute = route ? originalPreset?.models.find(m => m.provider === route.provider && m.model === route.model) : undefined;
    const local = route ? route.overrides ?? {} : preset?.defaults ?? {};
    const originalLocal = route ? originalRoute?.overrides ?? {} : originalPreset?.defaults ?? {};
    const originalEffective = { ...FIELD_DEFAULTS, ...originalPreset?.defaults, ...originalRoute?.overrides };
    const rowStates = {};
    for (const field of FIELD_NAMES) {
      const key = `${selectionKey}\u0000${field}`;
      const input = tagInputs[key];
      const pending = Boolean(input?.text.trim());
      const localChanged = Object.hasOwn(local, field) !== Object.hasOwn(originalLocal, field) || canonical(local[field]) !== canonical(originalLocal[field]);
      const changed = localChanged || canonical(effective[field]) !== canonical(originalEffective[field]);
      const invalid = Boolean(fieldErrors[key] || capabilityErrors[key] || field === 'delegates' && missingDelegates.length) || ['unknown', 'duplicate'].includes(input?.issue?.kind) || Boolean(schemaError && changed);
      const modified = changed || pending || Boolean(fieldErrors[key]);
      const status = busy && modified ? 'saving' : invalid ? 'invalid' : saveFailed && modified ? 'failed' : pending ? 'pending' : changed ? 'changed'
        : Object.hasOwn(local, field) ? 'saved' : route && Object.hasOwn(preset?.defaults ?? {}, field) ? 'inherited' : 'default';
      rowStates[field] = { status, changed, canSave: canSave && changed, canUndo: localChanged || pending || Boolean(fieldErrors[key]) };
    }
    let preview, previewError;
    try {
      // Pending tag input blocks saving, but the preview still describes only
      // confirmed lists. Do not blank unrelated Persona text while typing.
      if (Object.keys(fieldErrors).length) throw new Error('Correct the invalid fields to preview this draft');
      if (preset && promptScope.getSnapshot().status !== 'ready') throw new Error('Subagentbook requires the host Promptbook service');
      if (preset && previewRoute) preview = resolvePreset(parseBook(book), preset.id, previewRoute.provider, previewRoute.model, {
        models: modelRows, resolveText: (key, model, provider) => resolvePrompt(key, model, provider, promptScope.getSnapshot().value),
        resolveToolText: (key, model, provider) => resolveToolPrompt(key, model, provider, promptScope.getSnapshot().value),
      });
    } catch (e) { previewError = e.message; }
    return { book, preset, route, routeIndex, selectionKey, effective, modelRows, preview, previewError,
      optionControls: optionControls({ preset, route, modelRows }),
      otherOptionErrors: Object.entries(capabilityErrors).filter(([key]) => key !== `${selectionKey}\u0000agentOptions`).map(([, message]) => message).join('\n'),
      writable: scope.getSnapshot().writable, status: scope.getSnapshot().status,
      dirty, canSave, rowStates, schemaError, busy, error, errorCode, rawFields: { ...rawFields }, fieldErrors: errors, tagInputs: structuredClone(tagInputs), version,
      promptKeys: Object.keys(safeParse(promptScope.getSnapshot().value?.registryJson) ?? {}).filter(key => !key.startsWith('$')),
    };
  }
  const emit = () => {
    for (const preset of draft?.presets ?? []) for (const route of preset.models) {
      const original = baseline.presets.find(p => p.id === preset.id)?.models.find(m => m.provider === route.provider && m.model === route.model);
      if (route.overrides && Object.keys(route.overrides).length === 0 && original?.overrides === undefined) delete route.overrides;
    }
    // Undoing the final change releases its stale fence and returns to the live
    // persisted definition. Merely having opened a draft is not an edit.
    if (draft && !busy && !hasChanges()) clearDraft();
    state = projection(); for (const listener of listeners) listener();
  };
  const begin = () => {
    if (busy || !scope.getSnapshot().writable) throw new Error('The editor is not writable');
    if (!draft) { baseline = stored(); draft = structuredClone(baseline); fence = scope.getSnapshot().revision; }
    error = ''; errorCode = ''; saveFailed = false; version++;
  };
  const target = () => {
    const preset = draft.presets.find(p => p.id === presetId);
    return routeIndex < 0 ? preset.defaults : (preset.models[routeIndex].overrides ??= {});
  };
  const fieldKey = field => `${state.selectionKey}\u0000${field}`;
  const removeFields = matches => {
    for (const object of [rawFields, fieldErrors, tagInputs]) for (const key of Object.keys(object)) if (matches(JSON.parse(key.split('\u0000')[0]))) delete object[key];
  };
  function clearDraft() { draft = baseline = fence = undefined; saveFailed = false; for (const object of [rawFields, fieldErrors, tagInputs]) for (const key of Object.keys(object)) delete object[key]; version++; }
  const api = {
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => state,
    select(id, index = -1) { presetId = id; routeIndex = index; emit(); },
    edit(field, raw) {
      try {
        if (!FIELD_NAMES.includes(field)) throw new Error(`Unknown editable field ${field}`);
        begin(); const key = fieldKey(field); rawFields[key] = raw;
        if (listFields.has(field)) delete tagInputs[key];
        try { const value = fieldParse(field, raw, state.book); if (value === undefined) delete target()[field]; else target()[field] = value; delete fieldErrors[key]; }
        catch (e) { fieldErrors[key] = e.message; }
      } catch (e) { error = e.message; }
      emit();
    },
    option(name, value) {
      if (!['maxTokens', 'reasoningEffort'].includes(name)) return;
      const options = { ...state.effective.agentOptions };
      if (value === undefined) delete options[name]; else options[name] = value;
      api.edit('agentOptions', JSON.stringify(options));
    },
    requestField(index, patch) {
      const options = { ...state.effective.agentOptions }, fields = structuredClone(options.requestFields ?? []);
      if (index < 0) fields.push({ path: '', apiFormat: state.optionControls.apiFormat, type: 'number', value: 0 });
      else if (patch === null) fields.splice(index, 1);
      else if (fields[index]) fields[index] = { ...fields[index], ...patch };
      options.requestFields = fields;
      api.edit('agentOptions', JSON.stringify(options));
    },
    tagInput(field, text) {
      try { tagChoices(field, state.book); begin(); tagInputs[fieldKey(field)] = { text }; } catch (e) { error = e.message; }
      emit();
    },
    blurTagInput(field) {
      const input = tagInputs[fieldKey(field)];
      if (input?.text.trim() && !input.issue) { input.issue = { kind: 'pending' }; emit(); }
    },
    confirmTags(field) {
      const key = fieldKey(field), input = tagInputs[key];
      const names = (input?.text ?? '').split(/[\s,]+/).filter(Boolean);
      if (!names.length) return false;
      let accepted = false;
      try {
        begin();
        const choices = tagChoices(field, state.book);
        const unknown = [...new Set(names.filter(name => !choices.includes(name)))];
        const existing = state.effective[field] ?? [];
        const duplicate = [...new Set(names.filter((name, i) => existing.includes(name) || names.indexOf(name) !== i))];
        if (unknown.length || duplicate.length) input.issue = { kind: unknown.length ? 'unknown' : 'duplicate', names: unknown.length ? unknown : duplicate };
        else {
          const value = [...existing, ...names]; target()[field] = value; rawFields[key] = value.join(', ');
          delete tagInputs[key]; delete fieldErrors[key]; accepted = true;
        }
      } catch (e) { error = e.message; }
      emit(); return accepted;
    },
    removeTag(field, name) {
      try {
        tagChoices(field, state.book); begin(); const key = fieldKey(field);
        const value = (state.effective[field] ?? []).filter(item => item !== name);
        target()[field] = value; rawFields[key] = value.join(', '); delete fieldErrors[key];
      } catch (e) { error = e.message; }
      emit();
    },
    inherit(field) { try { begin(); delete target()[field]; delete rawFields[fieldKey(field)]; delete fieldErrors[fieldKey(field)]; delete tagInputs[fieldKey(field)]; } catch (e) { error = e.message; } emit(); },
    undo(field) {
      try {
        begin(); const original = baseline.presets.find(p => p.id === presetId);
        const source = routeIndex < 0 ? original?.defaults : original?.models.find(m => m.provider === state.route.provider && m.model === state.route.model)?.overrides;
        if (source && Object.hasOwn(source, field)) target()[field] = structuredClone(source[field]); else delete target()[field];
        delete rawFields[fieldKey(field)]; delete fieldErrors[fieldKey(field)]; delete tagInputs[fieldKey(field)];
      } catch (e) { error = e.message; } emit();
    },
    metadata(name, description, entry) {
      try { begin(); const p = draft.presets.find(p => p.id === presetId); p.name = name; p.description = description;
        draft.entryPresets = draft.entryPresets.filter(id => id !== presetId); if (entry) draft.entryPresets.push(presetId);
      } catch (e) { error = e.message; } emit();
    },
    addPreset(id, name, provider, model, persona) {
      try {
        begin(); if (!id.trim() || !name.trim() || !persona.trim()) throw new Error('ID, name and Persona are required');
        if (draft.presets.some(p => p.id === id)) throw new Error('Duplicate preset ID');
        if (!hostedModels(mimoScope.getSnapshot()).some(m => m.provider === provider && m.id === model)) throw new Error('Choose an available model');
        draft.presets.push({ id, name, defaults: { persona: { text: persona }, tools: [] }, models: [{ provider, model }] });
        draft.entryPresets.push(id); presetId = id; routeIndex = -1;
      } catch (e) { error = e.message; } emit();
    },
    addTeam(provider, model) {
      let entryId;
      try {
        if (!hostedModels(mimoScope.getSnapshot()).some(m => m.provider === provider && m.id === model)) throw new Error('Choose an available model');
        // Build first; an invalid template/route cannot leave half a team behind.
        const addition = addExpertTeam(state.book, provider, model);
        begin(); draft = addition.book; presetId = entryId = addition.entryId; routeIndex = -1;
      } catch (e) { error = e.message; }
      emit(); return entryId;
    },
    addRoute(provider, model) {
      try {
        begin(); const p = draft.presets.find(p => p.id === presetId);
        if (p.models.some(m => m.provider === provider && m.model === model)) throw new Error('This model route already exists');
        if (!hostedModels(mimoScope.getSnapshot()).some(m => m.provider === provider && m.id === model)) throw new Error('Choose an available model');
        p.models.push({ provider, model }); routeIndex = p.models.length - 1;
      } catch (e) { error = e.message; } emit();
    },
    deleteRoute() {
      try { begin(); const removed = draft.presets.find(p => p.id === presetId).models.splice(routeIndex, 1)[0];
        removeFields(([id, provider, model]) => id === presetId && provider === removed.provider && model === removed.model); routeIndex = -1;
      } catch (e) { error = e.message; } emit();
    },
    deletePreset() {
      try { begin(); draft.presets = draft.presets.filter(p => p.id !== presetId); draft.entryPresets = draft.entryPresets.filter(id => id !== presetId); removeFields(([id]) => id === presetId); }
      catch (e) { error = e.message; } emit();
    },
    discard() { if (!busy) { clearDraft(); error = ''; errorCode = ''; emit(); } },
    async save() {
      if (busy || !state.dirty || !draft || !scope.getSnapshot().writable) return false;
      try {
        if (Object.keys(state.fieldErrors).length) throw new Error('Correct the invalid fields before saving');
        const candidate = parseBook(draft); busy = true; error = ''; errorCode = ''; saveFailed = false; emit();
        const accepted = await scope.mutate([{ op: 'set', path: ['bookJson'], value: JSON.stringify(candidate) }], fence);
        if (!accepted) throw new Error('Configuration changed or the write was refused. Drafts are retained.');
        clearDraft(); return true;
      } catch (e) { error = e.message; errorCode = e.code ?? ''; saveFailed = true; return false; }
      finally { busy = false; emit(); }
    },
    dispose() { for (const off of subscriptions) off(); listeners.clear(); },
  };
  const subscriptions = [scope, mimoScope, promptScope].map(scope => scope.subscribe(emit));
  emit(); return api;
}

// The adapter owns API paths, stop IDs and model limits. The book only selects
// values; common settings must never borrow the first model's vocabulary.
function optionModels(s) {
  const routes = s.route ? [s.route] : (s.preset?.models ?? []).filter(route => !Object.hasOwn(route.overrides ?? {}, 'agentOptions'));
  return routes.map(route => ({ route, model: s.modelRows.find(model => model.provider === route.provider && model.id === route.model) }));
}
function optionControls(s) {
  const routes = optionModels(s), models = routes.map(row => row.model).filter(Boolean);
  const complete = routes.length > 0 && models.length === routes.length;
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const limits = models.flatMap(model => [model.budget?.contextWindow ?? model.context?.contextWindow ?? model.contextWindow,
    model.budget?.maxOutputTokens ?? model.maxOutputTokens].filter(positive));
  const defaults = models.map(model => model.budget?.defaultMaxTokens ?? model.defaultMaxTokens);
  const defaultBudget = complete && defaults.every(value => positive(value) && value === defaults[0]) ? defaults[0] : undefined;
  // A bound is usable for a common slider only when every affected route has
  // at least one known bound. Manual input remains available when undisclosed.
  const bounded = complete && models.every(model => [model.budget?.contextWindow ?? model.context?.contextWindow ?? model.contextWindow,
    model.budget?.maxOutputTokens ?? model.maxOutputTokens].some(positive));
  const efforts = complete ? (models[0].reasoning?.efforts ?? []).filter(effort => models.every(model => model.reasoning?.efforts?.some(item => item.id === effort.id)))
    .map(effort => ({ id: effort.id, name: models.every(model => model.reasoning.efforts.find(item => item.id === effort.id).name === effort.name) ? effort.name || effort.id : effort.id })) : [];
  const defaultEffort = complete && models.every(model => model.reasoning?.defaultEffort === models[0].reasoning?.defaultEffort) ? models[0].reasoning?.defaultEffort : undefined;
  const apiFormat = complete && models.every(model => model.apiFormat === models[0].apiFormat) ? models[0].apiFormat : undefined;
  return { routes, models, complete, apiFormat, requestFieldsSupported: complete && models.every(model => model.requestFieldsVersion === 1), limit: bounded ? Math.min(...limits) : undefined, defaultBudget, defaultEffort, efforts,
    outputUndisclosed: models.some(model => !positive(model.budget?.maxOutputTokens ?? model.maxOutputTokens)) };
}
function optionIssues(book, models) {
  const issues = {};
  for (const preset of book.presets) for (const route of preset.models) {
    const options = route.overrides?.agentOptions ?? preset.defaults.agentOptions ?? {};
    if (!Object.keys(options).length) continue;
    const key = `${canonical([preset.id, ...(Object.hasOwn(route.overrides ?? {}, 'agentOptions') ? [route.provider, route.model] : ['', ''])])}\u0000agentOptions`;
    try {
      const model = models.find(item => item.provider === route.provider && item.id === route.model);
      if (!model) throw new Error('Model route is unavailable');
      validateModelOptions(options, model);
    } catch (error) { issues[key] = [issues[key], `${route.provider} / ${route.model}: ${error.message}`].filter(Boolean).join('\n'); }
  }
  return issues;
}
function optionSummary(s, t) {
  const options = s.effective.agentOptions ?? {}, controls = s.optionControls;
  return [options.maxTokens === undefined ? '' : `${options.maxTokens} token`, options.reasoningEffort === undefined ? '' :
    controls.efforts.find(effort => effort.id === options.reasoningEffort)?.name ?? t('unavailableEffort'),
    options.requestFields?.length ? `${options.requestFields.length} ${t('extraFields')}` : ''].filter(Boolean).join(' · ') || t('modelDefaults');
}
function optionMapping(controls, effort, t) {
  if (!effort) return t('reasoningDefaultHint');
  const descriptions = controls.models.map(model => {
    const mapping = model.reasoningControls, stop = mapping?.stops?.find(item => item.id === effort);
    if (!stop) return '';
    if (stop.kind === 'omit') return t('reasoningDefaultHint');
    return `${stop.kind === 'off' ? mapping.offParameter : mapping.parameter} = ${stop.value}`;
  });
  return descriptions.length && descriptions.every(text => text && text === descriptions[0]) ? descriptions[0] : t('modelMappingHint');
}
function customOptionFields({ s, editor, t, disabled, dropdown, optionEditing, setOptionEditing }) {
  const controls = s.optionControls, fields = s.effective.agentOptions?.requestFields ?? [];
  const numeric = (text, empty) => text === '' ? empty : Number.isFinite(Number(text)) ? Number(text) : text;
  const input = (label, value, change, options = {}) => h('input', { className: 'sb-input', 'aria-label': label, title: label, value: value ?? '', disabled,
    onChange: event => change(event.target.value), ...options });
  return h('div', { className: 'sb-custom-options' },
    h('div', { className: 'sb-custom-head' }, h('span', { className: 'sb-option-label' }, t('extraFields')),
      h('button', { type: 'button', className: 'sb-button sb-custom-add', 'aria-label': t('addField'), title: controls.apiFormat && controls.requestFieldsSupported ? t('addField') : t('selectFieldModel'),
        disabled: disabled || !controls.apiFormat || !controls.requestFieldsSupported, onClick: () => { setOptionEditing(fields.length); editor.requestField(-1); } }, '+')),
    ...fields.map((field, index) => {
      const update = patch => editor.requestField(index, patch);
      const label = field.name || field.path || t('newField');
      const open = optionEditing === index;
      const range = field.type === 'number' && Number.isFinite(field.min) && Number.isFinite(field.max) && field.min < field.max;
      return h('div', { key: index, className: 'sb-custom-field' },
        h('div', { className: 'sb-custom-line' }, h('button', { type: 'button', className: 'sb-button sb-custom-name', title: field.path || t('fieldPath'), onClick: () => setOptionEditing(open ? -1 : index), 'aria-label': `${t('editField')} ${index + 1}`, 'aria-expanded': open, disabled }, label),
          field.type === 'boolean' ? dropdown(`custom-value-${index}`, `${t('fieldValue')} ${index + 1}`, String(field.value), [{ id: 'true', label: 'true' }, { id: 'false', label: 'false' }], value => update({ value: value === 'true' })) :
            input(`${t('fieldValue')} ${index + 1}`, field.value, value => update({ value: field.type === 'number' ? numeric(value, '') : value }), { inputMode: field.type === 'number' ? 'decimal' : 'text', className: 'sb-input sb-custom-value' }),
          h('button', { type: 'button', className: 'sb-tool-remove', 'aria-label': `${t('removeField')} ${index + 1}`, title: t('removeField'), disabled, onClick: () => { editor.requestField(index, null); setOptionEditing(-1); } }, '×')),
        range ? h('input', { className: 'sb-range sb-custom-range', type: 'range', min: field.min, max: field.max, step: field.step ?? 'any', value: typeof field.value === 'number' ? field.value : field.min,
          disabled, 'aria-label': `${t('fieldSlider')} ${index + 1}`, onChange: event => update({ value: Number(event.target.value) }) }) : null,
        open ? h('div', { className: 'sb-field-settings' },
          input(`${t('fieldName')} ${index + 1}`, field.name, name => update({ name }), { placeholder: t('fieldName') }),
          input(`${t('fieldPath')} ${index + 1}`, field.path, path => update({ path }), { placeholder: 'thinking.budget_tokens', spellCheck: false }),
          dropdown(`custom-format-${index}`, `${t('fieldFormat')} ${index + 1}`, field.apiFormat, ['chat', 'anthropic', 'responses'].map(id => ({ id, label: id })), apiFormat => update({ apiFormat })),
          dropdown(`custom-type-${index}`, `${t('fieldType')} ${index + 1}`, field.type, ['number', 'string', 'boolean'].map(id => ({ id, label: t(`type_${id}`) })), type => update({ type, value: type === 'number' ? 0 : type === 'boolean' ? false : '', min: undefined, max: undefined, step: undefined })),
          field.type === 'number' ? h('div', { className: 'sb-field-range', title: t('fieldRangeHint') }, ...['min', 'max', 'step'].map(key => input(`${t(`field_${key}`)} ${index + 1}`, field[key], value => update({ [key]: numeric(value, undefined) }), { key, placeholder: t(`field_${key}`), inputMode: 'decimal' }))) : null) : null);
    }));
}
function optionFields(props) {
  const { s, editor, t, disabled, dropdown } = props;
  const controls = s.optionControls, options = s.effective.agentOptions ?? {};
  const selected = options.reasoningEffort === controls.defaultEffort ? '' : options.reasoningEffort ?? '';
  const stops = [{ id: '', name: t('modelDefaults') }, ...controls.efforts.filter(effort => effort.id !== controls.defaultEffort)];
  const index = stops.findIndex(stop => stop.id === selected);
  const budgetValid = options.maxTokens === undefined || Number.isSafeInteger(options.maxTokens) && options.maxTokens > 0 && (!controls.limit || options.maxTokens <= controls.limit);
  const budget = Number.isSafeInteger(options.maxTokens) ? options.maxTokens : controls.defaultBudget ?? 0;
  const setBudget = text => editor.option('maxTokens', text === '' ? undefined : /^\d+$/.test(text) ? Number(text) : text);
  const choices = [...(index < 0 ? [{ id: selected, label: t('unavailableEffort') }] : []), ...stops.map(stop => ({ id: stop.id, label: stop.name }))];
  return h('div', { className: 'sb-options' },
    h('div', { className: 'sb-option' }, h('span', { className: 'sb-option-label', title: t('outputHint') }, t('outputBudget')),
      h('div', { className: 'sb-option-controls' },
        h('input', { className: 'sb-budget-number sb-input', type: 'text', inputMode: 'numeric', 'aria-label': t('outputBudget'),
          'aria-invalid': !budgetValid, value: options.maxTokens ?? '', placeholder: String(controls.defaultBudget ?? t('modelDefaults')),
          disabled, onChange: event => setBudget(event.target.value), title: t('outputHint') }),
        h('span', { className: 'sb-note' }, 'token'),
        h('button', { type: 'button', className: 'sb-button sb-option-default', disabled: disabled || options.maxTokens === undefined,
          onClick: () => editor.option('maxTokens', undefined), title: t('budgetDefaultHint') }, t('modelDefaults'))),
      h('input', { className: 'sb-range', type: 'range', min: 0, max: controls.limit ?? 1, step: 1,
        value: Math.min(controls.limit ?? 1, Math.max(0, budget)), 'aria-label': t('outputSlider'),
        'aria-valuetext': options.maxTokens === undefined ? `${t('modelDefaults')}${controls.defaultBudget ? ` · ${controls.defaultBudget} token` : ''}` : `${options.maxTokens} token`,
        disabled: disabled || !controls.limit, onChange: event => editor.option('maxTokens', Number(event.target.value) || undefined),
        title: controls.limit ? `${t('knownLimit')} ${controls.limit} token${controls.outputUndisclosed ? ` · ${t('outputUndisclosed')}` : ''}` : t('unknownLimit') })),
    h('div', { className: 'sb-option' }, h('span', { className: 'sb-option-label', title: t('reasoningHint') }, t('reasoning')),
      h('div', { className: 'sb-option-controls', title: optionMapping(controls, selected, t) },
        dropdown('option-effort', t('effortName'), selected, choices, value => editor.option('reasoningEffort', value || undefined)),
        h('code', { className: 'sb-option-mapping' }, optionMapping(controls, selected, t))),
      h('div', { className: 'sb-effort-rail' }, h('input', { className: 'sb-range', type: 'range', min: 0, max: Math.max(1, stops.length - 1), step: 1,
        value: Math.max(0, index), 'aria-label': t('reasoningSlider'), 'aria-valuetext': index < 0 ? t('unavailableEffort') : stops[index].name,
        disabled: disabled || stops.length < 2 || index < 0,
        onChange: event => editor.option('reasoningEffort', stops[Number(event.target.value)].id || undefined), title: optionMapping(controls, selected, t) }),
        h('div', { className: 'sb-effort-stops', 'aria-hidden': true }, ...stops.map(stop => h('span', { key: stop.id, title: optionMapping(controls, stop.id, t) }, stop.name))))),
    !controls.complete ? h('p', { className: 'sb-note' }, t(controls.routes.length ? 'missingOptionModels' : 'noOptionModels')) : null,
    controls.complete && controls.models.length > 1 ? h('p', { className: 'sb-note', title: controls.models.map(model => `${model.provider} / ${model.name}`).join('\n') }, t('commonOptionHint')) : null,
    controls.complete && !controls.efforts.length ? h('p', { className: 'sb-note' }, t('noCommonEfforts')) : null,
    customOptionFields(props));
}

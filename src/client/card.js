function SubagentbookCard(props) {
  const { editor, t } = props;
  const s = react.useSyncExternalStore(editor.subscribe, editor.getSnapshot);
  const [expanded, setExpanded] = react.useState('');
  const [optionEditing, setOptionEditing] = react.useState(-1);
  const [pop, setPop] = react.useState(null);
  const [popClosing, setPopClosing] = react.useState(false);
  const closePop = () => setPopClosing(true);
  react.useEffect(() => {
    if (!popClosing) return;
    const timer = window.setTimeout(() => { setPop(null); setPopClosing(false); }, 200);
    return () => window.clearTimeout(timer);
  }, [popClosing]);
  const [adding, setAdding] = react.useState(false);
  const [graphOpen, setGraphOpen] = react.useState(false);
  const [graphRoute, setGraphRoute] = react.useState('');
  const [routeAdding, setRouteAdding] = react.useState(false);
  const [teamAdding, setTeamAdding] = react.useState(false);
  const [teamRoute, setTeamRoute] = react.useState('');
  const [newRole, setNewRole] = react.useState({ id: '', name: '', persona: '', route: '' });
  const [newRoute, setNewRoute] = react.useState('');
  const [creationError, setCreationError] = react.useState('');
  const [createdRole, setCreatedRole] = react.useState('');
  const createAnchor = react.useRef(null);
  const popRef = react.useRef(null);
  const triggers = react.useRef({});
  const fieldRefs = react.useRef({});
  const nextExpanded = react.useRef('');
  const revealField = react.useRef('');
  react.useEffect(() => { setExpanded(nextExpanded.current); nextExpanded.current = ''; setPop(null); setPopClosing(false); setOptionEditing(-1); }, [s.selectionKey]);
  react.useEffect(() => { if (!s.dirty || createdRole && s.preset?.id !== createdRole) setCreatedRole(''); }, [s.dirty, s.preset?.id, createdRole]);
  react.useEffect(() => {
    if (!graphOpen && revealField.current && expanded === revealField.current) {
      fieldRefs.current[expanded]?.scrollIntoView({ block: 'start', behavior: 'smooth' }); revealField.current = '';
    }
  }, [s.selectionKey, expanded, graphOpen]);
  react.useLayoutEffect(() => {
    if (!pop) return;
    const place = () => {
      const rect = triggers.current[pop]?.getBoundingClientRect();
      if (!rect || !popRef.current) return;
      const menu = popRef.current;
      menu.style.width = `${Math.round(rect.width + 12)}px`;
      const active = menu.querySelector('.active');
      menu.style.left = `${Math.max(8, Math.min(rect.left - 6, window.innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(rect.top - (active?.offsetTop ?? 0), window.innerHeight - menu.offsetHeight - 8))}px`;
    };
    place(); window.addEventListener('resize', place); document.addEventListener('scroll', place, true);
    const outside = event => { if (!popRef.current?.contains(event.target) && !triggers.current[pop]?.contains(event.target)) closePop(); };
    const escape = event => { if (event.key === 'Escape') { closePop(); triggers.current[pop]?.focus(); } };
    document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', escape);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('scroll', place, true); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', escape); };
  }, [pop]);
  if (props.view === 'summary') return t('summary');
  if (s.status !== 'ready') return h('p', { role: 'status' }, t('unavailable'));
  const disabled = !s.writable || s.busy;
  const button = (label, onClick, options = {}) => h('button', { type: 'button', className: 'sb-button', disabled, onClick, ...options }, label);
  const routeLabel = route => `${route.provider} / ${s.modelRows.find(m => m.provider === route.provider && m.id === route.model)?.name ?? route.model}`;
  const input = (label, value, onChange, options = {}) => h('input', { className: 'sb-input', 'aria-label': label, value, disabled, onChange: event => onChange(event.target.value), ...options });
  const textarea = (label, value, onChange, options = {}) => h('textarea', { className: 'sb-ta', 'aria-label': label, value, disabled, rows: 4, onChange: event => onChange(event.target.value), ...options });
  const menus = {};
  const dropdown = (key, label, value, choices, pick, readOnly = disabled) => {
    menus[key] = { label, choices: choices.map(option => ({ ...option, active: option.id === value, pick: () => pick(option.id) })) };
    const selected = choices.find(option => option.id === value);
    return button([h('span', { key: 'label' }, selected?.label ?? label), h('span', { key: 'caret', className: 'sb-caret', 'aria-hidden': true }, '▾')],
      () => { if (pop === key && !popClosing) closePop(); else { setPopClosing(false); setPop(key); } }, { ref: el => { triggers.current[key] = el; }, className: 'sb-trigger', 'aria-label': label, 'aria-haspopup': 'listbox', 'aria-expanded': pop === key, disabled: readOnly });
  };
  const modelSelect = (key, value, setValue) => dropdown(key, t(key === 'team-route' ? 'teamModel' : key === 'new-role-route' ? 'newRoleModel' : 'newVariantModel'), value,
    [{ id: '', label: t('model') }, ...s.modelRows.map(m => ({ id: canonical([m.provider, m.id]), label: `${m.providerName} / ${m.name}` }))], setValue);
  const closeCreate = (focus = false) => {
    setAdding(false); setRouteAdding(false); setTeamAdding(false); setCreationError(''); setPop(null); setPopClosing(false);
    if (focus) createAnchor.current?.focus({ preventScroll: true });
  };
  const toggleCreate = (kind, event) => {
    createAnchor.current = event.currentTarget; setCreationError(''); setPop(null); setPopClosing(false);
    setAdding(kind === 'role' && !adding); setRouteAdding(kind === 'route' && !routeAdding);
    setTeamAdding(kind === 'team' && !teamAdding);
  };
  const roleField = (field, value) => { setNewRole({ ...newRole, [field]: value }); setCreationError(''); };
  // Reuse Promptbook's Iconoir save outline and filled reset silhouette.
  const saveOutline = 'M3 19V5a2 2 0 0 1 2-2h11.172a2 2 0 0 1 1.414.586l2.828 2.828A2 2 0 0 1 21 7.828V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z';
  const glyph = kind => kind === 'save'
    ? h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
      h('path', { d: saveOutline }),
      h('path', { d: 'M8.6 9h6.8a.6.6 0 0 0 .6-.6V3.6a.6.6 0 0 0-.6-.6H8.6a.6.6 0 0 0-.6.6v4.8a.6.6 0 0 0 .6.6Z' }),
      h('path', { d: 'M6 13.6V21h12v-7.4a.6.6 0 0 0-.6-.6H6.6a.6.6 0 0 0-.6.6Z' }))
    : h('svg', { viewBox: '0 0 24 24', width: 16, height: 16, 'aria-hidden': true },
      h('path', { d: saveOutline, className: 'sb-clearglyph' }),
      h('path', { d: 'M4.252 4v5H9M5.07 8a8 8 0 1 1-.818 6', transform: 'translate(5.04 6.54) scale(0.58)', className: 'sb-clearink', fill: 'none', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
  function fieldEditor(field, raw) {
    if (promptFields.has(field)) {
      const ref = safeParse(raw) ?? s.effective[field] ?? { text: '' };
      const mode = Object.hasOwn(ref, 'key') ? 'key' : 'text';
      return h('div', { className: 'sb-fields' },
        dropdown(`prompt-${field}`, `${t(field)} · ${t('key')}`, mode,
          [{ id: 'text', label: t('inline') }, { id: 'key', label: t('key') }],
          value => editor.edit(field, JSON.stringify(value === 'key' ? { key: '' } : { text: '' }))),
        mode === 'key'
          ? input(t(field), ref.key ?? '', text => editor.edit(field, JSON.stringify({ key: text })), { list: 'sb-prompt-keys' })
          : textarea(t(field), ref.text ?? '', text => editor.edit(field, JSON.stringify({ text }))),
        mode === 'key' && s.preview ? h('details', null, h('summary', null, t('preview')),
          h('pre', null, field === 'persona' ? s.preview.persona : s.preview.preference)) : null);
    }
    if (listFields.has(field)) return h(NameTags, { editor, s, t, disabled, field });
    if (field === 'agentOptions') return optionFields({ editor, s, t, disabled, dropdown, optionEditing, setOptionEditing });
    return textarea(`${t(field)} · JSON`, raw, value => editor.edit(field, value), { spellCheck: false });
  }
  const expandedIndex = FIELD_NAMES.indexOf(expanded);
  const fields = s.preset ? FIELD_NAMES.map((field, i) => {
    const key = `${s.selectionKey}\u0000${field}`;
    const raw = s.rawFields[key] ?? fieldString(field, s.effective[field]);
    const inline = field === 'toolPreference' || field === 'actionScope' || field === 'maxNestedDepth';
    const open = !inline && expanded === field;
    const groupStart = open || (i === 0 && graphOpen) || (expandedIndex !== -1 && i === expandedIndex + 1);
    const groupEnd = open || i + 1 === expandedIndex || i === FIELD_NAMES.length - 1;
    const borderRadius = groupStart && groupEnd ? '12px' : groupStart ? '12px 12px 0 0' : groupEnd ? '0 0 12px 12px' : '0px';
    const isModel = s.route && Object.hasOwn(s.route.overrides ?? {}, field);
    const source = isModel ? t('sourceModel') : Object.hasOwn(s.preset.defaults, field) ? t('sourceCommon') : t('sourceDefault');
    const row = s.rowStates[field];
    const statusTitle = `${t(`state_${row.status}`)} · ${t(field)} · ${source}`;
    const saveTitle = s.busy ? t('state_saving') : !s.writable ? t('readOnly') : !row.changed ? t(`state_${row.status}`)
      : !s.canSave ? t('correctDraft') : t('saveAll');
    let preview = fieldString(field, s.effective[field]);
    if (field === 'agentOptions') preview = optionSummary(s, t);
    if (promptFields.has(field) && s.effective[field]) preview = 'key' in s.effective[field] ? `${s.effective[field].key} → ${field === 'persona' ? s.preview?.persona ?? '' : s.preview?.preference ?? ''}` : s.effective[field].text;
    if (field === 'maxNestedDepth' && !preview) preview = t('inheritedDepth');
    if (field === 'toolPreference') preview = t(s.effective[field] === 'bash' ? 'bash' : 'free');
    if (field === 'actionScope') preview = t(s.effective[field] === 'verification-copy' ? 'scopeVerification' : s.effective[field] === 'read-only' ? 'scopeReadOnly' : 'scopeInherit');
    const actions = h('div', { className: inline ? `sb-inline-actions${row.canUndo || row.changed || pop === field ? ' visible' : ''}` : 'sb-actions' },
      !inline ? button('▴', () => setExpanded(''), { className: 'sb-collapsebtn', title: t('collapse'), 'aria-label': t('collapse') }) : null,
      button(glyph('save'), () => editor.save(), { className: 'sb-icon sb-iconsave', title: saveTitle, 'aria-label': `${t('save')} · ${t(field)}`, disabled: !row.canSave }),
      button(glyph('undo'), () => editor.undo(field), { className: 'sb-icon sb-iconclear', title: row.canUndo ? t('reset') : t('noChanges'), 'aria-label': `${t('reset')} · ${t(field)}`, disabled: disabled || !row.canUndo }),
      s.route ? button(t('inherit'), () => editor.inherit(field), { disabled: disabled || !isModel }) : null);
    const value = field === 'actionScope'
      ? dropdown('actionScope', t(field), raw || 'inherit', [{ id: 'inherit', label: t('scopeInherit') }, { id: 'read-only', label: t('scopeReadOnly') }, { id: 'verification-copy', label: t('scopeVerification') }], value => editor.edit(field, value))
      : field === 'toolPreference'
      ? dropdown('toolPreference', t(field), raw || 'free', [{ id: 'free', label: t('free') }, { id: 'bash', label: t('bash') }], value => editor.edit(field, value))
      : field === 'maxNestedDepth' ? h(InlineDepth, { editor, s, t, disabled }) : preview || '—';
    return h('div', { key: field, ref: el => { fieldRefs.current[field] = el; }, className: `sb-rowwrap${open ? ' open' : ''}${inline ? ' inline' : ''}`, style: { marginTop: groupStart ? '8px' : '-12px' } }, h('div', { className: 'sb-card', style: { borderRadius } },
      h('div', { className: `sb-line${inline ? ' sb-inline-line' : ''}`, role: open || inline ? undefined : 'button', tabIndex: open || inline ? undefined : 0, 'aria-expanded': inline ? undefined : open,
        'aria-label': open || inline ? undefined : `${t(field)} ${preview || '—'} ${source}`,
        onClick: open || inline ? undefined : () => setExpanded(field), onKeyDown: open || inline ? undefined : event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); setExpanded(field); } } },
        h('span', { className: `sb-dot ${row.status}`, role: 'img', title: statusTitle, 'aria-label': statusTitle }), h('span', { className: 'sb-field' }, t(field)),
        h('div', { className: inline ? 'sb-inline-value' : 'sb-value' }, value), h('span', { className: 'sb-source' }, source), inline ? actions : null),
      inline ? (s.fieldErrors[key] ? h('p', { role: 'alert', className: 'sb-error sb-inline-error' }, s.fieldErrors[key]) : null)
        : h('div', { className: 'sb-editorwrap' }, h('div', { className: 'sb-editor', inert: !open },
        h('div', { className: 'sb-fields' }, fieldEditor(field, raw)),
        s.fieldErrors[key] && !listFields.has(field) ? h('p', { role: 'alert', className: 'sb-error' }, s.fieldErrors[key]) : null,
        actions))));
  }) : [];
  const selectedAvailable = !s.route || s.modelRows.some(m => m.provider === s.route.provider && m.id === s.route.model);
  const graphRoutes = [...new Map(s.book.presets.flatMap(preset => preset.models.map(route => [canonical([route.provider, route.model]), route]))).entries()];
  // If a route is deleted in the editor, immediately show the common graph.
  const graphRouteKey = graphRoute === '*' || graphRoutes.some(([key]) => key === graphRoute) ? graphRoute : '';
  // Drafts are edited in place, so recalculate diagnostics on every projection.
  const allGraph = roleGraph(s.book, '*');
  const graph = graphRouteKey === '*' ? allGraph : roleGraph(s.book, graphRouteKey);
  const selectGraphRole = (id, index, delegates = false) => {
    setGraphOpen(false);
    const field = delegates ? 'delegates' : '';
    if (delegates) revealField.current = field;
    if (s.preset?.id === id && s.routeIndex === index) setExpanded(field);
    else { nextExpanded.current = field; editor.select(id, index); }
  };
  const createForm = teamAdding ? h(AnchoredPanel, { anchor: createAnchor.current, id: 'sb-create-team', label: t('teamTemplate'), onClose: closeCreate },
    h('p', { className: 'sb-note' }, t('teamSummary')),
    h('p', { className: 'sb-note' }, t('teamRoles')),
    modelSelect('team-route', teamRoute, value => { setTeamRoute(value); setCreationError(''); }),
    h('p', { className: 'sb-note' }, t('teamBoundary')),
    creationError ? h('p', { role: 'alert', className: 'sb-error' }, creationError) : null,
    h('div', { className: 'sb-actions' }, button(t('cancel'), () => closeCreate(true), { disabled: false }), button(t('addTeam'), () => {
      const [provider, model] = JSON.parse(teamRoute);
      const entryId = editor.addTeam(provider, model);
      if (!entryId) { setCreationError(editor.getSnapshot().error); return; }
      closeCreate(); setGraphRoute(''); setGraphOpen(true); setCreatedRole(entryId);
    }, { disabled: disabled || !teamRoute || !s.modelRows.some(row => canonical([row.provider, row.id]) === teamRoute) })))
    : adding ? h(AnchoredPanel, { anchor: createAnchor.current, id: 'sb-create-role', label: t('add'), onClose: closeCreate },
    h('div', { className: 'sb-create-names' },
      input(t('id'), newRole.id, value => roleField('id', value), { placeholder: t('id') }),
      input(t('name'), newRole.name, value => roleField('name', value), { placeholder: t('name') })),
    modelSelect('new-role-route', newRole.route, value => roleField('route', value)),
    textarea(t('persona'), newRole.persona, value => roleField('persona', value), { placeholder: t('persona') }),
    creationError ? h('p', { role: 'alert', className: 'sb-error' }, creationError) : null,
    h('div', { className: 'sb-actions' }, button(t('cancel'), () => closeCreate(true), { disabled: false }), button(t('create'), () => {
      if (s.book.presets.some(preset => preset.id === newRole.id)) { setCreationError(t('duplicateRoleId')); return; }
      const [provider, model] = JSON.parse(newRole.route); editor.addPreset(newRole.id, newRole.name, provider, model, newRole.persona);
      const result = editor.getSnapshot();
      if (result.error) { setCreationError(result.error); return; }
      closeCreate(); setNewRole({ id: '', name: '', persona: '', route: '' });
      setGraphRoute(''); setGraphOpen(true); setCreatedRole(newRole.id);
    }, { disabled: disabled || !newRole.id.trim() || !newRole.name.trim() || !newRole.persona.trim() || !newRole.route })))
    : routeAdding && s.preset ? h(AnchoredPanel, { anchor: createAnchor.current, id: 'sb-create-route', label: t('addRoute'), onClose: closeCreate },
      modelSelect('new-route', newRoute, value => { setNewRoute(value); setCreationError(''); }),
      creationError ? h('p', { role: 'alert', className: 'sb-error' }, creationError) : null,
      h('div', { className: 'sb-actions' }, button(t('cancel'), () => closeCreate(true), { disabled: false }), button(t('create'), () => {
        const [provider, model] = JSON.parse(newRoute);
        if (s.preset.models.some(route => route.provider === provider && route.model === model)) { setCreationError(t('duplicateRoute')); return; }
        editor.addRoute(provider, model);
        if (editor.getSnapshot().error) { setCreationError(editor.getSnapshot().error); return; }
        closeCreate(); setNewRoute(''); setGraphOpen(false); setCreatedRole(''); triggers.current.route?.focus();
      }, { disabled: disabled || !newRoute }))) : null;
  const graphView = s.preset ? h('div', { className: `sb-header-expand${graphOpen ? ' open' : ''}`, id: 'sb-role-graph', 'aria-hidden': !graphOpen },
    h('div', { className: 'sb-header-expand-inner', inert: !graphOpen }, h('div', { className: 'sb-graph' },
    h('div', { className: 'sb-graph-toolbar' },
      dropdown('graph-model', t('graphModel'), graphRouteKey, [{ id: '', label: t('common') }, { id: '*', label: t('graphAll') }, ...graphRoutes.map(([id, route]) => ({ id, label: routeLabel(route) }))], setGraphRoute, false),
      h('span', { className: 'sb-note sb-graph-hint', title: t('graphHint') }, t('graphDelegation'))),
    graphRouteKey === '*' ? h('p', { className: 'sb-note sb-graph-all-hint' }, t('graphAllHint')) : null,
    h(RoleGraph, { graph, selected: s.preset.id, onSelect: selectGraphRole, focusRole: createdRole, t })))) : null;
  return h('div', { className: 'sb-scope' },
    h('style', null, STYLES),
    h('datalist', { id: 'sb-prompt-keys' }, ...s.promptKeys.map(key => h('option', { key, value: key }))),
    h('div', { className: `sb-card sb-titlecard${graphOpen ? ' expanded' : ''}`, style: { borderRadius: graphOpen || expandedIndex === 0 || !s.preset ? '12px' : '12px 12px 0 0' } },
      h('div', { className: 'sb-head' },
      s.preset ? button([h('span', { key: 'title', className: 'sb-heading-title' }, t('title')), h('span', { key: 'role' }, s.preset.name), h('span', { key: 'caret', className: 'sb-caret', 'aria-hidden': true }, graphOpen ? '▴' : '▾')], () => setGraphOpen(!graphOpen),
        { className: 'sb-heading-trigger', disabled: false, 'aria-label': t('preset'), 'aria-expanded': graphOpen, 'aria-controls': 'sb-role-graph' }) : h('h3', null, t('title')),
      !s.preset ? h('span', { className: 'sb-note' }, t('empty')) : null,
      s.preset ? dropdown('route', t('model'), String(s.routeIndex), [{ id: '-1', label: t('common') }, ...s.preset.models.map((route, i) => ({ id: String(i), label: routeLabel(route) }))], id => editor.select(s.preset.id, Number(id)), false) : null,
      button('+', event => toggleCreate('role', event), { title: t('add'), 'aria-label': t('add'), 'aria-expanded': adding, 'aria-controls': 'sb-create-role' }),
      button(t('teamTemplate'), event => toggleCreate('team', event), { 'aria-expanded': teamAdding, 'aria-controls': 'sb-create-team', disabled: disabled || !s.modelRows.length }),
      allGraph.cycles.length ? button(`⚠ ${allGraph.cycles.length}`, () => { setGraphRoute('*'); setGraphOpen(true); }, { className: 'sb-button sb-cycle-indicator', disabled: false, 'aria-label': t('graphShowCycles'), title: t('graphCycleHint') }) : null,
      s.dirty ? h('span', { className: 'sb-note' }, t('unsaved')) : null),
      createdRole && s.preset?.id === createdRole ? h('div', { className: 'sb-role-added', role: 'status' }, `${t('roleAdded')} · ${s.preset.name}`) : null,
      graphView),
    ...fields,
    s.preset ? h('details', { className: 'sb-details' }, h('summary', null, t('metadata')), h('div', { className: 'sb-dialog' },
      input(t('name'), s.preset.name, value => editor.metadata(value, s.preset.description ?? '', s.book.entryPresets.includes(s.preset.id))),
      input(t('description'), s.preset.description ?? '', value => editor.metadata(s.preset.name, value, s.book.entryPresets.includes(s.preset.id))),
      h('label', null, h('input', { type: 'checkbox', checked: s.book.entryPresets.includes(s.preset.id), disabled, onChange: event => editor.metadata(s.preset.name, s.preset.description ?? '', event.target.checked) }), ' ', t('entry')),
      h('div', null, button(t('addRoute'), event => toggleCreate('route', event), { 'aria-expanded': routeAdding, 'aria-controls': 'sb-create-route' }), s.route ? button(t('deleteRoute'), () => editor.deleteRoute(), { disabled: disabled || s.preset.models.length < 2 }) : null,
        button(t('deletePreset'), () => editor.deletePreset(), { className: 'sb-button sb-warning' })))) : null,
    createForm,
    s.preset ? h('details', { className: 'sb-details' }, h('summary', null, t('preview')), !selectedAvailable ? h('p', { className: 'sb-route-missing' }, t('missingRoute')) : null,
      s.previewError ? h('p', { className: 'sb-error' }, s.previewError) : h('pre', null, JSON.stringify(s.preview, null, 2)), h('p', { className: 'sb-note' }, t('previewHint'))) : null,
    s.error && !(creationError === s.error && (adding || routeAdding || teamAdding)) ? h('div', { role: 'alert', className: 'sb-error' },
      s.errorCode ? h('div', null, t(s.errorCode === 'settings/conflict' ? 'saveConflict' : 'saveRejected')) : null,
      h('div', null, s.error)) : null,
    s.dirty && s.otherOptionErrors ? h('p', { role: 'alert', className: 'sb-error' }, s.otherOptionErrors) : null,
    s.dirty && s.schemaError && !s.error ? h('p', { role: 'alert', className: 'sb-error' }, s.schemaError) : null,
    s.dirty ? h('div', { className: 'sb-actions' }, button(t('discard'), () => editor.discard()), button(t('save'), () => editor.save(), { className: 'sb-button sb-primary', title: t('saveAll'), disabled: !s.canSave })) : null,
    pop && menus[pop] ? h('div', { className: `sb-pop${popClosing ? ' closing' : ''}`, ref: popRef, role: 'listbox', 'aria-label': menus[pop].label,
      onKeyDown: event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(popRef.current.querySelectorAll('[role="option"]'));
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      } }, h('div', { className: 'sb-pophead', title: menus[pop].label }, menus[pop].label), ...menus[pop].choices.map(option =>
      button(h('span', { title: option.label }, option.label), () => { option.pick(); closePop(); triggers.current[pop]?.focus(); },
        { key: option.id, role: 'option', 'aria-selected': option.active, className: `sb-popline${option.active ? ' active' : ''}`, disabled: false }))) : null);
}

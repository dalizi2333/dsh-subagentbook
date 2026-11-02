// rc.5 activations have a native continuable descriptor even when the book
// owns a one-shot. Correct the read-only catalog view, never the host store.
function presentBookCatalogs(state, modes) {
  const projections = state.projectionsBySession;
  if (!projections) return state;
  let changed = false;
  const next = Object.fromEntries(Object.entries(projections).map(([id, snapshot]) => {
    const rows = snapshot.values?.subagentCatalog;
    if (!Array.isArray(rows)) return [id, snapshot];
    let touched = false;
    const catalog = rows.map(row => {
      const mode = modes[row.id];
      if (mode !== 'one-shot' || row.mode === mode) return row;
      touched = changed = true; return { ...row, mode };
    });
    return [id, touched ? { ...snapshot, values: { ...snapshot.values, subagentCatalog: catalog } } : snapshot];
  }));
  return changed ? { ...state, projectionsBySession: next } : state;
}
function installBookPresentation(ctx, inspect) {
  // Public slot shadowing was added with the activation host. On the baseline
  // native one-shot descriptors already give the right UI; leave it alone.
  if (typeof ctx.slots.entriesOfSlot !== 'function') return inspect;
  const known = new Map(), listeners = new Set();
  const read = async id => {
    const result = await inspect(id);
    const mode = result.ok ? result.value?.mode : undefined;
    if (known.get(id) !== mode) { known.set(id, mode); for (const notify of listeners) notify(); }
    return result;
  };
  const install = name => ctx.slots.inject(name, () => {
    const shadows = new Map();
    const refresh = () => {
      const entries = ctx.slots.entries(name);
      for (const [entry, off] of shadows) if (!entries.includes(entry)) { off(); shadows.delete(entry); }
      for (const entry of entries) {
        if (entry.locale !== 'subagent' || entry.options.priority === -20 || shadows.has(entry)) continue;
        if (name.endsWith('actions') && entry.options.id !== 'subagent-catalog') continue;
        const Component = entry.component;
        function BookCatalog(props) {
          const raw = props.useSessions(value => value);
          const [modes, setModes] = react.useState({});
          const ids = [...new Set(Object.values(raw.projectionsBySession ?? {}).flatMap(snapshot =>
            (snapshot.values?.subagentCatalog ?? []).map(row => row.id)))].sort().join(',');
          react.useEffect(() => {
            let current = true;
            Promise.all(ids.split(',').filter(Boolean).map(async id => {
              try { const result = await read(id); return [id, result.ok ? result.value?.mode : undefined]; }
              catch { return [id, undefined]; }
            })).then(rows => { if (current) setModes(Object.fromEntries(rows)); });
            return () => { current = false; };
          }, [ids]);
          const presented = react.useMemo(() => presentBookCatalogs(raw, modes), [raw, modes]);
          // Mode is a label here; native authorization still requires the actual
          // durable address when opening the transcript or side pane.
          const nativeAddress = address => {
            const row = raw.projectionsBySession?.[address.parentSessionId]?.values?.subagentCatalog?.find(row => row.id === address.childSessionId);
            return row ? { ...address, mode: row.mode } : address;
          };
          return h(Component, { ...props, useSessions: selector => selector(presented),
            openChild: address => props.openChild(nativeAddress(address)),
            openChildAside: address => props.openChildAside(nativeAddress(address)) });
        }
        shadows.set(entry, ctx.slots.register({ name, ...entry.options, priority: -20, locale: entry.locale, inject: entry.inject }, BookCatalog));
      }
    };
    const off = ctx.slots.subscribe(name, refresh); refresh();
    return () => { off(); for (const dispose of shadows.values()) dispose(); shadows.clear(); };
  });
  // Independent selector seat: no native descriptor/store is rewritten and
  // no normal composer with declared child slots is re-rendered out of scope.
  ctx.effect(() => ctx.slots.inject('conversation.composer', () => {
    let off;
    const refresh = () => {
      off?.();
      off = ctx.slots.register({ name: 'conversation.composer', priority: -20, locale: 'subagent',
        select: owner => known.get(owner.sessionId) === 'one-shot' ? { reason: 'one-shot' } : null,
      }, ({ t }) => h('div', { role: 'status', style: { padding: '16px 24px', opacity: .7 } },
        h('strong', null, t('readonly.oneShot.title')), ' · ', t('readonly.oneShot.body')));
    };
    listeners.add(refresh); refresh();
    return () => { listeners.delete(refresh); off?.(); };
  }), 'subagentbook.one-shot-composer');
  ctx.effect(() => install('conversation.session.header.actions'), 'subagentbook.catalog-presentation');
  ctx.effect(() => install('conversation.session.header.lineage'), 'subagentbook.lineage-presentation');
  return read;
}

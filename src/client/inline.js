function InlineDepth({ editor, s, t, disabled }) {
  const [editing, setEditing] = react.useState(false);
  const inputRef = react.useRef(null), triggerRef = react.useRef(null), before = react.useRef(null), returnFocus = react.useRef(false);
  const field = 'maxNestedDepth', key = `${s.selectionKey}\u0000${field}`;
  const raw = s.rawFields[key] ?? fieldString(field, s.effective[field]);
  const error = s.fieldErrors[key];
  react.useEffect(() => { before.current = null; returnFocus.current = false; setEditing(false); }, [s.selectionKey]);
  react.useLayoutEffect(() => {
    if (editing) { inputRef.current?.focus(); inputRef.current?.select(); }
    else if (returnFocus.current) { returnFocus.current = false; triggerRef.current?.focus(); }
  }, [editing]);
  const finish = () => { returnFocus.current = true; setEditing(false); };
  return editing
    ? h('input', { ref: inputRef, className: 'sb-input sb-depth-input', value: raw, disabled, inputMode: 'numeric',
      'aria-label': t(field), 'aria-invalid': Boolean(error), placeholder: t('inheritedDepth'), title: error ?? t(field),
      onChange: event => editor.edit(field, event.target.value), onBlur: () => setEditing(false),
      onKeyDown: event => {
        if (event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault(); if (!editor.getSnapshot().fieldErrors[key]) finish();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          if (before.current?.selectionKey === s.selectionKey) {
            if (before.current.hasRaw || before.current.hasLocal) editor.edit(field, before.current.raw);
            else editor.inherit(field);
          }
          finish();
        }
      } })
    : h('button', { ref: triggerRef, type: 'button', className: `sb-depth-trigger${error ? ' invalid' : ''}`, disabled,
      'aria-label': t(field), title: error ?? t(field), onClick: () => {
        const local = s.route ? s.route.overrides ?? {} : s.preset.defaults;
        before.current = { selectionKey: s.selectionKey, raw, hasRaw: Object.hasOwn(s.rawFields, key), hasLocal: Object.hasOwn(local, field) };
        setEditing(true);
      } }, raw || t('inheritedDepth'));
}

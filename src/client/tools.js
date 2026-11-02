function NameTags({ editor, s, t, disabled, field }) {
  const inputRef = react.useRef(null);
  const key = `${s.selectionKey}\u0000${field}`;
  const entry = s.tagInputs[key] ?? { text: '' };
  const values = s.effective[field] ?? [];
  const tools = field === 'tools';
  const choices = tagChoices(field, s.book);
  const term = name => t(`${tools ? 'tool' : 'role'}${name}`);
  const issue = entry.issue;
  const missing = values.filter(name => !choices.includes(name));
  const extraError = !entry.text.trim() ? s.fieldErrors[key] : undefined;
  const hasError = Boolean(issue || missing.length || extraError);
  const errorId = react.useId();
  return h('div', null,
    h('div', { className: `sb-tools${hasError ? ' invalid' : ''}${disabled ? ' disabled' : ''}`, role: 'group', 'aria-label': t(field),
      onClick: event => { if (event.target === event.currentTarget) inputRef.current?.focus(); } },
      ...values.map(name => h('span', { key: name, className: `sb-tool-tag${missing.includes(name) ? ' invalid' : ''}`, title: name }, h('span', null, tools ? name : s.book.presets.find(preset => preset.id === name)?.name ?? name),
        h('button', { type: 'button', className: 'sb-tool-remove', disabled, title: `${t(tools ? 'removeTool' : 'removeRole')} ${name}`, 'aria-label': `${t(tools ? 'removeTool' : 'removeRole')} ${name}`,
          onClick: () => { editor.removeTag(field, name); inputRef.current?.focus(); } }, h('span', { 'aria-hidden': true }, '×')))),
      h('input', { ref: inputRef, className: 'sb-tool-input', 'aria-label': t(tools ? 'addTool' : 'addRole'), placeholder: term('Placeholder'), value: entry.text, disabled,
        spellCheck: false, autoComplete: 'off', 'aria-invalid': hasError, 'aria-describedby': hasError ? errorId : undefined,
        onChange: event => editor.tagInput(field, event.target.value), onBlur: () => editor.blurTagInput(field),
        onKeyDown: event => {
          if (event.key !== 'Enter' || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229) return;
          event.preventDefault(); editor.confirmTags(field);
        } })),
    hasError ? h('p', { id: errorId, role: 'alert', className: 'sb-tool-error' },
      issue ? issue.kind === 'pending' ? term('Pending') : `${term(issue.kind === 'unknown' ? 'Unknown' : 'Duplicate')}${issue.names.join(', ')}` : missing.length ? `${term('Unknown')}${missing.join(', ')}` : extraError,
      issue?.kind === 'unknown' || missing.length ? h('span', { className: 'sb-tool-known' }, `${term('Known')}${choices.join(', ')}`) : null) : null);
}

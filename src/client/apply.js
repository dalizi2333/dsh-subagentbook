const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.settings'];
function apply(ctx) {
  const namespace = 'settings.subagentbook';
  installInstanceInfo(ctx, namespace);
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'subagentbook.locale');
  const editor = createEditor(settingsWriter(ctx, ctx.configForms.get('subagentbook')), ctx.configForms.get('llm-mimo'), ctx.configForms.get('promptbook'));
  ctx.effect(() => () => editor.dispose(), 'subagentbook.editor');
  ctx.effect(() => ctx.configForms.whileServed(['subagentbook'], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: '@mimo-codex/dsh-subagentbook', locale: namespace, inject: () => ({ editor }),
  }, SubagentbookCard))), 'subagentbook.page');
}

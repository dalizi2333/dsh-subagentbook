function InstanceInfo({ sessionId, useSession, useProjection, inspect, exportReport, exportCheckpoint, prepareRecovery, t }) {
  const childIdentity = useSession(s => Boolean(s.subagent));
  const rootIdentity = useProjection('agentPreset', value => Boolean(value?.startsWith('subagentbook-root:')));
  const running = useSession(s => s.running);
  const identity = childIdentity || rootIdentity;
  const [open, setOpen] = react.useState(false);
  const [snapshot, setView] = react.useState(null);
  const view = snapshot?.sessionId === sessionId ? snapshot : null;
  const root = react.useRef(null);
  const trigger = react.useRef(null);
  const panel = react.useRef(null);
  const [error, setError] = react.useState('');
  const [loading, setLoading] = react.useState(false);
  const [exporting, setExporting] = react.useState(false);
  const [recovery, setRecovery] = react.useState(null);
  const [preparing, setPreparing] = react.useState(false);
  const [copied, setCopied] = react.useState(false);
  const recoveryForSession = recovery?.sessionId === sessionId ? recovery : null;
  const prepare = async () => {
    const id = sessionId; setPreparing(true); setError(''); setRecovery(null); setCopied(false);
    try { const result = await prepareRecovery(id); if (activeSession.current !== id) return;
      if (!result.ok) throw new Error(result.error.message);
      if (result.value?.format !== 'subagentbook-recovery-v1' || result.value.sessionId !== id || result.value.dispatched !== false) throw new Error(t('reportInvalid'));
      setRecovery(result.value);
    } catch(e) { if (activeSession.current === id) setError(e.message); }
    finally { if (activeSession.current === id) setPreparing(false); }
  };
  const copyRecovery = async () => {
    const id = sessionId;
    try { await navigator.clipboard.writeText(recoveryForSession.text); if (activeSession.current === id) setCopied(true); }
    catch(e) { if (activeSession.current === id) setError(e.message); }
  };
  const activeSession = react.useRef(sessionId); activeSession.current = sessionId;
  react.useEffect(() => { setExporting(false); setPreparing(false); setRecovery(null); setCopied(false); }, [sessionId]);
  const downloadReport = async (kind = 'final') => {
    const id = sessionId; setExporting(true); setError('');
    try {
      const result = await (kind === 'checkpoint' ? exportCheckpoint(id) : exportReport(id));
      if (activeSession.current !== id) return;
      if (!result.ok) throw new Error(result.error.message);
      const bundle = result.value;
      const bytes = new TextEncoder().encode(bundle.text);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (bundle.format !== (kind === 'checkpoint' ? 'subagentbook-checkpoint-v1' : 'subagentbook-report-v1') || bundle.sessionId !== id || hash !== bundle.sha256 || bytes.length !== bundle.totalBytes || bundle.text.length !== bundle.totalChars) throw new Error(t('reportInvalid'));
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2) + '\n'], { type: 'application/json;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `subagentbook-${id}.${kind === 'checkpoint' ? 'checkpoint' : 'report'}.json`;
      try { document.body.appendChild(link); link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    } catch (e) { if (activeSession.current === id) setError(e.message); }
    finally { if (activeSession.current === id) setExporting(false); }
  };
  react.useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      if (!panel.current || !trigger.current) return;
      const rect = trigger.current.getBoundingClientRect();
      panel.current.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - panel.current.offsetWidth - 8))}px`;
      panel.current.style.top = `${Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - panel.current.offsetHeight - 8))}px`;
    };
    place(); window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, view?.sessionId, loading]);
  react.useEffect(() => {
    if (!identity) return;
    let current = true;
    setLoading(true); setError('');
    Promise.resolve().then(() => inspect(sessionId)).then(result => {
      if (!current) return;
      if (!result.ok) setError(result.error.message);
      else setView(result.value);
    }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, sessionId, identity, running]);
  react.useEffect(() => {
    if (!open) return;
    const outside = e => { if (!root.current?.contains(e.target)) setOpen(false); };
    const escape = e => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  if (!identity || !rootIdentity && !view && !error) return null;
  const row = (key, value, literal = false) => h('div', { className: 'sb-instance-row', key }, h('dt', null, literal ? key : t(key)), h('dd', null, value ?? '—'));
  return h('div', { className: 'sb-instance', ref: root }, h('style', null, INSTANCE_STYLES),
    h('button', { type: 'button', className: 'sb-instance-trigger', ref: trigger, 'aria-controls': `sb-instance-${sessionId}`, 'aria-expanded': open, onClick: () => setOpen(!open) }, t('instanceInfo'), view?.activity?.state === 'interrupted' ? ` · ${t('activity_interrupted')}` : ''),
    open ? h('section', { className: 'sb-instance-panel', ref: panel, id: `sb-instance-${sessionId}`, 'data-instance-id': view?.sessionId, 'aria-label': t('instanceInfo') },
      h('button', { type: 'button', className: 'sb-instance-close', 'aria-label': t('closeInstance'), onClick: () => setOpen(false) }, '×'),
      h('h3', null, t('instanceInfo')),
      view?.checkpoint?.available && !running && view.activity?.state !== 'running' && (view.activity?.state !== 'completed' || view.report?.state === 'unavailable') ? h('button', {type:'button',className:'sb-instance-trigger',disabled:preparing || loading,onClick:prepare},t('recoveryPrepare')) : null,
      recoveryForSession ? h('div', {className:'sb-recovery'}, h('p', {className:'sb-instance-note'}, `${t('recoveryTarget')} ${recoveryForSession.targetSessionId}`),
        h('textarea', {className:'sb-ta','aria-label':t('recoveryTask'),readOnly:true,value:recoveryForSession.text,rows:5}),
        h('button',{type:'button',className:'sb-instance-trigger',onClick:copyRecovery},t(copied ? 'recoveryCopied' : 'recoveryCopy'))) : null,
      view?.checkpoint?.available ? h('button', { type: 'button', className: 'sb-instance-trigger', disabled: exporting || loading, onClick: () => downloadReport('checkpoint') }, t('checkpointExport')) : null,
      view?.mode === 'one-shot' ? h('button', { type: 'button', className: 'sb-instance-trigger', disabled: exporting || loading || running || !['available', 'empty'].includes(view.report?.state), onClick: () => downloadReport() }, t(exporting ? 'reportExporting' : 'reportExport')) : null, loading ? h('p', { role: 'status' }, t('instanceLoading')) : null,
      error ? h('p', { role: 'alert' }, error) : null,
      !view && !loading && !error ? h('p', { role: 'status' }, t('instancePending')) : null,
      view ? h(react.Fragment, null,
        view.activity?.state === 'interrupted' ? h('p', { className: 'sb-instance-note' }, t(view.mode === 'one-shot' ? 'recoveryOneShot' : 'recoverySession')) : null,
        view.bookChanged ? h('p', { className: 'sb-instance-note' }, t('instanceOlder')) : null,
        h('dl', null, row('instanceActivity', t(`activity_${view.activity?.state ?? 'unknown'}`)),
          view.activity?.reason ? row('instanceStopReason', view.activity.reason === 'previous-runtime-unsettled' ? t('recoveryReason') : view.activity.reason) : null,
          view.checkpoint?.available ? row('checkpointStatus', `${t('checkpointProvisional')} · #${view.checkpoint.seq}`) : null,
          view.report ? row('instanceReport', t(`report_${view.report.state}`)) : null,
          row('instanceRole', view.role), row('model', `${view.provider} / ${view.model}`),
          row('instanceMode', t(view.mode === 'root' ? 'instanceRoot' : view.mode === 'continuable' ? 'instanceContinuable' : 'instanceOneShot')),
          row('tools', view.tools.join(', ') || '—'), row('delegates', view.delegates?.join(', ') || '—'),
          row('actionScope', view.permission?.mode === 'read-only' ? t('scopeReadOnly') : view.permission?.mode), row('instanceApproval', view.permission?.approval),
          row('instanceWorkspace', view.permission?.workspaceRoot),
          row('instanceDepth', `${view.depth} / ${view.effectiveCeiling ?? view.ceiling ?? '∞'}`),
          row('outputBudget', view.maxTokens), row('reasoning', view.reasoningEffort ?? t('modelDefaults'))),
        view.requestFields?.length ? h('dl', null, ...view.requestFields.map(field => row(field.path, String(field.value), true))) : null,
        view.verification ? h('details', null, h('summary', null, t('verificationTitle')), h('dl', null,
          row('verificationSource', view.verification.sourceRoot), row('verificationWorkspace', view.verification.workspaceRoot),
          row('verificationStatus', [t(view.verification.sourceCurrent ? 'verificationFresh' : 'verificationStale'), t(view.verification.copyInputsUnchanged ? 'verificationIntact' : 'verificationModified')].join(' · '))),
          h('pre', null, view.verification.inputRevision), view.verification.error ? h('p', { role: 'alert' }, view.verification.error) : null) : null,
        h('details', null, h('summary', null, t('persona')), h('pre', null, view.persona)),
        h('details', null, h('summary', null, t('instanceIdentity')), h('pre', null, view.sessionId),
          ...Object.entries(view.revisions).map(([key, value]) => h('p', { key, title: value }, `${key}: ${value}`)))) : null) : null);
}
const INSTANCE_STYLES = `.sb-recovery{display:grid;gap:8px;margin:8px 0}.sb-recovery textarea{box-sizing:border-box;width:100%;min-height:140px;max-height:240px;padding:10px;resize:vertical;border:1px solid #8884;border-radius:12px;corner-shape:superellipse(1.43);background:light-dark(#fff,#191a1b);color:inherit;font:12px/1.5 ui-monospace,monospace}.sb-recovery>.sb-instance-trigger{justify-self:start}.sb-instance-trigger:disabled{opacity:.4;cursor:default}.sb-instance-trigger:disabled:hover{background:transparent}.sb-instance{position:relative;font-size:13px}.sb-instance-trigger{border:0;background:transparent;color:inherit;cursor:pointer;padding:6px 10px;border-radius:10px}.sb-instance-trigger:hover{background:color-mix(in srgb,currentColor 8%,transparent)}.sb-instance-panel{position:fixed;z-index:90;width:min(540px,calc(100vw - 40px));max-height:calc(100vh - 110px);overflow:auto;background:light-dark(#f5f6f7,#292b2e);color:inherit;border:1px solid #8884;border-radius:24px;corner-shape:superellipse(1.43);padding:20px;box-shadow:0 12px 48px #0003}.sb-instance-panel h3{margin:0 30px 16px 0;font-size:15px}.sb-instance-close{float:right;background:none;border:0;color:inherit;cursor:pointer;font-size:20px}.sb-instance-row{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:6px 0}.sb-instance-row dt{opacity:.65}.sb-instance-row dd{margin:0;overflow-wrap:anywhere}.sb-instance-panel pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}.sb-instance-panel details{padding:6px 0}.sb-instance-note{opacity:.65;font-size:12px}`;
function installInstanceInfo(ctx, namespace) {
  ctx.inject(['remote'], async local => {
    const off = await local.remote.$mount({ package: '@mimo-codex/dsh-subagentbook/diagnostics', descriptors: [INSTANCE_REMOTE, REPORT_EXPORT_REMOTE, CHECKPOINT_EXPORT_REMOTE, RECOVERY_REMOTE] });
    local.effect(() => off, 'subagentbook.instance-remote');
    local.inject(['remote.subagentbookDiagnostics'], wired => wired.slots.inject('conversation.session.header.actions', () => wired.slots.register({
      name: 'conversation.session.header.actions', id: 'subagentbook.instance', locale: namespace,
      inject: sessionId => ({ inspect: id => wired.remote.subagentbookDiagnostics.inspect(id), exportReport: id => wired.remote.subagentbookDiagnostics.exportReport(id), exportCheckpoint: id => wired.remote.subagentbookDiagnostics.exportCheckpoint(id), prepareRecovery: id => wired.remote.subagentbookDiagnostics.prepareRecovery(id) }),
    }, InstanceInfo)));
  });
}

// Shared, read-only Remote descriptor. No write/control endpoint is exported.
export const INSTANCE_REMOTE = {
  id: '@mimo-codex/dsh-subagentbook#diagnostics/inspect', service: 'subagentbookDiagnostics',
  namespace: 'subagentbookDiagnostics', method: 'inspect', invocation: { kind: 'direct' },
  parameters: [{ name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'strict', typeSymbol: '@mimo-codex/dsh-subagentbook#InstanceId', create: () => ({ parse(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) throw new TypeError('Invalid book instance ID');
    return value;
  } }) } }],
  result: { mode: 'src-json' },
};

export const REPORT_EXPORT_REMOTE = { ...INSTANCE_REMOTE,
  id: '@mimo-codex/dsh-subagentbook#diagnostics/exportReport', method: 'exportReport' };

export const CHECKPOINT_EXPORT_REMOTE = { ...INSTANCE_REMOTE, id: '@mimo-codex/dsh-subagentbook#diagnostics/exportCheckpoint', method: 'exportCheckpoint' };

export const RECOVERY_REMOTE = { ...INSTANCE_REMOTE, id: '@mimo-codex/dsh-subagentbook#diagnostics/prepareRecovery', method: 'prepareRecovery' };

export function instanceView(record) {
  if (!record) return null;
  const c = record.compiled, p = record.effectivePolicy ?? record.inheritedPolicy ?? {};
  // Pick known fields; never send the record, transport settings or env through.
  return JSON.parse(JSON.stringify({
    sessionId: record.instanceId, parentId: record.parentId, role: c.presetId,
    mode: record.mode === 'root' ? 'root' : record.mode === 'continuable' ? 'continuable' : 'one-shot',
    provider: c.provider, model: c.model, tools: c.tools,
    toolPreference: c.toolPreference, delegates: c.delegates,
    depth: record.depth, ceiling: record.ceiling,
    permission: { mode: c.actionScope === 'read-only' ? 'read-only' : record.verification ? 'workspace-write' : p.sandboxMode,
      workspaceRoot: record.verification?.workspaceRoot ?? p.workspaceRoot, approval: record.verification ? 'never' : p.approvalPolicy },
    persona: c.persona, preference: c.preference,
    maxTokens: record.agentOptions?.maxTokens ?? c.agentOptions?.maxTokens,
    reasoningEffort: record.agentOptions?.reasoningEffort ?? c.agentOptions?.reasoningEffort,
    requestFields: c.agentOptions?.requestFields?.map(({ path, type, value }) => ({ path, type, value })),
    revisions: { book: c.bookRevision, preset: c.presetRevision, prompt: c.promptRevision, composition: c.compositionRevision },
  }));
}

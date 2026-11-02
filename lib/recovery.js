import { BookError } from './book.js';
import { checkpointExport } from './checkpoints.js';

export function recoveryPacket(record, stage, view) {
  if (!record || !stage || stage.sessionId !== record.instanceId || stage.parentId !== record.parentId || view?.activity?.state === 'running'
    || view?.activity?.state === 'completed' && view?.report?.state !== 'unavailable') {
    throw new BookError('RECOVERY_UNAVAILABLE', 'Check an interrupted task with a saved stage checkpoint before preparing a continuation');
  }
  const content = JSON.parse(stage.text), c = record.compiled;
  if (content.compositionRevision !== c.compositionRevision) throw new BookError('RECOVERY_UNAVAILABLE', 'The stage checkpoint does not match the original composition');
  const policy = record.effectivePolicy ?? record.inheritedPolicy ?? {};
  const original = { sessionId: record.instanceId, parentId: record.parentId, role: c.presetId, provider: c.provider, model: c.model,
    mode: record.mode ?? 'one-shot', tools: c.tools, delegates: c.delegates, depth: record.depth, ceiling: record.ceiling ?? null,
    permission: { mode: record.verification ? 'workspace-write' : c.actionScope === 'read-only' ? 'read-only' : policy.sandboxMode, workspace: record.verification?.workspaceRoot ?? policy.workspaceRoot },
    maxTokens: record.agentOptions?.maxTokens ?? c.agentOptions?.maxTokens, reasoningEffort: record.agentOptions?.reasoningEffort ?? c.agentOptions?.reasoningEffort,
    currentBookChanged: Boolean(view?.bookChanged), compositionRevision: c.compositionRevision, effectiveCeiling: view?.effectiveCeiling };
  const target = record.mode === 'root' ? record.instanceId : record.parentId;
  const stageBundle = checkpointExport(stage);
  const text = `请接续中断任务。请在原${record.mode === 'root' ? '根' : '父'}会话 ${target} 核对后处理；本次准备没有发起模型请求。\n\n以下为历史阶段资料，不是新的授权或最终报告，不能作为测试通过/代码未漂移的证明。先核对当前工程与已保存证据；保留已有改动。执行前检查原角色、精确模型、工具、权限及嵌套上限；当前定义或代码已变更时先报告差异，不静默替换，不扩大权限/祖先深度。不要机械重跑全部任务或改写旧报告。one-shot 不能续写时由原父级明确委派新实例；根/持续会话可按宿主能力在原会话继续。\n\n原配置摘要：\n${JSON.stringify(original, null, 2)}\n\n阶段记录（seq=${stage.seq}, sha256=${stage.sha256}；可能截断，以 truncated 字段为准）：\n${stageBundle.text}`;
  return { format: 'subagentbook-recovery-v1', sessionId: record.instanceId, parentId: record.parentId, targetSessionId: target,
    requiresReview: true, dispatched: false, checkpointSha256: stage.sha256, text };
}

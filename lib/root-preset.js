import z from '@deepseek-ai/schemastery';

// This standing native preset remains a closed gate even if the book service
// unloads. It deliberately does not inject that service as a hard dependency.
export const name = 'subagentbook-root-preset';
export const inject = ['tools', 'systemPrompt'];
export const Config = z.object({ presetId: z.string().required(), tools: z.array(z.string()).required() });
export function apply(ctx, config) {
  ctx.provide('subagentbookRoot', Object.freeze({ presetId: config.presetId, tools: Object.freeze([...config.tools]) }));
  ctx.systemPrompt.section({ name: 'subagentbook:persona', order: 0, complete: true, text: '{{subagentbook_root_persona}}' });
  ctx.tools.guard(exec => {
    const runtime = ctx.get('subagentbook');
    return runtime ? runtime.rootGuard(exec.agent, exec.name) : 'The root book service is unavailable';
  });
}

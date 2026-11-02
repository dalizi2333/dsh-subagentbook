// Explicit small paid acceptance; never part of the installed bundle or CI.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
export const name = 'subagentbook-continuation-preview';
export const inject = ['agents', 'subagentbook', 'llmMimo', 'tools', 'systemPrompt', 'sessionPersistence'];
export async function apply(ctx, config) {
  const wires = [];
  ctx.on('agent/request', async ({ agent }, next) => {
    const request = await next(); wires.push({ agentId: agent.id, provider: request.provider, model: request.model }); return request;
  }, { global: true });
  const setup = local => {
    local.tools.restrict({ allow: [] });
    local.systemPrompt.section({ name: 'acceptance-notice-receiver', order: 0, complete: true, interpolate: false, text: 'You receive background child completion notices. Reply only RECEIVED. Do not start new work.' });
  };
  const parent = config.resumeParentId ? await ctx.agents.resume({ resumeSessionId: config.resumeParentId, agentOptions: { provider: config.provider, model: 'mimo-v2.6-flash', maxTokens: 8192 }, setup }) : await ctx.agents.create({ sessionId: `subagentbook-continuation-${Date.now()}`, meta: { cwd: config.workspace }, agentOptions: { provider: config.provider, model: 'mimo-v2.6-flash', maxTokens: 8192 }, setup });
  let childId = config.childId;
  async function settled() {
    const deadline = Date.now() + 300000;
    while (ctx.agents.get(childId)) { if (Date.now() > deadline) throw new Error('Child did not finish'); await new Promise(resolve => setTimeout(resolve, 100)); }
    await parent.agent.whenIdle();
  }
  async function history() { const h = await ctx.sessionPersistence.open(childId, 'read'); try { return (await h.read()).events; } finally { await h.close(); } }
  const work = (async () => {
    if (!childId) {
      const accepted = await ctx.subagentbook.startContinuable(parent.agent, { presetId: 'inspector', provider: config.provider, model: 'mimo-v2.6-pro', prompt: 'Read sample.txt using read. Report its exact nonce, the sum of its two numbers, and your INSPECTOR marker. Keep the answer concise.' });
      childId = accepted.childId; await settled();
      await ctx.subagentbook.sendMessage(parent.agent, childId, 'Continue this same task: without reading the file again, recall the nonce and sum from our earlier conversation, and calculate twice that sum. Report all three values concisely.');
    } else await ctx.subagentbook.sendMessage(parent.agent, childId, 'After the host process restarted, continue the same conversation. Without rereading sample.txt, recall the original nonce and sum and calculate three times that sum. Keep your INSPECTOR marker and answer concise.');
    await settled();
    const events = await history();
    const record = await ctx.subagentbook.readInstance(childId);
    const headers = events.filter(e => e.type === 'request/header').map(e => e.data.header);
    assert.ok(headers.length >= 2);
    assert.ok(headers.every(h => h.config.model === 'mimo-v2.6-pro'));
    assert.ok(headers.every(h => JSON.stringify(h.tools.map(t => t.name).sort()) === JSON.stringify(['read', 'subagentbook_message', 'subagentbook_stop'])));
    assert.equal(record.depth, 1); assert.equal(record.ceiling, 1);
    assert.equal(events.filter(e => e.type === 'subagent/descriptor').length, 1);
    assert.equal(events.findLast(e => e.type === 'turn/end').data.reason.kind, 'completed');
    const output = events.filter(e => e.type === 'assistant/message').at(-1).data.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
    assert.ok(output.includes('book-7c39a') && output.includes(config.resumeParentId ? '126' : '84'));
    assert.ok(events.some(e => e.type === 'system/message' && e.data.message.content.some(b => b.text === record.compiled.persona)));
    const report = { baseline: '0.2.0-rc.2', phase: config.resumeParentId ? 'new-process-resume' : 'create-and-follow-up', parent: parent.agent.id, childId, wires, record, sample: readFileSync(config.workspace + '/sample.txt', 'utf8'), events: events.filter(e => ['request/header', 'system/message', 'user/message', 'assistant/message', 'tool/result', 'subagent/descriptor', 'turn/end'].includes(e.type)).map(({ stream, ...event }) => event), output };
    writeFileSync(config.report, JSON.stringify(report, null, 2));
    ctx.logger.info('Continuable acceptance completed: %s model requests; %s', wires.length, report.phase);
  })().catch(error => { writeFileSync(config.report + '.error', String(error.stack)); ctx.logger.error('Continuable acceptance failed: %s', error.message); });
  ctx.effect(() => async () => { if (childId) await ctx.subagents.drainContinuableChildren(parent.agent, [childId]); await parent.dispose(); await work; });
}

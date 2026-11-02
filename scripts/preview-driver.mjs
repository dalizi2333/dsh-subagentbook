// Local acceptance fixture only; never installed by the published bundle.
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export const name = 'subagentbook-preview-driver';
export const inject = ['agents', 'subagentbook', 'llmMimo', 'loader', 'tools', 'systemPrompt'];
export async function apply(ctx, config) {
  const host = ctx.fiber.entry.parent.tree;
  const { createUserMessage } = await host.import('@deepseek-ai/dsh-llm');
  const wires = [];
  const children = new Map();
  ctx.on('agent/created', ({ agent }) => { if (ctx.subagentbook.instance(agent)) children.set(agent.id, agent); }, { global: true });
  ctx.on('agent/request', async ({ agent }, next) => {
    const request = await next();
    wires.push({ agentId: agent.id, provider: request.provider, model: request.model, tools: request.tools?.map(t => ({ name: t.name, description: t.description })), system: request.messages?.filter(m => m.role === 'system') });
    return request;
  }, { global: true });
  const parent = await ctx.agents.create({ sessionId: `subagentbook-acceptance-${Date.now()}`, meta: { cwd: config.workspace }, agentOptions: { provider: config.provider, model: 'mimo-v2.6-flash', maxTokens: 8192 }, async setup(local) {
    local.tools.restrict({ allow: ['subagentbook'] });
    local.systemPrompt.section({ name: 'acceptance-coordinator', order: 0, complete: true, interpolate: false, text: 'You coordinate two tiny verification tasks. Delegate each using subagentbook, inspect their returned evidence, and give one concise final answer. Do not invent results.' });
  } });
  const timeout = setTimeout(() => parent.agent.cancel({ kind: 'parent' }), 300000);
  const work = (async () => {
    parent.agent.followup(createUserMessage({ content: [{ type: 'text', text: `Run inspector using provider ${config.provider}, model mimo-v2.6-pro to read sample.txt and report the exact nonce and sum of its two numbers. Then run executor using provider ${config.provider}, model mimo-v2.6-flash to independently read sample.txt with Bash and compute the same sum. Each should include its role marker. Summarize both results.` }], source: { kind: 'user' } }));
    await parent.agent.whenIdle();
    const events = parent.agent.session.snapshotEvents();
    const catalogs = events.filter(e => e.type === 'subagent/catalog');

    const report = { baseline: '0.2.0-rc.2', parent: parent.agent.id, catalogs: catalogs.map(e => e.data), wires, events: events.filter(e => ['turn/end', 'assistant/message', 'tool/result'].includes(e.type)), children: [...children.values()].map(agent => ({ id: agent.id, header: agent.session.header, events: agent.session.snapshotEvents().filter(e => ['request/header', 'system/message', 'assistant/message', 'tool/result', 'subagent/descriptor', 'turn/end'].includes(e.type)).map(({ stream, ...event }) => event) })), sample: readFileSync(join(config.workspace, 'sample.txt'), 'utf8') };
    writeFileSync(config.report, JSON.stringify(report, null, 2));
    assert.ok(catalogs.length >= 2, 'Expected two real delegations');
    assert.ok(wires.some(w => w.model === 'mimo-v2.6-pro'), 'Pro child did not dispatch');
    assert.ok(wires.some(w => w.model === 'mimo-v2.6-flash' && w.agentId !== parent.agent.id), 'Flash child did not dispatch');
    for (const child of report.children) {
      const record = await ctx.subagentbook.readInstance(child.id);
      assert.ok(record && record.depth === 1 && record.ceiling === 1);
      const header = child.events.find(e => e.type === 'request/header').data.header;
      assert.deepEqual(header.tools.map(t => t.name), record.compiled.tools);
      assert.equal(header.config.model, record.compiled.model);
      assert.equal(child.events.find(e => e.type === 'system/message').data.message.content[0].text, record.compiled.persona);
      assert.ok(child.events.some(e => e.type === 'tool/result' && !e.data.message.isError));
      assert.equal(child.events.findLast(e => e.type === 'turn/end').data.reason.kind, 'completed');
      const text = child.events.filter(e => e.type === 'assistant/message').at(-1).data.message.content.filter(b => b.type === 'text').map(b => b.text).join('');
      assert.ok(text.includes('book-7c39a') && text.includes('42'));
    }
    assert.ok(ctx.agents.list().every(agent => !children.has(agent.id)), 'Disposed children leaked in the live registry');
    ctx.logger.info('Subagentbook acceptance completed: %s model requests; report saved', wires.length);
  })().catch(error => { writeFileSync(config.report + '.error', String(error.stack)); ctx.logger.error('Subagentbook acceptance failed: %s', error.message); }).finally(() => clearTimeout(timeout));
  ctx.effect(() => async () => { clearTimeout(timeout); await parent.dispose(); await work; });
}

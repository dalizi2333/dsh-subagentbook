// Trusted offline adapter for browser CI; never installed in user profiles.
import z from '@deepseek-ai/schemastery';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { runtimeRequire } from './runtime-path.mjs';
const require = runtimeRequire();
const { LlmAdapter } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
const models = [{ provider: 'fixture', id: 'pro', name: 'Offline Pro', apiFormat: 'chat', requestFieldsVersion: 1,
  budget: { contextWindow: 131072, defaultMaxTokens: 4096, maxOutputTokens: 8192 }, reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] } },
  { provider: 'fixture', id: 'flash', name: 'Offline Flash', apiFormat: 'chat', requestFieldsVersion: 1,
    budget: { contextWindow: 32768, defaultMaxTokens: 1024, maxOutputTokens: 2048 }, reasoning: { efforts: [{ id: 'quick', name: 'Quick' }] } }];
const longReport = 'REPORT_HEAD\n' + '字段🧪\n'.repeat(12000) + '\nREPORT_TAIL';
export const Config = z.object({ modelControlsViewJson: z.string().default(JSON.stringify(models)).volatile() });
export const inject = ['llm', 'subagents'];
export function apply(ctx) {
  ctx.provide('llmMimo', { listHostedModels: () => models, registerRequestFieldSource: () => () => {} });
  ctx.subagents.registerProvider({ name: 'subagentbook:blocked', start() { throw new Error('Reserved browser fixture'); } });
  class Adapter extends LlmAdapter {
    providerInfo(provider) { return { id: provider, name: 'Offline fixture' }; }
    async listModels(provider) { return models.map(model => ({ provider, id: model.id, name: model.name })); }
    async resolveModel(provider, id) {
      const model = models.find(model => model.id === id);
      if (!model) throw new Error(`Unknown offline model ${id}`);
      return { provider, id, name: model.name, context: { contextWindow: model.budget.contextWindow }, defaultMaxTokens: model.budget.defaultMaxTokens };
    }
    async *stream(options) {
      const prompt = options.messages.filter(m => m.role === 'user').flatMap(m => m.content).filter(c => c.type === 'text').map(c => c.text).findLast(text => ['GUI_DELEGATE', 'GUI_CHILD', 'GUI_BOOK_ROOT', 'GUI_VERIFY', 'GUI_VERIFY_CHILD', 'GUI_LONG_REPORT', 'GUI_LONG_REPORT_CHILD'].includes(text));
      if (prompt === 'GUI_LONG_REPORT_CHILD') {
        yield { type: 'block-start', index: 0, blockType: 'reasoning' };
        yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'PRIVATE_GUI_REASONING' } };
        yield { type: 'block-start', index: 1, blockType: 'text' };
        yield { type: 'block-end', index: 1, block: { type: 'text', text: longReport } };
        yield { type: 'finish', reason: { kind: 'stop' } }; return;
      }
      if (prompt === 'GUI_LONG_REPORT') {
        const replies = options.messages.filter(m => m.role === 'tool');
        const emit = (name, args) => [{ type: 'block-start', index: 0, blockType: 'tool-call' },
          { type: 'block-end', index: 0, block: { type: 'tool-call', id: `long-${replies.length}`, name, arguments: JSON.stringify(args) } },
          { type: 'finish', reason: { kind: 'tool-calls' } }];
        if (!replies.length) { yield* emit('subagentbook', { preset: 'worker', provider: 'fixture', model: 'pro', prompt: 'GUI_LONG_REPORT_CHILD', label: 'GUI Long Report' }); return; }
        const pages = replies.map(m => JSON.parse(m.content.filter(b => b.type === 'text').map(b => b.text).join('')));
        const initial = pages[0], latest = pages.at(-1), meta = latest.report ?? latest;
        if (meta.nextOffset !== null) { yield* emit('subagentbook_result', { sessionId: initial.sessionId, offset: meta.nextOffset, sha256: initial.report.sha256 }); return; }
        const combined = initial.output.map(b => b.text).join('') + pages.slice(1).map(p => p.text).join('');
        if (combined !== longReport || createHash('sha256').update(combined).digest('hex') !== initial.report.sha256 || replies.some(m => JSON.stringify(m).includes('PRIVATE_GUI_REASONING'))) throw new Error('Long report delivery is not intact');
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: `GUI_LONG_REPORT_COMPLETE pages=${pages.length} chars=${combined.length} HASH_OK REASONING_PRIVATE` } };
        yield { type: 'finish', reason: { kind: 'stop' } }; return;
      }
      if (['GUI_VERIFY', 'GUI_VERIFY_CHILD'].includes(prompt) && !options.messages.some(m => m.role === 'tool')) {
        let name, args;
        if (prompt === 'GUI_VERIFY') {
          if (!options.tools.find(t => t.name === 'subagentbook')?.description.includes('automatic independent Git copy; source read-only')) throw new Error('Parent cannot discover the verification role permission');
          name = 'subagentbook'; args = { preset: 'verify', provider: 'fixture', model: 'pro', prompt: 'GUI_VERIFY_CHILD', label: 'GUI Independent Verifier' }; }
        else {
          const context = options.messages.map(message => JSON.stringify(message)).join('\n');
          const plain = options.messages.flatMap(m => m.content).filter(block => block.type === 'text').map(block => block.text).join('\n');
          const match = plain.match(/Independent verification copy: (\{[^\n]*\})\. Run builds/);
          if (!match) throw new Error('Missing verification context: ' + context);
          name = 'bash'; args = { command: 'mkdir -p build && node test.mjs > build/result.txt', workdir: JSON.parse(match[1]).workspaceRoot, description: 'Run independent GUI test fixture' };
        }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'gui-verify-call', name, arguments: JSON.stringify(args) } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      if (prompt === 'GUI_DELEGATE' && !options.messages.some(m => m.role === 'tool')) {
        const args = JSON.stringify({ preset: 'worker', provider: 'fixture', model: 'pro', prompt: 'GUI_CHILD', background: true, label: 'GUI CI Worker' });
        yield { type: 'block-start', index: 0, blockType: 'tool-call' };
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'gui-delegate', name: 'subagentbook', arguments: args } };
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return;
      }
      const text = prompt === 'GUI_VERIFY' ? 'GUI_VERIFY_ROOT_COMPLETE' : prompt === 'GUI_VERIFY_CHILD' ? 'GUI_VERIFY_CHILD_COMPLETE' : prompt === 'GUI_BOOK_ROOT' ? `GUI_BOOK_ROOT_COMPLETE ${JSON.stringify({ model: options.model, maxTokens: options.maxTokens,
        tools: options.tools.map(tool => tool.name).sort(), persona: options.messages.filter(m => m.role === 'system').flatMap(m => m.content).filter(block => block.type === 'text').map(block => block.text).join('\n') })}` : prompt === 'GUI_CHILD' ? 'GUI_CHILD_COMPLETE' : 'GUI_ROOT_COMPLETE';
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['fixture'], new Adapter());
}

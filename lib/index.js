import z from '@deepseek-ai/schemastery';
import { EMPTY_BOOK, parseBook } from './book.js';
import { createRuntime } from './runtime.js';
import { installDiagnostics } from './diagnostics.js';

export const name = 'subagentbook';
export const inject = ['loader', 'agents', 'tools', 'systemPrompt', 'subagents'];
export const Config = z.object({
  bookJson: z.string().default(JSON.stringify(EMPTY_BOOK)).volatile().description('Version 1 Subagentbook definition as JSON. Updates apply to future instances; existing instances keep their snapshots.'),
});
const valueOf = value => value && typeof value.get === 'function' ? value.get() : value;
export function apply(ctx, config) {
  const runtime = createRuntime(ctx, parseBook(valueOf(config.bookJson)));
  // ConfigEditor calls this scoped waterfall before writing the profile patch.
  // Keep validation here: Loader listeners run only after values are committed.
  ctx.on('internal/config', (_raw, next) => {
    const candidate = next();
    runtime.validateBook(candidate?.bookJson ?? JSON.stringify(EMPTY_BOOK));
    return candidate;
  });
  ctx.on('loader/volatile-update', () => runtime.updateBook(valueOf(config.bookJson)));
  ctx.provide('subagentbook', runtime);
  runtime.installRootCatalog();
  installDiagnostics(ctx, runtime);
}

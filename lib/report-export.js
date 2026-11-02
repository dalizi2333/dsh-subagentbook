import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { BookError } from './book.js';

export function reportExport(record, report) {
  const fail = () => { throw new BookError('REPORT_UNAVAILABLE', 'No intact one-shot report with matching instance ownership is available'); };
  if (!record || record.mode !== undefined && record.mode !== 'one-shot' || !record.compiled ||
    record.instanceId !== report?.sessionId || record.parentId !== report?.parentId || typeof report?.text !== 'string' ||
    createHash('sha256').update(report.text).digest('hex') !== report.sha256) fail();
  const c = record.compiled, policy = record.effectivePolicy ?? record.inheritedPolicy ?? {};
  // Whitelist provenance; never copy transport config, Persona, env or history.
  return { format: 'subagentbook-report-v1', sessionId: report.sessionId, parentId: report.parentId,
    source: { role: c.presetId, provider: c.provider, model: c.model, mode: 'one-shot',
      depth: record.depth, ceiling: record.ceiling,
      permission: record.verification ? 'workspace-write' : c.actionScope === 'read-only' ? 'read-only' : policy.sandboxMode,
      revisions: { book: c.bookRevision, preset: c.presetRevision, prompt: c.promptRevision, composition: c.compositionRevision } },
    sha256: report.sha256, totalChars: report.text.length, totalBytes: Buffer.byteLength(report.text, 'utf8'), text: report.text };
}

// A fresh directory is reserved first; the manifest is written last. Never
// overwrite old rounds. Rollback only files created by this call, not a tree.
export function writeReportArchive(bundle, directory) {
  mkdirSync(directory, { mode: 0o700 });
  const written = [];
  try {
    const { text, ...manifest } = bundle;
    for (const [name, content] of [['report.md', text], ['manifest.json', JSON.stringify(manifest, null, 2) + '\n']]) {
      const file = join(directory, name);
      writeFileSync(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      written.push(file);
    }
  } catch (error) {
    for (const file of written) { try { unlinkSync(file); } catch {} }
    try { rmdirSync(directory); } catch {}
    throw error;
  }
}

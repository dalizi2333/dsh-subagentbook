import { constants, mkdirSync, lstatSync, realpathSync, openSync, fstatSync, readFileSync, closeSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { BookError, revision } from './book.js';
const hash = text => createHash('sha256').update(text).digest('hex');
const fail = () => { throw new BookError('CHECKPOINT_UNAVAILABLE', 'No intact stage checkpoint with matching ownership is available'); };
const idOK = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const clip = (text, limit) => {
  let end = Math.min(text.length, limit);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return { text: text.slice(0, end), truncated: end < text.length };
};
// Public text only. Tool payloads and reasoning never enter the stage artifact.
export function stageSnapshot(record, events) {
  const requests = events.filter(e => e.type === 'user/message' && ['user', 'agent-message'].includes((e.data?.message ?? e.data)?.source?.kind));
  const task = requests[0], latestRequest = requests.at(-1);
  const textOf = e => ((e?.data?.message ?? (e?.type === 'user/message' ? e.data : undefined))?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n\n');
  const draft = events.filter(e => e.type === 'assistant/message' && textOf(e).trim()).at(-1);
  const last = events.at(-1), tool = events.filter(e => e.type === 'tool/call').at(-1);
  if (!last || !Number.isSafeInteger(last.seq) || !Number.isFinite(last.time)) return undefined;
  const content = { kind: 'stage-checkpoint', final: false, sessionId: record.instanceId, parentId: record.parentId,
    compositionRevision: record.compiled.compositionRevision, source: { seq: last.seq, at: last.time,
      turn: last.data?.turn, step: last.data?.step, draftSeq: draft?.seq },
    task: clip(textOf(task), 16384), latestRequest: { ...clip(textOf(latestRequest), 16384), seq: latestRequest?.seq }, draft: clip(textOf(draft), 32768),
    tools: { calls: events.filter(e => e.type === 'tool/call').length, results: events.filter(e => e.type === 'tool/result').length,
      ...(tool ? { lastName: tool.data.name, lastCallId: tool.data.callId } : {}) } };
  const text = JSON.stringify(content, null, 2);
  return { version: 1, sessionId: record.instanceId, parentId: record.parentId, seq: last.seq, text, sha256: hash(text) };
}
export function checkpointStore(directory) {
  const path = id => { if (!idOK(id)) fail(); return join(directory, `${id}.json`); };
  const checkDir = () => { if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== resolve(directory)) fail(); };
  return {
    read(id, parentId) {
      const file = path(id); let fd;
      try {
        checkDir(); fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        const st = fstatSync(fd); if (!st.isFile() || st.size > 1024 * 1024) fail();
        const { integrity, ...value } = JSON.parse(readFileSync(fd, 'utf8'));
        if (value.version !== 1 || value.sessionId !== id || value.parentId !== parentId || !Number.isSafeInteger(value.seq) || typeof value.text !== 'string' || hash(value.text) !== value.sha256 || revision(value) !== integrity) fail();
        const payload = JSON.parse(value.text);
        if (payload.kind !== 'stage-checkpoint' || payload.final !== false || payload.sessionId !== id || payload.parentId !== parentId || payload.source?.seq !== value.seq) fail();
        return value;
      } catch (e) { if (e.code === 'ENOENT') return undefined; fail(); }
      finally { if (fd !== undefined) closeSync(fd); }
    },
    write(value) {
      mkdirSync(directory, { recursive: true, mode: 0o700 }); checkDir();
      const previous = this.read(value.sessionId, value.parentId);
      if (previous && previous.seq >= value.seq) return previous;
      const file = path(value.sessionId), temp = `${file}.${randomUUID()}.tmp`;
      const data = JSON.stringify({ ...value, integrity: revision(value) });
      if (Buffer.byteLength(data) > 1024 * 1024) fail();
      try { writeFileSync(temp, data, { mode: 0o600, flag: 'wx' }); renameSync(temp, file); }
      finally { rmSync(temp, { force: true }); }
      return value;
    },
  };
}
export function checkpointExport(value) {
  if (!value) fail();
  return { format: 'subagentbook-checkpoint-v1', final: false, sessionId: value.sessionId, parentId: value.parentId,
    seq: value.seq, text: value.text, sha256: value.sha256, totalChars: value.text.length, totalBytes: Buffer.byteLength(value.text) };
}

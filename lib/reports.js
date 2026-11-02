import { constants, mkdirSync, lstatSync, realpathSync, openSync, fstatSync, readFileSync, closeSync, writeFileSync, linkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { BookError, revision } from './book.js';

export const REPORT_PAGE_CHARS = 4000;
const digest = text => createHash('sha256').update(text).digest('hex');
const fail = message => { throw new BookError('REPORT_UNAVAILABLE', message); };
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;

// Final delivery text only. Reasoning stays in the native child history.
export function deliveryOutput(output) { return (output ?? []).filter(block => block.type === 'text').map(block => ({ type: 'text', text: block.text })); }
export function reportPage(report, offset = 0, limit = REPORT_PAGE_CHARS, expectedHash) {
  if (expectedHash !== undefined && expectedHash !== report.sha256) fail('The requested report hash does not match the saved result');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > report.text.length || !Number.isSafeInteger(limit) || limit < 1 || limit > REPORT_PAGE_CHARS ||
    offset > 0 && /[\uD800-\uDBFF]/.test(report.text[offset - 1]) && /[\uDC00-\uDFFF]/.test(report.text[offset] ?? '')) throw new BookError('INVALID_REPORT_PAGE', `Use a returned offset and a limit from 1 to ${REPORT_PAGE_CHARS}`);
  let end = Math.min(report.text.length, offset + limit);
  if (end < report.text.length && /[\uD800-\uDBFF]/.test(report.text[end - 1]) && /[\uDC00-\uDFFF]/.test(report.text[end])) end--;
  if (end === offset && end < report.text.length) throw new BookError('INVALID_REPORT_PAGE', 'Increase limit to include the complete Unicode character');
  return { sessionId: report.sessionId, sha256: report.sha256, totalChars: report.text.length, offset,
    nextOffset: end < report.text.length ? end : null, text: report.text.slice(offset, end) };
}
export function reportStore(directory) {
  const filename = id => {
    if (typeof id !== 'string' || !idPattern.test(id)) throw new BookError('INVALID_INSTANCE', 'Invalid book result sessionId');
    return join(directory, `${id}.json`);
  };
  const checkDirectory = () => { if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== resolve(directory)) fail('The saved report directory is unavailable'); };
  return {
    write(sessionId, parentId, output) {
      mkdirSync(directory, { recursive: true, mode: 0o700 }); checkDirectory();
      const text = deliveryOutput(output).map(block => block.text).join('\n\n');
      const value = { version: 1, sessionId, parentId, text, sha256: digest(text) };
      const data = JSON.stringify({ ...value, integrity: revision(value) });
      if (Buffer.byteLength(data) > 32 * 1024 * 1024) fail('The final report exceeds the 32 MiB saved-result limit');
      const file = filename(sessionId), temporary = join(directory, `.report-${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' });
        // Publish a complete immutable file, without replacing an earlier result.
        linkSync(temporary, file);
      } finally { rmSync(temporary, { force: true }); }
      return value;
    },
    read(sessionId, parentId) {
      const file = filename(sessionId);
      let fd;
      try {
        checkDirectory();
        if (!lstatSync(file).isFile() || realpathSync(file) !== resolve(file)) fail('The saved report is not a regular result file');
        fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
        const stat = fstatSync(fd);
        if (!stat.isFile() || stat.size > 32 * 1024 * 1024) fail('The saved report is not a supported regular result file');
        const value = JSON.parse(readFileSync(fd, 'utf8'));
        const { integrity, ...data } = value;
        if (value.version !== 1 || value.sessionId !== sessionId || value.parentId !== parentId || typeof value.text !== 'string' ||
          value.sha256 !== digest(value.text) || integrity !== revision(data)) fail('The saved result is missing, damaged, or belongs to another parent');
        return data;
      } catch (error) {
        if (error instanceof BookError || error.code === 'INVALID_INSTANCE') throw error;
        fail('No intact saved one-shot result is available for this session');
      } finally { if (fd !== undefined) closeSync(fd); }
    },
  };
}

// Owner diagnostics only. Availability is independent of execution/acceptance.
export function savedReportStatus(store, record) {
  if (!record || ['root', 'continuable'].includes(record.mode)) return undefined;
  try {
    const report = store.read(record.instanceId, record.parentId);
    return { state: report.text.trim() ? 'available' : 'empty', sha256: report.sha256, totalChars: report.text.length };
  } catch { return { state: 'unavailable' }; }
}

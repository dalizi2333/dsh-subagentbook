import { join } from 'node:path';
import { recordStore } from '../lib/records.js';
import { reportStore } from '../lib/reports.js';
import { reportExport, writeReportArchive } from '../lib/report-export.js';
const [home, id, destination, ...extra] = process.argv.slice(2);
try {
  if (!home || !id || !destination || extra.length) throw new Error('Usage: node scripts/export-report.mjs <DSH_HOME> <one-shot-sessionId> <new-directory>');
  const record = recordStore(join(home, 'subagentbook', 'instances')).read(id);
  if (!record || ['root','continuable'].includes(record.mode)) throw new Error('An existing one-shot book instance is required');
  const report = reportStore(join(home, 'subagentbook', 'reports')).read(id, record.parentId);
  const bundle = reportExport(record, report);
  writeReportArchive(bundle, destination);
  console.log(JSON.stringify({ sessionId: id, sha256: bundle.sha256, totalChars: bundle.totalChars, totalBytes: bundle.totalBytes }));
} catch (error) { console.error(error.message); process.exitCode = 1; }

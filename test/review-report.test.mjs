import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReviewReport } from '../scripts/review-report.mjs';
const value = { verdict: 'pass', findings: [], checks: ['actual check'], limits: [] };
test('native review JSON and observed prose/fence output preserve format compliance separately', () => {
  assert.deepEqual(parseReviewReport(JSON.stringify(value)), { value, format: 'json', formatCompliant: true });
  const parsed = parseReviewReport('Both verified findings are resolved.\n```json\n' + JSON.stringify(value) + '\n```');
  assert.deepEqual(parsed.value, value); assert.equal(parsed.format, 'prose-and-json-fence'); assert.equal(parsed.formatCompliant, false);
});
test('ambiguous, invalid and contradictory review reports do not silently become a pass', () => {
  const fence = '```json\n' + JSON.stringify(value) + '\n```';
  for (const text of ['No problems', fence + '\n' + fence, JSON.stringify({ verdict: 'pass' }), JSON.stringify({ ...value, findings: [{ problem: 'blocking' }] })]) assert.throws(() => parseReviewReport(text));
});

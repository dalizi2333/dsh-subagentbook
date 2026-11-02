// Read model output as data; never evaluate prose or code fences.
import assert from 'node:assert/strict';
function validate(value) {
  assert.ok(value && ['pass', 'revise'].includes(value.verdict) && Array.isArray(value.findings) && Array.isArray(value.checks), 'Invalid review report');
  assert.ok(value.verdict !== 'pass' || value.findings.length === 0, 'Passing review contains blocking findings');
  return value;
}
export function parseReviewReport(text) {
  const trimmed = text.trim();
  try { return { value: validate(JSON.parse(trimmed)), format: 'json', formatCompliant: true }; }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; }
  const reports = [];
  for (const match of trimmed.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)) {
    try { reports.push({ value: validate(JSON.parse(match[1])), fence: match[0] }); }
    catch {} // Other fences are evidence; only one valid report may be selected.
  }
  assert.equal(reports.length, 1, 'Expected exactly one unambiguous JSON review report');
  return { value: reports[0].value, format: trimmed === reports[0].fence ? 'json-fence' : 'prose-and-json-fence', formatCompliant: false };
}

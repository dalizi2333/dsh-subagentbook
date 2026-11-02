// Offline acceptance of archived completed stages. Does not rewrite raw reports.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluate, sourceHash } from './pipeline-task.mjs';
import { parseReviewReport } from './review-report.mjs';

if (process.argv.length !== 3) throw new Error('Usage: node scripts/pipeline-assess.mjs <archived run directory>');
const run = resolve(process.argv[2]);
const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
const workspace = join(run, 'final-project');
const assessment = { version: 1, status: 'checking', originalReportStatus: report.status, originalDriverError: report.error ?? null, source: 'offline verification of preserved native stages; no model requests' };
try {
  assert.ok(['failed', 'completed'].includes(report.status), 'Cannot assess a live run');
  assert.ok(report.stages.length && report.stages.every(stage => stage.status === 'completed'), 'A native stage did not complete');
  assert.equal(sourceHash(workspace), report.finalSourceHash ?? report.stages.at(-1).after, 'Archived source changed');
  for (const stage of report.stages) {
    assert.equal(stage.result.stopReason, 'completed');
    const events = JSON.parse(readFileSync(join(run, `stage-${stage.index}-${stage.role}.json`), 'utf8'));
    const header = events.find(event => event.type === 'request/header').data.header;
    assert.equal(header.config.model, stage.model);
    assert.deepEqual(header.tools.map(tool => tool.name).sort(), [...stage.record.compiled.tools].sort());
    const systems = events.filter(event => event.type === 'system/message').map(event => event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n'));
    assert.ok(systems.length && systems.every(text => text.split(stage.record.compiled.persona).length === 2));
    if (stage.policy === 'read-only') assert.equal(stage.after, stage.before);
  }
  for (const path of ['test/visible.test.mjs', 'package.json', 'README.md']) assert.equal(readFileSync(join(workspace, path), 'utf8'), readFileSync(join(run, 'starting-project', path), 'utf8'), `Seeded ${path} changed`);
  const reviewer = report.stages.findLast(stage => stage.role === 'reviewer');
  assert.ok(reviewer, 'No completed reviewer');
  const text = reviewer.result.output.filter(block => block.type === 'text').map(block => block.text).join('\n');
  assessment.review = parseReviewReport(text);
  assert.equal(assessment.review.value.verdict, 'pass');
  const verification = join(run, 'offline-assessment'); mkdirSync(verification, { recursive: true });
  assessment.grade = evaluate(workspace, verification);
  const tests = spawnSync(process.execPath, ['--test', 'test/cli.test.mjs', 'test/summary.test.mjs', 'test/visible.test.mjs'], { cwd: workspace, encoding: 'utf8', timeout: 30000 });
  assessment.projectTests = { passed: tests.status === 0, exitCode: tests.status, output: (tests.stdout ?? '') + (tests.stderr ?? '') };
  assert.ok(assessment.grade.passed && assessment.projectTests.passed, 'Independent checks failed');
  assessment.sourceHash = sourceHash(workspace);
  assert.equal(assessment.sourceHash, report.finalSourceHash ?? report.stages.at(-1).after);
  assessment.status = 'completed';
} catch (error) { assessment.status = 'failed'; assessment.error = { name: error.name, message: error.message }; process.exitCode = 1; }
writeFileSync(join(run, 'assessment.json'), JSON.stringify(assessment, null, 2));
console.log(JSON.stringify({ status: assessment.status, format: assessment.review?.format, grade: assessment.grade?.passed, tests: assessment.projectTests?.passed, error: assessment.error }));

// Synthetic temporary project with a real CLI feature and independently graded edges.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
export const requirement = `Implement summarize(events) in summary.mjs and a Node.js JSONL CLI in cli.mjs, using only built-in modules (Node >=22).
events is an array. Each event is a plain JSON object, not an array. Recognized types:
task/state: {type,taskId,sequence,state}; nonempty string taskId; sequence is a nonnegative safe integer; state is queued/running/completed/failed.
request/usage: {type,requestId,sequence,usage?}; same ID/sequence rules. Missing/null usage or a partial input/output pair is unknown. Otherwise usage must be a plain object. Present counters must be nonnegative safe integers; an invalid present counter is an error.
For each task/request keep the event with highest sequence. On equal sequence, the later input occurrence wins. Input order is otherwise arbitrary. Ignore unknown event types, but reject nonobjects and malformed recognized events.
Return exactly {tasks:{queued,running,completed,failed},requests:{count,usageKnown,usageUnknown},tokens:{input,output,total}}.
Count each distinct request once. Only complete known inputTokens/outputTokens pairs contribute tokens. Zero is known. Check every aggregated token sum for safe-integer overflow; do not infer unknown usage as zero.
CLI: node cli.mjs <path>, read UTF-8 JSONL, skip blank/whitespace-only lines (including CRLF), emit one JSON result followed by newline. Bad JSON errors mention the original 1-based line number. Missing argument, input/validation failures: nonzero exit and stderr; no JSON on stdout.
Preserve existing tests. Add relevant tests and run npm test. Do not add dependencies or edit files outside this project.`;

export const documents = [
  { slug: 'event-contract', title: 'Run Ledger v1: event ordering and identities', text: requirement.split('Return exactly')[0] },
  { slug: 'usage-contract', title: 'Run Ledger v1: reported token accounting and CLI', text: 'Return exactly' + requirement.split('Return exactly')[1] },
];
export function createTask(workspace) {
  mkdirSync(join(workspace, 'test'), { recursive: true });
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({ name: 'run-ledger-feature-fixture', private: true, type: 'module', scripts: { test: 'node --test test/*.test.mjs' } }, null, 2));
  writeFileSync(join(workspace, 'README.md'), '# Run Ledger\n\n' + requirement + '\n');
  writeFileSync(join(workspace, 'summary.mjs'), 'export function summarize(events) { throw new Error("Not implemented"); }\n');
  writeFileSync(join(workspace, 'cli.mjs'), 'process.stderr.write("Not implemented\\n"); process.exitCode = 1;\n');
  writeFileSync(join(workspace, 'test/visible.test.mjs'), `import test from 'node:test'; import assert from 'node:assert/strict'; import {summarize} from '../summary.mjs';
test('empty ledger',()=>assert.deepEqual(summarize([]),{tasks:{queued:0,running:0,completed:0,failed:0},requests:{count:0,usageKnown:0,usageUnknown:0},tokens:{input:0,output:0,total:0}}));
test('known usage and final task state',()=>{const r=summarize([{type:'task/state',taskId:'a',sequence:0,state:'running'},{type:'task/state',taskId:'a',sequence:1,state:'completed'},{type:'request/usage',requestId:'r',sequence:0,usage:{inputTokens:10,outputTokens:2}}]);assert.equal(r.tasks.completed,1);assert.equal(r.tasks.running,0);assert.equal(r.tokens.total,12);});
`);
  const git = args => { const result = spawnSync('git', args, { cwd: workspace, encoding: 'utf8' }); if (result.status) throw new Error(result.stderr); };
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Subagentbook fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Seed independent run ledger feature']);
}

export function sourceHash(workspace) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: workspace, encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
  const hash = createHash('sha256');
  for (const file of [...new Set(result.stdout.split('\0').filter(Boolean))].sort()) {
    hash.update(file); hash.update(readFileSync(join(workspace, file))); hash.update('\0');
  }
  return hash.digest('hex');
}

export function evaluate(workspace, run) {
  const file = join(run, 'acceptance.test.mjs');
  writeFileSync(file, `import test from 'node:test'; import assert from 'node:assert/strict'; import {pathToFileURL} from 'node:url'; import {spawnSync} from 'node:child_process'; import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
const root=process.env.BOOK_EVALUATION_PROJECT; const {summarize}=await import(pathToFileURL(join(root,'summary.mjs')));
const t=(id,sequence,state)=>({type:'task/state',taskId:id,sequence,state}); const u=(id,sequence,usage)=>({type:'request/usage',requestId:id,sequence,usage});
test('out of order state and tie replacement',()=>{const r=summarize([t('a',3,'failed'),t('a',1,'running'),t('a',3,'completed'),t('b',0,'queued'),t('c',4,'running')]);assert.deepEqual(r.tasks,{queued:1,running:1,completed:1,failed:0});});
test('dedup known, zero, partial, null and a later unknown update',()=>{const r=summarize([u('a',2,{inputTokens:10,outputTokens:4}),u('a',1,{inputTokens:99,outputTokens:99}),u('zero',0,{inputTokens:0,outputTokens:0}),u('partial',0,{inputTokens:20}),u('null',0,null),u('later',0,{inputTokens:3,outputTokens:4}),u('later',1,null)]);assert.deepEqual(r.requests,{count:5,usageKnown:2,usageUnknown:3});assert.deepEqual(r.tokens,{input:10,output:4,total:14});});
test('plain special IDs and unknown event types',()=>{const r=summarize([t('__proto__',0,'completed'),t('constructor',0,'failed'),u('__proto__',0,{inputTokens:1,outputTokens:2}),{type:'future/event'}]);assert.equal(r.tasks.completed,1);assert.equal(r.tasks.failed,1);assert.equal(r.requests.count,1);});
test('invalid recognized values reject',()=>{for(const e of [null,[],t('',0,'running'),t('a',-1,'running'),t('a',.5,'running'),t('a',0,'other'),u('a',0,{inputTokens:-1,outputTokens:2}),u('a',0,{inputTokens:'1',outputTokens:2}),u('a',0,[]),u('',0,null)])assert.throws(()=>summarize([e]));});
test('plain-object contract excludes exotic direct JS values',()=>{const event=Object.assign(new Date(0),t('a',0,'completed'));const usage=Object.assign(new Date(0),{inputTokens:1,outputTokens:2});class Task{constructor(){Object.assign(this,t('a',0,'completed'));}}for(const e of [event,new Task(),new Map(),u('a',0,usage)])assert.throws(()=>summarize([e]));});\ntest('sum overflow rejects',()=>{assert.throws(()=>summarize([u('a',0,{inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:1})]));assert.throws(()=>summarize([u('a',0,{inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:0}),u('b',0,{inputTokens:1,outputTokens:0})]));});
test('input and usage are not mutated',()=>{const events=[t('a',0,'queued'),u('x',0,{inputTokens:2,outputTokens:3})];const before=JSON.stringify(events);summarize(events);assert.equal(JSON.stringify(events),before);});
test('CLI JSONL/CRLF and original line diagnostics',()=>{const path=join(process.env.BOOK_EVALUATION_RUN,'input.jsonl');writeFileSync(path,'\\r\\n'+JSON.stringify(t('a',0,'completed'))+'\\r\\n   \\r\\n'+JSON.stringify(u('r',0,{inputTokens:0,outputTokens:1}))+'\\n');let result=spawnSync(process.execPath,[join(root,'cli.mjs'),path],{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),summarize([t('a',0,'completed'),u('r',0,{inputTokens:0,outputTokens:1})]));writeFileSync(path,'\\n{}\\n{broken\\n');result=spawnSync(process.execPath,[join(root,'cli.mjs'),path],{cwd:root,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/line\\s*3|第\\s*3\\s*行/i);assert.equal(result.stdout.trim(),'');result=spawnSync(process.execPath,[join(root,'cli.mjs')],{cwd:root,encoding:'utf8'});assert.notEqual(result.status,0);assert.ok(result.stderr.trim());assert.equal(result.stdout.trim(),'');});
`);
  const result = spawnSync(process.execPath, ['--test', file], { cwd: workspace, encoding: 'utf8', timeout: 30000,
    env: { ...process.env, BOOK_EVALUATION_PROJECT: workspace, BOOK_EVALUATION_RUN: run } });
  writeFileSync(join(run, 'acceptance.log'), `${result.stdout}\n${result.stderr}`);
  return { passed: result.status === 0, exitCode: result.status, error: result.error?.message ?? null, output: result.stdout + result.stderr };
}

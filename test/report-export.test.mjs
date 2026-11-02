import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { reportStore } from '../lib/reports.js';
import { recordStore } from '../lib/records.js';
import { reportExport, writeReportArchive } from '../lib/report-export.js';

test('export preserves exact full delivery text and owner metadata without private configuration', () => {
 const root=mkdtempSync(join(tmpdir(),'sb-export-'));
 try {
  const record={version:1,instanceId:'child',parentId:'parent',depth:1,ceiling:3,
   inheritedPolicy:{sandboxMode:'workspace-write',env:{SECRET:'never-export'}},
   compiled:{presetId:'reviewer',provider:'fixture',model:'pro',actionScope:'read-only',persona:'private Persona',bookRevision:'original-book'}};
  const reports=reportStore(join(root,'subagentbook','reports'));
  const text='导语\r\n```json\n{"quote":"保留\\n"}\n```\n'+'🧪汉字\t\n'.repeat(20000)+'END';
  const report=reports.write('child','parent',[{type:'reasoning',text:'private thought'},{type:'text',text}]);
  recordStore(join(root,'subagentbook','instances')).write(record);
  const bundle=reportExport(record,reports.read('child','parent'));
  assert.equal(bundle.text,text);assert.equal(bundle.source.permission,'read-only');
  assert.equal(bundle.totalBytes,Buffer.byteLength(text));assert.equal(bundle.totalChars,text.length);
  assert.equal(bundle.source.revisions.book,'original-book');
  for(const secret of ['never-export','private Persona','private thought']) assert.ok(!JSON.stringify(bundle).includes(secret));
  assert.deepEqual(reportExport(record,report),bundle);
  const target=join(root,'r04');writeReportArchive(bundle,target);
  assert.equal(readFileSync(join(target,'report.md'),'utf8'),text);
  const meta=JSON.parse(readFileSync(join(target,'manifest.json'),'utf8'));
  assert.ok(!('text' in meta));assert.equal(meta.sha256,createHash('sha256').update(readFileSync(join(target,'report.md'))).digest('hex'));
  assert.throws(()=>writeReportArchive(bundle,target),{code:'EEXIST'});
  for(const bad of [{...record,parentId:'other'},{...record,instanceId:'other'},{...record,mode:'root'},{...record,mode:'continuable'}]) assert.throws(()=>reportExport(bad,report),{code:'REPORT_UNAVAILABLE'});
  assert.throws(()=>reportExport(record,{...report,text:'changed'}),{code:'REPORT_UNAVAILABLE'});
  const cli=fileURLToPath(new URL('../scripts/export-report.mjs',import.meta.url));
  execFileSync(process.execPath,[cli,root,'child',join(root,'cli-r04')]);
  assert.equal(readFileSync(join(root,'cli-r04','report.md'),'utf8'),text);
  writeFileSync(join(root,'subagentbook','reports','child.json'),JSON.stringify({...report,text:'tampered'}));
  assert.throws(()=>execFileSync(process.execPath,[cli,root,'child',join(root,'bad')],{stdio:'pipe'}),e=>e.status===1);
 } finally {rmSync(root,{recursive:true,force:true});}
});

test('empty delivery remains explicitly empty, never a fabricated report',()=>{
 const root=mkdtempSync(join(tmpdir(),'sb-empty-export-'));
 try {
  const record={instanceId:'child',parentId:'parent',compiled:{}};
  const report=reportStore(root).write('child','parent',[]);
  const bundle=reportExport(record,report);assert.equal(bundle.text,'');assert.equal(bundle.totalBytes,0);
 } finally {rmSync(root,{recursive:true,force:true});}
});

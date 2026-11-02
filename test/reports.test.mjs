import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliveryOutput, reportStore, reportPage, savedReportStatus } from '../lib/reports.js';

test('saved reports survive a new store, protect ownership and keep UTF-16 pagination lossless', () => {
  const root = mkdtempSync(join(tmpdir(), 'book-reports-'));
  try {
    const directory = join(root, 'reports');
    const output = [{ type: 'reasoning', text: 'private draft' }, { type: 'text', text: 'abc🧪' }, { type: 'text', text: 'tail' }];
    const saved = reportStore(directory).write('child', 'owner', output);
    assert.deepEqual(deliveryOutput(output), output.slice(1));
    const restored = reportStore(directory).read('child', 'owner');
    assert.deepEqual(restored, saved); assert.equal(restored.text, 'abc🧪\n\ntail');
    const first = reportPage(restored, 0, 4);
    assert.equal(first.text, 'abc'); assert.equal(first.nextOffset, 3);
    const second = reportPage(restored, first.nextOffset, 4, first.sha256);
    const third = reportPage(restored, second.nextOffset, 4000, first.sha256);
    assert.equal(first.text + second.text + third.text, saved.text); assert.equal(third.nextOffset, null);
    for (const args of [[-1], [100], [4], [0, 4001], [0, 0]]) assert.throws(() => reportPage(restored, ...args), { code: 'INVALID_REPORT_PAGE' });
    assert.throws(() => reportStore(directory).read('child', 'other'), { code: 'REPORT_UNAVAILABLE' });
    assert.throws(() => reportStore(directory).write('child', 'owner', [{ type: 'text', text: 'overwrite' }]), { code: 'EEXIST' });
    assert.equal(reportStore(directory).read('child', 'owner').text, saved.text);
    assert.throws(() => reportStore(directory).read('../child', 'owner'), { code: 'INVALID_INSTANCE' });
    assert.throws(() => reportStore(directory).read('missing', 'owner'), { code: 'REPORT_UNAVAILABLE' });
    const empty = reportStore(directory).write('empty', 'owner', []); assert.equal(reportPage(empty).nextOffset, null);
    const target = join(root, 'foreign.json'); writeFileSync(target, JSON.stringify(saved));
    symlinkSync(target, join(directory, 'linked.json'));
    assert.throws(() => reportStore(directory).read('linked', 'owner'), { code: 'REPORT_UNAVAILABLE' });
    writeFileSync(join(directory, 'child.json'), JSON.stringify({ ...saved, text: 'tampered' }));
    assert.throws(() => reportStore(directory).read('child', 'owner'), { code: 'REPORT_UNAVAILABLE' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('report availability independently validates legacy one-shot, empty, missing, damaged and wrong-parent results',()=>{
 const root=mkdtempSync(join(tmpdir(),'book-report-status-'));
 try {
  const store=reportStore(root), record={instanceId:'child',parentId:'owner'};
  assert.deepEqual(savedReportStatus(store,record),{state:'unavailable'});
  const value=store.write('child','owner',[{type:'text',text:'intact'}]);
  assert.deepEqual(savedReportStatus(store,record),{state:'available',sha256:value.sha256,totalChars:6});
  assert.equal(savedReportStatus(store,{...record,parentId:'other'}).state,'unavailable');
  assert.equal(savedReportStatus(store,{...record,mode:'root'}),undefined);
  assert.equal(savedReportStatus(store,{...record,mode:'continuable'}),undefined);
  store.write('empty','owner',[]);
  assert.equal(savedReportStatus(store,{...record,instanceId:'empty'}).state,'empty');
  writeFileSync(join(root,'child.json'),'{}');
  assert.deepEqual(savedReportStatus(store,record),{state:'unavailable'});
 } finally {rmSync(root,{recursive:true,force:true});}
});

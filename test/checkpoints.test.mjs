import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageSnapshot,checkpointStore,checkpointExport} from '../lib/checkpoints.js';
const record={instanceId:'child',parentId:'parent',compiled:{compositionRevision:'original'}};
const events=[{type:'user/message',seq:1,time:1,data:{source:{kind:'user'},content:[{type:'text',text:'original task'}]}},
 {type:'assistant/message',seq:2,time:2,data:{message:{content:[{type:'reasoning',text:'PRIVATE_THOUGHT'},{type:'text',text:'progress'}]}}},
 {type:'tool/call',seq:3,time:3,data:{name:'bash',callId:'call',arguments:'PRIVATE_ARGS'}},
 {type:'tool/result',seq:4,time:4,data:{message:{content:[{type:'text',text:'PRIVATE_RESULT'}]}}}];
test('stage captures public progress and native positions, never tool payloads/reasoning or finality',()=>{
 const stage=stageSnapshot(record,events),data=JSON.parse(stage.text);
 const steered=stageSnapshot(record,[...events,{type:'user/message',seq:5,time:5,data:{source:{kind:'agent-message'},content:[{type:'text',text:'new steering'}]}}]);
 assert.equal(JSON.parse(steered.text).latestRequest.text,'new steering');
 assert.equal(JSON.parse(steered.text).task.text,'original task');
 assert.equal(data.final,false);assert.equal(data.task.text,'original task');assert.equal(data.draft.text,'progress');
 assert.equal(data.tools.lastName,'bash');assert.equal(data.source.seq,4);assert.equal(data.source.draftSeq,2);
 assert.ok(!stage.text.includes('PRIVATE_'));
 assert.equal(checkpointExport(stage).format,'subagentbook-checkpoint-v1');
 const long=stageSnapshot(record,[...events,{type:'assistant/message',seq:5,time:5,data:{message:{content:[{type:'text',text:'🧪'.repeat(20000)}]}}}]);
 assert.equal(JSON.parse(long.text).draft.truncated,true);
 assert.ok(!/[\uD800-\uDBFF]$/.test(JSON.parse(long.text).draft.text));
});
test('stage survives cold reads, fences stale events, validates owner/hash and refuses links/corruption',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sb-stage-'));
 try {
  const store=checkpointStore(join(dir,'stages')),value=stageSnapshot(record,events);
  assert.equal(store.read('child','parent'),undefined);store.write(value);
  assert.deepEqual(checkpointStore(join(dir,'stages')).read('child','parent'),value);
  assert.throws(()=>store.read('child','other'),{code:'CHECKPOINT_UNAVAILABLE'});
  assert.equal(store.write(stageSnapshot(record,events.slice(0,2))).seq,4);
  const file=join(dir,'stages/child.json');writeFileSync(file,'{}');
  assert.throws(()=>store.read('child','parent'),{code:'CHECKPOINT_UNAVAILABLE'});
  assert.throws(()=>store.write(value),{code:'CHECKPOINT_UNAVAILABLE'});
  rmSync(file);writeFileSync(join(dir,'secret'),'private');symlinkSync(join(dir,'secret'),file);
  assert.throws(()=>store.read('child','parent'),{code:'CHECKPOINT_UNAVAILABLE'});
  assert.throws(()=>store.read('../secret','parent'),{code:'CHECKPOINT_UNAVAILABLE'});
 }finally{rmSync(dir,{recursive:true,force:true});}
});

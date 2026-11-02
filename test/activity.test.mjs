import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { activityStore, activityView } from '../lib/activity.js';

test('latest activation survives reload and rejects stale settlement', () => {
 const dir=mkdtempSync(join(tmpdir(),'sb-activity-'));
 try {
  const s=activityStore(dir); s.record({id:'child',runId:'first'},'active'); s.record({id:'child',runId:'second'},'active');
  s.record({id:'child',runId:'first',stopReason:'completed'},'settled'); assert.equal(s.read('child').phase,'active');
  s.record({id:'child',runId:'second',stopReason:'error'},'settled');
  assert.equal(activityView({settlement:activityStore(dir).read('child')}).state,'failed');
  assert.equal(activityView({liveStatus:'running',settlement:s.read('child')}).state,'running');
  writeFileSync(join(dir,'child.json'),'{}'); assert.throws(()=>s.read('child'),/Invalid activity/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
test('missing turn end is unknown; native failure notice is evidence, not server liveness',()=>{
 const events=[{type:'turn/start',seq:1,time:10}];
 const notice={time:20,data:{source:{kind:'subagent-settled',senderSessionId:'child',summary:'Background subagent child failed before it finished.'}}};
 assert.equal(activityView({events}).state,'unknown');
 assert.equal(activityView({events,settlement:{phase:'settled',at:1,stopReason:'completed'}}).state,'unknown');
 assert.equal(activityView({events,notices:[notice],id:'child'}).state,'failed');
 assert.equal(activityView({events:[{type:'turn/start',seq:2,time:30}],notices:[notice],id:'child'}).state,'unknown');
 assert.equal(activityView({events,notices:[notice],id:'other'}).state,'unknown');
 assert.equal(activityView({events,notices:[{...notice,data:{source:{kind:'user',summary:notice.data.source.summary}}}],id:'child'}).state,'unknown');
 for(const [reason,state] of [['completed','completed'],['aborted','interrupted'],['max-tokens','limited'],['blocked','blocked']]) {
  assert.equal(activityView({events:[...events,{type:'turn/end',seq:2,time:20,data:{reason:{kind:reason}}}]}).state,state);
 }
});

test('cold unfinished turns are interrupted, without inventing a shutdown cause or overriding live/terminal evidence',()=>{
 const events=[{type:'turn/start',seq:1,time:10}];
 const cold={events,runtimeStartedAt:20,liveStatus:'idle'};
 assert.deepEqual(activityView(cold),{state:'interrupted',source:'recovery',reason:'previous-runtime-unsettled',at:10});
 assert.equal(activityView({...cold,liveStatus:'running'}).state,'running');
 assert.equal(activityView({...cold,runtimeStartedAt:5}).state,'idle');
 assert.equal(activityView({...cold,runtimeStartedAt:undefined}).state,'idle');
 assert.equal(activityView({runtimeStartedAt:20}).state,'unknown');
 assert.equal(activityView({runtimeStartedAt:20,settlement:{phase:'active',at:10}}).state,'interrupted');
 assert.equal(activityView({...cold,events:[...events,{type:'turn/end',seq:2,time:15,data:{reason:{kind:'completed'}}}]}).state,'completed');
 assert.equal(activityView({...cold,settlement:{phase:'settled',at:15,stopReason:'error'}}).state,'failed');
 assert.equal(activityView({...cold,events:[...events,{type:'turn/end',seq:2,time:15,data:{reason:{kind:'completed'}}},{type:'turn/start',seq:3,time:30}]}).state,'idle');
});

test('a newer active edge prevents an old completed turn from hiding an interrupted activation',()=>{
 const events=[{type:'turn/start',seq:1,time:10},{type:'turn/end',seq:2,time:15,data:{reason:{kind:'completed'}}}];
 const input={events,settlement:{phase:'active',at:30},runtimeStartedAt:40};
 assert.equal(activityView(input).state,'interrupted');
 assert.equal(activityView({...input,runtimeStartedAt:20}).state,'unknown');
 assert.equal(activityView({...input,liveStatus:'running'}).state,'running');
});

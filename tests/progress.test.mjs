import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {classifyRetryReason,readProgress,resolveTurnExecution} from '../lib/progress.mjs';

test('native execution outranks request errors and intermediate text, with conversation and turn guards',()=>{
  const turn={stepIndexStart:10,status:'error',completedAtMs:2000},execution={conversationId:'current',turnStartStepIndex:10,status:2,terminationReason:1};
  for(const status of [2,4]){
    const resolved=resolveTurnExecution(turn,{...execution,status},'current');
    assert.equal(resolved.status,'running');assert.equal(resolved.completedAtMs,null);
  }
  assert.equal(resolveTurnExecution({...turn,status:'complete'},execution,'current').status,'running');
  assert.equal(resolveTurnExecution(turn,{...execution,status:3},'current').status,'canceling');
  assert.equal(resolveTurnExecution(turn,{...execution,status:1,terminationReason:1},'current').status,'error');
  assert.equal(resolveTurnExecution(turn,{...execution,status:1,terminationReason:2},'current').status,'stopped');
  assert.equal(resolveTurnExecution(turn,{...execution,status:1,terminationReason:4},'current').status,'complete');
  assert.equal(resolveTurnExecution(turn,{...execution,conversationId:'other'},'current'),turn);
  assert.equal(resolveTurnExecution(turn,{...execution,turnStartStepIndex:0},'current'),turn);
  assert.equal(resolveTurnExecution(turn,{...execution,status:0},'current'),turn);
  assert.equal(resolveTurnExecution(turn,null,'current'),turn);assert.equal(turn.status,'error');
});

test('progress isolates the current turn and does not call untimed tools running or completed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'agy-progress-'));
  try{
    const latest={stepIndexStart:10,status:'running',startedAtMs:1000,toolCalls:[
      {id:'finished',itemLabel:'Read file',startedAtIso:new Date(1000).toISOString(),completedAtIso:new Date(2000).toISOString(),durationMs:1000},
      {id:'active',itemLabel:'Run build',startedAtIso:new Date(3000).toISOString(),completedAtIso:null},
      {id:'unknown',itemLabel:'Untimed',startedAtIso:null,completedAtIso:null}
    ]};
    const steps=[{step_index:2,tool_calls:[{name:'task_boundary',args:{TaskName:'Previous task',TaskStatus:'Previous step'}}]}];
    const p=readProgress(dir,'test',[latest],steps,6000);
    assert.equal(p.title,'');assert.equal(p.current,'Run build');assert.equal(p.elapsedMs,5000);
    assert.deepEqual(p.recentActivity.map(a=>a.status),['complete','running','recorded']);
    const complete=readProgress(dir,'test',[{...latest,status:'complete',completedAtMs:4500}],steps,9000);
    assert.equal(complete.elapsedMs,3500);assert.equal(complete.current,'');
    assert.deepEqual(complete.recentActivity.map(a=>a.status),['complete','recorded','recorded']);
    assert.equal(readProgress(dir,'test',[],steps).elapsedMs,null);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('progress reports detailed live phase for retrying, tool execution, thinking, and streaming',()=>{
  const dir=mkdtempSync(join(tmpdir(),'agy-progress-phase-'));
  try{
    assert.equal(classifyRetryReason('Post "https://...": unexpected EOF').code,'eof');
    assert.equal(classifyRetryReason('HTTP 503 Service Unavailable').code,'unavailable');
    assert.equal(classifyRetryReason('429 RESOURCE_EXHAUSTED').code,'rate-limit');
    assert.equal(classifyRetryReason('This service is not available in your region').code,'region');

    // 1. Retrying via generation retryErrors while turn is still running
    const retryingTurn={stepIndexStart:10,status:'running',startedAtMs:1000,toolCalls:[]};
    const retryingDb={
      generations:[{stepIndices:[11],retries:2,retryErrors:['Post "https://daily-cloudcode-pa.googleapis.com": unexpected EOF'],error:''}],
      times:new Map([[10,{createdMs:1000}],[11,{createdMs:5000}]])
    };
    const pRetry=readProgress(dir,'test',[retryingTurn],[{step_index:10,type:'USER_INPUT'},{step_index:11,type:'ERROR_MESSAGE',content:'Post "https://...": unexpected EOF'}],12000,retryingDb);
    assert.equal(pRetry.phase,'retrying');
    assert.equal(pRetry.retryCount,2);
    assert.equal(pRetry.retrySummary.code,'eof');
    assert.equal(pRetry.phaseElapsedMs,7000);

    // 2. Waiting for model / thinking after tool completes
    const thinkingTurn={stepIndexStart:10,status:'running',startedAtMs:1000,toolCalls:[{id:'t1',itemLabel:'Read file',startedAtIso:new Date(2000).toISOString(),completedAtIso:new Date(4000).toISOString(),durationMs:2000}]};
    const pThink=readProgress(dir,'test',[thinkingTurn],[{step_index:10,type:'USER_INPUT'},{step_index:11,type:'GENERIC'}],14000,{generations:[],times:new Map([[11,{completedMs:4000}]])});
    assert.equal(pThink.phase,'thinking');
    assert.equal(pThink.phaseElapsedMs,10000);

    // 3. Active tool takes priority
    const toolTurn={stepIndexStart:10,status:'running',startedAtMs:1000,toolCalls:[{id:'t2',itemLabel:'Run tests',startedAtIso:new Date(5000).toISOString(),completedAtIso:null}]};
    const pTool=readProgress(dir,'test',[toolTurn],[{step_index:10,type:'USER_INPUT'}],9000,{generations:[],times:new Map()});
    assert.equal(pTool.phase,'tool');
    assert.equal(pTool.phaseDetail,'Run tests');
    assert.equal(pTool.phaseElapsedMs,4000);

    // 4. Streaming planner response (viewableMs set, finishedMs not set)
    const pStream=readProgress(dir,'test',[retryingTurn],[{step_index:10,type:'USER_INPUT'},{step_index:11,type:'PLANNER_RESPONSE',content:'partial'}],9000,{generations:[],times:new Map([[11,{createdMs:2000,viewableMs:6000}]])});
    assert.equal(pStream.phase,'streaming');
    assert.equal(pStream.phaseElapsedMs,3000);

    // 5. Live execution state overrides stale disk fallback (streaming, thinking, waiting approval, live tool, live retry)
    const baseExec={conversationId:'test',turnStartStepIndex:10,status:2};
    const diskOnlyUser=[{step_index:10,type:'USER_INPUT'}];
    const pLiveStream=readProgress(dir,'test',[retryingTurn],diskOnlyUser,9000,null,{...baseExec,live:{waiting:false,lastCase:'plannerResponse',lastStatus:2,hasThinking:true,hasResponse:true,toolCallCount:0,toolName:''}});
    assert.equal(pLiveStream.phase,'streaming');

    const pLiveThink=readProgress(dir,'test',[retryingTurn],diskOnlyUser,9000,null,{...baseExec,live:{waiting:false,lastCase:'plannerResponse',lastStatus:2,hasThinking:true,hasResponse:false,toolCallCount:0,toolName:''}});
    assert.equal(pLiveThink.phase,'thinking');
    assert.equal(pLiveThink.phaseDetail,'thinking');

    const pLiveWait=readProgress(dir,'test',[retryingTurn],diskOnlyUser,9000,null,{...baseExec,live:{waiting:true,lastCase:'generic',lastStatus:9,hasThinking:false,hasResponse:false,toolCallCount:0,toolName:'run_command'}});
    assert.equal(pLiveWait.phase,'waiting');
    assert.equal(pLiveWait.phaseDetail,'run_command');

    const pLiveTool=readProgress(dir,'test',[retryingTurn],diskOnlyUser,9000,null,{...baseExec,live:{waiting:false,lastCase:'generic',lastStatus:2,hasThinking:false,hasResponse:false,toolCallCount:0,toolName:'run_command'}});
    assert.equal(pLiveTool.phase,'tool');
    assert.equal(pLiveTool.phaseDetail,'run_command');

    const pLiveRetry=readProgress(dir,'test',[retryingTurn],diskOnlyUser,9000,null,{...baseExec,live:{waiting:false,lastCase:'errorMessage',lastStatus:3,hasThinking:false,hasResponse:false,toolCallCount:0,toolName:'',errorText:'HTTP 503 Service Unavailable'}});
    assert.equal(pLiveRetry.phase,'retrying');
    assert.equal(pLiveRetry.retrySummary.code,'unavailable');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

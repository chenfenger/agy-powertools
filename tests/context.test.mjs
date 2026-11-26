import test from 'node:test';import assert from 'node:assert/strict';import {contextSnapshot,modelContexts,shortModelName} from '../lib/context.mjs';
const categories=[{key:'messages',label:'Chat Messages',tokens:293170},{key:'tools',label:'Tools',tokens:7336},{key:'system',label:'System Prompt',tokens:12380,children:[{label:'skills',tokens:3678}]}];
test('provider usage replaces the inflated local estimate from the same generation',()=>{
 const c=contextSnapshot({providerInputTokens:248366,context:{usedTokens:312886,maxTokens:256000,categories}});
 assert.equal(c.usedTokens,248366);assert.equal(c.estimatedUsedTokens,312886);assert.equal(c.usedPercent,97);assert.equal(c.source,'provider-usage');
 assert.equal(c.categories.reduce((n,g)=>n+g.tokens,0),256000);assert.equal(c.categories.filter(g=>g.key!=='free').reduce((n,g)=>n+g.tokens,0),248366);
 assert.ok(c.categories.every(g=>g.percent<=100));assert.ok(c.categories.filter(g=>g.key!=='free').every(g=>g.estimated));
});
test('inconsistent or missing capacity stays unknown instead of displaying a fabricated percentage',()=>{
 const estimated=contextSnapshot({context:{usedTokens:312886,maxTokens:256000,categories}});
 assert.equal(estimated.maxTokens,null);assert.equal(estimated.usedPercent,null);assert.equal(estimated.reportedMaxTokens,256000);
 const mismatch=contextSnapshot({providerInputTokens:300000,context:{usedTokens:312886,maxTokens:256000,categories}});
 assert.equal(mismatch.usedTokens,300000);assert.equal(mismatch.usedPercent,null);
 assert.equal(contextSnapshot({providerInputTokens:100}).usedPercent,null);const zero=contextSnapshot({providerInputTokens:100,context:{maxTokens:1000,categories:[{tokens:0}]}});assert.equal(zero.categories[0].tokens,100);assert.equal(zero.categories[0].estimated,false);
 const fallback=contextSnapshot(null,1000);assert.equal(fallback.usedTokens,1000);assert.equal(fallback.source,'transcript');
});

test('modelContexts tracks Orchestrator planner and execution models, short names, and compactions',()=>{
 assert.equal(shortModelName('Gemini 4 Carbon (High)'),'Carbon');
 assert.equal(shortModelName('Gemini 4 Hydrogen (High)'),'Hydrogen');
 assert.equal(shortModelName('gemini-3.8-flash-n'),'3.8 Flash');
 const orchestrator=modelContexts([
  {modelName:'Gemini 4 Carbon (High)',role:'planner',providerInputTokens:295000,context:{maxTokens:512000}},
  {modelName:'Gemini 4 Hydrogen (High)',role:'execution',providerInputTokens:480000,context:{maxTokens:512000}},
  {modelName:'Gemini 4 Hydrogen (High)',role:'execution',providerInputTokens:217000,context:{maxTokens:512000}}
 ],[564]);
 assert.equal(orchestrator.hasOrchestrator,true);
 assert.equal(orchestrator.compactions,1);
 assert.equal(orchestrator.models.length,2);
 assert.equal(orchestrator.models[0].role,'planner');assert.equal(orchestrator.models[0].shortName,'Carbon');assert.equal(orchestrator.models[0].isCurrent,false);
 assert.equal(orchestrator.models[1].role,'execution');assert.equal(orchestrator.models[1].shortName,'Hydrogen');assert.equal(orchestrator.models[1].isCurrent,true);assert.equal(orchestrator.models[1].compactions,1);

 const plainMulti=modelContexts([
  {modelName:'Gemini 4 Carbon (High)',role:'',providerInputTokens:578000,context:{maxTokens:786432}},
  {modelName:'Gemini 4 Neon (XHigh)',role:'',providerInputTokens:583000,context:{maxTokens:786432}}
 ],[]);
 assert.equal(plainMulti.hasOrchestrator,false);
 assert.equal(plainMulti.models[0].role,'');assert.equal(plainMulti.models[1].shortName,'Neon');assert.equal(plainMulti.models[1].isCurrent,true);

 const sparseOrch=modelContexts([
  {modelName:'Orchestrator (Neon)',modelEnum:1537,executionModelEnum:null,role:'',providerInputTokens:100000,context:{maxTokens:786432}},
  {modelName:'Gemini 4 Hydrogen (High)',modelEnum:1669,executionModelEnum:null,role:'',providerInputTokens:180000,context:{maxTokens:786432}},
  {modelName:'Orchestrator (Neon)',modelEnum:1537,executionModelEnum:1669,role:'planner',providerInputTokens:220000,context:{maxTokens:786432}}
 ],[]);
 assert.equal(sparseOrch.hasOrchestrator,true);
 assert.equal(sparseOrch.models.length,2);
 assert.equal(sparseOrch.models[0].role,'planner');assert.equal(sparseOrch.models[0].shortName,'Orchestrator');assert.equal(sparseOrch.models[0].isCurrent,true);
 assert.equal(sparseOrch.models[1].role,'execution');assert.equal(sparseOrch.models[1].shortName,'Hydrogen');assert.equal(sparseOrch.models[1].isCurrent,false);
});


test('contextSnapshot immediately reflects post-compaction estimate when a completed CHECKPOINT step follows the latest generation (Issue #48)', () => {
  const gen = { stepIndices: [100, 101], providerInputTokens: 780000, context: { usedTokens: 775000, maxTokens: 786432, categories } };
  const c = contextSnapshot(gen, 0, { stepIndex: 105, summaryTokens: 6200 });
  assert.equal(c.compactedPending, true);
  assert.equal(c.source, 'post-compact-estimate');
  assert.equal(c.preCompactUsedTokens, 780000);
  assert.equal(c.preCompactPercent, 99.2);
  // Fixed categories (Tools 7336 + System Prompt 8702 + Skills 3678 = 19716) + summary 6200 = 25916 (~3.3%)
  assert.equal(c.usedTokens, 25916);
  assert.equal(c.usedPercent, 3.3);
  assert.equal(c.categories.reduce((n, g) => n + g.tokens, 0), 786432);
  const mc = modelContexts([{ ...gen, modelName: 'Gemini 4 Carbon (High)' }], [105], c);
  assert.equal(mc.models[0].usedTokens, 25916);
  assert.equal(mc.models[0].usedPercent, 3.3);

  // Once a newer generation exists after the checkpoint, normal provider-usage resumes
  const nextGen = { stepIndices: [106, 107], providerInputTokens: 29170, context: { usedTokens: 31000, maxTokens: 786432, categories } };
  const after = contextSnapshot(nextGen, 0, { stepIndex: 105, summaryTokens: 6200 });
  assert.equal(after.compactedPending, false);
  assert.equal(after.source, 'provider-usage');
  assert.equal(after.usedTokens, 29170);
});

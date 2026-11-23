import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';
function render(status,tasks=[]){
 const R={createElement:(type,props,...children)=>({type,props:props||{},children}),useSyncExternalStore:(_,snapshot)=>snapshot()};
 const context=vm.createContext({React:R,dq:'icon',document:{createElement:()=>({dataset:{},remove(){}}),head:{append(){}}}});
 vm.runInContext(readFileSync(new URL('../lib/native-panels.js',import.meta.url),'utf8'),context);
 const panels=context.__agyPanels({t:v=>v,options:()=>({progress:true,language:'en'}),state:()=>({conversationId:'test',progress:{status,tasks}}),subscribe:()=>()=>{},revision:()=>0});
 function text(node){if(typeof node==='string')return node;if(Array.isArray(node))return node.map(text).join(' ');return node&&typeof node==='object'?text(node.children):'';}
 return text(panels.Progress());
}
test('progress distinguishes active, failed, stopped and stopping states even when a checklist is complete',()=>{
 const done=[{title:'Example task',status:'complete'}];
 assert.ok(render('running',done).includes('进行中'));assert.ok(render('error',done).includes('错误'));
 assert.ok(render('stopped',done).includes('Stopped'));assert.ok(!render('stopped',done).includes('已完成'));
 assert.ok(render('canceling').includes('Stopping'));assert.ok(render('stopped').includes('Stopped'));
});

test('progress integrates live phase into header, renders connected activity trail with step durations, and omits filler captions', () => {
  const renderProgress = progress => {
    const R = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useSyncExternalStore: (_, snapshot) => snapshot() };
    const context = vm.createContext({ React: R, dq: 'icon', document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } } });
    vm.runInContext(readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8'), context);
    const panels = context.__agyPanels({
      t: v => v,
      options: () => ({ progress: true, language: 'zh-CN' }),
      state: () => ({ conversationId: 'conv-1', progress }),
      subscribe: () => () => {},
      revision: () => 0
    });
    return panels.Progress();
  };
  const collectText = node => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    return node && typeof node === 'object' ? collectText(node.children) : '';
  };

  const runningTree = renderProgress({
    status: 'running',
    phase: 'tool',
    phaseDetail: 'run_command',
    toolCount: 2,
    elapsedMs: 17000,
    recentActivity: [
      { id: 'c1', label: 'Read config.json', groupKey: 'reads', status: 'complete', durationMs: 420 },
      { id: 'c2', label: 'Run npm test', groupKey: 'commands', status: 'running', durationMs: null }
    ]
  });
  const runningText = collectText(runningTree);
  assert.ok(runningText.includes('正在执行：run_command'));
  assert.ok(runningText.includes('0.4s'));
  assert.ok(runningText.includes('执行中'));
  assert.ok(!runningText.includes('最近活动'));
  assert.equal(runningText.includes('\u00b7'), false);

  const doneTree = renderProgress({
    status: 'complete',
    toolCount: 2,
    elapsedMs: 25000,
    recentActivity: [{ id: 'c1', label: 'Read config.json', groupKey: 'reads', status: 'complete', durationMs: 420 }]
  });
  const doneText = collectText(doneTree);
  assert.ok(doneText.includes('已完成'));
  assert.ok(!doneText.includes('本轮已结束'));
  assert.ok(!doneText.includes('最近活动'));
  assert.ok(doneText.includes('0:25'));
});

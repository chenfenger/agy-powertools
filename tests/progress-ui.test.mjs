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

test('progress supports native-style collapsing with compact status badge and persists state', () => {
  const storage = new Map();
  let stateVal;
  let hookInit = false;
  const R = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useSyncExternalStore: (_, snapshot) => snapshot(),
    useState: init => {
      if (!hookInit) {
        stateVal = typeof init === 'function' ? init() : init;
        hookInit = true;
      }
      return [stateVal, next => { stateVal = typeof next === 'function' ? next(stateVal) : next; }];
    }
  };
  const states = [];
  let idx = 0;
  R.useState = init => {
    const i = idx++;
    if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
    return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
  };
  const context = vm.createContext({
    React: R,
    dq: 'icon',
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } }
  });
  vm.runInContext(readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8'), context);
  const panels = context.__agyPanels({
    t: v => v,
    options: () => ({ progress: true, language: 'zh-CN' }),
    state: () => ({ conversationId: 'conv-1', progress: { status: 'complete', toolCount: 5, elapsedMs: 65000, recentActivity: [{ id: 'a1', label: 'Read app.js', status: 'complete', durationMs: 300 }] } }),
    subscribe: () => () => {},
    revision: () => 0
  });
  const findByTestId = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (node.props?.['data-testid'] === id) return node;
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findByTestId(c, id);
      if (hit) return hit;
    }
    return null;
  };
  const collectText = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(collectText).join(' ') : (node && typeof node === 'object' ? collectText(node.children) : '');

  idx = 0;
  const expanded = panels.Progress();
  const toggle = findByTestId(expanded, 'agy-progress-toggle');
  assert.ok(toggle);
  assert.equal(toggle.props['aria-expanded'], true);
  assert.ok(collectText(expanded).includes('Read app.js'));

  toggle.props.onClick();
  assert.equal(storage.get('agy-powertools:ov-open:progress'), '0');

  idx = 0;
  const collapsed = panels.Progress();
  const collapsedToggle = findByTestId(collapsed, 'agy-progress-toggle');
  assert.equal(collapsedToggle.props['aria-expanded'], false);
  const collapsedText = collectText(collapsed);
  assert.ok(collapsedText.includes('任务进度'));
  assert.ok(collapsedText.includes('已完成 1:05'));
  assert.ok(!collapsedText.includes('Read app.js'));
  assert.equal(collapsedText.includes('\u00b7'), false);
});

test('progress renders subagent and background phases in expanded and collapsed views', () => {
  const renderWith = (progress, language = 'zh-CN', initiallyOpen = true) => {
    const storage = new Map([['agy-powertools:ov-open:progress', initiallyOpen ? '1' : '0']]);
    const states = [];
    let idx = 0;
    const R = {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useSyncExternalStore: (_, snapshot) => snapshot(),
      useState: init => {
        const i = idx++;
        if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
        return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
      }
    };
    const context = vm.createContext({
      React: R,
      dq: 'icon',
      localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
      document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } }
    });
    vm.runInContext(readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8'), context);
    const panels = context.__agyPanels({
      t: v => v,
      options: () => ({ progress: true, language }),
      state: () => ({ conversationId: 'conv-1', progress }),
      subscribe: () => () => {},
      revision: () => 0
    });
    const collectText = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(collectText).join(' ') : (node && typeof node === 'object' ? collectText(node.children) : '');
    return collectText(panels.Progress());
  };

  const singleZh = renderWith({ status: 'running', phase: 'subagent', activeSubagentCount: 1, phaseDetail: 'UI Verification', elapsedMs: 75000 });
  assert.ok(singleZh.includes('子智能体运行中：UI Verification'));
  assert.ok(!singleZh.includes('已完成'));
  assert.equal(singleZh.includes('\u00b7'), false);

  const multiZh = renderWith({ status: 'running', phase: 'subagent', activeSubagentCount: 3, phaseDetail: '3', elapsedMs: 75000 });
  assert.ok(multiZh.includes('子智能体运行中（3 个）'));

  const bgZh = renderWith({ status: 'running', phase: 'background', elapsedMs: 30000 });
  assert.ok(bgZh.includes('等待后台任务完成'));

  const collapsedSubZh = renderWith({ status: 'running', phase: 'subagent', activeSubagentCount: 1, phaseDetail: 'UI Verification', elapsedMs: 75000 }, 'zh-CN', false);
  assert.ok(collapsedSubZh.includes('子智能体 1:15'));
  assert.equal(collapsedSubZh.includes('\u00b7'), false);

  const collapsedBgEn = renderWith({ status: 'running', phase: 'background', elapsedMs: 30000 }, 'en', false);
  assert.ok(collapsedBgEn.includes('Background 0:30'));

  const singleEn = renderWith({ status: 'running', phase: 'subagent', activeSubagentCount: 1, phaseDetail: 'UI Verification', elapsedMs: 75000 }, 'en', true);
  assert.ok(singleEn.includes('Subagent running: UI Verification'));
});

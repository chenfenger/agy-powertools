import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startNativeIntegration,declaredNativeNames,isSwarmTarget,swarmI18nSource} from '../lib/native-host.mjs';

test('same window reattaches after an updater changes the origin or debug endpoint',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'agy-recovery-')),portFile=join(directory,'port');
  writeFileSync(portFile,'12345\n');
  const originalFetch=globalThis.fetch,clients=[],origins=[];
  let target={id:'same-window',type:'page',title:'Conversation - Antigravity',url:'https://127.0.0.1:5000/c/a',webSocketDebuggerUrl:'ws://127.0.0.1:12345/devtools/page/a'};
  globalThis.fetch=async()=>({json:async()=>[target]});
  let stop;
  try{
    stop=startNativeIntegration({portFile,parseSessionData:()=>({}),onStatus:()=>{},discover:async origin=>{origins.push(origin);return ['sampleNativeName'];},connect:async endpoint=>{
      const client={endpoint,closed:false,calls:[],onEvent(){},socket:{addEventListener(){},close(){client.closed=true;}},async send(method,params){this.calls.push({method,params});if(method==='Page.getFrameTree')return{frameTree:{frame:{id:'frame'}}};if(method==='Page.addScriptToEvaluateOnNewDocument')return{identifier:'script'};return{result:{value:false}};}};
      clients.push(client);return client;
    }});
    await stop.ready;
    assert.equal(clients.length,1);
    target={...target,url:'https://127.0.0.1:6000/c/a'};
    await stop.check();
    assert.equal(clients.length,2);assert.equal(clients[0].closed,true);
    assert.deepEqual(origins,['https://127.0.0.1:5000','https://127.0.0.1:6000']);
    target={...target,webSocketDebuggerUrl:'ws://127.0.0.1:12345/devtools/page/b'};
    await stop.check();
    assert.equal(clients.length,3);assert.equal(clients[1].closed,true);
    for(const client of clients)assert.ok(client.calls.some(c=>c.method==='Page.addScriptToEvaluateOnNewDocument'));
  }finally{await stop?.();globalThis.fetch=originalFetch;rmSync(directory,{recursive:true,force:true});}
});

test('component discovery includes lexical declarations without executing bundle text',()=>{
  const source='var Alpha=1;const Beta=2,Gamma=3;let Delta=4;globalThis.sideEffect();';
  assert.deepEqual(declaredNativeNames(source),['Alpha','Beta','Gamma','Delta']);
});

test('onMissingDebugPort triggers on missing/refused port before connection, ignores transient timeouts, and stops after debug port is ready', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-port-guard-'));
  const missingFile = join(dir, 'missing-port');
  const activeFile = join(dir, 'active-port');
  writeFileSync(activeFile, '12345\n');
  const originalFetch = globalThis.fetch;

  let stopMissing, stopTimeout, stopReady;
  try {
    let missingCalls = 0;
    stopMissing = startNativeIntegration({
      portFile: missingFile,
      parseSessionData: () => ({}),
      onStatus: () => {},
      onMissingDebugPort: () => { missingCalls++; }
    });
    await stopMissing.ready;
    assert.equal(missingCalls, 1, 'missing DevToolsActivePort file should notify onMissingDebugPort');

    globalThis.fetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    };
    let refusedCalls = 0;
    const stopRefused = startNativeIntegration({
      portFile: activeFile,
      parseSessionData: () => ({}),
      onStatus: () => {},
      onMissingDebugPort: () => { refusedCalls++; }
    });
    try {
      await stopRefused.ready;
      assert.equal(refusedCalls, 1, 'ECONNREFUSED before first connection should notify onMissingDebugPort');
    } finally {
      await stopRefused();
    }

    let fetchMode = 'timeout';
    globalThis.fetch = async () => {
      if (fetchMode === 'timeout') throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
      if (fetchMode === 'abort') throw Object.assign(new Error('Aborted'), { name: 'AbortError', code: 'ABORT_ERR' });
      if (fetchMode === 'refused') throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      return { json: async () => [] };
    };
    let timeoutMissingCalls = 0;
    stopTimeout = startNativeIntegration({
      portFile: activeFile,
      parseSessionData: () => ({}),
      onStatus: () => {},
      onMissingDebugPort: () => { timeoutMissingCalls++; }
    });
    await stopTimeout.ready;
    fetchMode = 'abort';
    await stopTimeout.check();
    assert.equal(timeoutMissingCalls, 0, 'transient timeouts before connection must not trigger onMissingDebugPort');

    let readyCalls = 0, postReadyMissingCalls = 0;
    fetchMode = 'ok';
    stopReady = startNativeIntegration({
      portFile: activeFile,
      parseSessionData: () => ({}),
      onStatus: () => {},
      onDebugPortReady: () => { readyCalls++; },
      onMissingDebugPort: () => { postReadyMissingCalls++; }
    });
    await stopReady.ready;
    assert.equal(readyCalls, 1, 'successful /json/list poll should invoke onDebugPortReady');

    fetchMode = 'timeout';
    await stopReady.check();
    fetchMode = 'refused';
    await stopReady.check();
    assert.equal(postReadyMissingCalls, 0, 'subsequent timeout or ECONNREFUSED after debug port reached must not trigger onMissingDebugPort');
  } finally {
    await stopMissing?.();
    await stopTimeout?.();
    await stopReady?.();
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('isSwarmTarget and startNativeIntegration localize Swarm plugin iframes and dispose cleanly', async () => {
  assert.equal(isSwarmTarget({ type: 'iframe', url: 'plugin://swarm--swarm_board-123/index.html' }), true);
  assert.equal(isSwarmTarget({ type: 'page', url: 'plugin://swarm--swarm_board-123/index.html' }), false);
  assert.equal(isSwarmTarget({ type: 'iframe', url: 'https://127.0.0.1:5000/c/a' }), false);
  const src = swarmI18nSource({ enabled: true, language: 'zh-TW' });
  assert.doesNotThrow(() => new Function(src));
  assert.ok(src.includes('"language":"zh-TW"'));

  const dir = mkdtempSync(join(tmpdir(), 'agy-swarm-i18n-'));
  const portFile = join(dir, 'port');
  writeFileSync(portFile, '12345\n');
  const originalFetch = globalThis.fetch;
  const swarmClientCalls = [];
  let swarmClosed = false;
  globalThis.fetch = async () => ({
    json: async () => [
      { id: 'swarm-1', type: 'iframe', title: 'Swarm', url: 'plugin://swarm--swarm_board-abc/index.html', webSocketDebuggerUrl: 'ws://127.0.0.1:12345/devtools/page/swarm-1' }
    ]
  });
  let stop;
  try {
    stop = startNativeIntegration({
      portFile,
      parseSessionData: () => ({}),
      onStatus: () => {},
      connect: async () => ({
        onEvent() {},
        socket: { addEventListener() {}, close() { swarmClosed = true; } },
        async send(method, params) {
          swarmClientCalls.push({ method, params });
          if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'swarm-script-1' };
          return { result: { value: { ready: true, lang: 'zh-CN' } } };
        }
      })
    });
    await stop.ready;
    assert.ok(swarmClientCalls.some(c => c.method === 'Runtime.evaluate' && String(c.params?.expression || '').includes('__agyLocalization')));
    await stop();
    assert.equal(swarmClosed, true);
    assert.ok(swarmClientCalls.some(c => c.method === 'Runtime.evaluate' && c.params?.expression === 'globalThis.__agyLocalization?.dispose()'));
    assert.ok(swarmClientCalls.some(c => c.method === 'Page.removeScriptToEvaluateOnNewDocument' && c.params?.identifier === 'swarm-script-1'));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

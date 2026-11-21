import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { devToolsPortFile } from './paths.mjs';
import { createNativeDeclarationCache } from './native-cache.mjs';
import { checkForUpdates, projectInfo } from './updates.mjs';
import { startUpdate, updateStatus } from './update-manager.mjs';
export { declaredNativeNames } from './native-cache.mjs';
import { createSettingsStore } from './settings.mjs';
import { usageDashboard } from './analytics.mjs';
import { createPricingStore, estimateCost } from './pricing.mjs';
import { createQuotaTracker } from './quota.mjs';
import { createAccountsStore } from './accounts.mjs';
import { installationPaths } from './lifecycle.mjs';
import { checkProxyPortOpen, inspectProxyRuntime, probeProxyConnectivity } from './proxy.mjs';
import { copyLocalFile, isRemoteSshEnvironment, notifyTaskbarAttention, openLocalFile, resolveLocalFilePath, scheduleRelaunchWithDebugPort } from './launcher.mjs';

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), 'native-ui.js');
export const isHubTarget = target => {
  try {
    const url = new URL(target.url);
    return target.type === 'page' && /(?:^| - |\(\d+\) )Antigravity(?:\s*(?:\([^)]+\)|\[[^\]]+\]))?$/.test(target.title || '') && url.protocol === 'https:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch { return false; }
};

export function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let sequence = 0;
    const listeners = new Set();
    const timeout = setTimeout(() => { socket.close(); reject(new Error('调试接口连接超时')); }, 4000);
    const close = () => {
      for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('调试接口已断开')); }
      pending.clear();
    };
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('调试接口不可用')); });
    socket.addEventListener('close', close);
    socket.addEventListener('message', event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      const p = pending.get(message.id);
      if (p) {
        clearTimeout(p.timer); pending.delete(message.id);
        if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
      } else for (const listener of listeners) listener(message);
    });
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve({
        socket,
        onEvent: listener => listeners.add(listener),
        send(method, params = {}) {
          if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('调试接口已断开'));
          return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timeoutMs = ['Page.captureScreenshot', 'Runtime.evaluate'].includes(method) ? 15000 : 5000;
            const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, timeoutMs);
            pending.set(id, { resolve, reject, timer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        }
      });
    });
  });
}

export function findIdentifier(result, keys = ['conversationId', 'conversation_id', 'cascadeId', 'cascade_id']) {
  if (!result || typeof result !== 'object') return null;
  for (const key of keys) if (typeof result[key] === 'string' && result[key]) return result[key];
  for (const value of Object.values(result)) {
    if (value && typeof value === 'object') { const id = findIdentifier(value, keys); if (id) return id; }
  }
  return null;
}

const nativeDeclarations=createNativeDeclarationCache();
const pluginVersion=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).version;

export function nativeSource(origin,declaredNames=[]) {
  const dashboard=readFileSync(join(dirname(scriptPath),'dashboard.mjs'),'utf8').replaceAll('export function','function');
  const cache=readFileSync(join(dirname(scriptPath),'cache.mjs'),'utf8').replaceAll('export function','function');
  const accountHelpers=readFileSync(join(dirname(scriptPath),'account-helpers.mjs'),'utf8').replaceAll('export function','function');
  const bindings=readFileSync(join(dirname(scriptPath),'native-bindings.js'),'utf8');
  const aliases=['B','HC','IC','JC','KC','GC','Uy','XP','UP','TP','VP','dq','k0','Sy','kT','lT','mT','nT','Mmc','um','HU','I','tc','Wb','IJ','LN','VD','Wz','YF'];
  const scripts=['native-client.js','native-i18n.js','calendar-vendor.js','native-panels.js','native-ui.js'].map(name=>readFileSync(join(dirname(scriptPath),name),'utf8')).join('\n');
  return `if(location.origin===${JSON.stringify(origin)} && window===window.top && (globalThis.__agyPowertools?.version!==${JSON.stringify(pluginVersion)}||globalThis.__agyPowertools?.status?.healthy===false) && !globalThis.__agyNativeBootPending){\nglobalThis.__agyInitialSettings=${JSON.stringify(createSettingsStore().get())};\n globalThis.__agyProject=${JSON.stringify(projectInfo())};\n(()=>{${dashboard}\n${cache}\n${accountHelpers}\nglobalThis.__agyDashboard={modelIdentity,dateRange,summarizeRequests,subscriptionIdentity,cacheObservation,distributionModels};\nglobalThis.__agyAccounts={quotaGroupMeta,accountBucketStatus,summarizeAccountQuota,formatRelativeTime,formatResetCountdown,formatCompactCountdown,accountInitials,selectAutoSwitchCandidate};})();\n${bindings}\nglobalThis.__agyNativeBootPending=true;\n(function boot(){if(!document.head||!document.body||!globalThis.ReactDOM?.createRoot||!globalThis.createFileRoute){setTimeout(boot,100);return;}try{globalThis.__agyPowertools?.dispose();const resolved=globalThis.__agyResolveNativeBindings(${JSON.stringify(declaredNames)});globalThis.__agyNativeBindings=resolved.bindings;globalThis.__agyNativeBindingNames=resolved.names;delete globalThis.__agyCompatibilityError;(function({${aliases.join(',')}}){\n${scripts}\n})(resolved.bindings);}catch(error){globalThis.__agyCompatibilityError=error.message;console.error(error);}finally{delete globalThis.__agyNativeBootPending;}})();\n}`;
}

export function startNativeIntegration({ parseSessionData, portFile, onStatus = console.log, onMissingDebugPort, connect=connectCdp,discover=nativeDeclarations }) {
  const dataDir = join(homedir(),'.gemini','antigravity','plugin_data','agy-powertools');
  const settings = createSettingsStore();
  const pricing = createPricingStore(dataDir);
  const quota = createQuotaTracker(dataDir);
  let relaunchPendingUntil = 0;
  const triggerRelaunch = () => {
    if (Date.now() < relaunchPendingUntil) throw new Error('正在重启 Antigravity，请稍候');
    const res = scheduleRelaunchWithDebugPort({ dataDir, home: installationPaths().home });
    relaunchPendingUntil = Date.now() + 10000;
    return res;
  };
  const accounts = createAccountsStore(dataDir, {
    relaunch: () => triggerRelaunch()
  });
  const activePortFile = devToolsPortFile({portFile});
  const clients = new Map();
  let stopped = false, polling = false, lastStatus = '';
  const status = message => { if (message !== lastStatus) { lastStatus = message; onStatus(`[native-ui] ${message}`); } };
  const attach = async target => {
    const client = await connect(target.webSocketDebuggerUrl);
    const origin = new URL(target.url).origin;
    const mainFrame = (await client.send('Page.getFrameTree')).frameTree.frame.id;
    const contexts = new Set();
    clients.set(target.id, client);
    client.socket.addEventListener('close', () => { if(clients.get(target.id)===client)clients.delete(target.id); });
    client.onEvent(async event => {
      if (event.method === 'Runtime.executionContextCreated') {
        const context = event.params.context;
        if (context.origin === origin && context.auxData?.isDefault && context.auxData.frameId === mainFrame) contexts.add(context.id);
        return;
      }
      if (event.method === 'Runtime.executionContextDestroyed') { contexts.delete(event.params.executionContextId); return; }
      if (event.method === 'Runtime.executionContextsCleared') { contexts.clear(); return; }
      if (event.method !== 'Runtime.bindingCalled' || event.params.name !== '__agyPowertoolsHost') return;
      if (!contexts.has(event.params.executionContextId)) return;
      let request;
      try { if (event.params.payload.length > 65536) return; request = JSON.parse(event.params.payload); } catch { return; }
      if (!Number.isInteger(request.id)) return;
      let reply;
      try {
        if(!settings.get().enabled&&!['settings.get','settings.set','update.check','update.install','update.status'].includes(request.method))throw new Error('Powertools 已关闭');
        if (request.method === 'state') {
          const session = parseSessionData(request.conversationId, { includeSessions: false, strict: true, execution: request.execution });
          const rates = pricing.get().rates;
          const costUsd = (session.requests || []).reduce((sum, r) => sum + (estimateCost(r, rates) || 0), 0);
          reply = { ...session, telemetry: { ...session.telemetry, costUsd }, settings: settings.get() };
        }
        else if (request.method === 'settings.get') reply = settings.get();
        else if (request.method === 'settings.set') reply = settings.set(request.settings);
        else if (request.method === 'dashboard') {
          const data = usageDashboard(process.env.ANTIGRAVITY_APP_DATA_DIR || join(homedir(),'.gemini','antigravity'), { force:request.force===true });
          const prices=pricing.get();
          reply={...data,pricing:prices,requests:data.requests.map(r=>({...r,costUsd:estimateCost(r,prices.rates)}))};
        }
        else if (request.method === 'update.check') reply = await checkForUpdates({currentVersion:pluginVersion});
        else if (request.method === 'update.install') reply = await startUpdate({currentVersion:pluginVersion,expectedVersion:request.version});
        else if (request.method === 'update.status') reply = updateStatus();
        else if (request.method === 'pricing.refresh') reply = await pricing.refresh();
        else if (request.method === 'quota.observe') reply = quota.observe(request.groups,usageDashboard(process.env.ANTIGRAVITY_APP_DATA_DIR || join(homedir(),'.gemini','antigravity'), { force: true }).requests,pricing.get().rates,Date.now(),request.accountKey);
        else if (typeof request.method === 'string' && request.method.startsWith('accounts.')) {
          if (!settings.get().multiAccount) throw new Error('多账号切换未启用');
          if (request.method === 'accounts.list') reply = accounts.list();
          else if (request.method === 'accounts.syncActive') reply = accounts.syncActive(request.snapshot);
          else if (request.method === 'accounts.prepareAdd') reply = accounts.prepareAdd({ pendingAlias: request.pendingAlias });
          else if (request.method === 'accounts.switch') reply = accounts.switchAccount(request.accountId, { auto: request.auto === true, triggerRelaunch: request.relaunch !== false });
          else if (request.method === 'accounts.rename') reply = accounts.renameAccount(request.accountId, request.alias);
          else if (request.method === 'accounts.setDisabled') reply = accounts.setDisabled(request.accountId, request.disabled);
          else if (request.method === 'accounts.reorder') reply = accounts.reorderAccounts(request.orderedIds);
          else if (request.method === 'accounts.refreshCredentials') reply = accounts.refreshCredentials({ accountId: request.accountId || '' });
          else if (request.method === 'accounts.refreshLocalQuotas') reply = accounts.refreshLocalQuotas({ accountId: request.accountId || '' });
          else if (request.method === 'accounts.remove') reply = accounts.removeAccount(request.accountId);
          else if (request.method === 'accounts.autoSwitchCandidate') reply = accounts.pickAutoSwitch(request.depletedGroupKey);
          else throw new Error('不支持的操作');
        }
        else if (request.method === 'proxy.status') {
          reply = {
            ...inspectProxyRuntime(settings.get(), process.env),
            canRelaunch: !isRemoteSshEnvironment(),
            relaunching: Date.now() < relaunchPendingUntil
          };
        }
        else if (request.method === 'proxy.test') {
          const targetUrl = typeof request.proxyUrl === 'string' ? request.proxyUrl : settings.get().proxyUrl;
          const probed = await probeProxyConnectivity(targetUrl);
          reply = { ok: probed.ok, reachable: probed.reachable, tunnelOk: probed.tunnelOk, latencyMs: probed.latencyMs, statusCode: probed.statusCode, url: probed.url, message: probed.error || '' };
        }
        else if (request.method === 'proxy.relaunch') {
          if (isRemoteSshEnvironment()) throw new Error('SSH 远端模式不支持重启本地客户端');
          const current = settings.get();
          if (current.proxyEnabled && current.proxyUrl && request.force !== true) {
            const portCheck = await checkProxyPortOpen(current.proxyUrl, 900);
            if (!portCheck.ok) {
              reply = { ok: false, portUnreachable: true, message: portCheck.error, host: portCheck.host, port: portCheck.port };
            } else {
              const launched = triggerRelaunch();
              reply = { ok: true, relaunching: Boolean(launched.scheduled), proxyActive: Boolean(launched.proxyActive) };
            }
          } else {
            const launched = triggerRelaunch();
            reply = { ok: true, relaunching: Boolean(launched.scheduled), proxyActive: Boolean(launched.proxyActive) };
          }
        }
        else if (request.method === 'window.attention') { notifyTaskbarAttention({ count: Number(request.count) || 0 }); reply = { ok: true }; }
        else if (request.method === 'file.open') { if (!settings.get().fileContextMenu) throw new Error('文件右键菜单已关闭'); reply = openLocalFile(request.uri, { action: 'open' }); }
        else if (request.method === 'file.reveal') { if (!settings.get().fileContextMenu) throw new Error('文件右键菜单已关闭'); reply = openLocalFile(request.uri, { action: 'reveal' }); }
        else if (request.method === 'file.copy') { if (!settings.get().fileContextMenu) throw new Error('文件右键菜单已关闭'); reply = await copyLocalFile(request.uri); }
        else if (request.method === 'file.path') { if (!settings.get().fileContextMenu) throw new Error('文件右键菜单已关闭'); reply = { ok: true, path: resolveLocalFilePath(request.uri) }; }
        else throw new Error('不支持的操作');
      } catch (error) { reply = { error: error.message }; }
      try {
        await client.send('Runtime.evaluate', {
          expression: `globalThis.__agyPowertoolsReceive?.(${JSON.stringify(request.id)},${JSON.stringify(reply)})`,
          contextId: event.params.executionContextId
        });
      } catch { /* Navigation invalidates the old context. */ }
    });
    await client.send('Runtime.enable');
    await client.send('Runtime.addBinding', { name: '__agyPowertoolsHost' });
    const agent=await client.send('Runtime.evaluate',{expression:'navigator.userAgent',returnByValue:true});
    const version=agent.result?.value?.match?.(/Antigravity\/([0-9.]+)/)?.[1]||'unknown';
    const fallbackFetch=async()=>{
      const fetched=await client.send('Runtime.evaluate',{
        expression:`fetch('/main.js').then(async r=>({status:r.status,source:r.ok?await r.text():'',headers:{etag:r.headers.get('etag')||undefined,'last-modified':r.headers.get('last-modified')||undefined}}))`,
        awaitPromise:true,returnByValue:true
      });
      if(fetched.exceptionDetails||!fetched.result?.value)throw new Error('页面上下文读取原生界面组件失败');
      return fetched.result.value;
    };
    client.declaredNames=await discover(origin,{version,fallbackFetch});
    const source = nativeSource(origin,client.declaredNames);
    client.origin = origin;
    client.endpoint=target.webSocketDebuggerUrl;
    await client.send('Page.enable');
    const installed = await client.send('Page.addScriptToEvaluateOnNewDocument', { source });
    client.scriptId = installed.identifier;
    const result = await client.send('Runtime.evaluate', { expression: source });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    status('已接入原生输入框');
  };
  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const port = Number(readFileSync(activePortFile, 'utf8').split('\n')[0]);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('调试端口不可用');
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
      const hubs = targets.filter(isHubTarget);
      for (const target of hubs) {
        let client = clients.get(target.id);
        try {
          if(client&&(client.origin!==new URL(target.url).origin||client.endpoint!==target.webSocketDebuggerUrl)){
            client.socket.close();clients.delete(target.id);client=null;
          }
          if (!client) await attach(target);
          else {
            // A live CDP connection does not guarantee that its renderer survived.
            const result = await client.send('Runtime.evaluate', {
              expression: `location.origin===${JSON.stringify(client.origin)} && (!globalThis.__agyPowertools||globalThis.__agyPowertools.status?.healthy===false) && !globalThis.__agyNativeBootPending && !globalThis.__agyPowertoolsPending && document.readyState!=='loading'`,
              returnByValue: true
            });
            if (result.result?.value === true) {
              const restored = await client.send('Runtime.evaluate', { expression: nativeSource(client.origin,client.declaredNames) });
              if (restored.exceptionDetails) throw new Error(restored.exceptionDetails.text);
              status('已恢复原生输入框控件');
            }
          }
        } catch (error) { clients.get(target.id)?.socket.close(); clients.delete(target.id); status(error.message); }
      }
      const ids = new Set(hubs.map(t => t.id));
      for (const [id, client] of clients) if (!ids.has(id)) { client.socket.close(); clients.delete(id); }
      if (!hubs.length) status('等待 Antigravity 窗口');
    } catch { status('等待 Antigravity 本地调试接口'); try { onMissingDebugPort?.(); } catch {} }
    finally { polling = false; }
  };
  const timer = setInterval(poll, 4000);
  const initialPoll=poll();
  const stop = async ({purge=false}={}) => {
    stopped = true; clearInterval(timer);
    for (const client of clients.values()) {
      try {
        await client.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: client.scriptId });
        if(purge)await client.send('Runtime.evaluate',{expression:`(async()=>{if(location.pathname==='/powertools')await globalThis.__agyNativeAdapter?.router()?.navigate({to:'/customizations'});localStorage.removeItem('agy-powertools-language');})()`,awaitPromise:true});
        await client.send('Runtime.evaluate', { expression: 'globalThis.__agyPowertools?.dispose()' });
      } catch {}
      client.socket.close();
    }
    clients.clear();
  };
  stop.fork = async (conversationId, stepIndex = -1) => {
    for (const client of clients.values()) {
      const result = await client.send('Runtime.evaluate', {
        expression: `globalThis.__agyNativeAdapter.fork(${JSON.stringify(conversationId)},${JSON.stringify(stepIndex)})`,
        awaitPromise: true, returnByValue: true
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    }
    throw new Error('请先打开 Antigravity 会话窗口');
  };
  stop.ready=initialPoll;
  stop.check=poll;
  stop.health=async()=>{
    await initialPoll;
    for(const client of clients.values()){
      try{const result=await client.send('Runtime.evaluate',{expression:`({version:globalThis.__agyPowertools?.version,healthy:globalThis.__agyPowertools?.status?.healthy})`,returnByValue:true});if(result.result?.value?.version===pluginVersion&&result.result.value.healthy)return{healthy:true};}catch{}
    }
    return{healthy:false};
  };
  return stop;
}

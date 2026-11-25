import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createConnection, createServer } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendWslEnv,
  createWslCdpBridge,
  isWslEnvironment,
  rewriteCdpWebSocketUrl,
  windowsPathToWsl,
  wslDistroName,
  wslPathToWindows
} from '../lib/wsl.mjs';
import { devToolsPortFile } from '../lib/paths.mjs';
import { createCredentialVault, vaultTargetFor } from '../lib/credential-vault.mjs';
import { createAccountsStore } from '../lib/accounts.mjs';
import {
  configureLaunchers,
  isRemoteSshEnvironment,
  manualLaunchCommand,
  restoreLaunchers,
  scheduleRelaunchWithDebugPort
} from '../lib/launcher.mjs';
import { startNativeIntegration } from '../lib/native-host.mjs';
import { pruneStaleRuntimeRecords } from '../lib/runtime-control.mjs';

test('WSL2 environment detection, WSLENV merging, path conversion, and CDP URL rewriting work accurately', () => {
  assert.equal(isWslEnvironment({ platform: 'win32', env: { WSL_DISTRO_NAME: 'Ubuntu' } }), false);
  assert.equal(isWslEnvironment({ platform: 'darwin', env: { WSL_DISTRO_NAME: 'Ubuntu' } }), false);
  assert.equal(isWslEnvironment({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' } }), true);
  assert.equal(isWslEnvironment({ platform: 'linux', env: { WSL_INTEROP: '/run/WSL/1_interop' } }), true);
  assert.equal(isWslEnvironment({ platform: 'linux', env: {}, readProcVersion: () => 'Linux version 5.15.153.1-microsoft-standard-WSL2' }), true);
  assert.equal(isWslEnvironment({ platform: 'linux', env: {}, readProcVersion: () => 'Linux version 6.8.0-generic' }), false);

  assert.equal(wslDistroName({ env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' } }), 'Ubuntu-24.04');
  assert.equal(wslDistroName({ env: { WSL_DISTRO_NAME: 'My Distro:1' } }), 'My_Distro_1');

  const merged = appendWslEnv({ WSLENV: 'EXISTING/u:AGY_CRED_OP' }, ['AGY_CRED_OP', 'AGY_CRED_SRC', 'AGY_CRED_DST']);
  assert.equal(merged.WSLENV, 'EXISTING/u:AGY_CRED_OP:AGY_CRED_SRC:AGY_CRED_DST');

  assert.equal(
    windowsPathToWsl('C:\\Users\\Alice\\AppData\\Roaming', { runSpawn: () => ({ status: 1, stdout: '' }) }),
    '/mnt/c/Users/Alice/AppData/Roaming'
  );
  assert.equal(
    wslPathToWindows('/mnt/d/work/relaunch.ps1', { runSpawn: () => ({ status: 1, stdout: '' }) }),
    'D:\\work\\relaunch.ps1'
  );
  assert.equal(
    rewriteCdpWebSocketUrl('ws://127.0.0.1:51234/devtools/page/ABC', 51234, 49001),
    'ws://127.0.0.1:49001/devtools/page/ABC'
  );
  assert.equal(
    rewriteCdpWebSocketUrl('ws://127.0.0.1:9999/devtools/page/ABC', 51234, 49001),
    'ws://127.0.0.1:9999/devtools/page/ABC'
  );
});

test('devToolsPortFile resolves Windows AppData path in WSL2 while preserving explicit overrides', () => {
  const portFile = devToolsPortFile({
    platform: 'linux',
    home: '/home/dev',
    env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
    wsl: true,
    resolveWslAppData: () => '/mnt/c/Users/dev/AppData/Roaming'
  });
  assert.equal(portFile, '/mnt/c/Users/dev/AppData/Roaming/Antigravity/DevToolsActivePort');

  const overridden = devToolsPortFile({
    platform: 'linux',
    home: '/home/dev',
    env: { WSL_DISTRO_NAME: 'Ubuntu-24.04', ANTIGRAVITY_CDP_PORT_FILE: '/custom/DevToolsActivePort' },
    wsl: true,
    resolveWslAppData: () => '/mnt/c/Users/dev/AppData/Roaming'
  });
  assert.equal(overridden, '/custom/DevToolsActivePort');
});

test('createWslCdpBridge multiplexes HTTP and concurrent TCP streams over stdio and tears down cleanly', async () => {
  const httpServer = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ id: 'p1', type: 'page', title: 'Antigravity', url: 'https://127.0.0.1:3000/c/1', webSocketDebuggerUrl: `ws://127.0.0.1:${httpPort}/devtools/page/p1` }]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const httpPort = httpServer.address().port;

  const echoServer = createServer(sock => {
    sock.on('error', () => {});
    sock.on('data', d => sock.write(Buffer.concat([Buffer.from('echo:'), d])));
  });
  await new Promise(resolve => echoServer.listen(0, '127.0.0.1', resolve));
  const echoPort = echoServer.address().port;

  const bridge = createWslCdpBridge({
    resolveRuntime: () => ({ command: process.execPath, extraEnv: {} })
  });
  try {
    const ep = await bridge.endpointFor(httpPort);
    const res = await fetch(`http://${ep.host}:${ep.port}/json/list`, { headers: { connection: 'close' } });
    assert.equal(res.status, 200);
    const list = await res.json();
    const rewritten = bridge.rewriteTargets(list, httpPort);
    assert.equal(rewritten[0].webSocketDebuggerUrl, `ws://127.0.0.1:${ep.port}/devtools/page/p1`);

    // Switch target port dynamically (simulating Antigravity restart on a new port) and open 2 concurrent streams
    const ep2 = await bridge.endpointFor(echoPort);
    const roundTrip = payload => new Promise((resolve, reject) => {
      const sock = createConnection({ host: ep2.host, port: ep2.port });
      let got = '';
      sock.on('connect', () => sock.write(payload));
      sock.on('data', chunk => { got += chunk.toString('utf8'); if (got.length >= payload.length + 5) sock.end(); });
      sock.on('end', () => resolve(got));
      sock.on('close', () => { if (got.length >= payload.length + 5) resolve(got); });
      sock.on('error', reject);
    });
    const [a, b] = await Promise.all([roundTrip('stream-alpha'), roundTrip('stream-beta')]);
    assert.equal(a, 'echo:stream-alpha');
    assert.equal(b, 'echo:stream-beta');
  } finally {
    await bridge.close();
    await new Promise(resolve => httpServer.close(resolve));
    await new Promise(resolve => echoServer.close(resolve));
  }
});

test('WSL2 hybrid credential vault pairs file active state with isolated Windows Credential Manager backup slots', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-wsl-vault-'));
  try {
    const geminiDir = join(dir, '.gemini');
    const configDir = join(dir, '.config', 'antigravity');
    mkdirSync(geminiDir, { recursive: true });
    mkdirSync(configDir, { recursive: true });
    const tokenPath = join(geminiDir, 'jetski-standalone-oauth-token');
    const scopePath = join(configDir, 'credential-user-scope');
    writeFileSync(tokenPath, 'oauth-token-alpha\n', 'utf8');
    writeFileSync(scopePath, 'scope-alpha', 'utf8');

    const winStore = new Map();
    const spawnCalls = [];
    const vault = createCredentialVault({
      platform: 'linux',
      home: dir,
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
      wsl: true,
      runSpawn(cmd, args, opts) {
        spawnCalls.push({ cmd, args, env: opts.env, input: opts.input, stdio: opts.stdio });
        const op = opts.env.AGY_CRED_OP;
        if (op === 'probe') return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
        if (op === 'write') {
          winStore.set(opts.env.AGY_CRED_DST, opts.input);
          return { status: 0, stdout: JSON.stringify({ ok: true, bytes: Buffer.from(opts.input, 'base64').length, hash: '112233445566' }) + '\n', stderr: '' };
        }
        if (op === 'has' || op === 'inspect') {
          const val = winStore.get(opts.env.AGY_CRED_SRC);
          return { status: 0, stdout: JSON.stringify({ ok: true, exists: Boolean(val), hash: val ? '112233445566' : '' }) + '\n', stderr: '' };
        }
        if (op === 'read') {
          const val = winStore.get(opts.env.AGY_CRED_SRC);
          return { status: 0, stdout: JSON.stringify({ ok: true, exists: Boolean(val), bytes: val ? Buffer.from(val, 'base64').length : 0, hash: '112233445566', data: val || '' }) + '\n', stderr: '' };
        }
        if (op === 'remove') {
          winStore.delete(opts.env.AGY_CRED_SRC);
          return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
        }
        return { status: 1, stdout: '', stderr: 'unexpected' };
      }
    });

    assert.equal(vaultTargetFor('acct-1', { wslDistro: 'Ubuntu-24.04' }), 'agy-powertools:wsl:Ubuntu-24.04:account:acct-1');
    assert.deepEqual(vault.probe(), { supported: true, backend: 'wsl-wincred', reason: '' });

    // Save active WSL files into Windows Credential Manager over stdin with WSLENV set
    const saved = vault.saveActiveTo('acct-alpha');
    assert.equal(saved.ok, true);
    assert.equal(winStore.has('agy-powertools:wsl:Ubuntu-24.04:account:acct-alpha'), true);
    const writeCall = spawnCalls.find(c => c.env.AGY_CRED_OP === 'write');
    assert.equal(writeCall.cmd, 'powershell.exe');
    assert.ok(writeCall.env.WSLENV.includes('AGY_CRED_OP'));
    assert.ok(writeCall.env.WSLENV.includes('AGY_CRED_DST'));
    assert.equal(writeCall.args.join(' ').includes('oauth-token-alpha'), false);

    // Overwrite active WSL files as if user logged into account beta, then restore alpha atomically
    writeFileSync(tokenPath, 'oauth-token-beta\n', 'utf8');
    writeFileSync(scopePath, 'scope-beta', 'utf8');
    const restored = vault.restoreToActive('acct-alpha');
    assert.equal(restored.ok, true);
    assert.equal(readFileSync(tokenPath, 'utf8'), 'oauth-token-alpha\n');
    assert.equal(readFileSync(scopePath, 'utf8'), 'scope-alpha');

    // WSL2 hybrid vault blocks mismatched expectedEmail on both saveActiveTo and restoreToActive
    const betaJson = JSON.stringify({ token: { access_token: 'a' }, id_token_email: 'beta@example.com' });
    writeFileSync(tokenPath, betaJson, 'utf8');
    assert.equal(vault.inspectActive().email, 'beta@example.com');
    const wslMismatchSave = vault.saveActiveTo('acct-alpha', { expectedEmail: 'alpha@example.com' });
    assert.equal(wslMismatchSave.ok, false);
    assert.equal(wslMismatchSave.mismatch, true);
    assert.equal(wslMismatchSave.actualEmail, 'beta@example.com');
    assert.equal(vault.saveActiveTo('acct-beta', { expectedEmail: 'beta@example.com' }).ok, true);
    const wslMismatchRestore = vault.restoreToActive('acct-beta', { expectedEmail: 'alpha@example.com' });
    assert.equal(wslMismatchRestore.ok, false);
    assert.equal(wslMismatchRestore.mismatch, true);

    // Headless Linux without secret-tool reports clear probe failure and error reason
    const headlessVault = createCredentialVault({
      platform: 'linux',
      env: {},
      wsl: false,
      runSpawn: () => ({ status: null, error: Object.assign(new Error('spawn secret-tool ENOENT'), { code: 'ENOENT' }) })
    });
    const probeRes = headlessVault.probe();
    assert.equal(probeRes.supported, false);
    assert.ok(probeRes.reason.includes('secret-tool'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accounts store surfaces vault error details on prepareAdd and degrades gracefully to manualRestartRequired on relaunch failure', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-wsl-acct-'));
  try {
    // 1. prepareAdd surfaces real vault saveActiveTo error reason
    const failingVault = {
      supported: true,
      probe: () => ({ supported: true, reason: '' }),
      saveActiveTo: () => ({ ok: false, error: '未检测到 WSL2 登录凭据文件' }),
      hasSaved: () => false
    };
    const storeFail = createAccountsStore(dir, { vault: failingVault });
    storeFail.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    assert.throws(() => storeFail.prepareAdd(), /未检测到 WSL2 登录凭据文件/);

    // 2. switchAccount succeeds with manualRestartRequired when relaunch throws after credential restore
    const slots = new Map();
    let activeToken = 'tok-A';
    const workingVault = {
      supported: true,
      probe: () => ({ supported: true, reason: '' }),
      saveActiveTo(id) { slots.set(id, activeToken); return { ok: true, hash: `H-${activeToken}` }; },
      restoreToActive(id) { activeToken = slots.get(id); return { ok: true, hash: `H-${activeToken}` }; },
      hasSaved: id => slots.has(id),
      inspectSaved: id => ({ exists: slots.has(id), hash: slots.has(id) ? `H-${slots.get(id)}` : '' }),
      removeSaved: id => { slots.delete(id); return { ok: true }; }
    };
    const store = createAccountsStore(join(dir, 'ok'), {
      vault: workingVault,
      relaunch: () => { throw new Error('未找到 Antigravity 启动程序'); }
    });
    store.syncActive({ email: 'alpha@example.com', name: 'Alpha' });
    store.prepareAdd();
    activeToken = 'tok-B';
    store.syncActive({ email: 'beta@example.com', name: 'Beta' });
    const alphaId = store.list().accounts.find(a => a.email === 'alpha@example.com').id;

    const switched = store.switchAccount(alphaId, { triggerRelaunch: true });
    assert.equal(switched.ok, true);
    assert.equal(switched.relaunching, false);
    assert.equal(switched.manualRestartRequired, true);
    assert.ok(switched.relaunchError.includes('Antigravity'));
    assert.equal(activeToken, 'tok-A');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('launcher delegates Windows shortcuts and relaunch properly in WSL2 without triggering SSH remote mode', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-wsl-launcher-'));
  try {
    assert.equal(isRemoteSshEnvironment({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu-24.04', ANTIGRAVITY_VSCODE_HOST: '1' }, wsl: true }), false);

    const psScripts = [];
    const cfg = configureLaunchers({
      home: dir,
      dataDir: dir,
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
      wsl: true,
      runPowerShell(script) {
        psScripts.push(script);
        return JSON.stringify(['C:\\Users\\dev\\Desktop\\Antigravity.lnk']);
      }
    });
    assert.deepEqual(cfg.updated, ['C:\\Users\\dev\\Desktop\\Antigravity.lnk']);
    assert.ok(psScripts[0].includes('WScript.Shell'));

    const rest = restoreLaunchers({
      home: dir,
      dataDir: dir,
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
      wsl: true,
      runPowerShell(_script, env, wslKeys) {
        assert.ok(wslKeys.includes('AGY_LNK_LIST'));
        assert.ok(env.AGY_LNK_LIST.includes('Antigravity.lnk'));
        return JSON.stringify(['C:\\Users\\dev\\Desktop\\Antigravity.lnk']);
      }
    });
    assert.deepEqual(rest.restored, ['C:\\Users\\dev\\Desktop\\Antigravity.lnk']);

    const winTempDir = join(dir, 'win-temp');
    mkdirSync(winTempDir, { recursive: true });
    const fakeExe = 'C:\\Users\\dev\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe';
    assert.equal(
      manualLaunchCommand({ platform: 'linux', env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' }, wsl: true, resolveWslExe: () => ({ winPath: fakeExe, wslPath: '' }) }),
      `"${fakeExe}" --remote-debugging-port=0`
    );

    let spawned = null;
    const relaunched = scheduleRelaunchWithDebugPort({
      dataDir: dir,
      home: dir,
      platform: 'linux',
      env: { WSL_DISTRO_NAME: 'Ubuntu-24.04' },
      wsl: true,
      resolveWslExe: () => ({ winPath: fakeExe, wslPath: '' }),
      resolveWslTemp: () => ({ winPath: 'C:\\Users\\dev\\AppData\\Local\\Temp', wslPath: winTempDir }),
      spawnProcess(cmd, args, opts) {
        spawned = { cmd, args, opts };
        return { unref() {} };
      }
    });
    assert.equal(relaunched.scheduled, true);
    assert.equal(relaunched.target, fakeExe);
    assert.equal(spawned.cmd, 'powershell.exe');
    assert.equal(spawned.opts.env.AGY_RELAUNCH_SCRIPT, 'C:\\Users\\dev\\AppData\\Local\\Temp\\agy-powertools-relaunch.ps1');
    assert.ok(spawned.opts.env.WSLENV.includes('AGY_RELAUNCH_SCRIPT'));
    assert.ok(readFileSync(join(winTempDir, 'agy-powertools-relaunch.ps1'), 'utf8').includes(fakeExe));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('startNativeIntegration falls back to WSL2 CDP bridge when direct loopback fails and passes preferFallback to discover', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-wsl-host-'));
  const portFile = join(dir, 'DevToolsActivePort');
  // Point portFile to an unused local port so direct fetch fails immediately, triggering the WSL bridge fallback
  const dummyServer = http.createServer((req, res) => {
    if (req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{
        id: 'win-hub-1',
        type: 'page',
        title: 'Main - Antigravity',
        url: 'https://127.0.0.1:41234/c/conv-wsl',
        webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/page/win-hub-1'
      }]));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(resolve => dummyServer.listen(0, '127.0.0.1', resolve));
  const bridgeLocalPort = dummyServer.address().port;
  writeFileSync(portFile, '1\n/devtools/browser/test\n', 'utf8');

  let bridgeClosed = false;
  let connectedEndpoint = '';
  let discoverOpts = null;
  const stop = startNativeIntegration({
    parseSessionData: () => ({ conversationId: 'conv-wsl', turns: [], requests: [] }),
    portFile,
    wsl: true,
    onStatus() {},
    createCdpBridge: () => ({
      async endpointFor(winPort) {
        assert.equal(winPort, 1);
        return { host: '127.0.0.1', port: bridgeLocalPort };
      },
      rewriteTargets(targets, winPort) {
        return targets.map(t => ({ ...t, webSocketDebuggerUrl: rewriteCdpWebSocketUrl(t.webSocketDebuggerUrl, winPort, bridgeLocalPort) }));
      },
      async close() { bridgeClosed = true; }
    }),
    connect: async endpoint => {
      connectedEndpoint = endpoint;
      return {
        socket: { addEventListener() {}, close() {} },
        onEvent() {},
        async send(method) {
          if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'f1' } } };
          if (method === 'Runtime.evaluate') return { result: { value: { ua: 'Antigravity/2.34.0', isHub: true, sshKind: '', sshHost: '', title: 'Main - Antigravity' } } };
          if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 's1' };
          return {};
        }
      };
    },
    discover: async (_origin, opts) => {
      discoverOpts = opts;
      return [];
    }
  });

  try {
    await stop.ready;
    assert.equal(connectedEndpoint, `ws://127.0.0.1:${bridgeLocalPort}/devtools/page/win-hub-1`);
    assert.equal(discoverOpts?.preferFallback, true);
  } finally {
    await stop();
    await new Promise(resolve => dummyServer.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(bridgeClosed, true);
});

test('pruneStaleRuntimeRecords removes dead PID runtime JSON files while keeping live PIDs intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-rt-prune-'));
  try {
    const deadFile = join(dir, '999991-aaaa.json');
    const liveFile = join(dir, '12345-bbbb.json');
    const selfFile = join(dir, `${process.pid}-cccc.json`);
    writeFileSync(deadFile, '{}');
    writeFileSync(liveFile, '{}');
    writeFileSync(selfFile, '{}');
    const removed = pruneStaleRuntimeRecords(dir, { isAlive: pid => pid === 12345 });
    assert.deepEqual(removed, [deadFile]);
    assert.equal(readFileSync(liveFile, 'utf8'), '{}');
    assert.equal(readFileSync(selfFile, 'utf8'), '{}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

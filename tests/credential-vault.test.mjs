import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  ACTIVE_TARGET,
  ACTIVE_USERNAME,
  createCredentialVault,
  extractCredentialEmail,
  vaultTargetFor
} from '../lib/credential-vault.mjs';

test('vaultTargetFor validates account IDs and rejects invalid or injection-like names', () => {
  assert.equal(vaultTargetFor('acct-123_ab'), 'agy-powertools:account:acct-123_ab');
  for (const bad of ['', '   ', '../etc', 'a b', 'acct:1', 'a"b', 'x'.repeat(65)]) {
    assert.throws(() => vaultTargetFor(bad), /账号标识/);
  }
});

test('Windows credential vault passes target names via environment variables and avoids leaking secrets', () => {
  const calls = [];
  const vault = createCredentialVault({
    platform: 'win32',
    runSpawn(cmd, args, opts) {
      calls.push({ cmd, args, env: opts.env });
      const op = opts.env.AGY_CRED_OP;
      if (op === 'has' || op === 'inspect') return { status: 0, stdout: '{"ok":true,"exists":true,"bytes":512,"hash":"AABBCCDDEEFF"}\n', stderr: '' };
      if (op === 'copy') return { status: 0, stdout: '{"ok":true,"bytes":512,"hash":"AABBCCDDEEFF"}\n', stderr: '' };
      return { status: 0, stdout: '{"ok":true}\n', stderr: '' };
    }
  });
  assert.equal(vault.supported, true);
  assert.equal(vault.hasSaved('acct-1'), true);
  assert.deepEqual(vault.inspectSaved('acct-1'), { exists: true, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[0].cmd, 'powershell.exe');
  assert.equal(calls[0].env.AGY_CRED_SRC, 'agy-powertools:account:acct-1');

  const saved = vault.saveActiveTo('acct-1');
  assert.deepEqual(saved, { ok: true, bytes: 512, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[2].env.AGY_CRED_SRC, ACTIVE_TARGET);
  assert.equal(calls[2].env.AGY_CRED_DST, 'agy-powertools:account:acct-1');

  const restored = vault.restoreToActive('acct-1');
  assert.deepEqual(restored, { ok: true, bytes: 512, hash: 'AABBCCDDEEFF' });
  assert.equal(calls[3].env.AGY_CRED_SRC, 'agy-powertools:account:acct-1');
  assert.equal(calls[3].env.AGY_CRED_DST, ACTIVE_TARGET);
  assert.equal(calls[3].env.AGY_CRED_USER, ACTIVE_USERNAME);

  assert.deepEqual(vault.removeSaved('acct-1'), { ok: true });
  assert.equal(calls[4].env.AGY_CRED_OP, 'remove');
});

test('macOS and Linux credential vaults use stdin pipes for secrets and never pass tokens in CLI args', () => {
  const macCalls = [];
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(cmd, args, opts) {
      macCalls.push({ cmd, args, input: opts?.input });
      if (args.includes('-w')) return { status: 0, stdout: Buffer.from('secret-refresh-token\n') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(macVault.hasSaved('acct-mac'), true);
  const macCopy = macVault.saveActiveTo('acct-mac');
  assert.equal(macCopy.ok, true);
  assert.equal(macCalls[1].cmd, '/usr/bin/security');
  assert.equal(macCalls[2].args[0], '-i');
  assert.equal(macCalls[2].args.includes('secret-refresh-token'), false);
  assert.ok(String(macCalls[2].input).includes('agy-powertools-account'));

  const linuxCalls = [];
  const linuxVault = createCredentialVault({
    platform: 'linux',
    wsl: false,
    runSpawn(cmd, args, opts) {
      linuxCalls.push({ cmd, args, inputText: opts?.input ? Buffer.from(opts.input).toString('utf8') : '' });
      if (args[0] === 'lookup') return { status: 0, stdout: Buffer.from('linux-token') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(linuxVault.hasSaved('acct-lin'), true);
  assert.equal(linuxVault.restoreToActive('acct-lin').ok, true);
  assert.equal(linuxCalls[2].args.includes('linux-token'), false);
  assert.equal(linuxCalls[2].inputText, 'linux-token');
});

test('credential vault extracts id_token_email and blocks mismatched writes across Linux, macOS, and Windows', () => {
  const alphaPayload = JSON.stringify({
    token: { access_token: 'tok-a', refresh_token: 'rt-a' },
    auth_method: 'consumer',
    id_token_email: 'Alpha@Example.com'
  });
  const wslEnvelope = JSON.stringify({
    v: 1,
    token: Buffer.from(alphaPayload, 'utf8').toString('base64'),
    scope: null
  });
  assert.equal(extractCredentialEmail(alphaPayload), 'alpha@example.com');
  assert.equal(extractCredentialEmail(Buffer.from(wslEnvelope, 'utf8')), 'alpha@example.com');
  assert.equal(extractCredentialEmail('opaque-non-json-token'), '');

  // Linux: inspect returns email, and mismatched saveActiveTo refuses without calling secret-tool store
  const linuxOps = [];
  const linuxVault = createCredentialVault({
    platform: 'linux',
    wsl: false,
    runSpawn(cmd, args) {
      linuxOps.push(args[0]);
      if (args[0] === 'lookup') return { status: 0, stdout: Buffer.from(alphaPayload, 'utf8') };
      return { status: 0, stdout: '' };
    }
  });
  const inspected = linuxVault.inspectActive();
  assert.equal(inspected.exists, true);
  assert.equal(inspected.email, 'alpha@example.com');
  const blocked = linuxVault.saveActiveTo('acct-beta', { expectedEmail: 'beta@example.com' });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.mismatch, true);
  assert.equal(blocked.actualEmail, 'alpha@example.com');
  assert.equal(blocked.expectedEmail, 'beta@example.com');
  assert.equal(linuxOps.includes('store'), false);
  const allowed = linuxVault.saveActiveTo('acct-alpha', { expectedEmail: 'alpha@example.com' });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.email, 'alpha@example.com');
  assert.equal(linuxOps.includes('store'), true);

  // macOS: mismatched restoreToActive refuses without calling security -i
  const macOps = [];
  const macVault = createCredentialVault({
    platform: 'darwin',
    runSpawn(_cmd, args) {
      macOps.push(args[0]);
      if (args.includes('-w')) return { status: 0, stdout: Buffer.from(alphaPayload + '\n', 'utf8') };
      return { status: 0, stdout: '' };
    }
  });
  assert.equal(macVault.inspectSaved('acct-alpha').email, 'alpha@example.com');
  const macBlocked = macVault.restoreToActive('acct-beta', { expectedEmail: 'beta@example.com' });
  assert.equal(macBlocked.ok, false);
  assert.equal(macBlocked.mismatch, true);
  assert.equal(macOps.includes('-i'), false);

  // Windows: forwards AGY_CRED_EXPECTED_EMAIL (and clears inherited value when omitted) and surfaces mismatch JSON cleanly
  const winEnvs = [];
  const winVault = createCredentialVault({
    platform: 'win32',
    env: { AGY_CRED_EXPECTED_EMAIL: 'stale@example.com' },
    runSpawn(_cmd, _args, opts) {
      winEnvs.push(opts.env);
      if (opts.env.AGY_CRED_OP === 'inspect') {
        return { status: 0, stdout: '{"ok":true,"exists":true,"bytes":128,"hash":"AABBCCDDEEFF","email":"alpha@example.com"}\n', stderr: '' };
      }
      return {
        status: 1,
        stdout: '{"ok":false,"mismatch":true,"actualEmail":"alpha@example.com","expectedEmail":"beta@example.com","error":"credential email mismatch"}\n',
        stderr: ''
      };
    }
  });
  assert.deepEqual(winVault.inspectSaved('acct-alpha'), { exists: true, hash: 'AABBCCDDEEFF', email: 'alpha@example.com' });
  assert.equal(winEnvs[0].AGY_CRED_EXPECTED_EMAIL, '');
  const winBlocked = winVault.saveActiveTo('acct-beta', { expectedEmail: 'Beta@Example.com' });
  assert.equal(winBlocked.ok, false);
  assert.equal(winBlocked.mismatch, true);
  assert.equal(winBlocked.actualEmail, 'alpha@example.com');
  assert.equal(winBlocked.expectedEmail, 'beta@example.com');
  assert.equal(winEnvs[1].AGY_CRED_EXPECTED_EMAIL, 'beta@example.com');
});

test('Windows PowerShell WIN32_SCRIPT compiles Add-Type and extracts id_token_email across direct JSON, decoy keys, and WSL envelopes', { skip: process.platform !== 'win32' }, () => {
  let capturedScript = '';
  const probeVault = createCredentialVault({
    platform: 'linux',
    wsl: true,
    runSpawn(cmd, args, opts) {
      capturedScript = args[args.indexOf('-Command') + 1];
      return spawnSync(cmd, args, { ...opts, timeout: 20000 });
    }
  });
  const probed = probeVault.probe({ force: true });
  assert.equal(probed.supported, true, `WIN32_SCRIPT probe failed: ${probed.reason}`);
  assert.ok(capturedScript.includes('class AgyWinCred'));

  const endMatch = capturedScript.match(/^"@/m);
  assert.ok(endMatch && typeof endMatch.index === 'number');
  const addTypeBlock = capturedScript.slice(0, endMatch.index + endMatch[0].length);
  const directPayload = JSON.stringify({
    token: { access_token: 'tok-a', refresh_token: 'rt-a' },
    id_token_email: 'Alpha@Example.com'
  });
  const decoyPayload = JSON.stringify({
    note: 'id_token_email',
    other: 'decoy@example.com',
    id_token_email: 'Real@Example.com'
  });
  const wslEnvelope = JSON.stringify({
    v: 1,
    token: Buffer.from(JSON.stringify({ id_token_email: 'Beta@Example.com' }), 'utf8').toString('base64'),
    scope: null
  });
  const verifyScript = [
    addTypeBlock,
    '$cases = @($env:AGY_TEST_C1, $env:AGY_TEST_C2, $env:AGY_TEST_C3, $env:AGY_TEST_C4)',
    '$out = foreach ($c in $cases) { [AgyWinCred]::ExtractEmail([System.Text.Encoding]::UTF8.GetBytes($c)) }',
    'Write-Output ($out -join "|")'
  ].join('\n');
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', verifyScript],
    {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      env: {
        ...process.env,
        AGY_TEST_C1: directPayload,
        AGY_TEST_C2: decoyPayload,
        AGY_TEST_C3: wslEnvelope,
        AGY_TEST_C4: 'opaque-non-json-token'
      }
    }
  );
  assert.equal(res.status, 0, res.stderr || res.error?.message || 'powershell failed');
  const line = String(res.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
  assert.equal(line, 'alpha@example.com|real@example.com|beta@example.com|');
});

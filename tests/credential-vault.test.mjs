import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_TARGET,
  ACTIVE_USERNAME,
  createCredentialVault,
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

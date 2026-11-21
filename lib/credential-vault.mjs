import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const ACTIVE_TARGET = 'gemini:antigravity';
export const ACTIVE_USERNAME = 'antigravity';
export const ACTIVE_SERVICE = 'gemini';
export const VAULT_SERVICE = 'agy-powertools-account';

const ACCOUNT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function vaultTargetFor(accountId) {
  const id = String(accountId || '').trim();
  if (!ACCOUNT_ID_RE.test(id)) throw new Error('账号标识无效');
  return `agy-powertools:account:${id}`;
}

function splitPosixTarget(target) {
  if (target === ACTIVE_TARGET) return { service: ACTIVE_SERVICE, account: ACTIVE_USERNAME };
  const prefix = 'agy-powertools:account:';
  if (target.startsWith(prefix)) {
    const account = target.slice(prefix.length);
    if (!ACCOUNT_ID_RE.test(account)) throw new Error('账号标识无效');
    return { service: VAULT_SERVICE, account };
  }
  throw new Error('不支持的凭据目标');
}

function shortHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 12).toUpperCase();
}

const WIN32_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Security.Cryptography;

public static class AgyWinCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public string TargetName;
    public string Comment;
    public long LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public string TargetAlias;
    public string UserName;
  }

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredReadW(string target, uint type, int reservedFlag, out IntPtr credentialPtr);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredWriteW([In] ref CREDENTIAL userCredential, uint flags);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern bool CredDeleteW(string target, uint type, int flags);

  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr cred);

  public static string ShortHash(byte[] bytes) {
    using (var sha = SHA256.Create()) {
      return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").Substring(0, 12);
    }
  }
}
"@
$op = $env:AGY_CRED_OP
$src = $env:AGY_CRED_SRC
$dst = $env:AGY_CRED_DST
$dstUser = $env:AGY_CRED_USER
if ($op -eq 'has' -or $op -eq 'inspect') {
  $ptr = [IntPtr]::Zero
  if ([AgyWinCred]::CredReadW($src, 1, 0, [ref]$ptr)) {
    [byte[]]$bytes = $null
    try {
      $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][AgyWinCred+CREDENTIAL])
      $size = [int]$c.CredentialBlobSize
      $bytes = New-Object byte[] $size
      if ($size -gt 0 -and $c.CredentialBlob -ne [IntPtr]::Zero) {
        [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $size)
      }
      $hash = [AgyWinCred]::ShortHash($bytes)
      Write-Output ('{"ok":true,"exists":true,"bytes":' + $size + ',"hash":"' + $hash + '"}')
    } finally {
      if ($bytes -ne $null) { [Array]::Clear($bytes, 0, $bytes.Length) }
      [AgyWinCred]::CredFree($ptr)
    }
  } else {
    Write-Output '{"ok":true,"exists":false,"hash":""}'
  }
} elseif ($op -eq 'copy') {
  $ptr = [IntPtr]::Zero
  if (-not [AgyWinCred]::CredReadW($src, 1, 0, [ref]$ptr)) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-Output ('{"ok":false,"error":"read failed: ' + $err + '"}')
    exit 1
  }
  $blobCopy = [IntPtr]::Zero
  [byte[]]$bytes = $null
  try {
    $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][AgyWinCred+CREDENTIAL])
    $size = [int]$c.CredentialBlobSize
    $bytes = New-Object byte[] $size
    if ($size -gt 0 -and $c.CredentialBlob -ne [IntPtr]::Zero) {
      [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $size)
      $blobCopy = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
      [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blobCopy, $size)
    }
    $hash = [AgyWinCred]::ShortHash($bytes)
    $next = New-Object AgyWinCred+CREDENTIAL
    $next.Flags = 0
    $next.Type = 1
    $next.TargetName = $dst
    $next.Comment = $c.Comment
    $next.CredentialBlobSize = [uint32]$size
    $next.CredentialBlob = $blobCopy
    $next.Persist = if ($c.Persist -ne 0) { $c.Persist } else { 2 }
    $next.AttributeCount = 0
    $next.Attributes = [IntPtr]::Zero
    $next.TargetAlias = $null
    $next.UserName = if ([string]::IsNullOrEmpty($dstUser)) { $c.UserName } else { $dstUser }
    if (-not [AgyWinCred]::CredWriteW([ref]$next, 0)) {
      $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
      Write-Output ('{"ok":false,"error":"write failed: ' + $err + '"}')
      exit 1
    }
    Write-Output ('{"ok":true,"bytes":' + $size + ',"hash":"' + $hash + '"}')
  } finally {
    if ($bytes -ne $null) { [Array]::Clear($bytes, 0, $bytes.Length) }
    if ($blobCopy -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::FreeHGlobal($blobCopy) }
    if ($ptr -ne [IntPtr]::Zero) { [AgyWinCred]::CredFree($ptr) }
  }
} elseif ($op -eq 'remove') {
  $ok = [AgyWinCred]::CredDeleteW($src, 1, 0)
  if (-not $ok) {
    $err = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
    if ($err -ne 1168) {
      Write-Output ('{"ok":false,"error":"delete failed: ' + $err + '"}')
      exit 1
    }
  }
  Write-Output '{"ok":true}'
} else {
  Write-Output '{"ok":false,"error":"unknown op"}'
  exit 1
}
`;

export function createCredentialVault({ platform = process.platform, env = process.env, runSpawn = spawnSync } = {}) {
  const supported = platform === 'win32' || platform === 'darwin' || platform === 'linux';

  function runWin32(op, src, dst = '', userName = '') {
    const result = runSpawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', WIN32_SCRIPT],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 12000,
        env: { ...env, AGY_CRED_OP: op, AGY_CRED_SRC: src, AGY_CRED_DST: dst, AGY_CRED_USER: userName }
      }
    );
    const line = String(result.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
    try {
      const parsed = JSON.parse(line);
      if (result.status === 0 && parsed?.ok) return parsed;
      return { ok: false, error: parsed?.error || result.stderr?.trim() || '凭据操作失败' };
    } catch {
      return { ok: false, error: result.stderr?.trim() || result.error?.message || '凭据操作失败' };
    }
  }

  function inspect(target) {
    if (!supported) return { exists: false, hash: '' };
    if (platform === 'win32') {
      const res = runWin32('inspect', target);
      return { exists: Boolean(res.exists), hash: typeof res.hash === 'string' ? res.hash : '' };
    }
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account, '-w'], {
        timeout: 8000
      });
      if (res.status !== 0 || !res.stdout) return { exists: false, hash: '' };
      const buf = Buffer.from(Buffer.from(res.stdout).toString('utf8').replace(/[\r\n]+$/, ''), 'utf8');
      const hash = shortHash(buf);
      buf.fill(0);
      return { exists: true, hash };
    }
    const res = runSpawn('secret-tool', ['lookup', 'service', service, 'username', account], {
      timeout: 8000
    });
    if (res.status !== 0 || !res.stdout) return { exists: false, hash: '' };
    const buf = Buffer.from(res.stdout);
    const hash = shortHash(buf);
    buf.fill(0);
    return { exists: true, hash };
  }

  function has(target) {
    if (!supported) return false;
    if (platform === 'win32') return Boolean(runWin32('has', target).exists);
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['find-generic-password', '-s', service, '-a', account], {
        stdio: 'ignore',
        timeout: 8000
      });
      return res.status === 0;
    }
    const res = runSpawn('secret-tool', ['lookup', 'service', service, 'username', account], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 8000
    });
    return res.status === 0;
  }

  function copy(fromTarget, toTarget, { userName = '' } = {}) {
    if (!supported) return { ok: false, error: '当前系统不支持凭据库操作' };
    if (platform === 'win32') return runWin32('copy', fromTarget, toTarget, userName);
    const src = splitPosixTarget(fromTarget);
    const dst = splitPosixTarget(toTarget);
    if (platform === 'darwin') {
      const readRes = runSpawn('/usr/bin/security', ['find-generic-password', '-s', src.service, '-a', src.account, '-w'], {
        timeout: 8000
      });
      if (readRes.status !== 0 || !readRes.stdout) {
        return { ok: false, error: '未能读取当前凭据' };
      }
      const secret = Buffer.from(readRes.stdout).toString('utf8').replace(/[\r\n]+$/, '');
      const buf = Buffer.from(secret, 'utf8');
      const hash = shortHash(buf);
      const hex = buf.toString('hex');
      buf.fill(0);
      const cmd = `add-generic-password -U -s ${JSON.stringify(dst.service)} -a ${JSON.stringify(dst.account)} -X ${hex}\n`;
      const writeRes = runSpawn('/usr/bin/security', ['-i'], {
        input: cmd,
        stdio: ['pipe', 'ignore', 'pipe'],
        timeout: 8000
      });
      if (writeRes.status !== 0) {
        return { ok: false, error: String(writeRes.stderr || '').trim() || '写入钥匙串失败' };
      }
      return { ok: true, bytes: Buffer.byteLength(secret, 'utf8'), hash };
    }
    const readRes = runSpawn('secret-tool', ['lookup', 'service', src.service, 'username', src.account], {
      timeout: 8000
    });
    if (readRes.status !== 0 || !readRes.stdout) {
      return { ok: false, error: '未能读取当前凭据' };
    }
    const buf = Buffer.from(readRes.stdout);
    const hash = shortHash(buf);
    const writeRes = runSpawn('secret-tool', ['store', '--label=Agy Powertools', 'service', dst.service, 'username', dst.account], {
      input: buf,
      stdio: ['pipe', 'ignore', 'pipe'],
      timeout: 8000
    });
    buf.fill(0);
    if (writeRes.status !== 0) {
      return { ok: false, error: String(writeRes.stderr || '').trim() || '写入密钥环失败' };
    }
    return { ok: true, bytes: readRes.stdout.length, hash };
  }

  function remove(target) {
    if (!supported) return { ok: false, error: '当前系统不支持凭据库操作' };
    if (platform === 'win32') return runWin32('remove', target);
    const { service, account } = splitPosixTarget(target);
    if (platform === 'darwin') {
      const res = runSpawn('/usr/bin/security', ['delete-generic-password', '-s', service, '-a', account], {
        stdio: 'ignore',
        timeout: 8000
      });
      return { ok: res.status === 0 || res.status === 44 };
    }
    const res = runSpawn('secret-tool', ['clear', 'service', service, 'username', account], {
      stdio: 'ignore',
      timeout: 8000
    });
    return { ok: res.status === 0 };
  }

  return {
    supported,
    has,
    inspect,
    copy,
    remove,
    saveActiveTo: accountId => copy(ACTIVE_TARGET, vaultTargetFor(accountId)),
    restoreToActive: accountId => copy(vaultTargetFor(accountId), ACTIVE_TARGET, { userName: ACTIVE_USERNAME }),
    hasSaved: accountId => has(vaultTargetFor(accountId)),
    inspectSaved: accountId => inspect(vaultTargetFor(accountId)),
    inspectActive: () => inspect(ACTIVE_TARGET),
    removeSaved: accountId => remove(vaultTargetFor(accountId))
  };
}

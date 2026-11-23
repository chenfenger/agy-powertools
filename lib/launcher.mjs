import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, unlinkSync, chmodSync, statSync, copyFileSync, utimesSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DEBUG_FLAG = '--remote-debugging-port=0';
const HAS_DEBUG_RE = /(?:^|\s)--remote-debugging-port(?:=\S+|\s+\d+|\b)/;
const STRIP_DEBUG_RE = /(?:^|\s+)--remote-debugging-port=0(?=\s|$)/g;
const PROMPT_COOLDOWN_MS = 10 * 60 * 1000;
const FRESH_INSTALL_GRACE_MS = 120 * 1000;

export function isRemoteSshEnvironment({ env = process.env, platform = process.platform } = {}) {
  if (platform === 'win32') return false;
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return false;
  return Boolean(
    env.ANTIGRAVITY_VSCODE_HOST === '1' ||
    env.SSH_CONNECTION ||
    env.SSH_CLIENT ||
    env.SSH_TTY
  );
}

export function injectDebugArg(args = '') {
  const trimmed = String(args || '').trim();
  if (HAS_DEBUG_RE.test(trimmed)) return trimmed;
  return trimmed ? `${trimmed} ${DEBUG_FLAG}` : DEBUG_FLAG;
}

export function removeDebugArg(args = '') {
  return String(args || '').replace(STRIP_DEBUG_RE, ' ').replace(/\s{2,}/g, ' ').trim();
}

export function patchDesktopEntry(content) {
  let changed = false;
  const lines = String(content || '').split(/\r?\n/).map(line => {
    if (!/^Exec\s*=/.test(line) || HAS_DEBUG_RE.test(line)) return line;
    const eq = line.indexOf('=');
    const prefix = line.slice(0, eq + 1);
    const cmd = line.slice(eq + 1).trim();
    if (!/antigravity/i.test(cmd)) return line;
    const match = cmd.match(/^("[^"]+"|\S+)([\s\S]*)$/);
    if (!match) return line;
    changed = true;
    const rest = match[2].trim();
    return `${prefix}${match[1]} ${DEBUG_FLAG}${rest ? ` ${rest}` : ''}`;
  });
  return { content: lines.join('\n'), changed };
}

export function unpatchDesktopEntry(content) {
  let changed = false;
  const lines = String(content || '').split(/\r?\n/).map(line => {
    if (!/^Exec\s*=/.test(line) || !line.includes(DEBUG_FLAG)) return line;
    const next = line.replace(STRIP_DEBUG_RE, ' ').replace(/^(Exec\s*=\s*)/, '$1').replace(/\s{2,}/g, ' ').trimEnd();
    if (next !== line) changed = true;
    return next;
  });
  return { content: lines.join('\n'), changed };
}

function readJson(path, fallback = {}) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

function writeJson(path, value) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  } catch {}
}

function defaultRunPowerShell(script, env) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8000,
    env
  });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim();
}

function windowsShortcutCandidates({ home, env, sandbox, runPowerShell }) {
  const appData = sandbox ? join(home, 'AppData', 'Roaming') : (env.APPDATA || join(home, 'AppData', 'Roaming'));
  const dirs = new Set([
    join(home, 'Desktop'),
    join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar')
  ]);
  if (!sandbox) {
    const out = runPowerShell('[Console]::OutputEncoding=[Text.Encoding]::UTF8; @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs")) | ConvertTo-Json -Compress', env);
    try {
      for (const folder of JSON.parse(out || '[]')) if (typeof folder === 'string' && folder) dirs.add(folder);
    } catch {}
  }
  const files = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isFile() && /\.lnk$/i.test(entry.name)) files.add(full);
        else if (entry.isDirectory() && /^antigravity$/i.test(entry.name)) {
          for (const sub of readdirSync(full, { withFileTypes: true })) {
            if (sub.isFile() && /\.lnk$/i.test(sub.name)) files.add(join(full, sub.name));
          }
        }
      }
    } catch {}
  }
  return [...files];
}

const MAC_LSREGISTER_PATH = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

function resolveMacSourceApp({ home = homedir(), env = process.env, execPath = process.execPath, sandbox = false, excludeAppDir = '', macSourceApp } = {}) {
  if (typeof macSourceApp === 'string') return macSourceApp;
  const resolvedHome = resolve(home);
  const excluded = excludeAppDir ? resolve(excludeAppDir) : '';
  const isUsableApp = candidate => {
    if (!candidate || !existsSync(candidate)) return false;
    const resolved = resolve(candidate);
    if (resolved === excluded) return false;
    if (sandbox && !resolved.startsWith(resolvedHome + sep)) return false;
    return true;
  };
  for (const seed of [env.ANTIGRAVITY_AGENTAPI_EXE, execPath].filter(Boolean)) {
    for (let cur = dirname(seed); cur && cur !== dirname(cur); cur = dirname(cur)) {
      if (/Antigravity.*\.app$/i.test(basename(cur)) && isUsableApp(cur)) return cur;
    }
  }
  const candidates = [join(home, 'Applications', 'Antigravity.app')];
  if (!sandbox) candidates.unshift('/Applications/Antigravity.app');
  for (const candidate of candidates) {
    if (isUsableApp(candidate)) return candidate;
  }
  return '';
}

function resolveMacAppIcon(sourceApp) {
  if (!sourceApp) return '';
  const resourcesDir = join(sourceApp, 'Contents', 'Resources');
  if (!existsSync(resourcesDir)) return '';
  let declared = '';
  try {
    const plist = readFileSync(join(sourceApp, 'Contents', 'Info.plist'), 'utf8');
    const raw = (plist.match(/<key>\s*CFBundleIconFile\s*<\/key>\s*<string>([^<]+)<\/string>/)?.[1] || '').trim();
    declared = raw ? basename(raw) : '';
  } catch {}
  const candidates = [
    declared && declared.toLowerCase().endsWith('.icns') ? declared : '',
    declared && !declared.toLowerCase().endsWith('.icns') ? `${declared}.icns` : '',
    'icon.icns',
    'Antigravity.icns',
    'app.icns',
    'electron.icns'
  ].filter(Boolean);
  for (const name of candidates) {
    const candidate = join(resourcesDir, name);
    if (existsSync(candidate)) return candidate;
  }
  try {
    const fallback = readdirSync(resourcesDir).sort().find(name => name.toLowerCase().endsWith('.icns'));
    if (fallback) return join(resourcesDir, fallback);
  } catch {}
  return '';
}

export function configureLaunchers({
  home = homedir(),
  dataDir,
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  sandbox = resolve(home) !== resolve(homedir()),
  systemApplicationsDir = sandbox ? '' : '/usr/share/applications',
  runPowerShell = defaultRunPowerShell,
  macSourceApp
} = {}) {
  const stateFile = dataDir ? join(dataDir, 'launcher-state.json') : '';
  const state = stateFile ? readJson(stateFile, { shortcuts: [], desktopEntries: [], macApps: [] }) : { shortcuts: [], desktopEntries: [], macApps: [] };
  const updated = [];
  let iconConfigured = false;
  let macApp = '';

  if (platform === 'win32') {
    const candidates = windowsShortcutCandidates({ home, env, sandbox, runPowerShell });
    if (candidates.length) {
      const psEnv = { ...env, AGY_LNK_LIST: JSON.stringify(candidates) };
      const script = [
        '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
        '$paths = $env:AGY_LNK_LIST | ConvertFrom-Json',
        '$ws = New-Object -ComObject WScript.Shell',
        '$changed = @()',
        'foreach ($p in $paths) {',
        '  try {',
        '    if (-not (Test-Path -LiteralPath $p)) { continue }',
        '    $s = $ws.CreateShortcut($p)',
        '    $leaf = Split-Path -Leaf $s.TargetPath',
        '    if ($leaf -match "^antigravity\\.exe$") {',
        '      $args = [string]$s.Arguments',
        '      if ($args -notmatch "(?:^|\\s)--remote-debugging-port(?:=\\S+|\\s+\\d+|\\b)") {',
        '        $s.Arguments = ($args + " --remote-debugging-port=0").Trim()',
        '        $s.Save()',
        '        $changed += $p',
        '      }',
        '    }',
        '  } catch {}',
        '}',
        'ConvertTo-Json -Compress @($changed)'
      ].join('\n');
      const out = runPowerShell(script, psEnv);
      try {
        for (const item of JSON.parse(out || '[]')) {
          if (typeof item === 'string' && item) {
            updated.push(item);
            if (!state.shortcuts.includes(item)) state.shortcuts.push(item);
          }
        }
      } catch {}
    }
  } else if (platform === 'linux') {
    const appsDir = join(sandbox ? join(home, '.local', 'share') : (env.XDG_DATA_HOME || join(home, '.local', 'share')), 'applications');
    const userDesktop = join(appsDir, 'antigravity.desktop');
    const systemDesktop = systemApplicationsDir ? join(systemApplicationsDir, 'antigravity.desktop') : '';
    if (existsSync(userDesktop)) {
      const patched = patchDesktopEntry(readFileSync(userDesktop, 'utf8'));
      if (patched.changed) {
        writeFileSync(userDesktop, patched.content, 'utf8');
        updated.push(userDesktop);
        if (!state.desktopEntries.some(e => e.path === userDesktop)) state.desktopEntries.push({ path: userDesktop, mode: 'patched' });
      }
    } else if (systemDesktop && existsSync(systemDesktop)) {
      const patched = patchDesktopEntry(readFileSync(systemDesktop, 'utf8'));
      if (patched.changed) {
        mkdirSync(appsDir, { recursive: true });
        writeFileSync(userDesktop, patched.content, 'utf8');
        updated.push(userDesktop);
        state.desktopEntries = [...state.desktopEntries.filter(e => e.path !== userDesktop), { path: userDesktop, mode: 'created' }];
      }
    }
  } else if (platform === 'darwin') {
    const appDir = join(home, 'Applications', 'Antigravity (Powertools).app');
    const macosDir = join(appDir, 'Contents', 'MacOS');
    const resourcesDir = join(appDir, 'Contents', 'Resources');
    const plistPath = join(appDir, 'Contents', 'Info.plist');
    const launcherPath = join(macosDir, 'launcher');
    const iconTargetPath = join(resourcesDir, 'icon.icns');
    const sourceApp = resolveMacSourceApp({ home, env, execPath, sandbox, excludeAppDir: appDir, macSourceApp });
    const iconSource = resolveMacAppIcon(sourceApp);
    mkdirSync(macosDir, { recursive: true });
    if (iconSource) {
      mkdirSync(resourcesDir, { recursive: true });
      copyFileSync(iconSource, iconTargetPath);
      iconConfigured = true;
    } else if (existsSync(iconTargetPath)) {
      try { unlinkSync(iconTargetPath); } catch {}
    }
    const plistLines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0"><dict>',
      '  <key>CFBundleExecutable</key><string>launcher</string>',
      '  <key>CFBundleIdentifier</key><string>com.whitebr1ck.agy-powertools.launcher</string>',
      '  <key>CFBundleName</key><string>Antigravity (Powertools)</string>',
      '  <key>CFBundlePackageType</key><string>APPL</string>'
    ];
    if (iconConfigured) {
      plistLines.push('  <key>CFBundleIconFile</key><string>icon.icns</string>');
    }
    plistLines.push('</dict></plist>');
    writeFileSync(plistPath, plistLines.join('\n'), 'utf8');
    const launchTarget = (sourceApp || '/Applications/Antigravity.app').replace(/(["\\$`])/g, '\\$1');
    writeFileSync(launcherPath, `#!/bin/sh\nexec open -a "${launchTarget}" --args --remote-debugging-port=0 "$@"\n`, { mode: 0o755 });
    try { chmodSync(launcherPath, 0o755); } catch {}
    if (!sandbox) {
      try { const now = new Date(); utimesSync(appDir, now, now); } catch {}
      if (iconConfigured && existsSync(MAC_LSREGISTER_PATH)) {
        try { spawnSync(MAC_LSREGISTER_PATH, ['-f', appDir], { stdio: 'ignore', timeout: 3000 }); } catch {}
      }
    }
    macApp = appDir;
    updated.push(appDir);
    if (!state.macApps.includes(appDir)) state.macApps.push(appDir);
  }

  if (stateFile && (updated.length || existsSync(stateFile))) writeJson(stateFile, state);
  return platform === 'darwin' ? { updated, macApp, iconConfigured } : { updated };
}

export function restoreLaunchers({
  home = homedir(),
  dataDir,
  platform = process.platform,
  env = process.env,
  sandbox = resolve(home) !== resolve(homedir()),
  runPowerShell = defaultRunPowerShell
} = {}) {
  const stateFile = dataDir ? join(dataDir, 'launcher-state.json') : '';
  const state = stateFile ? readJson(stateFile, { shortcuts: [], desktopEntries: [], macApps: [] }) : { shortcuts: [], desktopEntries: [], macApps: [] };
  const restored = [];

  if (platform === 'win32') {
    const candidates = [...new Set([...(state.shortcuts || []), ...windowsShortcutCandidates({ home, env, sandbox, runPowerShell })])];
    if (candidates.length) {
      const psEnv = { ...env, AGY_LNK_LIST: JSON.stringify(candidates) };
      const script = [
        '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
        '$paths = $env:AGY_LNK_LIST | ConvertFrom-Json',
        '$ws = New-Object -ComObject WScript.Shell',
        '$changed = @()',
        'foreach ($p in $paths) {',
        '  try {',
        '    if (-not (Test-Path -LiteralPath $p)) { continue }',
        '    $s = $ws.CreateShortcut($p)',
        '    $leaf = Split-Path -Leaf $s.TargetPath',
        '    if ($leaf -match "^antigravity\\.exe$" -and ([string]$s.Arguments) -match "--remote-debugging-port=0") {',
        '      $s.Arguments = (([string]$s.Arguments) -replace "(?:^|\\s+)--remote-debugging-port=0(?=\\s|$)", " ").Trim()',
        '      $s.Save()',
        '      $changed += $p',
        '    }',
        '  } catch {}',
        '}',
        'ConvertTo-Json -Compress @($changed)'
      ].join('\n');
      const out = runPowerShell(script, psEnv);
      try {
        for (const item of JSON.parse(out || '[]')) if (typeof item === 'string' && item) restored.push(item);
      } catch {}
    }
  } else if (platform === 'linux') {
    const fallbackPath = join(sandbox ? join(home, '.local', 'share') : (env.XDG_DATA_HOME || join(home, '.local', 'share')), 'applications', 'antigravity.desktop');
    const entries = state.desktopEntries?.length ? state.desktopEntries : [{ path: fallbackPath, mode: 'patched' }];
    for (const entry of entries) {
      if (!entry?.path || !existsSync(entry.path)) continue;
      if (entry.mode === 'created' && resolve(entry.path).startsWith(resolve(home))) {
        try { unlinkSync(entry.path); restored.push(entry.path); } catch {}
      } else {
        const unpatched = unpatchDesktopEntry(readFileSync(entry.path, 'utf8'));
        if (unpatched.changed) {
          writeFileSync(entry.path, unpatched.content, 'utf8');
          restored.push(entry.path);
        }
      }
    }
  } else if (platform === 'darwin') {
    const targets = state.macApps?.length ? state.macApps : [join(home, 'Applications', 'Antigravity (Powertools).app')];
    for (const appDir of targets) {
      if (appDir && existsSync(appDir) && resolve(appDir).startsWith(resolve(home))) {
        try { rmSync(appDir, { recursive: true, force: true }); restored.push(appDir); } catch {}
      }
    }
  }

  if (stateFile && existsSync(stateFile)) {
    try { unlinkSync(stateFile); } catch {}
  }
  return { restored };
}

export function resolveAntigravityExecutable({ platform = process.platform, env = process.env, home = homedir(), execPath = process.execPath } = {}) {
  const agentExe = env.ANTIGRAVITY_AGENTAPI_EXE || '';
  if (platform === 'win32') {
    if (agentExe) {
      const candidate = join(dirname(dirname(dirname(agentExe))), 'Antigravity.exe');
      if (existsSync(candidate)) return candidate;
    }
    if (execPath && /^antigravity\.exe$/i.test(basename(execPath)) && existsSync(execPath)) {
      return execPath;
    }
    const candidates = [
      join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs', 'antigravity', 'Antigravity.exe'),
      env.ProgramFiles && join(env.ProgramFiles, 'Antigravity', 'Antigravity.exe'),
      env.ProgramFiles && join(env.ProgramFiles, 'antigravity', 'Antigravity.exe'),
      env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Antigravity', 'Antigravity.exe')
    ].filter(Boolean);
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return '';
  }
  if (platform === 'darwin') {
    for (const seed of [agentExe, execPath].filter(Boolean)) {
      for (let cur = dirname(seed); cur && cur !== dirname(cur); cur = dirname(cur)) {
        if (/Antigravity.*\.app$/i.test(basename(cur)) && existsSync(cur)) return cur;
      }
    }
    for (const candidate of ['/Applications/Antigravity.app', join(home, 'Applications', 'Antigravity.app')]) {
      if (existsSync(candidate)) return candidate;
    }
    return '';
  }
  if (env.APPIMAGE && existsSync(env.APPIMAGE)) return env.APPIMAGE;
  if (agentExe) {
    const candidate = join(dirname(dirname(dirname(agentExe))), 'antigravity');
    if (existsSync(candidate)) return candidate;
  }
  if (execPath && /^antigravity$/i.test(basename(execPath)) && existsSync(execPath)) {
    return execPath;
  }
  for (const candidate of ['/usr/share/antigravity/antigravity', '/opt/Antigravity/antigravity', '/usr/bin/antigravity']) {
    if (existsSync(candidate)) return candidate;
  }
  return '';
}

export function manualLaunchCommand({ platform = process.platform, env = process.env, home = homedir(), execPath = process.execPath } = {}) {
  const target = resolveAntigravityExecutable({ platform, env, home, execPath });
  if (!target) return '';
  if (platform === 'win32') return `"${target}" ${DEBUG_FLAG}`;
  if (platform === 'darwin') return `open -n -a "${target}" --args ${DEBUG_FLAG}`;
  return `"${target}" ${DEBUG_FLAG}`;
}

function cleanGuiEnv(env) {
  const copy = { ...env };
  for (const key of Object.keys(copy)) {
    if (key === 'ELECTRON_RUN_AS_NODE' || key === 'NODE_OPTIONS' || key.startsWith('ANTIGRAVITY_SIDECAR_') || key === 'ANTIGRAVITY_LS_ADDRESS' || key === 'ANTIGRAVITY_CSRF_TOKEN' || key === 'ANTIGRAVITY_AGENTAPI_EXE') {
      delete copy[key];
    }
  }
  return copy;
}

function resolveLaunchProxy({ dataDir, proxy } = {}) {
  let raw = proxy;
  if (raw === undefined && dataDir) {
    const saved = readJson(join(dataDir, 'settings.json'), null);
    if (saved && typeof saved === 'object') {
      raw = {
        enabled: Boolean(saved.proxyEnabled),
        url: typeof saved.proxyUrl === 'string' ? saved.proxyUrl : '',
        bypass: typeof saved.proxyBypass === 'string' ? saved.proxyBypass : '',
        forceHttp1: Boolean(saved.proxyForceHttp1)
      };
    }
  }
  const empty = { enabled: false, url: '', bypass: 'localhost,127.0.0.1,::1', forceHttp1: false, specKey: '', chromiumServer: '', chromiumBypass: 'localhost;127.0.0.1;[::1]' };
  if (!raw || !raw.enabled || typeof raw.url !== 'string') return empty;
  const trimmed = raw.url.trim();
  if (!trimmed || trimmed.length > 256 || /[\x00-\x1f\x7f\s'"`\\;$|&<>]/.test(trimmed)) return empty;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return empty; }
  if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(parsed.protocol) || !parsed.hostname) return empty;
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) return empty;
  const auth = parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@` : '';
  const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[') ? `[${parsed.hostname}]` : parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : '';
  const url = `${parsed.protocol}//${auth}${host}${port}`;
  const bypassRaw = typeof raw.bypass === 'string' && !/[\x00-\x1f\x7f'"`\\$|&<>]/.test(raw.bypass) ? raw.bypass : '';
  const seen = new Set();
  const bypassList = [];
  for (const item of ['localhost', '127.0.0.1', '::1', ...bypassRaw.split(/[,;\s]+/)]) {
    const clean = item.trim() === '[::1]' ? '::1' : item.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    bypassList.push(clean);
  }
  const bypass = bypassList.join(',');
  const forceHttp1 = Boolean(raw.forceHttp1);
  const chromeScheme = parsed.protocol === 'socks5h:' ? 'socks5:' : parsed.protocol;
  const chromiumServer = `${chromeScheme}//${host}${port}`;
  const chromiumBypass = bypassList.map(item => (item === '::1' ? '[::1]' : item)).join(';');
  return {
    enabled: true,
    url,
    bypass,
    forceHttp1,
    specKey: `${url}|${bypass}|${forceHttp1 ? 'h1' : 'auto'}`,
    chromiumServer,
    chromiumBypass
  };
}

function psSingleQuote(value) {
  return `'${String(value ?? '').replace(/'/g, "''")}'`;
}

export function scheduleRelaunchWithDebugPort({
  dataDir,
  home = homedir(),
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  proxy,
  spawnProcess = spawn
} = {}) {
  const target = resolveAntigravityExecutable({ platform, env, home, execPath });
  if (!target) throw new Error('未找到 Antigravity 启动程序');
  if (dataDir) {
    const stateFile = join(dataDir, 'relaunch-state.json');
    const prev = readJson(stateFile, {});
    writeJson(stateFile, { ...prev, lastRelaunchAt: Date.now(), lastPromptLsAddress: env.ANTIGRAVITY_LS_ADDRESS || '' });
  }

  const launchProxy = resolveLaunchProxy({ dataDir, proxy });
  const childEnv = { ...cleanGuiEnv(env), AGY_RELAUNCH_TARGET: target };
  if (platform === 'win32') {
    const scriptDir = dataDir || tmpdir();
    mkdirSync(scriptDir, { recursive: true });
    const relaunchScriptPath = join(scriptDir, 'relaunch-antigravity.ps1');
    const targetLiteral = target.replace(/'/g, "''");
    const proxyEnvLines = launchProxy.enabled
      ? [
          `$env:HTTP_PROXY = ${psSingleQuote(launchProxy.url)}`,
          `$env:HTTPS_PROXY = ${psSingleQuote(launchProxy.url)}`,
          `$env:ALL_PROXY = ${psSingleQuote(launchProxy.url)}`,
          `$env:http_proxy = ${psSingleQuote(launchProxy.url)}`,
          `$env:https_proxy = ${psSingleQuote(launchProxy.url)}`,
          `$env:all_proxy = ${psSingleQuote(launchProxy.url)}`,
          `$env:NO_PROXY = ${psSingleQuote(launchProxy.bypass)}`,
          `$env:no_proxy = ${psSingleQuote(launchProxy.bypass)}`,
          `$env:AGY_POWERTOOLS_PROXY_SPEC = ${psSingleQuote(launchProxy.specKey)}`,
          ...(launchProxy.forceHttp1
            ? ["$env:GODEBUG = 'http2client=0'"]
            : ["if ($env:GODEBUG -eq 'http2client=0') { Remove-Item Env:GODEBUG -ErrorAction SilentlyContinue }"])
        ]
      : [
          "Remove-Item Env:HTTP_PROXY,Env:HTTPS_PROXY,Env:ALL_PROXY,Env:http_proxy,Env:https_proxy,Env:all_proxy,Env:NO_PROXY,Env:no_proxy,Env:AGY_POWERTOOLS_PROXY_SPEC -ErrorAction SilentlyContinue",
          "if ($env:GODEBUG -eq 'http2client=0') { Remove-Item Env:GODEBUG -ErrorAction SilentlyContinue }"
        ];
    const startArgs = launchProxy.enabled
      ? `@(${[DEBUG_FLAG, `--proxy-server=${launchProxy.chromiumServer}`, `--proxy-bypass-list=${launchProxy.chromiumBypass}`].map(psSingleQuote).join(', ')})`
      : `'${DEBUG_FLAG}'`;
    const relaunchBody = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "Start-Sleep -Milliseconds 350",
      `$target = '${targetLiteral}'`,
      "function Get-AgyProcs {",
      "  @(Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" | Where-Object {",
      "    -not $_.ExecutablePath -or $_.ExecutablePath.Equals($target, [System.StringComparison]::OrdinalIgnoreCase)",
      "  })",
      "}",
      "foreach ($p in @(Get-Process -Name 'Antigravity')) {",
      "  if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() }",
      "}",
      "$deadline = (Get-Date).AddSeconds(3)",
      "while ((Get-Date) -lt $deadline) {",
      "  if ((Get-AgyProcs).Count -eq 0) { break }",
      "  Start-Sleep -Milliseconds 250",
      "}",
      "foreach ($p in (Get-AgyProcs)) {",
      "  Stop-Process -Id ([int]$p.ProcessId) -Force",
      "}",
      "$waitExit = (Get-Date).AddSeconds(6)",
      "while ((Get-Date) -lt $waitExit) {",
      "  if ((Get-AgyProcs).Count -eq 0) { break }",
      "  Start-Sleep -Milliseconds 250",
      "}",
      "Start-Sleep -Milliseconds 400",
      ...proxyEnvLines,
      `Start-Process -FilePath $target -ArgumentList ${startArgs}`,
      "Remove-Item -LiteralPath $PSCommandPath -Force"
    ].join('\r\n');
    writeFileSync(relaunchScriptPath, '\uFEFF' + relaunchBody + '\r\n', 'utf8');

    // Launch via Explorer.exe Desktop COM (ShellWindows FindWindowSW -> ShellExecute) using -EncodedCommand
    // without detached:true on the short-lived trigger (PowerShell 5.1 exits silently under DETACHED_PROCESS + windowsHide).
    // Explorer.exe spawns relaunch-antigravity.ps1 completely outside Antigravity's Win32 Job Object and avoids WMI ASR blocks.
    const launcherScript = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$script = $env:AGY_RELAUNCH_SCRIPT",
      '$psArgs = \'-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "\' + $script + \'"\'',
      '$launched = $false',
      'try {',
      "  $shellWin = [Activator]::CreateInstance([Type]::GetTypeFromCLSID([Guid]'9BA05972-F6A8-11CF-A442-00A0C90A8F39'))",
      '  $hwnd = 0',
      '  $disp = $shellWin.FindWindowSW(0, 0, 8, [ref]$hwnd, 1)',
      '  if ($disp -and $disp.Document -and $disp.Document.Application) {',
      "    $disp.Document.Application.ShellExecute('powershell.exe', $psArgs, '', 'open', 0)",
      '    $launched = $true',
      '  }',
      '} catch {}',
      'if (-not $launched) {',
      '  try {',
      '    Add-Type -TypeDefinition @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'public static class AgyBreakawayLaunch {',
      '  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]',
      '  public struct STARTUPINFO {',
      '    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;',
      '    public int dwX; public int dwY; public int dwXSize; public int dwYSize;',
      '    public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;',
      '    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;',
      '    public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;',
      '  }',
      '  [StructLayout(LayoutKind.Sequential)]',
      '  public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }',
      '  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]',
      '  public static extern bool CreateProcessW(string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string dir, ref STARTUPINFO si, out PROCESS_INFORMATION pi);',
      '  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);',
      '  public static bool Run(string cmd) {',
      '    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si); si.dwFlags = 1; si.wShowWindow = 0;',
      '    PROCESS_INFORMATION pi;',
      '    if (!CreateProcessW(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x01000000u | 0x08000000u, IntPtr.Zero, null, ref si, out pi)) return false;',
      '    CloseHandle(pi.hThread); CloseHandle(pi.hProcess); return true;',
      '  }',
      '}',
      '"@',
      "    if ([AgyBreakawayLaunch]::Run('powershell.exe ' + $psArgs)) { $launched = $true }",
      '  } catch {}',
      '}',
      'if (-not $launched) {',
      "  Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',$script) -WindowStyle Hidden",
      '}'
    ].join('\r\n');
    const encodedLauncher = Buffer.from(launcherScript, 'utf16le').toString('base64');

    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedLauncher], {
      stdio: 'ignore',
      windowsHide: true,
      env: { ...childEnv, AGY_RELAUNCH_SCRIPT: relaunchScriptPath }
    });
    child.unref?.();
    return { scheduled: true, target, proxyActive: launchProxy.enabled };
  }

  const proxyShellEnv = launchProxy.enabled
    ? {
        AGY_PROXY_URL: launchProxy.url,
        AGY_PROXY_BYPASS: launchProxy.bypass,
        AGY_PROXY_SPEC: launchProxy.specKey,
        AGY_PROXY_CHROME_SERVER: launchProxy.chromiumServer,
        AGY_PROXY_CHROME_BYPASS: launchProxy.chromiumBypass,
        AGY_PROXY_FORCE_HTTP1: launchProxy.forceHttp1 ? '1' : '0'
      }
    : {};

  if (platform === 'darwin') {
    const appName = basename(target, '.app');
    const launchLines = launchProxy.enabled
      ? [
          'p_url="$AGY_PROXY_URL"; p_bypass="$AGY_PROXY_BYPASS"; p_spec="$AGY_PROXY_SPEC"; p_chrome="$AGY_PROXY_CHROME_SERVER"; p_cbypass="$AGY_PROXY_CHROME_BYPASS"; p_h1="$AGY_PROXY_FORCE_HTTP1"',
          'unset AGY_PROXY_URL AGY_PROXY_BYPASS AGY_PROXY_SPEC AGY_PROXY_CHROME_SERVER AGY_PROXY_CHROME_BYPASS AGY_PROXY_FORCE_HTTP1',
          'export HTTP_PROXY="$p_url" HTTPS_PROXY="$p_url" ALL_PROXY="$p_url" http_proxy="$p_url" https_proxy="$p_url" all_proxy="$p_url" NO_PROXY="$p_bypass" no_proxy="$p_bypass" AGY_POWERTOOLS_PROXY_SPEC="$p_spec"',
          'if [ "$p_h1" = "1" ]; then export GODEBUG="http2client=0"; elif [ "$GODEBUG" = "http2client=0" ]; then unset GODEBUG; fi',
          'set -- --env "HTTP_PROXY=$p_url" --env "HTTPS_PROXY=$p_url" --env "ALL_PROXY=$p_url" --env "http_proxy=$p_url" --env "https_proxy=$p_url" --env "all_proxy=$p_url" --env "NO_PROXY=$p_bypass" --env "no_proxy=$p_bypass" --env "AGY_POWERTOOLS_PROXY_SPEC=$p_spec"',
          'if [ "$p_h1" = "1" ]; then set -- "$@" --env "GODEBUG=http2client=0"; fi',
          '/usr/bin/open -n -a "$target" "$@" --args --remote-debugging-port=0 "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass" >/dev/null 2>&1 || /usr/bin/open -n -a "$target" --args --remote-debugging-port=0 "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass" >/dev/null 2>&1'
        ]
      : [
          'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy AGY_POWERTOOLS_PROXY_SPEC AGY_PROXY_URL AGY_PROXY_BYPASS AGY_PROXY_SPEC AGY_PROXY_CHROME_SERVER AGY_PROXY_CHROME_BYPASS AGY_PROXY_FORCE_HTTP1',
          'if [ "$GODEBUG" = "http2client=0" ]; then unset GODEBUG; fi',
          '/usr/bin/open -n -a "$target" --args --remote-debugging-port=0 >/dev/null 2>&1'
        ];
    const script = [
      "trap '' HUP TERM",
      `/usr/bin/osascript -e 'tell application "${appName.replace(/"/g, '\\"')}" to quit' >/dev/null 2>&1 || true`,
      'i=0; while [ $i -lt 15 ] && /bin/ps -axo args= | /usr/bin/awk -v p="$AGY_RELAUNCH_TARGET/Contents/MacOS/" \'{ sub(/^ +/, ""); if (index($0, p) == 1) found=1 } END { exit !found }\'; do sleep 0.3; i=$((i+1)); done',
      'pids=$(/bin/ps -axo pid=,args= | /usr/bin/awk -v p="$AGY_RELAUNCH_TARGET/Contents/MacOS/" \'{ pid=$1; sub(/^ *[0-9]+ +/, ""); if (index($0, p) == 1) print pid }\')',
      'if [ -n "$pids" ]; then kill -TERM $pids >/dev/null 2>&1 || true; fi',
      'i=0; while [ $i -lt 45 ] && /bin/ps -axo args= | /usr/bin/awk -v p="$AGY_RELAUNCH_TARGET/Contents/MacOS/" \'{ sub(/^ +/, ""); if (index($0, p) == 1) found=1 } END { exit !found }\'; do sleep 0.3; i=$((i+1)); done',
      'sleep 0.8',
      'target="$AGY_RELAUNCH_TARGET"; unset AGY_RELAUNCH_TARGET',
      ...launchLines
    ].join('\n');
    const child = spawnProcess('sh', ['-c', script], { detached: true, stdio: 'ignore', env: { ...childEnv, ...proxyShellEnv } });
    child.unref?.();
    return { scheduled: true, target, proxyActive: launchProxy.enabled };
  }

  const linuxLaunchLines = launchProxy.enabled
    ? [
        'p_url="$AGY_PROXY_URL"; p_bypass="$AGY_PROXY_BYPASS"; p_spec="$AGY_PROXY_SPEC"; p_chrome="$AGY_PROXY_CHROME_SERVER"; p_cbypass="$AGY_PROXY_CHROME_BYPASS"; p_h1="$AGY_PROXY_FORCE_HTTP1"',
        'unset AGY_PROXY_URL AGY_PROXY_BYPASS AGY_PROXY_SPEC AGY_PROXY_CHROME_SERVER AGY_PROXY_CHROME_BYPASS AGY_PROXY_FORCE_HTTP1',
        'export HTTP_PROXY="$p_url" HTTPS_PROXY="$p_url" ALL_PROXY="$p_url" http_proxy="$p_url" https_proxy="$p_url" all_proxy="$p_url" NO_PROXY="$p_bypass" no_proxy="$p_bypass" AGY_POWERTOOLS_PROXY_SPEC="$p_spec"',
        'if [ "$p_h1" = "1" ]; then export GODEBUG="http2client=0"; elif [ "$GODEBUG" = "http2client=0" ]; then unset GODEBUG; fi',
        'nohup "$target" --remote-debugging-port=0 "--proxy-server=$p_chrome" "--proxy-bypass-list=$p_cbypass" >/dev/null 2>&1 &'
      ]
    : [
        'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy AGY_POWERTOOLS_PROXY_SPEC AGY_PROXY_URL AGY_PROXY_BYPASS AGY_PROXY_SPEC AGY_PROXY_CHROME_SERVER AGY_PROXY_CHROME_BYPASS AGY_PROXY_FORCE_HTTP1',
        'if [ "$GODEBUG" = "http2client=0" ]; then unset GODEBUG; fi',
        'nohup "$target" --remote-debugging-port=0 >/dev/null 2>&1 &'
      ];
  const script = [
    "trap '' HUP TERM",
    'pids=$(ps -eo pid=,args= | awk -v p="$AGY_RELAUNCH_TARGET" \'{ pid=$1; sub(/^ *[0-9]+ +/, ""); if ($0 == p || index($0, p " ") == 1) print pid }\')',
    'if [ -n "$pids" ]; then kill -TERM $pids >/dev/null 2>&1 || true; fi',
    'i=0; while [ $i -lt 60 ] && ps -eo args= | awk -v p="$AGY_RELAUNCH_TARGET" \'{ sub(/^ +/, ""); if ($0 == p || index($0, p " ") == 1) found=1 } END { exit !found }\'; do sleep 0.3; i=$((i+1)); done',
    'sleep 0.8',
    'target="$AGY_RELAUNCH_TARGET"; unset AGY_RELAUNCH_TARGET',
    ...linuxLaunchLines
  ].join('\n');
  const child = spawnProcess('sh', ['-c', script], { detached: true, stdio: 'ignore', env: { ...childEnv, ...proxyShellEnv } });
  child.unref?.();
  return { scheduled: true, target, proxyActive: launchProxy.enabled };
}

export function shouldPromptPostUpdate({
  dataDir,
  installDir,
  env = process.env,
  now = Date.now()
} = {}) {
  if (!env.ANTIGRAVITY_LS_ADDRESS || env.ELECTRON_OZONE_PLATFORM_HINT === 'headless' || env.AGY_POWERTOOLS_NO_PROMPT === '1') {
    return { prompt: false, reason: 'non-interactive' };
  }
  if (installDir) {
    try {
      const mtimeMs = statSync(join(installDir, '.agy-install.json')).mtimeMs;
      if (Number.isFinite(mtimeMs) && now - mtimeMs > -5000 && now - mtimeMs < FRESH_INSTALL_GRACE_MS) {
        return { prompt: false, reason: 'fresh-install' };
      }
    } catch {}
  }
  if (dataDir) {
    const state = readJson(join(dataDir, 'relaunch-state.json'), {});
    if (state.lastPromptLsAddress && state.lastPromptLsAddress === env.ANTIGRAVITY_LS_ADDRESS) {
      return { prompt: false, reason: 'already-prompted-session' };
    }
    if ((state.lastPromptAt && now - state.lastPromptAt < PROMPT_COOLDOWN_MS) ||
        (state.lastRelaunchAt && now - state.lastRelaunchAt < PROMPT_COOLDOWN_MS)) {
      return { prompt: false, reason: 'cooldown' };
    }
  }
  return { prompt: true, reason: 'ready' };
}

export function maybePromptPostUpdateRelaunch({
  dataDir,
  installDir,
  language = 'zh-CN',
  platform = process.platform,
  env = process.env,
  home = homedir(),
  now = Date.now(),
  relaunch = scheduleRelaunchWithDebugPort
} = {}) {
  const decision = shouldPromptPostUpdate({ dataDir, installDir, env, now });
  if (!decision.prompt) return { prompted: false, reason: decision.reason };
  const target = resolveAntigravityExecutable({ platform, env, home });
  if (!target) return { prompted: false, reason: 'executable-not-found' };

  if (dataDir) {
    const stateFile = join(dataDir, 'relaunch-state.json');
    const prev = readJson(stateFile, {});
    writeJson(stateFile, { ...prev, lastPromptAt: now, lastPromptLsAddress: env.ANTIGRAVITY_LS_ADDRESS });
  }

  const en = language === 'en';
  const message = en
    ? 'Antigravity was updated. Restart to re-enable the Powertools plugin?\n\nYour open conversations will be preserved.'
    : '检测到 Antigravity 已升级，请重启以重新启用 Powertools 插件。\n\n是否现在立即重启客户端？（当前会话记录会自动保留）';

  if (platform === 'win32') {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command',
      `$ws = New-Object -ComObject WScript.Shell; $ans = $ws.Popup($env:AGY_PROMPT_TEXT, 0, 'Agy Powertools', 65 + 4096); if ($ans -eq 1) { exit 10 } else { exit 0 }`
    ], { windowsHide: true, stdio: 'ignore', env: { ...env, AGY_PROMPT_TEXT: message } });
    child.on('exit', code => {
      if (code === 10) {
        try { relaunch({ dataDir, home, platform, env }); } catch {}
      }
    });
    child.unref?.();
    return { prompted: true };
  }

  if (platform === 'darwin') {
    const dockHint = en
      ? '\n\nTip: Drag ~/Applications/Antigravity (Powertools).app onto your Dock to replace the original icon for future launches.'
      : '\n\n提示：可将 ~/Applications/Antigravity (Powertools).app 拖入 Dock 栏替换原图标，后续直接从 Dock 启动即可生效。';
    const btnLater = en ? 'Later' : '稍后';
    const btnNow = en ? 'Restart Now' : '立即重启';
    const script = `display dialog ${JSON.stringify(message + dockHint)} with title "Agy Powertools" buttons {${JSON.stringify(btnLater)}, ${JSON.stringify(btnNow)}} default button ${JSON.stringify(btnNow)}`;
    const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', chunk => { out += chunk; });
    child.on('exit', code => {
      if (code === 0 && out.includes(btnNow)) {
        try { relaunch({ dataDir, home, platform, env }); } catch {}
      }
    });
    child.unref?.();
    return { prompted: true };
  }

  return { prompted: false, reason: 'unsupported-dialog-platform' };
}

let lastAttentionAt = 0;
export function notifyTaskbarAttention({
  count = 0,
  platform = process.platform,
  env = process.env,
  home = homedir(),
  spawnProcess = spawn
} = {}) {
  if (platform !== 'win32' || env.ELECTRON_OZONE_PLATFORM_HINT === 'headless') return false;
  const now = Date.now();
  if (count > 0 && now - lastAttentionAt < 1500) return false;
  lastAttentionAt = now;
  const target = resolveAntigravityExecutable({ platform, env, home });
  const flags = count > 0 ? 14 : 0; // FLASHW_TRAY (2) | FLASHW_TIMERNOFG (12), or FLASHW_STOP (0)
  const flashCount = count > 0 ? 3 : 0;
  const script = [
    '$target = $env:AGY_FLASH_TARGET',
    '$flags = [uint32]$env:AGY_FLASH_FLAGS',
    '$count = [uint32]$env:AGY_FLASH_COUNT',
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class AgyFlash {',
    '  [StructLayout(LayoutKind.Sequential)]',
    '  public struct FLASHWINFO { public uint cbSize; public IntPtr hwnd; public uint dwFlags; public uint uCount; public uint dwTimeout; }',
    '  [DllImport("user32.dll")] public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);',
    '  public static void Flash(IntPtr h, uint f, uint c) {',
    '    var info = new FLASHWINFO { cbSize = (uint)Marshal.SizeOf(typeof(FLASHWINFO)), hwnd = h, dwFlags = f, uCount = c, dwTimeout = 0 };',
    '    FlashWindowEx(ref info);',
    '  }',
    '}',
    '"@ -ErrorAction SilentlyContinue',
    '$procs = @(Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and (-not $target -or ($_.Path -and ([string]$_.Path).Equals($target, [System.StringComparison]::OrdinalIgnoreCase))) })',
    'foreach ($p in $procs) { [AgyFlash]::Flash($p.MainWindowHandle, $flags, $count) }'
  ].join('\n');
  try {
    const child = spawnProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: { ...env, AGY_FLASH_TARGET: target || '', AGY_FLASH_FLAGS: String(flags), AGY_FLASH_COUNT: String(flashCount) }
    });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}

const WINDOWS_RUNNABLE_EXTENSIONS = new Set([
  '.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.psd1',
  '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.hta',
  '.msi', '.msp', '.scr', '.pif', '.reg', '.msc', '.cpl', '.lnk', '.url', '.jar'
]);

export function isWindowsRunnableFile(filePath) {
  return WINDOWS_RUNNABLE_EXTENSIONS.has(extname(String(filePath || '')).toLowerCase());
}

function normalizeFileUri(uri) {
  let s = String(uri || '').trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx >= 0) {
    const before = s.slice(0, hashIdx);
    const decodedFragSep = s.slice(hashIdx + 1).replace(/%2f/gi, '/').replace(/%5c/gi, '/');
    const isLineAnchor = /^(?:L\d+(?:(?:C|:)\d+)?(?:-L?\d+(?:(?:C|:)\d+)?)?|\d+(?:-\d+)?)$/i.test(decodedFragSep);
    const isDocHeading = /\.(?:md|markdown|html?|rst|adoc|pdf)$/i.test(before) && /^[^/\\#?.]+$/.test(decodedFragSep);
    if (isLineAnchor || isDocHeading) {
      s = before;
    } else {
      let tail = decodedFragSep.replace(/(?:#|%23)(?:L\d+(?:(?:C|:)\d+)?(?:-L?\d+(?:(?:C|:)\d+)?)?|\d+(?:-\d+)?)$/i, '');
      tail = tail.replace(/(\.(?:md|markdown|html?|rst|adoc|pdf))(?:#|%23)[^/\\#?.]+$/i, '$1');
      s = `${before}%23${tail.replaceAll('#', '%23')}`;
    }
  }
  return s;
}

export function resolveLocalFilePath(uri) {
  if (typeof uri !== 'string' || !uri.trim()) throw new Error('文件路径无效');
  let parsed;
  try {
    parsed = new URL(normalizeFileUri(uri));
  } catch {
    throw new Error('文件路径格式无效');
  }
  if (parsed.protocol !== 'file:') throw new Error('仅支持本地文件链接');
  if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') throw new Error('仅支持本机文件路径');
  parsed.hash = '';
  parsed.search = '';
  return fileURLToPath(parsed);
}

export function openLocalFile(
  uri,
  { action = 'open', platform = process.platform, spawnProcess = spawn, exists = existsSync, stat = statSync } = {}
) {
  if (action !== 'open' && action !== 'reveal') throw new Error('不支持的文件操作');
  const filePath = resolveLocalFilePath(uri);
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');
  let isDir = false;
  try { isDir = Boolean(stat(filePath)?.isDirectory?.()); } catch { /* Best effort. */ }
  if (action === 'open' && platform === 'win32' && !isDir && isWindowsRunnableFile(filePath)) {
    throw new Error('该文件类型在 Windows 下可能直接执行，已拦截；请使用“打开所在文件夹”或“复制路径”');
  }

  let command;
  let args;
  const spawnOptions = { detached: true, stdio: 'ignore' };
  if (platform === 'win32') {
    command = 'explorer.exe';
    if (action === 'reveal') {
      if (filePath.includes(',')) {
        args = [`/select,"${filePath}"`];
        spawnOptions.windowsVerbatimArguments = true;
      } else {
        args = [`/select,${filePath}`];
      }
    } else {
      args = [filePath];
    }
  } else if (platform === 'darwin') {
    command = 'open';
    args = action === 'reveal' ? ['-R', filePath] : [filePath];
  } else {
    command = 'xdg-open';
    args = [action === 'reveal' ? (isDir ? filePath : dirname(filePath)) : filePath];
  }

  const child = spawnProcess(command, args, spawnOptions);
  child?.unref?.();
  return { ok: true, path: filePath };
}

function runProcessAsync(spawnProcess, command, args, options = {}, { input, timeoutMs = 8000 } = {}) {
  return new Promise(resolvePromise => {
    let settled = false;
    let stderr = '';
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(result);
    };
    let child;
    try {
      child = spawnProcess(command, args, {
        ...options,
        stdio: [input != null ? 'pipe' : 'ignore', 'ignore', 'pipe']
      });
    } catch (error) {
      return finish({ status: -1, error, stderr: '' });
    }
    const timer = setTimeout(() => {
      try { child?.kill?.(); } catch { /* Best effort. */ }
      finish({ status: -1, error: new Error('操作超时'), stderr });
    }, timeoutMs);
    child?.stderr?.on?.('data', chunk => {
      if (stderr.length < 2048) stderr += String(chunk);
    });
    child?.on?.('error', error => finish({ status: -1, error, stderr }));
    child?.on?.('close', code => finish({ status: code ?? 0, error: null, stderr }));
    if (input != null && child?.stdin) {
      child.stdin.on?.('error', () => {});
      child.stdin.end(input);
    }
  });
}

export async function copyLocalFile(
  uri,
  { platform = process.platform, spawnProcess = spawn, exists = existsSync, env = process.env, timeoutMs = 8000 } = {}
) {
  const filePath = resolveLocalFilePath(uri);
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');

  let result;
  if (platform === 'win32') {
    result = await runProcessAsync(
      spawnProcess,
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', 'Set-Clipboard -LiteralPath $env:AGY_CLIPBOARD_PATH'],
      { windowsHide: true, env: { ...env, AGY_CLIPBOARD_PATH: filePath } },
      { timeoutMs }
    );
  } else if (platform === 'darwin') {
    result = await runProcessAsync(
      spawnProcess,
      'osascript',
      ['-e', 'set the clipboard to (POSIX file (system attribute "AGY_CLIPBOARD_PATH"))'],
      { env: { ...env, AGY_CLIPBOARD_PATH: filePath } },
      { timeoutMs }
    );
  } else {
    const fileUri = `${pathToFileURL(filePath).href}\n`;
    result = await runProcessAsync(
      spawnProcess,
      'wl-copy',
      ['--type', 'text/uri-list'],
      { env },
      { input: fileUri, timeoutMs }
    );
    if (result.error || result.status !== 0) {
      result = await runProcessAsync(
        spawnProcess,
        'xclip',
        ['-selection', 'clipboard', '-t', 'text/uri-list'],
        { env },
        { input: fileUri, timeoutMs }
      );
    }
  }

  if (result?.error || result?.status !== 0) {
    throw new Error(result?.stderr?.trim() || result?.error?.message || '复制文件失败');
  }
  return { ok: true, path: filePath };
}

const ATTACH_MEDIA_MIME = new Map([
  ['.png', { mimeType: 'image/png', kind: 'media' }],
  ['.jpg', { mimeType: 'image/jpeg', kind: 'media' }],
  ['.jpeg', { mimeType: 'image/jpeg', kind: 'media' }],
  ['.gif', { mimeType: 'image/gif', kind: 'media' }],
  ['.webp', { mimeType: 'image/webp', kind: 'media' }],
  ['.bmp', { mimeType: 'image/bmp', kind: 'media' }],
  ['.pdf', { mimeType: 'application/pdf', kind: 'doc' }],
  ['.docx', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'doc' }],
  ['.doc', { mimeType: 'application/msword', kind: 'doc' }],
  ['.xlsx', { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'doc' }],
  ['.xls', { mimeType: 'application/vnd.ms-excel', kind: 'doc' }],
  ['.pptx', { mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'doc' }],
  ['.ppt', { mimeType: 'application/vnd.ms-powerpoint', kind: 'doc' }],
  ['.odt', { mimeType: 'application/vnd.oasis.opendocument.text', kind: 'doc' }],
  ['.ods', { mimeType: 'application/vnd.oasis.opendocument.spreadsheet', kind: 'doc' }],
  ['.odp', { mimeType: 'application/vnd.oasis.opendocument.presentation', kind: 'doc' }],
  ['.rtf', { mimeType: 'application/rtf', kind: 'doc' }],
  ['.zip', { mimeType: 'application/zip', kind: 'media' }],
  ['.mp4', { mimeType: 'video/mp4', kind: 'media' }],
  ['.webm', { mimeType: 'video/webm', kind: 'media' }],
  ['.wav', { mimeType: 'audio/wav', kind: 'media' }],
  ['.mp3', { mimeType: 'audio/mp3', kind: 'media' }],
  ['.m4a', { mimeType: 'audio/m4a', kind: 'media' }],
  ['.aac', { mimeType: 'audio/aac', kind: 'media' }],
  ['.ogg', { mimeType: 'audio/ogg', kind: 'media' }],
  ['.flac', { mimeType: 'audio/flac', kind: 'media' }],
  ['.opus', { mimeType: 'audio/opus', kind: 'media' }],
  ['.weba', { mimeType: 'audio/webm', kind: 'media' }]
]);

export function readLocalFileForAttach(
  uri,
  {
    exists = existsSync,
    stat = statSync,
    readFile = readFileSync,
    maxMediaBytes = 10 * 1024 * 1024,
    maxDocBytes = 10 * 1024 * 1024
  } = {}
) {
  const filePath = resolveLocalFilePath(uri);
  if (!exists(filePath)) throw new Error('文件或文件夹不存在');
  const info = stat(filePath);
  const name = basename(filePath) || filePath;
  const normalizedUri = pathToFileURL(filePath).href;
  if (info?.isDirectory?.()) {
    return { ok: true, mode: 'mention', kind: 'directory', uri: normalizedUri, path: filePath, name, isDirectory: true };
  }
  const spec = ATTACH_MEDIA_MIME.get(extname(filePath).toLowerCase());
  const size = Number(info?.size || 0);
  const limit = spec?.kind === 'doc' ? maxDocBytes : maxMediaBytes;
  if (spec && size >= 0 && size <= limit) {
    const buffer = readFile(filePath);
    return {
      ok: true,
      mode: 'media',
      kind: 'file',
      uri: normalizedUri,
      path: filePath,
      name,
      mimeType: spec.mimeType,
      size: buffer.length,
      base64: buffer.toString('base64'),
      isDirectory: false
    };
  }
  return {
    ok: true,
    mode: 'mention',
    kind: 'file',
    uri: normalizedUri,
    path: filePath,
    name,
    size,
    oversized: Boolean(spec && size > limit),
    isDirectory: false
  };
}

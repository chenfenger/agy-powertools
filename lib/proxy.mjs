import net from 'node:net';
import tls from 'node:tls';

export const DEFAULT_PROXY_BYPASS = 'localhost,127.0.0.1,::1';
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'socks5:', 'socks5h:']);
const UNSAFE_CHARS = /[\x00-\x1f\x7f\s'"`\\;$|&<>]/;
const UNSAFE_BYPASS_CHARS = /[\x00-\x1f\x7f'"`\\$|&<>]/;
const REQUIRED_LOOPBACK = ['localhost', '127.0.0.1', '::1'];

export function normalizeProxyUrl(raw = '') {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (trimmed.length > 256 || UNSAFE_CHARS.test(trimmed)) return null;
  let parsed;
  try { parsed = new URL(trimmed); } catch { return null; }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return null;
  if (!parsed.hostname) return null;
  if (parsed.pathname && parsed.pathname !== '/') return null;
  if (parsed.search || parsed.hash) return null;
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return null;
  }
  const auth = parsed.username
    ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@`
    : '';
  const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
    ? `[${parsed.hostname}]`
    : parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : '';
  return `${parsed.protocol}//${auth}${host}${port}`;
}

export function maskProxyUrl(raw = '') {
  const normalized = normalizeProxyUrl(raw);
  if (!normalized) return String(raw || '').trim();
  try {
    const parsed = new URL(normalized);
    if (!parsed.username && !parsed.password) return normalized;
    const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
      ? `[${parsed.hostname}]`
      : parsed.hostname;
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//***@${host}${port}`;
  } catch {
    return normalized;
  }
}

export function isValidProxyUrl(raw = '') {
  if (typeof raw !== 'string') return false;
  if (!raw.trim()) return true;
  return normalizeProxyUrl(raw) !== null;
}

export function normalizeProxyBypass(raw = '') {
  if (typeof raw !== 'string') return null;
  if (raw.length > 512 || UNSAFE_BYPASS_CHARS.test(raw)) return null;
  const parts = raw
    .split(/[,;\s]+/)
    .map(item => item.trim())
    .filter(Boolean);
  const seen = new Set();
  const ordered = [];
  const push = item => {
    const clean = item === '[::1]' ? '::1' : item;
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) return;
    seen.add(key);
    ordered.push(clean);
  };
  for (const required of REQUIRED_LOOPBACK) push(required);
  for (const part of parts) push(part);
  return ordered.join(',');
}

export function isValidProxyBypass(raw = '') {
  return normalizeProxyBypass(raw) !== null;
}

export function chromiumProxyArgs(spec) {
  if (!spec?.enabled || !spec.url) return [];
  const parsed = new URL(spec.url);
  // Chromium expects socks5:// (remote DNS by default) and does not recognize socks5h://.
  const scheme = parsed.protocol === 'socks5h:' ? 'socks5:' : parsed.protocol;
  const host = parsed.hostname.includes(':') && !parsed.hostname.startsWith('[')
    ? `[${parsed.hostname}]`
    : parsed.hostname;
  const port = parsed.port ? `:${parsed.port}` : '';
  const server = `${scheme}//${host}${port}`;
  const bypassItems = (spec.bypass || DEFAULT_PROXY_BYPASS)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => (item === '::1' ? '[::1]' : item));
  return [
    `--proxy-server=${server}`,
    `--proxy-bypass-list=${bypassItems.join(';')}`
  ];
}

export function proxySpecFromSettings(settings = {}) {
  const url = normalizeProxyUrl(settings.proxyUrl || '') || '';
  const bypass = normalizeProxyBypass(settings.proxyBypass ?? DEFAULT_PROXY_BYPASS) || DEFAULT_PROXY_BYPASS;
  const forceHttp1 = Boolean(settings.proxyForceHttp1);
  const enabled = Boolean(settings.proxyEnabled && url);
  const specKey = enabled ? `${url}|${bypass}|${forceHttp1 ? 'h1' : 'auto'}` : '';
  return {
    enabled,
    url,
    displayUrl: maskProxyUrl(url),
    bypass,
    forceHttp1,
    specKey
  };
}

function hasHttp2ClientDisabled(godebug = '') {
  return String(godebug || '')
    .split(',')
    .map(token => token.trim())
    .includes('http2client=0');
}

export function inspectProxyRuntime(settings = {}, env = process.env) {
  const spec = proxySpecFromSettings(settings);
  const managedSpec = typeof env?.AGY_POWERTOOLS_PROXY_SPEC === 'string'
    ? env.AGY_POWERTOOLS_PROXY_SPEC.trim()
    : '';
  const rawRunningUrl = env?.HTTPS_PROXY || env?.https_proxy || env?.HTTP_PROXY || env?.http_proxy || env?.ALL_PROXY || env?.all_proxy || '';
  const activeUrl = normalizeProxyUrl(rawRunningUrl) || '';
  const activeForceHttp1 = hasHttp2ClientDisabled(env?.GODEBUG || '');
  const managedByPowertools = Boolean(managedSpec);

  if (!spec.enabled) {
    if (managedByPowertools) {
      return {
        configured: false,
        configuredUrl: spec.url,
        configuredDisplayUrl: spec.displayUrl,
        configuredBypass: spec.bypass,
        configuredForceHttp1: spec.forceHttp1,
        active: Boolean(activeUrl),
        activeUrl,
        activeDisplayUrl: maskProxyUrl(activeUrl),
        activeForceHttp1,
        managedByPowertools: true,
        mismatch: true,
        reason: 'needs-disable'
      };
    }
    return {
      configured: false,
      configuredUrl: spec.url,
      configuredDisplayUrl: spec.displayUrl,
      configuredBypass: spec.bypass,
      configuredForceHttp1: spec.forceHttp1,
      active: Boolean(activeUrl),
      activeUrl,
      activeDisplayUrl: maskProxyUrl(activeUrl),
      activeForceHttp1,
      managedByPowertools: false,
      mismatch: false,
      reason: 'disabled'
    };
  }

  const exactManagedMatch = managedByPowertools && managedSpec === spec.specKey;
  const envMatch = Boolean(activeUrl) && activeUrl === spec.url && (!spec.forceHttp1 || activeForceHttp1);

  if (exactManagedMatch || (!managedByPowertools && envMatch)) {
    return {
      configured: true,
      configuredUrl: spec.url,
      configuredDisplayUrl: spec.displayUrl,
      configuredBypass: spec.bypass,
      configuredForceHttp1: spec.forceHttp1,
      active: true,
      activeUrl: activeUrl || spec.url,
      activeDisplayUrl: maskProxyUrl(activeUrl || spec.url),
      activeForceHttp1: managedByPowertools ? spec.forceHttp1 : activeForceHttp1,
      managedByPowertools,
      mismatch: false,
      reason: 'active'
    };
  }

  const reason = managedByPowertools || activeUrl ? 'config-changed' : 'not-applied';
  return {
    configured: true,
    configuredUrl: spec.url,
    configuredDisplayUrl: spec.displayUrl,
    configuredBypass: spec.bypass,
    configuredForceHttp1: spec.forceHttp1,
    active: Boolean(activeUrl),
    activeUrl,
    activeDisplayUrl: maskProxyUrl(activeUrl),
    activeForceHttp1,
    managedByPowertools,
    mismatch: true,
    reason
  };
}

function defaultPortForProtocol(protocol) {
  if (protocol === 'https:') return 443;
  if (protocol === 'socks5:' || protocol === 'socks5h:') return 1080;
  return 80;
}

export function checkProxyPortOpen(rawUrl, timeoutMs = 800) {
  const normalized = normalizeProxyUrl(rawUrl);
  if (!normalized) {
    return Promise.resolve({ ok: false, reachable: false, error: '代理地址格式无效' });
  }
  const parsed = new URL(normalized);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = parsed.port ? Number(parsed.port) : defaultPortForProtocol(parsed.protocol);
  const startedAt = Date.now();

  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, latencyMs: Date.now() - startedAt, host, port });
    };
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true, reachable: true }));
    socket.once('timeout', () => finish({ ok: false, reachable: false, error: `代理端口 ${host}:${port} 连接超时，请确认代理软件已启动` }));
    socket.once('error', err => finish({ ok: false, reachable: false, error: `代理端口 ${host}:${port} 无法连接（${err.code || err.message}），请确认代理软件已启动` }));
  });
}

function probeHttpConnect(parsed, { host, port, targetHost, targetPort, timeoutMs }) {
  return new Promise(resolve => {
    let settled = false;
    const startedAt = Date.now();
    const finish = result => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, latencyMs: Date.now() - startedAt });
    };
    const connectOpts = { host, port };
    const socket = parsed.protocol === 'https:'
      ? tls.connect({ ...connectOpts, servername: host })
      : net.createConnection(connectOpts);
    socket.setTimeout(timeoutMs);

    const onConnected = () => {
      const headers = [
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
        `Host: ${targetHost}:${targetPort}`,
        'Proxy-Connection: keep-alive'
      ];
      if (parsed.username || parsed.password) {
        const creds = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
        headers.push(`Proxy-Authorization: Basic ${Buffer.from(creds, 'utf8').toString('base64')}`);
      }
      socket.write(headers.join('\r\n') + '\r\n\r\n');
    };

    if (parsed.protocol === 'https:') socket.once('secureConnect', onConnected);
    else socket.once('connect', onConnected);

    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1');
      const idx = buffer.indexOf('\r\n');
      if (idx === -1) {
        if (buffer.length > 4096) finish({ ok: false, reachable: true, tunnelOk: false, error: '代理返回了无效的响应头' });
        return;
      }
      const statusLine = buffer.slice(0, idx).trim();
      const match = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})(?:\s+(.*))?$/i);
      if (!match) {
        finish({ ok: false, reachable: true, tunnelOk: false, error: `代理响应异常：${statusLine.slice(0, 64)}` });
        return;
      }
      const code = Number(match[1]);
      if (code >= 200 && code < 300) {
        finish({ ok: true, reachable: true, tunnelOk: true, statusCode: code });
      } else if (code === 407) {
        finish({ ok: false, reachable: true, tunnelOk: false, statusCode: code, error: '代理需要身份验证（HTTP 407）' });
      } else {
        finish({ ok: false, reachable: true, tunnelOk: false, statusCode: code, error: `代理拒绝转发目标地址（HTTP ${code}）` });
      }
    });

    socket.once('timeout', () => finish({ ok: false, reachable: false, tunnelOk: false, error: `代理连接超时（${host}:${port}）` }));
    socket.once('error', err => finish({ ok: false, reachable: false, tunnelOk: false, error: `无法连接代理 ${host}:${port}（${err.code || err.message}）` }));
    socket.once('end', () => finish({ ok: false, reachable: true, tunnelOk: false, error: '代理提前断开了连接' }));
  });
}

function probeSocks5Connect(parsed, { host, port, targetHost, targetPort, timeoutMs }) {
  return new Promise(resolve => {
    let settled = false;
    const startedAt = Date.now();
    const hasAuth = Boolean(parsed.username || parsed.password);
    const finish = result => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ...result, latencyMs: Date.now() - startedAt });
    };
    const socket = net.createConnection({ host, port });
    socket.setTimeout(timeoutMs);

    let stage = 'greeting';
    let buf = Buffer.alloc(0);

    const sendConnect = () => {
      stage = 'connect';
      const domainBytes = Buffer.from(targetHost, 'ascii');
      const req = Buffer.alloc(7 + domainBytes.length);
      req[0] = 0x05;
      req[1] = 0x01; // CONNECT
      req[2] = 0x00;
      req[3] = 0x03; // DOMAINNAME
      req[4] = domainBytes.length;
      domainBytes.copy(req, 5);
      req.writeUInt16BE(targetPort, 5 + domainBytes.length);
      socket.write(req);
    };

    socket.once('connect', () => {
      const methods = hasAuth ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
      socket.write(methods);
    });

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (stage === 'greeting' && buf.length >= 2) {
        const ver = buf[0], method = buf[1];
        buf = buf.subarray(2);
        if (ver !== 0x05) {
          finish({ ok: false, reachable: true, tunnelOk: false, error: '目标端口不是有效的 SOCKS5 代理' });
          return;
        }
        if (method === 0x00) {
          sendConnect();
        } else if (method === 0x02 && hasAuth) {
          stage = 'auth';
          const u = Buffer.from(decodeURIComponent(parsed.username), 'utf8');
          const p = Buffer.from(decodeURIComponent(parsed.password), 'utf8');
          const authBuf = Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]);
          socket.write(authBuf);
        } else {
          finish({ ok: false, reachable: true, tunnelOk: false, error: 'SOCKS5 代理需要用户名密码认证或不支持当前认证方式' });
          return;
        }
      }
      if (stage === 'auth' && buf.length >= 2) {
        const status = buf[1];
        buf = buf.subarray(2);
        if (status !== 0x00) {
          finish({ ok: false, reachable: true, tunnelOk: false, error: 'SOCKS5 代理认证失败' });
          return;
        }
        sendConnect();
      }
      if (stage === 'connect' && buf.length >= 4) {
        const ver = buf[0], rep = buf[1];
        if (ver !== 0x05) {
          finish({ ok: false, reachable: true, tunnelOk: false, error: 'SOCKS5 代理返回格式异常' });
          return;
        }
        if (rep === 0x00) {
          finish({ ok: true, reachable: true, tunnelOk: true });
        } else {
          finish({ ok: false, reachable: true, tunnelOk: false, error: `SOCKS5 转发失败（错误码 0x${rep.toString(16).padStart(2, '0')}）` });
        }
      }
    });

    socket.once('timeout', () => finish({ ok: false, reachable: false, tunnelOk: false, error: `代理连接超时（${host}:${port}）` }));
    socket.once('error', err => finish({ ok: false, reachable: false, tunnelOk: false, error: `无法连接代理 ${host}:${port}（${err.code || err.message}）` }));
    socket.once('end', () => finish({ ok: false, reachable: true, tunnelOk: false, error: 'SOCKS5 代理提前断开了连接' }));
  });
}

export async function probeProxyConnectivity(rawUrl, {
  timeoutMs = 4500,
  targetHost = 'daily-cloudcode-pa.googleapis.com',
  targetPort = 443
} = {}) {
  const normalized = normalizeProxyUrl(rawUrl);
  if (!normalized) {
    return { ok: false, reachable: false, tunnelOk: false, error: '代理地址无效，请使用 http://、https:// 或 socks5:// 开头', url: '' };
  }
  const parsed = new URL(normalized);
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const port = parsed.port ? Number(parsed.port) : defaultPortForProtocol(parsed.protocol);
  const res = parsed.protocol === 'socks5:' || parsed.protocol === 'socks5h:'
    ? await probeSocks5Connect(parsed, { host, port, targetHost, targetPort, timeoutMs })
    : await probeHttpConnect(parsed, { host, port, targetHost, targetPort, timeoutMs });
  return { ...res, url: maskProxyUrl(normalized) };
}

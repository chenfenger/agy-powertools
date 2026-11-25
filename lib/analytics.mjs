import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readDatabase } from './database.mjs';

export function requestEvents(database, conversationId) {
  const generations = (database?.generations || []).filter(g => g.modelName || g.error || g.outputTokens);
  const knownExecutionEnum = generations.find(g => g.executionModelEnum)?.executionModelEnum || null;
  return generations.map(g => {
    const times = g.stepIndices.map(index => database.times.get(index)).filter(Boolean);
    const created = times.map(t => t.createdMs).filter(Number.isFinite);
    const timestampMs = created.length ? Math.min(...created) : null;
    const role = g.role || (knownExecutionEnum && g.modelEnum ? (g.modelEnum === knownExecutionEnum ? 'execution' : 'planner') : '');
    const durationMs = g.ttftMs != null && g.streamingMs != null ? g.ttftMs + g.streamingMs : null;
    // Exclude TTFT for genuine streamed responses so slow prefill/queueing doesn't distort decode speed,
    // while keeping whole-request fallback for buffered providers that flush tokens in a short streaming tail.
    const isStreamed = Boolean(g.streamingMs != null && g.streamingMs >= 500 && g.outputTokens >= 20);
    const tpsDurationMs = isStreamed ? g.streamingMs : durationMs;
    const tps = tpsDurationMs != null && tpsDurationMs > 0 ? Number((g.outputTokens * 1000 / tpsDurationMs).toFixed(1)) : null;
    const wholeTps = durationMs != null && durationMs > 0 ? Number((g.outputTokens * 1000 / durationMs).toFixed(1)) : null;
    return { id: g.requestId || `${g.executionId}:${g.index}:${timestampMs}:${g.modelName}`, conversationId, timestampMs,
      model: g.modelName, role, inputTokens: g.inputTokens, cacheReadTokens: g.cacheReadTokens, outputTokens: g.outputTokens,
      cacheHitPercent: g.inputTokens + g.cacheReadTokens > 0 ? Number((g.cacheReadTokens / (g.inputTokens + g.cacheReadTokens) * 100).toFixed(1)) : null,
      thinkingTokens: g.thinkingTokens, responseTokens: g.responseTokens, ttftMs: g.ttftMs, streamingMs: g.streamingMs,
      durationMs, tpsDurationMs, tps, wholeTps, tpsMode: tps == null ? null : (isStreamed ? 'stream' : 'whole'),
      error: g.error || '', status: g.error ? 'error' : g.outputTokens > 0 ? 'success' : 'recorded', retries: g.retries, retryErrors:g.retryErrors||[] };
  });
}

let cache;
const fileEventsCache = new Map();
let fileCacheDir = '';

function dbStamp(dbPath) {
  return [dbPath, `${dbPath}-wal`].map(p => {
    try {
      const s = statSync(p);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return '';
    }
  }).join('|');
}

export function usageDashboard(appDataDir, { force = false } = {}) {
  if (!force && cache?.dir === appDataDir && Date.now() - cache.at < 30000) return cache.value;
  if (fileCacheDir !== appDataDir) {
    fileEventsCache.clear();
    fileCacheDir = appDataDir;
  }
  const convDir = join(appDataDir, 'conversations');
  let files = [];
  try { files = readdirSync(convDir).filter(name => /^[\w-]+\.db$/.test(name)); } catch {}
  const activeFiles = new Set(files);
  for (const cachedFile of fileEventsCache.keys()) {
    if (!activeFiles.has(cachedFile)) fileEventsCache.delete(cachedFile);
  }
  const unique = new Map();
  for (const file of files) {
    const id = file.slice(0, -3);
    const stamp = dbStamp(join(convDir, file));
    let cached = fileEventsCache.get(file);
    if (!cached || cached.stamp !== stamp) {
      const db = readDatabase(appDataDir, id);
      cached = { stamp, events: requestEvents(db, id) };
      fileEventsCache.set(file, cached);
    }
    for (const event of cached.events) if (!unique.has(event.id)) unique.set(event.id, event);
  }
  const requests = [...unique.values()].sort((a,b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  const days = new Map();
  for (const r of requests) {
    if (!r.timestampMs) continue;
    const date = new Date(r.timestampMs);
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    if (!days.has(key)) days.set(key, { date: key, requests: 0, tokens: 0 });
    const day = days.get(key); day.requests++; day.tokens += r.inputTokens + r.cacheReadTokens + r.outputTokens;
  }
  const errors=requests.flatMap(r=>[...(r.error?[r]:[]),...r.retryErrors.filter(error=>error&&String(error).trim()&&error!==r.error).map((error,index)=>({...r,id:`${r.id}:retry:${index}`,status:'error',error}))]);
  const value = { requests, totalRequests: requests.length, errors, totalErrors:errors.length, days:[...days.values()], updatedAtMs:Date.now() };
  cache = { dir: appDataDir, at: Date.now(), value }; return value;
}

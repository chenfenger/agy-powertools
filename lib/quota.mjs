import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateCost } from './pricing.mjs';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TIMELINE_ENTRIES = 256;

function normalizeEmail(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : '';
}

export function createQuotaTracker(directory) {
  const path = join(directory, 'quota-samples.json');
  const timelinePath = join(directory, 'account-timeline.json');
  let history = [];
  let timeline = [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(parsed)) history = parsed.filter(s => s && typeof s.id === 'string' && Number.isFinite(s.resetTimeMs));
  } catch {}
  try {
    const parsed = JSON.parse(readFileSync(timelinePath, 'utf8'));
    if (Array.isArray(parsed)) {
      const sorted = parsed
        .map(entry => ({ email: normalizeEmail(entry?.email), sinceMs: Number(entry?.sinceMs) }))
        .filter(entry => entry.email && Number.isFinite(entry.sinceMs) && entry.sinceMs >= 0)
        .sort((a, b) => a.sinceMs - b.sinceMs);
      for (const entry of sorted) {
        if (!timeline.length || timeline[timeline.length - 1].email !== entry.email) timeline.push(entry);
      }
      timeline = timeline.slice(-MAX_TIMELINE_ENTRIES);
    }
  } catch {}

  const saveTimeline = () => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));
  };

  function collapseTimeline(entries) {
    const out = [];
    for (const entry of entries) {
      if (!entry?.email || !Number.isFinite(entry.sinceMs) || entry.sinceMs < 0) continue;
      if (!out.length || out[out.length - 1].email !== entry.email) {
        out.push({ email: entry.email, sinceMs: entry.sinceMs });
      }
    }
    return out.slice(-MAX_TIMELINE_ENTRIES);
  }

  function backfillHistoricalTimeline() {
    if (timeline.length > 0 && timeline[0].sinceMs === 0) return;
    const obs = [];
    let savedAccountCount = 0;
    for (const entry of history) {
      if (!entry || typeof entry.id !== 'string' || !entry.id.includes('::')) continue;
      const email = normalizeEmail(entry.id.slice(0, entry.id.indexOf('::')));
      const atMs = Number(entry.lastAt);
      if (email && Number.isFinite(atMs) && atMs > 0) obs.push({ email, atMs });
    }
    try {
      const parsed = JSON.parse(readFileSync(join(directory, 'accounts.json'), 'utf8'));
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.accounts)) {
        const real = parsed.accounts.filter(a => a && a.source !== 'preview' && !String(a.id || '').startsWith('preview-') && normalizeEmail(a.email));
        savedAccountCount = real.length;
        for (const acct of real) {
          const email = normalizeEmail(acct.email);
          for (const ts of [acct.lastUsedAtMs, acct.syncedAtMs]) {
            if (Number.isFinite(ts) && ts > 0) obs.push({ email, atMs: ts });
          }
        }
      }
    } catch {}
    if (!obs.length) return;
    const distinctEmails = new Set(obs.map(o => o.email));
    for (const entry of timeline) distinctEmails.add(entry.email);
    if (distinctEmails.size <= 1 && savedAccountCount <= 1) return;
    const cutoff = timeline.length ? timeline[0].sinceMs : Infinity;
    const earlier = obs.filter(o => o.atMs < cutoff).sort((a, b) => a.atMs - b.atMs);
    if (!earlier.length) return;
    const merged = collapseTimeline([
      ...earlier.map(o => ({ email: o.email, sinceMs: o.atMs })),
      ...timeline
    ]);
    if (merged.length && (merged.length !== timeline.length || merged[0].sinceMs !== timeline[0]?.sinceMs || merged[0].email !== timeline[0]?.email)) {
      timeline = merged;
      saveTimeline();
    }
  }
  backfillHistoricalTimeline();

  function recordAccount(email, now = Date.now(), { knownAccountCount = 0 } = {}) {
    const normalized = normalizeEmail(email);
    if (!normalized) return timeline.slice();
    const ts = Number.isFinite(now) ? now : Date.now();
    if (!timeline.length) {
      timeline.push({ email: normalized, sinceMs: knownAccountCount > 1 ? ts : 0 });
      saveTimeline();
      return timeline.slice();
    }
    const last = timeline[timeline.length - 1];
    if (last.email === normalized) return timeline.slice();
    const sinceMs = ts > last.sinceMs ? ts : last.sinceMs + 1;
    timeline.push({ email: normalized, sinceMs });
    if (timeline.length > MAX_TIMELINE_ENTRIES) timeline = timeline.slice(-MAX_TIMELINE_ENTRIES);
    saveTimeline();
    return timeline.slice();
  }

  function emailAt(timestampMs) {
    if (!Number.isFinite(timestampMs) || !timeline.length) return '';
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timestampMs >= timeline[i].sinceMs) return timeline[i].email;
    }
    return '';
  }

  function accounts() {
    const seen = new Set();
    const out = [];
    for (let i = timeline.length - 1; i >= 0; i--) {
      const email = timeline[i].email;
      if (email && !seen.has(email)) {
        seen.add(email);
        out.push(email);
      }
    }
    return out;
  }

  return {
    recordAccount,
    emailAt,
    accounts,
    timeline() {
      return timeline.map(entry => ({ ...entry }));
    },
    observe(groups, requests, rates, now = Date.now(), accountKey = '', options = {}) {
      if (!Array.isArray(groups) || groups.length > 10) throw Error('额度数据无效');
      const scope = normalizeEmail(accountKey);
      if (scope) recordAccount(scope, now, { knownAccountCount: Number(options?.knownAccountCount) || 0 });
      const distinctEmails = new Set(timeline.map(entry => entry.email));
      const hasExplicitEmails = Array.isArray(requests) && requests.some(req => Boolean(normalizeEmail(req?.accountEmail)));
      const isolateByAccount = Boolean(scope && (distinctEmails.size > 1 || hasExplicitEmails || (timeline.length > 0 && timeline[0].sinceMs > 0)));
      const result = [];
      for (const group of groups) {
        for (const bucket of group.buckets || []) {
          const fraction = bucket.remainingFraction;
          if (typeof fraction !== 'number' || fraction < 0 || fraction > 1 || typeof bucket.bucketId !== 'string') continue;
          const id = bucket.bucketId, historyId = scope ? `${scope}::${id}` : id, resetTimeMs = bucket.resetTimeMs;
          const isWeekly = bucket.window === 'weekly' || /weekly/i.test(id);
          const windowMs = isWeekly ? SEVEN_DAYS_MS : FIVE_HOURS_MS;
          let cycleStartMs = Number.isFinite(resetTimeMs) ? resetTimeMs - windowMs : now - windowMs;

          if (Number.isFinite(resetTimeMs) && fraction < 1) {
            const previous = history
              .filter(s => s.id === historyId && s.active && s.resetTimeMs !== resetTimeMs && s.resetTimeMs > cycleStartMs && s.resetTimeMs < resetTimeMs)
              .sort((a, b) => b.resetTimeMs - a.resetTimeMs)[0];
            if (previous) {
              const boundary = Number.isFinite(previous.lastAt) ? Math.min(previous.resetTimeMs, previous.lastAt) : previous.resetTimeMs;
              if (boundary > cycleStartMs) cycleStartMs = boundary;
            }
            const currentIdx = history.findIndex(s => s.id === historyId && s.resetTimeMs === resetTimeMs);
            const record = { id: historyId, resetTimeMs, active: true, lastAt: now };
            if (currentIdx >= 0) history[currentIdx] = record;
            else history.push(record);
          }

          const delta = 1 - fraction;
          let estimateUsd = null, estimateTokens = null, observedCost = 0, observedTokens = 0, count = 0;
          if (delta > 0) {
            const isGemini = /gemini/i.test(id);
            for (const request of requests) {
              const modelLabel = request.model || '';
              const isGeminiRequest = !/claude|gpt/i.test(modelLabel) && /gemini|orchestrator/i.test(modelLabel);
              if (isGeminiRequest !== isGemini) continue;
              const billedAt = Number.isFinite(request.timestampMs)
                ? request.timestampMs + (Number.isFinite(request.durationMs) && request.durationMs > 0 ? request.durationMs : 0)
                : null;
              if (billedAt == null || billedAt <= cycleStartMs || billedAt > now) continue;
              if (isolateByAccount) {
                const reqEmail = normalizeEmail(request.accountEmail) || emailAt(billedAt);
                if (reqEmail !== scope) continue;
              }
              const cost = estimateCost(request, rates);
              if (cost == null) continue;
              observedCost += cost;
              observedTokens += (request.inputTokens || 0) + (request.cacheReadTokens || 0) + (request.outputTokens || 0);
              count++;
            }
            if (delta >= 0.01 && count >= 3 && observedCost > 0) {
              estimateUsd = observedCost / delta;
              estimateTokens = observedTokens / delta;
            }
          }

          const confidence = estimateUsd == null ? 'unknown' : (delta >= 0.05 && count >= 8 ? 'medium' : 'low');
          result.push({
            bucketId: id,
            cycleStartMs,
            resetTimeMs: Number.isFinite(resetTimeMs) ? resetTimeMs : null,
            estimateUsd,
            estimateTokens,
            remainingTokens: estimateTokens == null ? null : estimateTokens * fraction,
            remainingUsd: estimateUsd == null ? null : estimateUsd * fraction,
            confidence,
            observedRequests: count,
            observedCostUsd: observedCost
          });
        }
      }
      history = history.filter(s => s.resetTimeMs > now - SEVEN_DAYS_MS).slice(-96);
      mkdirSync(directory, { recursive: true });
      writeFileSync(path, JSON.stringify(history, null, 2));
      return { estimates: result };
    },
    samples(accountKey = '', now = Date.now()) {
      const scope = normalizeEmail(accountKey);
      const active = history.filter(s => s && s.active && Number.isFinite(s.resetTimeMs) && s.resetTimeMs > now - SEVEN_DAYS_MS);
      const hasScopedEntries = active.some(s => s.id.includes('::'));
      const scoped = scope ? active.filter(s => s.id.startsWith(`${scope}::`)) : [];
      const chosen = scoped.length ? scoped : (!scope || !hasScopedEntries ? active.filter(s => !s.id.includes('::')) : []);
      const latestByBucket = new Map();
      for (const entry of chosen) {
        const bucketId = entry.id.includes('::') ? entry.id.slice(entry.id.indexOf('::') + 2) : entry.id;
        if (!bucketId) continue;
        const prev = latestByBucket.get(bucketId);
        const curLastAt = Number.isFinite(entry.lastAt) ? entry.lastAt : 0;
        const prevLastAt = Number.isFinite(prev?.lastAt) ? prev.lastAt : 0;
        if (!prev || curLastAt > prevLastAt || (curLastAt === prevLastAt && entry.resetTimeMs > prev.resetTimeMs)) {
          latestByBucket.set(bucketId, {
            bucketId,
            resetTimeMs: entry.resetTimeMs,
            lastAt: Number.isFinite(entry.lastAt) ? entry.lastAt : null
          });
        }
      }
      return [...latestByBucket.values()];
    }
  };
}

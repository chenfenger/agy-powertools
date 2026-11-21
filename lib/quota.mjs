import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { estimateCost } from './pricing.mjs';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function createQuotaTracker(directory) {
  const path = join(directory, 'quota-samples.json');
  let history = [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(parsed)) history = parsed.filter(s => s && typeof s.id === 'string' && Number.isFinite(s.resetTimeMs));
  } catch {}

  return {
    observe(groups, requests, rates, now = Date.now(), accountKey = '') {
      if (!Array.isArray(groups) || groups.length > 10) throw Error('额度数据无效');
      const scope = typeof accountKey === 'string' && accountKey.trim() ? accountKey.trim().toLowerCase() : '';
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
              if (/gemini|orchestrator/i.test(request.model || '') !== isGemini) continue;
              const billedAt = Number.isFinite(request.timestampMs)
                ? request.timestampMs + (Number.isFinite(request.durationMs) && request.durationMs > 0 ? request.durationMs : 0)
                : null;
              if (billedAt == null || billedAt <= cycleStartMs || billedAt > now) continue;
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
    }
  };
}

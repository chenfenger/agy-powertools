export function quotaGroupMeta(group = {}, index = 0) {
  const displayName = String(group.displayName || '').trim();
  const bucketIds = (Array.isArray(group.buckets) ? group.buckets : []).map(b => String(b?.bucketId || '')).join(' ');
  const combined = `${displayName} ${bucketIds}`;
  if (/argon/i.test(combined)) {
    return { key: 'argon', shortName: 'Argon', compactName: 'Argon' };
  }
  if (/claude|gpt|\b3p\b/i.test(combined)) {
    return { key: 'claude', shortName: 'Claude / GPT', compactName: 'Claude/GPT' };
  }
  if (/gemini/i.test(combined)) {
    return { key: 'gemini', shortName: 'Gemini', compactName: 'Gemini' };
  }
  const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const label = displayName || `Group ${index + 1}`;
  return { key: slug || `group-${index}`, shortName: label, compactName: label };
}

export function accountBucketStatus(bucket = {}, now = Date.now()) {
  const rawFraction = typeof bucket.remainingFraction === 'number' && Number.isFinite(bucket.remainingFraction)
    ? Math.max(0, Math.min(1, bucket.remainingFraction))
    : null;
  const resetTimeMs = Number.isFinite(bucket.resetTimeMs) ? bucket.resetTimeMs : null;
  const window = bucket.window === 'weekly' || /weekly/i.test(bucket.bucketId || '') ? 'weekly' : '5h';
  const isReset = Boolean(resetTimeMs != null && now >= resetTimeMs && (rawFraction == null || rawFraction < 1));
  const effectiveFraction = isReset ? 1 : rawFraction;
  const tone = effectiveFraction == null
    ? 'unknown'
    : effectiveFraction < 0.1
      ? 'critical'
      : effectiveFraction < 0.25
        ? 'warning'
        : 'ok';
  return {
    bucketId: bucket.bucketId || '',
    window,
    rawFraction,
    effectiveFraction,
    resetTimeMs,
    isReset,
    tone
  };
}

export function summarizeAccountQuota(account = {}, now = Date.now()) {
  const seenKeys = new Set();
  const groups = (Array.isArray(account.groups) ? account.groups : []).map((g, index) => {
    const meta = quotaGroupMeta(g, index);
    let key = meta.key;
    if (seenKeys.has(key)) key = `${key}-${index}`;
    seenKeys.add(key);
    return {
      displayName: g.displayName || meta.shortName,
      shortName: meta.shortName,
      compactName: meta.compactName,
      key,
      buckets: (Array.isArray(g.buckets) ? g.buckets : []).map(b => accountBucketStatus(b, now))
    };
  });
  const allBuckets = groups.flatMap(g => g.buckets);
  let lowestBucket = null;
  for (const b of allBuckets) {
    if (b.effectiveFraction == null) continue;
    if (!lowestBucket || b.effectiveFraction < lowestBucket.effectiveFraction ||
      (b.effectiveFraction === lowestBucket.effectiveFraction && b.window === '5h' && lowestBucket.window !== '5h')) {
      lowestBucket = b;
    }
  }
  const hasResetBucket = allBuckets.some(b => b.isReset);
  const overallTone = allBuckets.some(b => b.tone === 'critical')
    ? 'critical'
    : allBuckets.some(b => b.tone === 'warning')
      ? 'warning'
      : lowestBucket != null
        ? 'ok'
        : 'unknown';
  return { groups, lowestBucket, hasResetBucket, overallTone };
}

export function formatRelativeTime(timestampMs, now = Date.now(), language = 'zh-CN') {
  if (!Number.isFinite(timestampMs)) return '-';
  const en = language === 'en', tw = language === 'zh-TW';
  const diffSec = Math.max(0, Math.floor((now - timestampMs) / 1000));
  if (diffSec < 60) return en ? 'Just now' : tw ? '剛剛' : '刚刚';
  if (diffSec < 3600) {
    const m = Math.floor(diffSec / 60);
    return en ? `${m}m ago` : tw ? `${m} 分鐘前` : `${m} 分钟前`;
  }
  if (diffSec < 86400) {
    const h = Math.floor(diffSec / 3600);
    return en ? `${h}h ago` : tw ? `${h} 小時前` : `${h} 小时前`;
  }
  const d = Math.floor(diffSec / 86400);
  return en ? `${d}d ago` : `${d} 天前`;
}

export function formatResetCountdown(resetTimeMs, now = Date.now(), language = 'zh-CN') {
  if (!Number.isFinite(resetTimeMs)) return '';
  const en = language === 'en', tw = language === 'zh-TW';
  const diffMs = resetTimeMs - now;
  if (diffMs <= 0) return '';
  const totalMin = Math.max(1, Math.ceil(diffMs / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) {
    if (en) return hours > 0 ? `Resets in ${days}d ${hours}h` : `Resets in ${days}d`;
    return tw
      ? (hours > 0 ? `${days} 天 ${hours} 小時後重置` : `${days} 天後重置`)
      : (hours > 0 ? `${days} 天 ${hours} 小时后重置` : `${days} 天后重置`);
  }
  if (hours > 0) {
    if (en) return mins > 0 ? `Resets in ${hours}h ${mins}m` : `Resets in ${hours}h`;
    return tw
      ? (mins > 0 ? `${hours} 小時 ${mins} 分鐘後重置` : `${hours} 小時後重置`)
      : (mins > 0 ? `${hours} 小时 ${mins} 分钟后重置` : `${hours} 小时后重置`);
  }
  return en ? `Resets in ${mins}m` : tw ? `${mins} 分鐘後重置` : `${mins} 分钟后重置`;
}

export function formatCompactCountdown(resetTimeMs, now = Date.now()) {
  if (!Number.isFinite(resetTimeMs)) return '';
  const diffMs = resetTimeMs - now;
  if (diffMs <= 0) return '';
  const totalMin = Math.max(1, Math.ceil(diffMs / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

export function accountInitials(account = {}) {
  const source = String(account.name || account.email || account.alias || 'A').trim();
  return Array.from(source)[0]?.toUpperCase() || 'A';
}

export function selectAutoSwitchCandidate(
  accounts = [],
  activeId = '',
  depletedGroupKey = '',
  now = Date.now(),
  minFraction = 0.05
) {
  const eligible = [];
  for (const acct of accounts || []) {
    if (!acct || acct.id === activeId || acct.disabled || acct.hasCredential === false) continue;
    const summary = summarizeAccountQuota(acct, now);
    const matching = depletedGroupKey ? summary.groups.find(g => g.key === depletedGroupKey) : null;
    const targetGroup = matching || summary.groups[0] || null;
    const allBuckets = targetGroup ? targetGroup.buckets : summary.groups.flatMap(g => g.buckets);
    const b5 = allBuckets.find(b => b.window === '5h');
    const bw = allBuckets.find(b => b.window === 'weekly');
    if (b5 && b5.effectiveFraction != null && b5.effectiveFraction <= minFraction) continue;
    if (bw && bw.effectiveFraction != null && bw.effectiveFraction <= minFraction) continue;
    const score5h = b5?.effectiveFraction ?? (bw?.effectiveFraction ?? 0.5);
    const scoreWeekly = bw?.effectiveFraction ?? 1;
    eligible.push({ acct, score5h, scoreWeekly, lastUsed: acct.lastUsedAtMs || 0 });
  }
  eligible.sort((a, b) => {
    if (b.score5h !== a.score5h) return b.score5h - a.score5h;
    if (b.scoreWeekly !== a.scoreWeekly) return b.scoreWeekly - a.scoreWeekly;
    return a.lastUsed - b.lastUsed;
  });
  return eligible[0]?.acct || null;
}

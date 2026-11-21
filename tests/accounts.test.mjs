import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import {
  quotaGroupMeta,
  accountBucketStatus,
  summarizeAccountQuota,
  formatRelativeTime,
  formatResetCountdown,
  formatCompactCountdown,
  accountInitials,
  selectAutoSwitchCandidate
} from '../lib/account-helpers.mjs';
import { createAccountsStore } from '../lib/accounts.mjs';
import { createQuotaTracker } from '../lib/quota.mjs';

function createFakeVault(initial = {}) {
  const slots = new Map(Object.entries(initial));
  const hashOf = v => `H_${String(v)}`;
  return {
    supported: true,
    slots,
    has(target) { return slots.has(target); },
    inspect(target) {
      return slots.has(target) ? { exists: true, hash: hashOf(slots.get(target)) } : { exists: false, hash: '' };
    },
    copy(from, to) {
      if (!slots.has(from)) return { ok: false, error: 'missing source' };
      const val = slots.get(from);
      slots.set(to, val);
      return { ok: true, bytes: 128, hash: hashOf(val) };
    },
    remove(target) { slots.delete(target); return { ok: true }; },
    saveActiveTo(id) { return this.copy('gemini:antigravity', `agy-powertools:account:${id}`); },
    restoreToActive(id) { return this.copy(`agy-powertools:account:${id}`, 'gemini:antigravity'); },
    hasSaved(id) { return this.has(`agy-powertools:account:${id}`); },
    inspectSaved(id) { return this.inspect(`agy-powertools:account:${id}`); },
    inspectActive() { return this.inspect('gemini:antigravity'); },
    removeSaved(id) { return this.remove(`agy-powertools:account:${id}`); }
  };
}

test('accountBucketStatus, countdowns, and selectAutoSwitchCandidate work accurately without middle dots', () => {
  const now = 1_700_000_000_000;
  const rawOk = { bucketId: 'g-5h', window: '5h', remainingFraction: 0.72, resetTimeMs: now + 3600_000 };
  const rawWarn = { bucketId: 'g-5h', window: '5h', remainingFraction: 0.18, resetTimeMs: now + 3600_000 };
  const rawCrit = { bucketId: 'c-5h', window: '5h', remainingFraction: 0.05, resetTimeMs: now + 3600_000 };
  const rawReset = { bucketId: 'c-5h', window: '5h', remainingFraction: 0.12, resetTimeMs: now - 60_000 };

  assert.equal(accountBucketStatus(rawOk, now).tone, 'ok');
  assert.equal(accountBucketStatus(rawWarn, now).tone, 'warning');
  assert.equal(accountBucketStatus(rawCrit, now).tone, 'critical');
  const reset = accountBucketStatus(rawReset, now);
  assert.equal(reset.isReset, true);
  assert.equal(reset.effectiveFraction, 1);
  assert.equal(reset.tone, 'ok');

  const summary = summarizeAccountQuota({
    groups: [
      { displayName: 'Gemini Models', buckets: [rawOk] },
      { displayName: 'Claude and GPT models', buckets: [rawCrit, rawReset] },
      { displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'gemini-argon-wtu-weekly', window: 'weekly', remainingFraction: 1, resetTimeMs: now + 6 * 86400_000 }] }
    ]
  }, now);
  assert.equal(summary.overallTone, 'critical');
  assert.equal(summary.hasResetBucket, true);
  assert.deepEqual(summary.groups.map(g => g.key), ['gemini', 'claude', 'argon']);
  assert.deepEqual(summary.groups.map(g => g.shortName), ['Gemini', 'Claude / GPT', 'Argon']);
  assert.deepEqual(quotaGroupMeta({ displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'gemini-argon-wtu-weekly' }] }), { key: 'argon', shortName: 'Argon', compactName: 'Argon' });

  assert.equal(formatResetCountdown(now - 1000, now, 'zh-CN'), '');
  assert.equal(formatCompactCountdown(now - 1000, now), '');
  assert.equal(formatCompactCountdown(now + 4 * 3600_000 + 56 * 60_000, now), '4h 56m');
  assert.equal(formatCompactCountdown(now + 3 * 86400_000 + 2 * 3600_000, now), '3d 2h');
  for (const s of [
    formatRelativeTime(now - 20_000, now, 'zh-CN'),
    formatRelativeTime(now - 5 * 60_000, now, 'en'),
    formatResetCountdown(now + 2 * 3600_000 + 15 * 60_000, now, 'zh-CN')
  ]) {
    assert.equal(s.includes('\u00b7'), false);
  }
  assert.equal(accountInitials({ name: 'Alice Chen', alias: '主力', email: 'alice@example.com' }), 'A');

  const candidates = [
    { id: 'active', disabled: false, hasCredential: true, lastUsedAtMs: 10, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0, resetTimeMs: now + 3600_000 }] }] },
    { id: 'disabled-high', disabled: true, hasCredential: true, lastUsedAtMs: 1, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1, resetTimeMs: now + 3600_000 }] }] },
    { id: 'no-cred', disabled: false, hasCredential: false, lastUsedAtMs: 1, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 1, resetTimeMs: now + 3600_000 }] }] },
    { id: 'low', disabled: false, hasCredential: true, lastUsedAtMs: 2, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.04, resetTimeMs: now + 3600_000 }] }] },
    { id: 'medium', disabled: false, hasCredential: true, lastUsedAtMs: 3, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.65, resetTimeMs: now + 3600_000 }] }] },
    { id: 'expired-full', disabled: false, hasCredential: true, lastUsedAtMs: 4, groups: [{ displayName: 'Gemini', buckets: [{ window: '5h', remainingFraction: 0.1, resetTimeMs: now - 10_000 }] }] }
  ];
  assert.equal(selectAutoSwitchCandidate(candidates, 'active', 'gemini', now).id, 'expired-full');
});

test('createAccountsStore strips legacy preview seeds, syncs real avatars/profiles, backs up credentials, switches, and enforces auto-switch guards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-accounts-v2-'));
  let clock = 1_700_000_000_000;
  let relaunches = 0;
  const vault = createFakeVault({ 'gemini:antigravity': 'token-A' });
  try {
    // Seed legacy preview state and confirm migration discards preview entries cleanly
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify({
      version: 1,
      mode: 'preview',
      activeId: 'preview-ultra-main',
      accounts: [{ id: 'preview-ultra-main', email: 'fake@example.com', source: 'preview' }]
    }));

    const store = createAccountsStore(dir, { now: () => clock, vault, relaunch: () => { relaunches++; } });
    assert.deepEqual(store.list().accounts, []);

    const avatar = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const first = store.syncActive({
      email: 'alpha@example.com',
      name: 'Alice Chen',
      avatarUrl: avatar,
      tier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
      groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.85, resetTimeMs: clock + 3600_000 }] }]
    });
    assert.equal(first.accounts.length, 1);
    assert.equal(first.accounts[0].name, 'Alice Chen');
    assert.equal(first.accounts[0].avatarUrl, avatar);
    assert.equal(first.accounts[0].hasCredential, true);
    assert.equal(vault.slots.get(`agy-powertools:account:${first.activeId}`), 'token-A');

    // Reject unsafe avatar URLs
    const unsafe = store.syncActive({ email: 'alpha@example.com', avatarUrl: 'javascript:alert(1)' });
    assert.equal(unsafe.accounts[0].avatarUrl, avatar);

    // Prepare add backs up current active account and stores pendingAlias
    const prep = store.prepareAdd({ pendingAlias: '公司备用' });
    assert.equal(prep.backedUpId, first.activeId);

    // Simulate logging into second Google account
    vault.slots.set('gemini:antigravity', 'token-B');
    clock += 10_000;
    const second = store.syncActive({
      email: 'beta@example.com',
      name: 'Beta User',
      tier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
      groups: [{ displayName: 'Gemini', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.95, resetTimeMs: clock + 3600_000 }] }]
    });
    assert.equal(second.accounts.length, 2);
    const betaAcct = second.accounts.find(a => a.email === 'beta@example.com');
    const alphaAcct = second.accounts.find(a => a.email === 'alpha@example.com');
    assert.equal(betaAcct.alias, '公司备用');
    assert.equal(vault.slots.get(`agy-powertools:account:${betaAcct.id}`), 'token-B');

    // Switch back to alpha -> saves active beta slot, restores alpha slot, sets pendingSwitch lock, triggers relaunch
    const sw = store.switchAccount(alphaAcct.id);
    assert.equal(sw.ok, true);
    assert.equal(sw.relaunching, true);
    assert.equal(relaunches, 1);
    assert.equal(vault.slots.get('gemini:antigravity'), 'token-A');

    // Anti-clobber guard: stale syncActive from the closing old beta UI MUST NOT overwrite beta's vault slot with token-A
    const ignored = store.syncActive({ email: 'beta@example.com', name: 'Beta User' });
    assert.equal(ignored.activeId, alphaAcct.id);
    assert.equal(vault.slots.get(`agy-powertools:account:${betaAcct.id}`), 'token-B');

    // Once relaunched Antigravity boots as alpha, syncActive clears pendingSwitch cleanly
    const confirmed = store.syncActive({ email: 'alpha@example.com', name: 'Alice Chen' });
    assert.equal(confirmed.activeId, alphaAcct.id);

    // Custom account ordering persists across store reloads
    const reordered = store.reorderAccounts([betaAcct.id, alphaAcct.id]);
    assert.deepEqual(reordered.accounts.map(a => a.id), [betaAcct.id, alphaAcct.id]);
    assert.deepEqual(createAccountsStore(dir, { now: () => clock, vault }).list().accounts.map(a => a.id), [betaAcct.id, alphaAcct.id]);

    // Disable beta -> blocks BOTH manual and auto switching
    store.setDisabled(betaAcct.id, true);
    assert.equal(store.pickAutoSwitch('gemini').candidate, null);
    assert.throws(() => store.switchAccount(betaAcct.id), /禁用/);
    assert.throws(() => store.switchAccount(betaAcct.id, { auto: true }), /禁用/);

    // refreshLocalQuotas updates expired reset windows on inactive accounts without dropping active data
    clock += 4_000_000;
    const localRefreshed = store.refreshLocalQuotas({ accountId: betaAcct.id });
    assert.equal(localRefreshed.ok, true);
    assert.equal(localRefreshed.accounts.find(a => a.id === betaAcct.id).groups[0].buckets[0].remainingFraction, 1);

    // refreshCredentials validates OS keyring slots globally and per-account
    const credAll = store.refreshCredentials();
    assert.equal(credAll.ok, true);
    assert.equal(credAll.checked, 2);
    assert.equal(credAll.valid, 2);
    assert.equal(credAll.invalid, 0);
    const credOne = store.refreshCredentials({ accountId: betaAcct.id });
    assert.equal(credOne.ok, true);
    assert.equal(credOne.account.hasCredential, true);

    // Re-enable beta -> auto switch candidate resolves and enforces 120s cooldown
    store.setDisabled(betaAcct.id, false);
    assert.equal(store.pickAutoSwitch('gemini').candidate.id, betaAcct.id);
    store.switchAccount(betaAcct.id, { auto: true });
    assert.ok(store.pickAutoSwitch('gemini').cooldownRemainingMs > 0);
    assert.throws(() => store.switchAccount(alphaAcct.id, { auto: true }), /冷却/);

    // Duplicate credential hash detection rejects switching into a clobbered slot and marks hasCredential false
    vault.slots.set(`agy-powertools:account:${alphaAcct.id}`, 'token-B');
    store.syncActive({ email: 'beta@example.com', name: 'Beta User' });
    assert.throws(() => store.switchAccount(alphaAcct.id), /重新登录/);
    assert.equal(store.list().accounts.find(a => a.id === alphaAcct.id).hasCredential, false);

    // Migrated account without stored credHash whose vault slot matches active hash is flagged immediately on syncActive
    const rawJson = JSON.parse(readFileSync(join(dir, 'accounts.json'), 'utf8'));
    const rawAlpha = rawJson.accounts.find(a => a.id === alphaAcct.id);
    rawAlpha.hasCredential = true;
    rawAlpha.credHash = '';
    writeFileSync(join(dir, 'accounts.json'), JSON.stringify(rawJson, null, 2));
    store.syncActive({ email: 'beta@example.com', name: 'Beta User' });
    assert.equal(store.list().accounts.find(a => a.id === alphaAcct.id).hasCredential, false);

    // Cannot remove active account; removing inactive cleans vault slot too
    assert.throws(() => store.removeAccount(betaAcct.id), /切换/);
    store.removeAccount(alphaAcct.id);
    assert.equal(vault.hasSaved(alphaAcct.id), false);
    assert.equal(store.list().accounts.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('quota tracker isolates cycle samples by accountKey without cross-account bleed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agy-quota-iso-'));
  try {
    const tracker = createQuotaTracker(dir);
    const now = 1_700_000_000_000;
    const reqs = [{ model: 'gemini-4-neon', timestampMs: now - 600_000, inputTokens: 1000, cacheReadTokens: 0, outputTokens: 500 }];
    const rates = [{ model: 'gemini-4-neon', input: 3, output: 15, cache: 0.15 }];
    tracker.observe([{ buckets: [{ bucketId: 'gemini-5h', remainingFraction: 0.8, resetTimeMs: now + 3600_000 }] }], reqs, rates, now, 'alpha@example.com');
    tracker.observe([{ buckets: [{ bucketId: 'gemini-5h', remainingFraction: 0.5, resetTimeMs: now + 7200_000 }] }], reqs, rates, now + 1000, 'beta@example.com');

    const saved = JSON.parse(readFileSync(join(dir, 'quota-samples.json'), 'utf8'));
    assert.equal(saved.some(s => s.id === 'alpha@example.com::gemini-5h'), true);
    assert.equal(saved.some(s => s.id === 'beta@example.com::gemini-5h'), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createPanelHarness(accountsData, opts = {}, hooks = {}) {
  const componentStates = new Map();
  let activeComponent = 'default';
  let hookIdx = 0;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: 'fragment',
    useState: init => {
      if (!componentStates.has(activeComponent)) componentStates.set(activeComponent, []);
      const states = componentStates.get(activeComponent);
      const i = hookIdx++;
      if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
      return [states[i], val => { states[i] = typeof val === 'function' ? val(states[i]) : val; }];
    },
    useEffect: () => {},
    useSyncExternalStore: (_, getSnap) => getSnap()
  };
  const dashboardCode = readFileSync(new URL('../lib/dashboard.mjs', import.meta.url), 'utf8').replaceAll('export function', 'function');
  const helperCode = readFileSync(new URL('../lib/account-helpers.mjs', import.meta.url), 'utf8').replaceAll('export function', 'function');
  const panelsCode = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    React,
    URL,
    window: { addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ dataset: {}, remove() {} }), head: { append() {} } },
    setInterval: () => 1,
    clearInterval() {},
    UP: 'row',
    TP: 'card',
    VP: 'section',
    Uy: 'button',
    XP: 'switch',
    k0: 'disclosure',
    dq: ({ name }) => ({ type: 'icon', props: { name }, children: [] }),
    Sy: 'tooltip',
    HC: 'popover',
    IC: 'popover-trigger',
    JC: 'popover-content',
    kT: 'select',
    lT: 'select-trigger',
    mT: 'select-menu',
    nT: 'select-item'
  });
  vm.runInContext(`(() => { ${dashboardCode}\n${helperCode}\nglobalThis.__agyDashboard = { modelIdentity, dateRange, summarizeRequests, subscriptionIdentity, distributionModels }; globalThis.__agyAccounts = { quotaGroupMeta, accountBucketStatus, summarizeAccountQuota, formatRelativeTime, formatResetCountdown, formatCompactCountdown, accountInitials, selectAutoSwitchCandidate }; })();`, context);
  vm.runInContext(panelsCode, context);
  const currentOpts = { enabled: true, language: 'zh-CN', multiAccount: true, accountSwitcher: true, accountViewMode: 'list', accountQuotaWindow: '5h', autoSwitchAccount: false, ...opts };
  const panels = context.__agyPanels({
    version: '2.12.10',
    t: v => v,
    defaults: currentOpts,
    options: () => currentOpts,
    settingsError: () => '',
    state: () => ({ contextWindow: { maxTokens: 200000 } }),
    accounts: () => accountsData,
    account: () => null,
    capabilities: () => ({ plan: 'Google AI Ultra', planId: 'g1-ultra-tier', email: 'alice@example.com', name: 'Alice Chen' }),
    estimates: () => [],
    subscribe: () => () => {},
    revision: () => 0,
    change: patch => { Object.assign(currentOpts, patch); hooks.onChange?.(patch); return Promise.resolve(); },
    openNativeSettings: () => hooks.onOpenSettings?.(),
    refreshAccountQuotas: id => { hooks.onRefreshQuotas?.(id); return Promise.resolve({ ok: true }); },
    refreshAccountCredentials: id => { hooks.onRefreshCredentials?.(id); return Promise.resolve({ ok: true }); }
  });
  function collectText(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(collectText).join(' ');
    if (typeof node === 'object') {
      if (typeof node.type === 'function') return collectText(node.type({ ...node.props, children: node.children }));
      const children = Array.isArray(node.children) ? node.children : [node.children];
      return [collectText(children), collectText(node.props?.label), collectText(node.props?.rightElement)].filter(Boolean).join(' ');
    }
    return '';
  }
  function find(node, id) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const item of node) { const r = find(item, id); if (r) return r; } return null; }
    if (node.props?.['data-testid'] === id) return node;
    if (typeof node.type === 'function') return find(node.type({ ...node.props, children: node.children }), id);
    for (const value of [...(Array.isArray(node.children) ? node.children : [node.children]), node.props?.label, node.props?.rightElement]) {
      const r = find(value, id);
      if (r) return r;
    }
    return null;
  }
  function findAll(node, pred, out = []) {
    if (!node || typeof node !== 'object') return out;
    if (Array.isArray(node)) { for (const item of node) findAll(item, pred, out); return out; }
    if (pred(node)) out.push(node);
    if (typeof node.type === 'function') return findAll(node.type({ ...node.props, children: node.children }), pred, out);
    for (const value of [...(Array.isArray(node.children) ? node.children : [node.children]), node.props?.label, node.props?.rightElement]) {
      findAll(value, pred, out);
    }
    return out;
  }
  return {
    renderSwitcher: () => { activeComponent = 'switcher'; hookIdx = 0; return panels.AccountSwitcher(); },
    renderQuotas: () => { activeComponent = 'quotas'; hookIdx = 0; return panels.Quotas(); },
    renderSettings: () => { activeComponent = 'settings'; hookIdx = 0; return panels.Settings(); },
    collectText,
    find,
    findAll
  };
}

test('AccountSwitcher, Quotas, and Settings implement master switch risk warning, Argon group, integrated native settings, and refresh controls', () => {
  const now = Date.now();
  const realAccounts = [
    {
      id: 'acct-1',
      email: 'alice@example.com',
      name: 'Alice Chen',
      alias: '主力号',
      avatarUrl: 'data:image/jpeg;base64,AAAA',
      tier: { id: 'g1-ultra-tier', name: 'Google AI Ultra' },
      disabled: false,
      hasCredential: true,
      syncedAtMs: now,
      lastUsedAtMs: now,
      groups: [
        { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.86, resetTimeMs: now + 3600_000 }, { bucketId: 'g-w', window: 'weekly', remainingFraction: 0.42, resetTimeMs: now + 4 * 86400_000 }] },
        { displayName: 'Claude and GPT models', buckets: [{ bucketId: 'c-5h', window: '5h', remainingFraction: 0.94, resetTimeMs: now + 3600_000 }, { bucketId: 'c-w', window: 'weekly', remainingFraction: 0.77, resetTimeMs: now + 5 * 86400_000 }] }
      ]
    },
    {
      id: 'acct-2',
      email: 'bob@example.com',
      name: 'Bob Lin',
      alias: '',
      avatarUrl: '',
      tier: { id: 'g1-pro-tier', name: 'Google AI Pro' },
      disabled: false,
      hasCredential: true,
      syncedAtMs: now - 300_000,
      lastUsedAtMs: now - 300_000,
      groups: [
        { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 1, resetTimeMs: now + 3600_000 }] },
        { displayName: 'Claude and GPT models', buckets: [{ bucketId: 'c-5h', window: '5h', remainingFraction: 1, resetTimeMs: now + 3600_000 }] },
        { displayName: 'Gemini 4 Argon', buckets: [{ bucketId: 'gemini-argon-wtu-weekly', window: 'weekly', remainingFraction: 1, resetTimeMs: now + 6 * 86400_000 }] }
      ]
    },
    {
      id: 'acct-3',
      email: 'backup@example.com',
      name: 'Backup Dev',
      alias: '',
      avatarUrl: '',
      tier: { id: 'g1-plus-tier', name: 'Google AI Plus' },
      disabled: true,
      hasCredential: true,
      syncedAtMs: now - 600_000,
      lastUsedAtMs: now - 600_000,
      groups: [
        { displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.1, resetTimeMs: now - 60_000 }] }
      ]
    }
  ];

  // Master switch OFF: hides switcher & accounts management, Settings opens risk confirmation dialog before enabling
  const changes = [];
  const offUi = createPanelHarness({ activeId: 'acct-1', accounts: realAccounts }, { multiAccount: false }, { onChange: p => changes.push(p) });
  assert.equal(offUi.renderSwitcher(), null);
  assert.equal(offUi.find(offUi.renderQuotas(), 'agy-accounts-overview'), null);
  let settingsTree = offUi.renderSettings();
  const masterToggle = offUi.find(settingsTree, 'agy-setting-multiAccount');
  assert.ok(masterToggle);
  assert.equal(offUi.find(settingsTree, 'agy-setting-accountSwitcher'), null);
  masterToggle.props.onCheckedChange(true);
  assert.equal(changes.length, 0);
  settingsTree = offUi.renderSettings();
  const riskDialog = offUi.find(settingsTree, 'agy-multi-account-risk-dialog');
  assert.ok(riskDialog);
  assert.ok(offUi.collectText(riskDialog).includes('Google'));
  offUi.find(riskDialog, 'agy-multi-account-risk-confirm').props.onClick();
  assert.deepEqual(changes.map(c => ({ ...c })), [{ multiAccount: true }]);

  // Master switch ON: test Switcher trigger & popover
  let settingsOpened = 0;
  const refreshedQuotas = [];
  const refreshedCreds = [];
  const listUi = createPanelHarness(
    { activeId: 'acct-1', accounts: realAccounts },
    { multiAccount: true, accountViewMode: 'list' },
    {
      onOpenSettings: () => settingsOpened++,
      onRefreshQuotas: id => refreshedQuotas.push(id),
      onRefreshCredentials: id => refreshedCreds.push(id)
    }
  );
  let swTree = listUi.renderSwitcher();
  const trigger = listUi.find(swTree, 'agy-account-switcher-trigger');
  assert.ok(trigger);
  const triggerImgs = listUi.findAll(trigger, n => n.type === 'img');
  assert.equal(triggerImgs.length, 1);
  assert.equal(triggerImgs[0].props.src, 'data:image/jpeg;base64,AAAA');
  const triggerText = listUi.collectText(trigger);
  assert.ok(triggerText.includes('Alice Chen'));
  assert.ok(triggerText.includes('主力号'));
  assert.equal(/\b周\s*\d+%/.test(triggerText), false);
  assert.equal(triggerText.includes('20x'), false);
  assert.equal(triggerText.includes('\u00b7'), false);

  // Open switcher popover: verify Argon + inline 5h/周 tags, window toggle + icon-only refresh button, native Settings entry, disabled row non-clickable
  trigger.props.onClick();
  swTree = listUi.renderSwitcher();
  const popText = listUi.collectText(swTree);
  assert.ok(popText.includes('Alice Chen'));
  assert.ok(popText.includes('Bob Lin'));
  assert.ok(popText.includes('Argon'));
  assert.ok(popText.includes('5h'));
  assert.ok(popText.includes('周'));
  assert.ok(popText.includes('86%'));
  assert.ok(popText.includes('更新于 '));
  assert.ok(popText.includes('设置'));
  assert.equal(popText.includes('刷新全部额度'), false);
  assert.equal(popText.includes('切换账号'), false);
  assert.equal(popText.includes('5H 限额'), false);
  assert.equal(popText.includes('实时同步'), false);
  assert.equal(popText.includes('已重置'), false);
  assert.equal(listUi.find(swTree, 'agy-account-row-acct-3').props.disabled, true);
  assert.equal(listUi.collectText(listUi.find(swTree, 'agy-account-row-acct-2')).includes('切换'), false);
  const popWinTabs = listUi.find(swTree, 'agy-popover-window-tabs');
  assert.ok(popWinTabs);
  // Switching popover window to weekly updates both popover and list view immediately
  popWinTabs.children[1].props.onClick();
  swTree = listUi.renderSwitcher();
  assert.ok(listUi.collectText(swTree).includes('42%'));
  const weeklyListText = listUi.collectText(listUi.renderQuotas());
  assert.ok(weeklyListText.includes('42%'));
  popWinTabs.children[0].props.onClick();
  swTree = listUi.renderSwitcher();
  assert.ok(listUi.collectText(swTree).includes('86%'));
  assert.ok(listUi.find(listUi.renderSettings(), 'agy-account-quota-window'));

  listUi.find(swTree, 'agy-popover-refresh-quotas').props.onClick();
  listUi.find(swTree, 'agy-account-open-settings').props.onClick();
  assert.deepEqual(refreshedQuotas, ['']);
  assert.equal(settingsOpened, 1);
  assert.equal(listUi.findAll(swTree, n => n.type === 'icon' && (n.props?.name === 'person_add' || n.props?.name === 'tune')).length, 0);

  // Quotas list view: Argon label, disabled hides switch button, global + per-account refresh quota & cred buttons
  const listQuotas = listUi.renderQuotas();
  assert.ok(listUi.find(listQuotas, 'agy-accounts-table'));
  assert.equal(listUi.find(listQuotas, 'agy-accounts-cards'), null);
  assert.ok(listUi.find(listQuotas, 'agy-accounts-refresh-quotas'));
  assert.ok(listUi.find(listQuotas, 'agy-accounts-refresh-creds'));
  assert.ok(listUi.find(listQuotas, 'agy-refresh-quota-acct-1'));
  assert.ok(listUi.find(listQuotas, 'agy-refresh-cred-acct-1'));
  assert.ok(listUi.find(listQuotas, 'agy-refresh-quota-acct-2'));
  assert.ok(listUi.find(listQuotas, 'agy-refresh-cred-acct-2'));
  assert.ok(listUi.find(listQuotas, 'agy-switch-account-acct-2'));
  assert.equal(listUi.find(listQuotas, 'agy-switch-account-acct-3'), null);
  const listText = listUi.collectText(listQuotas);
  assert.ok(listText.indexOf('当前账号额度') < listText.indexOf('账号管理与切换'));
  assert.ok(listText.includes('Argon'));
  assert.ok(listText.includes('Plus 1'));
  assert.ok(listText.includes('账号已禁用'));
  assert.equal(listText.includes('实时同步'), false);
  assert.equal(listText.includes('\u00b7'), false);
  listUi.find(listQuotas, 'agy-accounts-refresh-creds').props.onClick();
  assert.deepEqual(refreshedCreds, ['']);

  // Quotas card view: icon-only action buttons (no mixed text labels), Argon label, disabled hides switch button, zero middle dots
  const cardUi = createPanelHarness({ activeId: 'acct-1', accounts: realAccounts }, { multiAccount: true, accountViewMode: 'card' });
  const cardQuotas = cardUi.renderQuotas();
  assert.ok(cardUi.find(cardQuotas, 'agy-accounts-cards'));
  assert.equal(cardUi.find(cardQuotas, 'agy-accounts-table'), null);
  assert.ok(cardUi.find(cardQuotas, 'agy-refresh-quota-acct-2'));
  assert.ok(cardUi.find(cardQuotas, 'agy-refresh-cred-acct-2'));
  assert.equal(cardUi.find(cardQuotas, 'agy-switch-account-acct-3'), null);
  assert.equal(cardUi.collectText(cardUi.find(cardQuotas, 'agy-switch-account-acct-2')), '');
  assert.equal(cardUi.collectText(cardUi.find(cardQuotas, 'agy-rename-account-acct-2')), '');
  const cardText = cardUi.collectText(cardQuotas);
  assert.ok(cardText.includes('Argon'));
  assert.ok(cardText.includes('更新于 '));
  for (const banned of ['实时同步', '额度充裕', '部分限额接近耗尽', '切入后自动刷新最新额度', '5 小时已回满', '已重置（预计 100%）', '\u00b7']) {
    assert.equal(cardText.includes(banned), false, `Unexpected text: ${banned}`);
  }
});

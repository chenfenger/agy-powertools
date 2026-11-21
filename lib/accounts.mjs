import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createCredentialVault } from './credential-vault.mjs';
import { selectAutoSwitchCandidate } from './account-helpers.mjs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AUTO_SWITCH_COOLDOWN_MS = 120 * 1000;
const PENDING_SWITCH_TTL_MS = 5 * 60 * 1000;
const AVATAR_DATA_RE = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

function clone(value) {
  return structuredClone(value);
}

function sanitizeAvatarUrl(url) {
  const value = String(url || '').trim();
  if (!value || value.length > 49152) return '';
  if (AVATAR_DATA_RE.test(value)) return value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') return value;
  } catch {}
  return '';
}

function sanitizeGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups
    .filter(g => g && typeof g.displayName === 'string')
    .map(g => ({
      displayName: g.displayName,
      buckets: Array.isArray(g.buckets)
        ? g.buckets.map(b => ({
            bucketId: String(b.bucketId || ''),
            window: b.window === 'weekly' || /weekly/i.test(b.bucketId || '') ? 'weekly' : '5h',
            remainingFraction: typeof b.remainingFraction === 'number' && Number.isFinite(b.remainingFraction)
              ? Math.max(0, Math.min(1, b.remainingFraction))
              : null,
            resetTimeMs: Number.isFinite(b.resetTimeMs) ? b.resetTimeMs : null
          }))
        : []
    }));
}

function sanitizePendingSwitch(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.targetId !== 'string' || typeof value.targetEmail !== 'string' || !Number.isFinite(value.atMs)) return null;
  return { targetId: value.targetId, targetEmail: value.targetEmail, atMs: value.atMs };
}

export function createAccountsStore(
  directory = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-powertools'),
  { now = () => Date.now(), vault = createCredentialVault(), relaunch = null } = {}
) {
  const path = join(directory, 'accounts.json');

  function writeState(state) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(state, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  }

  function loadState() {
    try {
      if (existsSync(path)) {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.accounts)) {
          const accounts = parsed.accounts
            .filter(a => a && typeof a.id === 'string' && typeof a.email === 'string')
            .filter(a => a.source !== 'preview' && !a.id.startsWith('preview-'))
            .map(a => ({
              id: a.id,
              email: a.email,
              name: typeof a.name === 'string' ? a.name : '',
              alias: typeof a.alias === 'string' ? a.alias : '',
              avatarUrl: sanitizeAvatarUrl(a.avatarUrl),
              tier: a.tier && typeof a.tier === 'object' ? { id: String(a.tier.id || ''), name: String(a.tier.name || '') } : { id: '', name: '' },
              groups: sanitizeGroups(a.groups),
              disabled: Boolean(a.disabled),
              hasCredential: a.hasCredential !== false,
              credHash: typeof a.credHash === 'string' ? a.credHash : '',
              syncedAtMs: Number.isFinite(a.syncedAtMs) ? a.syncedAtMs : null,
              lastUsedAtMs: Number.isFinite(a.lastUsedAtMs) ? a.lastUsedAtMs : null
            }));
          const activeId = accounts.some(a => a.id === parsed.activeId) ? parsed.activeId : (accounts[0]?.id || '');
          return {
            version: 2,
            activeId,
            pendingAlias: typeof parsed.pendingAlias === 'string' ? parsed.pendingAlias : '',
            pendingSwitch: sanitizePendingSwitch(parsed.pendingSwitch),
            lastAutoSwitchAtMs: Number.isFinite(parsed.lastAutoSwitchAtMs) ? parsed.lastAutoSwitchAtMs : 0,
            accounts
          };
        }
      }
    } catch {}
    return {
      version: 2,
      activeId: '',
      pendingAlias: '',
      pendingSwitch: null,
      lastAutoSwitchAtMs: 0,
      accounts: []
    };
  }

  function snapshotResponse(state) {
    return clone({
      activeId: state.activeId,
      accounts: state.accounts.map(({ credHash, ...rest }) => rest),
      vaultSupported: Boolean(vault?.supported),
      lastAutoSwitchAtMs: state.lastAutoSwitchAtMs || 0
    });
  }

  function readSavedInfo(accountId) {
    if (!vault?.supported) return { exists: false, hash: '' };
    if (typeof vault.inspectSaved === 'function') return vault.inspectSaved(accountId);
    return { exists: Boolean(vault.hasSaved?.(accountId)), hash: '' };
  }

  return {
    list() {
      return snapshotResponse(loadState());
    },

    syncActive({ email, name = '', avatarUrl = '', tier = null, groups = null } = {}) {
      const cleanEmail = String(email || '').trim();
      const state = loadState();
      if (!EMAIL_RE.test(cleanEmail)) return snapshotResponse(state);
      const ts = now();

      // Anti-clobber lock: if a switch was triggered and Antigravity has not yet restarted
      // into the target account, ignore syncActive events coming from the old account's UI.
      if (state.pendingSwitch) {
        const expired = ts - state.pendingSwitch.atMs >= PENDING_SWITCH_TTL_MS;
        if (cleanEmail.toLowerCase() === state.pendingSwitch.targetEmail.toLowerCase()) {
          state.pendingSwitch = null;
        } else if (!expired) {
          return snapshotResponse(state);
        } else {
          state.pendingSwitch = null;
        }
      }

      let target = state.accounts.find(a => a.email.toLowerCase() === cleanEmail.toLowerCase());
      if (!target) {
        const appliedAlias = String(state.pendingAlias || '').trim().slice(0, 40);
        state.pendingAlias = '';
        target = {
          id: `acct-${randomUUID().slice(0, 8)}`,
          email: cleanEmail,
          name: String(name || '').trim() || cleanEmail.split('@')[0],
          alias: appliedAlias,
          avatarUrl: sanitizeAvatarUrl(avatarUrl),
          tier: tier ? { id: String(tier.id || ''), name: String(tier.name || '') } : { id: '', name: '' },
          groups: sanitizeGroups(groups),
          disabled: false,
          hasCredential: false,
          credHash: '',
          syncedAtMs: ts,
          lastUsedAtMs: ts
        };
        state.accounts.push(target);
      } else {
        if (typeof name === 'string' && name.trim()) target.name = name.trim();
        const cleanAvatar = sanitizeAvatarUrl(avatarUrl);
        if (cleanAvatar) target.avatarUrl = cleanAvatar;
        if (tier && (tier.id || tier.name)) target.tier = { id: String(tier.id || ''), name: String(tier.name || '') };
        const cleanGroups = sanitizeGroups(groups);
        if (cleanGroups.length > 0) target.groups = cleanGroups;
        target.syncedAtMs = ts;
        target.lastUsedAtMs = ts;
        if (state.pendingAlias && state.activeId !== target.id) {
          target.alias = String(state.pendingAlias).trim().slice(0, 40);
          state.pendingAlias = '';
        }
      }
      state.activeId = target.id;
      if (vault?.supported) {
        const saved = vault.saveActiveTo(target.id);
        if (saved?.ok) {
          target.hasCredential = true;
          const savedHash = typeof saved.hash === 'string' ? saved.hash : '';
          if (savedHash) {
            target.credHash = savedHash;
            // Detect duplicate/clobbered vault slots on other accounts so we never silently switch into the same token.
            for (const other of state.accounts) {
              if (other.id === target.id) continue;
              let otherHash = other.credHash;
              if (!otherHash && other.hasCredential) {
                const info = readSavedInfo(other.id);
                if (!info.exists) {
                  other.hasCredential = false;
                  continue;
                }
                otherHash = info.hash;
                if (otherHash) other.credHash = otherHash;
              }
              if (otherHash && otherHash === savedHash) {
                other.hasCredential = false;
                other.credHash = '';
              }
            }
          }
        }
      }
      writeState(state);
      return snapshotResponse(state);
    },

    prepareAdd({ pendingAlias = '' } = {}) {
      const state = loadState();
      const active = state.accounts.find(a => a.id === state.activeId);
      const ts = now();
      const hasPendingSwitch = Boolean(state.pendingSwitch && ts - state.pendingSwitch.atMs < PENDING_SWITCH_TTL_MS);
      state.pendingSwitch = null;
      if (active && vault?.supported && !hasPendingSwitch) {
        const saved = vault.saveActiveTo(active.id);
        if (!saved?.ok || !vault.hasSaved(active.id)) {
          throw new Error('无法保存当前账号凭证，已取消添加操作以保护当前登录');
        }
        active.hasCredential = true;
        if (typeof saved.hash === 'string' && saved.hash) active.credHash = saved.hash;
      }
      state.pendingAlias = String(pendingAlias || '').trim().slice(0, 40);
      writeState(state);
      return clone({
        ok: true,
        backedUpId: active?.id || '',
        ...snapshotResponse(state)
      });
    },

    switchAccount(accountId, { auto = false, triggerRelaunch = true } = {}) {
      const state = loadState();
      const target = state.accounts.find(a => a.id === accountId);
      if (!target) throw new Error('账号不存在');
      if (target.id === state.activeId && !state.pendingSwitch) {
        return clone({ ok: true, unchanged: true, account: target, ...snapshotResponse(state) });
      }
      const ts = now();
      if (target.disabled) {
        throw new Error('该账号已禁用，请先启用后再切换');
      }
      if (auto) {
        if (ts - (state.lastAutoSwitchAtMs || 0) < AUTO_SWITCH_COOLDOWN_MS) {
          throw new Error('自动切换冷却中');
        }
      }
      if (!vault?.supported) throw new Error('当前系统不支持凭据切换');
      const current = state.accounts.find(a => a.id === state.activeId);
      const hasLivePendingSwitch = Boolean(state.pendingSwitch && ts - state.pendingSwitch.atMs < PENDING_SWITCH_TTL_MS);
      if (current && current.id !== target.id && !hasLivePendingSwitch) {
        const backup = vault.saveActiveTo(current.id);
        if (backup?.ok) {
          current.hasCredential = true;
          if (typeof backup.hash === 'string' && backup.hash) current.credHash = backup.hash;
        }
      }
      const targetInfo = readSavedInfo(target.id);
      if (!targetInfo.exists) {
        target.hasCredential = false;
        target.credHash = '';
        writeState(state);
        throw new Error('该账号尚未保存有效凭证，请点击“添加账号”重新登录该账号');
      }
      if (current && current.id !== target.id && current.credHash && targetInfo.hash && targetInfo.hash === current.credHash) {
        target.hasCredential = false;
        target.credHash = '';
        writeState(state);
        throw new Error('该账号的本地凭据与当前账号重复，请点击“添加账号”重新登录该账号');
      }
      const restored = vault.restoreToActive(target.id);
      if (!restored?.ok) {
        throw new Error(restored?.error || '写入目标账号凭证失败，请重试');
      }
      target.hasCredential = true;
      if (typeof restored.hash === 'string' && restored.hash) target.credHash = restored.hash;
      target.lastUsedAtMs = ts;
      state.activeId = target.id;
      state.pendingSwitch = { targetId: target.id, targetEmail: target.email, atMs: ts };
      if (auto) state.lastAutoSwitchAtMs = ts;
      writeState(state);

      let relaunching = false;
      if (triggerRelaunch && typeof relaunch === 'function') {
        relaunch();
        relaunching = true;
      }
      return clone({
        ok: true,
        relaunching,
        account: target,
        ...snapshotResponse(state)
      });
    },

    renameAccount(accountId, alias = '') {
      const state = loadState();
      const target = state.accounts.find(a => a.id === accountId);
      if (!target) throw new Error('账号不存在');
      target.alias = String(alias || '').trim().slice(0, 40);
      writeState(state);
      return clone({
        ok: true,
        account: target,
        ...snapshotResponse(state)
      });
    },

    setDisabled(accountId, disabled) {
      const state = loadState();
      const target = state.accounts.find(a => a.id === accountId);
      if (!target) throw new Error('账号不存在');
      target.disabled = Boolean(disabled);
      writeState(state);
      return clone({
        ok: true,
        account: target,
        ...snapshotResponse(state)
      });
    },

    reorderAccounts(orderedIds = []) {
      if (!Array.isArray(orderedIds)) throw new Error('排序参数无效');
      const state = loadState();
      const byId = new Map(state.accounts.map(a => [a.id, a]));
      const next = [];
      const seen = new Set();
      for (const id of orderedIds) {
        if (typeof id === 'string' && byId.has(id) && !seen.has(id)) {
          seen.add(id);
          next.push(byId.get(id));
        }
      }
      for (const acct of state.accounts) {
        if (!seen.has(acct.id)) next.push(acct);
      }
      state.accounts = next;
      writeState(state);
      return clone({
        ok: true,
        ...snapshotResponse(state)
      });
    },

    removeAccount(accountId) {
      const state = loadState();
      const index = state.accounts.findIndex(a => a.id === accountId);
      if (index < 0) throw new Error('账号不存在');
      if (state.accounts[index].id === state.activeId) {
        throw new Error('请先切换到其他账号后再移除');
      }
      try { vault?.removeSaved?.(accountId); } catch {}
      state.accounts.splice(index, 1);
      writeState(state);
      return clone({
        ok: true,
        ...snapshotResponse(state)
      });
    },

    refreshCredentials({ accountId = '' } = {}) {
      const state = loadState();
      if (!vault?.supported) throw new Error('当前系统不支持凭据库校验');
      const ts = now();
      const hasLivePendingSwitch = Boolean(state.pendingSwitch && ts - state.pendingSwitch.atMs < PENDING_SWITCH_TTL_MS);
      const active = state.accounts.find(a => a.id === state.activeId);

      // Refresh active account's backup first when not mid-switch.
      if (active && !hasLivePendingSwitch && (!accountId || accountId === active.id)) {
        const saved = vault.saveActiveTo(active.id);
        if (saved?.ok) {
          active.hasCredential = true;
          if (typeof saved.hash === 'string' && saved.hash) active.credHash = saved.hash;
        } else {
          const info = readSavedInfo(active.id);
          active.hasCredential = info.exists;
          active.credHash = info.hash || '';
        }
      }

      const targets = accountId
        ? state.accounts.filter(a => a.id === accountId)
        : state.accounts;
      if (accountId && targets.length === 0) throw new Error('账号不存在');

      const seenHashes = new Map();
      if (active?.credHash && active.hasCredential) seenHashes.set(active.credHash, active.id);

      let valid = 0, invalid = 0;
      for (const acct of targets) {
        if (acct.id === active?.id) {
          if (acct.hasCredential) valid++; else invalid++;
          continue;
        }
        const info = readSavedInfo(acct.id);
        if (!info.exists) {
          acct.hasCredential = false;
          acct.credHash = '';
          invalid++;
          continue;
        }
        if (info.hash && seenHashes.has(info.hash) && seenHashes.get(info.hash) !== acct.id) {
          acct.hasCredential = false;
          acct.credHash = '';
          invalid++;
          continue;
        }
        acct.hasCredential = true;
        if (info.hash) {
          acct.credHash = info.hash;
          seenHashes.set(info.hash, acct.id);
        }
        valid++;
      }
      writeState(state);
      return clone({
        ok: true,
        checked: targets.length,
        valid,
        invalid,
        ...(accountId ? { account: targets[0] } : {}),
        ...snapshotResponse(state)
      });
    },

    refreshLocalQuotas({ accountId = '' } = {}) {
      const state = loadState();
      const ts = now();
      const targets = accountId
        ? state.accounts.filter(a => a.id === accountId)
        : state.accounts;
      if (accountId && targets.length === 0) throw new Error('账号不存在');
      let updatedBuckets = 0;
      for (const acct of targets) {
        if (acct.id === state.activeId) continue;
        for (const group of acct.groups || []) {
          for (const bucket of group.buckets || []) {
            if (Number.isFinite(bucket.resetTimeMs) && ts >= bucket.resetTimeMs && bucket.remainingFraction != null && bucket.remainingFraction < 1) {
              bucket.remainingFraction = 1;
              updatedBuckets++;
            }
          }
        }
      }
      writeState(state);
      return clone({
        ok: true,
        updatedBuckets,
        ...snapshotResponse(state)
      });
    },

    pickAutoSwitch(depletedGroupKey = '') {
      const state = loadState();
      const ts = now();
      const elapsed = ts - (state.lastAutoSwitchAtMs || 0);
      const cooldownRemainingMs = elapsed < AUTO_SWITCH_COOLDOWN_MS ? AUTO_SWITCH_COOLDOWN_MS - elapsed : 0;
      const candidate = selectAutoSwitchCandidate(state.accounts, state.activeId, depletedGroupKey, ts);
      return clone({ candidate, cooldownRemainingMs });
    }
  };
}

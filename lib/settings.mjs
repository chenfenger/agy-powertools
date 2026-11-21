import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROXY_BYPASS, isValidProxyBypass, isValidProxyUrl, normalizeProxyBypass, normalizeProxyUrl } from './proxy.mjs';

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  compact: true, contextRing: true, speedStats: true, timing: true, toolDetails: true,
  responseBranch: true, messageEdit: true, fileContextMenu: true, progress: true, keepTurnOutline:true, keepOverviewOpen:true, taskbarBadge:true, multiAccount:false, accountSwitcher:true, accountViewMode:'list', accountQuotaWindow:'5h', autoSwitchAccount:false, proxyEnabled:false, proxyUrl:'', proxyBypass:DEFAULT_PROXY_BYPASS, proxyForceHttp1:false, stageUpdates:true, efficientIO:false, language: 'zh-CN', contextLimit: 0, sidebarProjectLimit: 0
});
const validSetting = (key,value) => key === 'language' ? ['zh-CN','en'].includes(value) : key === 'accountViewMode' ? ['list','card'].includes(value) : key === 'accountQuotaWindow' ? ['5h','weekly'].includes(value) : key === 'contextLimit' ? [0,256000,500000,1000000].includes(value) : key === 'sidebarProjectLimit' ? [0,1,2,3,4,5,10,-1].includes(value) : key === 'proxyUrl' ? isValidProxyUrl(value) : key === 'proxyBypass' ? isValidProxyBypass(value) : typeof value === 'boolean';
const coerceSetting = (key, value) => key === 'proxyUrl' ? (normalizeProxyUrl(value) || '') : key === 'proxyBypass' ? (normalizeProxyBypass(value) || DEFAULT_PROXY_BYPASS) : value;
export function normalizeSettings(value = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [key, validSetting(key,value[key]) ? coerceSetting(key,value[key]) : fallback]));
}
export function createSettingsStore(directory = join(homedir(), '.gemini', 'antigravity', 'plugin_data', 'agy-powertools')) {
  const path = join(directory, 'settings.json');
  return {
    get() {
      try { return normalizeSettings(existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}); }
      catch { return { ...DEFAULT_SETTINGS }; }
    },
    set(patch) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置格式无效');
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(DEFAULT_SETTINGS, key) || !validSetting(key,value)) throw new Error('设置选项无效');
      }
      const value = normalizeSettings({ ...this.get(), ...patch });
      mkdirSync(directory, { recursive: true });
      writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2) + '\n', 'utf8');
      renameSync(`${path}.tmp`, path);
      return value;
    }
  };
}

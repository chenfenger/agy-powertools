import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/native-ui.js', import.meta.url), 'utf8');

function page(ready = false) {
  const callbacks = new Map();
  const nodes = [];
  const node = () => ({
    dataset: {}, isConnected: false,
    append(child) { child.isConnected = true; },
    setAttribute() {}, addEventListener() {}, remove() { this.isConnected = false; }
  });
  const attrs = new Set();
  const document = {
    readyState: ready ? 'complete' : 'loading',
    head: ready ? node() : null, body: ready ? node() : null,
    documentElement: { toggleAttribute(name, force) { if (force === undefined ? !attrs.has(name) : force) attrs.add(name); else attrs.delete(name); }, removeAttribute(name) { attrs.delete(name); }, hasAttribute(name) { return attrs.has(name); } },
    createElement() { const element = node(); nodes.push(element); return element; },
    addEventListener(event, callback) { if (!callbacks.has(event)) callbacks.set(event, []); callbacks.get(event).push(callback); },
    querySelectorAll() { return []; },
    querySelector() { return null; }
  };
  const context = vm.createContext({
    document, location: { pathname: '/' }, AbortController,
    React: { createElement() { return {}; } }, ReactDOM: { createRoot() { throw new Error('No DOM roots expected'); } }, HC() {},
    __agyNativeAdapter: { wrap() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}
  });
  return { context, document, nodes, callbacks, node };
}

test('new-document injection waits for head and body and initializes exactly once', () => {
  const p = page();
  vm.runInContext(source, p.context);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 0);
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.callbacks.get('DOMContentLoaded').length, 1);
  p.document.head = p.node(); p.document.body = p.node();
  p.callbacks.get('DOMContentLoaded')[0]();
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.context.__agyPowertoolsPending, undefined);
  assert.equal(p.nodes.length, 1);
  vm.runInContext(source, p.context);
  assert.equal(p.nodes.length, 1);
});

test('already-loaded injection initializes without waiting and disposes cleanly', () => {
  const p = page(true);
  vm.runInContext(source, p.context);
  assert.equal(p.callbacks.has('DOMContentLoaded'), false);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(p.context.__agyPowertools, undefined);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-keep-outline'), false);
  assert.ok(p.nodes.every(n => !n.isConnected));
});

test('multi-pane conversations with multiple composers stay healthy without triggering reload loops', () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-1';
  const renderedRings = [];
  p.context.ReactDOM = { createRoot(mount) { renderedRings.push(mount); return { render() {}, unmount() {} }; } };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = () => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    return { isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? {} : null };
  };
  const twoTriggers = [makeComposerTrigger(), makeComposerTrigger()];
  let ringNodes = [{}, {}];
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return twoTriggers;
    if (sel === '[data-testid="agy-context-ring-trigger"]') return ringNodes;
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true };
  vm.runInContext(source, p.context);
  assert.equal(renderedRings.length, 2);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('side-question and split-pane composers fetch and render independent context and telemetry per cascadeId', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/main-conv';
  const renderedByMount = new Map();
  const mountOrder = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props, children }) };
  p.context.ReactDOM = {
    createRoot(mount) {
      mountOrder.push(mount);
      return {
        render(el) { renderedByMount.set(mount, el); },
        unmount() {}
      };
    }
  };
  p.context.getComputedStyle = () => ({ display: 'flex' });
  const makeComposerTrigger = cid => {
    const parent = { insertBefore(child) { child.isConnected = true; } };
    const card = { cid };
    return { cid, isConnected: true, parentElement: parent, nextSibling: null, closest: sel => sel === '.surface-composer-card' ? card : null };
  };
  const mainTrigger = makeComposerTrigger('main-conv');
  const btwTrigger = makeComposerTrigger('btw-conv');
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.composerCascadeId = el => el?.cid || '';
  const stateRequests = [];
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, contextRing: true, speedStats: true }));
      return;
    }
    if (req.method === 'state') {
      stateRequests.push(req.conversationId);
      const reply = req.conversationId === 'btw-conv'
        ? { conversationId: 'btw-conv', contextWindow: { usedPercent: 80.4, usedTokens: 632000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 60.4 }, turns: [], requests: [] }
        : { conversationId: 'main-conv', contextWindow: { usedPercent: 78.2, usedTokens: 615000, maxTokens: 786432, categories: [] }, telemetry: { tps: 38, latestTps: 51.7 }, turns: [], requests: [] };
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, reply));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelectorAll = sel => {
    if (sel === '[data-testid="model-selector-trigger"]') return [mainTrigger, btwTrigger];
    if (sel === '[data-testid="agy-context-ring-trigger"]') return [{}, {}];
    return [];
  };
  p.context.__agyInitialSettings = { enabled: true, contextRing: true, speedStats: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 40));
  assert.ok(stateRequests.includes('main-conv'));
  assert.ok(stateRequests.includes('btw-conv'));
  assert.equal(mountOrder.length, 2);
  const mainData = renderedByMount.get(mountOrder[0])?.props?.data;
  const btwData = renderedByMount.get(mountOrder[1])?.props?.data;
  assert.equal(mainData?.conversationId, 'main-conv');
  assert.equal(mainData?.contextWindow?.usedPercent, 78.2);
  assert.equal(btwData?.conversationId, 'btw-conv');
  assert.equal(btwData?.contextWindow?.usedPercent, 80.4);
  assert.equal(btwData?.telemetry?.latestTps, 60.4);
  assert.equal(p.context.__agyPowertools.status.healthy, true);
  p.context.__agyPowertools.dispose();
});

test('accountSwitcher respects multiAccount master switch, toggles native settings hide attr, and cleans up on dispose', () => {
  const pOff = page(true);
  const offMounts = [];
  const offSettingsBtn = { isConnected: true, parentElement: { insertBefore(node) { node.isConnected = true; offMounts.push(node); } } };
  pOff.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  pOff.context.__agyNativeAdapter.installPage = () => true;
  pOff.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} });
  pOff.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? offSettingsBtn : null;
  pOff.context.__agyInitialSettings = { enabled: true, multiAccount: false, accountSwitcher: true };
  vm.runInContext(source, pOff.context);
  assert.equal(offMounts.length, 0);
  assert.equal(pOff.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
  pOff.context.__agyPowertools.dispose();

  const p = page(true);
  const mountedNodes = [];
  const settingsBtn = {
    isConnected: true,
    parentElement: {
      children: [],
      insertBefore(node, before) {
        node.isConnected = true;
        mountedNodes.push({ node, before });
      }
    }
  };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({
    Page: () => null,
    Sidebar: () => null,
    AccountSwitcher: () => null,
    dispose() {}
  });
  p.document.querySelector = sel => sel === '[data-testid="settings-button"]' ? settingsBtn : null;
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, accountSwitcher: true };
  vm.runInContext(source, p.context);
  assert.equal(mountedNodes.length, 1);
  assert.equal(mountedNodes[0].node.dataset.agyPowertoolsRoot, 'account-switcher');
  assert.equal(mountedNodes[0].before, settingsBtn);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), true);
  p.context.__agyPowertools.dispose();
  assert.equal(mountedNodes[0].node.isConnected, false);
  assert.equal(p.document.documentElement.hasAttribute('data-agy-account-switcher'), false);
});

test('renderRoot does not repeatedly call insertBefore when before equals existing mount', () => {
  const p = page(true);
  let insertCount = 0;
  const link = { isConnected: true, nextSibling: null };
  const parent = {
    insertBefore(node) {
      insertCount++;
      node.isConnected = true;
      link.nextSibling = node;
    }
  };
  link.parentElement = parent;
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  let scheduled = null;
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => sel === 'a[href="/customizations"]' ? link : null;
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(insertCount, 1);
  // Trigger a second mount cycle after link.nextSibling points to entry.mount
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, 1);
  p.context.__agyPowertools.dispose();
});

test('Powertools sidebar entry repositions after /customizations once /customizations mounts later', () => {
  const p = page(true);
  const children = [];
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  let insertCount = 0;
  const navContainer = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const existingIdx = children.indexOf(node);
      if (existingIdx >= 0) children.splice(existingIdx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  const newChat = { id: 'new-chat', isConnected: true, parentElement: navContainer, nextSibling: null };
  children.push(newChat);
  let custLink = null;
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, dispose() {} });
  p.document.querySelector = sel => {
    if (sel === 'a[href="/customizations"]') return custLink;
    if (sel === '[data-testid="sidebar-navigation-items"]') return navContainer;
    return null;
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  assert.equal(children.length, 2);
  assert.equal(children[1].dataset.agyPowertoolsRoot, 'management');

  // Now native React mounts Automations and Customizations after Powertools
  const automations = { id: 'auto', isConnected: true, parentElement: navContainer, nextSibling: null };
  custLink = { id: 'cust', isConnected: true, parentElement: navContainer, nextSibling: null };
  children.push(automations, custLink);
  syncSiblings();
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.deepEqual(children.map(c => c.id || c.dataset?.agyPowertoolsRoot), ['new-chat', 'auto', 'cust', 'management']);
  const countAfterMove = insertCount;

  // Next mount tick must be a no-op (no flicker loop)
  observerCb?.([{ target: { closest: () => null } }]);
  scheduled?.();
  assert.equal(insertCount, countAfterMove);

  p.context.__agyPowertools.dispose();
  assert.equal(children.find(c => c.dataset?.agyPowertoolsRoot === 'management')?.isConnected, false);
});

test('cold-start proxy prompt banner appears on mismatch, handles unreachable port, dismisses, and cleans up on dispose', async () => {
  const p = page(true);
  const bodyChildren = [];
  const makeEl = () => {
    const listeners = new Map();
    const el = {
      dataset: {},
      children: [],
      isConnected: false,
      textContent: '',
      append(...items) {
        for (const item of items) {
          item.isConnected = true;
          this.children.push(item);
        }
      },
      setAttribute() {},
      addEventListener(type, fn) { listeners.set(type, fn); },
      click() { listeners.get('click')?.(); },
      remove() {
        this.isConnected = false;
        const idx = bodyChildren.indexOf(this);
        if (idx >= 0) bodyChildren.splice(idx, 1);
      }
    };
    return el;
  };
  p.document.createElement = () => makeEl();
  p.document.body = {
    append(el) { el.isConnected = true; bodyChildren.push(el); }
  };

  const sent = [];
  p.context.__agyPowertoolsHost = payload => {
    const req = JSON.parse(payload);
    sent.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' });
      } else if (req.method === 'proxy.status') {
        p.context.__agyPowertoolsReceive(req.id, {
          configured: true,
          configuredUrl: 'http://127.0.0.1:7897',
          configuredDisplayUrl: 'http://127.0.0.1:7897',
          configuredForceHttp1: false,
          active: false,
          mismatch: true,
          reason: 'not-applied',
          canRelaunch: true
        });
      } else if (req.method === 'proxy.relaunch') {
        p.context.__agyPowertoolsReceive(req.id, req.force
          ? { ok: true, relaunching: true, proxyActive: true }
          : { ok: false, portUnreachable: true, message: '代理端口 127.0.0.1:7897 无法连接' });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, proxyEnabled: true, proxyUrl: 'http://127.0.0.1:7897', language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setTimeout(resolve, 20));

  const findBanner = () => bodyChildren.find(el => el.dataset.testid === 'agy-proxy-prompt-banner');
  const findBtn = (banner, testId) => banner?.children?.flatMap(c => c.children || []).find(b => b.dataset?.testid === testId);

  let banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('http://127.0.0.1:7897'));
  assert.equal(banner.children[0].textContent.includes('\u00b7'), false);

  // Clicking relaunch when port is closed warns instead of restarting immediately
  findBtn(banner, 'agy-proxy-banner-relaunch').click();
  await new Promise(resolve => setTimeout(resolve, 20));
  banner = findBanner();
  assert.ok(banner);
  assert.ok(banner.children[0].textContent.includes('无法连接'));
  assert.ok(findBtn(banner, 'agy-proxy-banner-force'));

  // Dismiss removes banner cleanly
  findBtn(banner, 'agy-proxy-banner-dismiss').click();
  assert.equal(findBanner(), undefined);

  p.context.__agyPowertools.dispose();
  assert.equal(bodyChildren.some(el => el.dataset.testid === 'agy-proxy-prompt-banner'), false);
});

test('native-bindings resolves 2.34.0 notification hook without type:"add" and stays optional when absent', () => {
  const bindingsSource = readFileSync(new URL('../lib/native-bindings.js', import.meta.url), 'utf8');
  const makeEnv = (toastHook, jcImpl = null) => {
    const Sy = () => null; Sy.displayName = 'CompactTooltipBaseUi';
    const ctx = vm.createContext({
      React: {},
      createFileRoute: () => opts => opts,
      HC: () => ({ defaultOpen: 1, matchTriggerWidth: 1, disableMobileSheet: 1 }),
      IC: () => ({ startDragTracking: 1, tag: 'popover-trigger-element', asChild: 1 }),
      JC: jcImpl || (() => ({ scrollContainerClassName: 1, arrowNavigable: 1, matchTriggerWidth: 1 })),
      KC: () => ({ asChild: 1, isMobile: 1, setIsOpen: 1 }),
      GC: () => ({ tooltipPlace: 1, secondaryAction: 1, tag: 'main-row-trigger' }),
      Uy: () => ({ paddingClassName: 1, computedAriaLabel: 1, asChild: 1 }),
      XP: () => ({ onCheckedChange: 1, desc: 'aria-describedby', role:"switch" }),
      UP: ({label: a}) => ({ rightElement: a, extraContent: 1, descriptionId: 1 }),
      TP: () => 'agy-card bg-transparent rounded-xl border border-border overflow-hidden divide-y divide-border',
      VP: () => ({ headerRight: 1, defaultCollapsed: 1, forceExpanded: 1 }),
      dq: ({name: a}) => ({ cls: 'google-symbols', kind: 'Icon', a }),
      k0: ({trigger: a}) => ({ triggerVisible: a, onCollapseComplete: 1, defaultExpanded: 1 }),
      Sy,
      kT: () => ({ ownsHighlight: 1, onHighlightExit: 1, onSearchQueryChange: 1 }),
      lT: () => ({ asChild: 1, openOnHover: 1, closeDelay: 1, attr: "data-no-drag" }),
      mT: () => ({ collisionBoundary: 1, pad: 1, alignOffset: 1, keepMounted: 1 }),
      nT: () => ({ highlighted: 1, selected: 1, action: 1, description: 1, managedHighlight: 1 }),
      HU: s => s.sourceTrajectoryStepInfo?.stepIndex,
      Kc: x => x,
      resolveFn: () => { const c = Kc(Proto.CascadeConfigSchema, { lookupCustomModelInfo: 1, customModelInfoOverride: 1, checkpointConfig: void 0 }); return c; },
      segmentFn: () => ({ getStepRendererConfig: 1, hasBeenCollapsed: 1, leadingSteps: 1 }),
      menuFn: function m(a,{onRenameClick:b}) { return { b, onRestoreClick: 1, onCreateGroup: 1 }; },
      Proto: { CascadeConfigSchema: {} },
      Wb: x => { const o = Object.create(null); o.$typeName=x.members+'oneof'; return o; },
      IJ: s => { const x = {}; x._dirtyElements=1; x._dirtyLeaves=1; x._parsed=!0; return JSON.parse(s); },
      LN: s => JSON.stringify({ version:1, singleParagraph: s, type:"root" }),
      ...(toastHook ? { kn: toastHook } : {})
    });
    // Ensure resolveFn contains exact matcher literal checkpointConfig=void 0
    vm.runInContext(`resolveFn = function(checkpointConfig=void 0){ const x=Kc(Proto.CascadeConfigSchema, checkpointConfig); return { lookupCustomModelInfo: x, customModelInfoOverride: 1 }; };`, ctx);
    vm.runInContext(bindingsSource, ctx);
    return ctx.__agyResolveNativeBindings([]);
  };

  // 2.34.0 style (action creator Mqa instead of inline type:"add")
  const toast234 = function () { return ({ autoDismissMs: m, plainTextFallback: p, primaryActionLabel: l }) => b.showNotification({ primaryActionLabel: l, autoDismissMs: m, plainTextFallback: p }); };
  const resolved234 = makeEnv(toast234);
  assert.equal(resolved234.names.um, 'kn');
  assert.equal(resolved234.bindings.um, toast234);

  // Absent toast hook degrades gracefully without throwing
  const resolvedNoToast = makeEnv(null);
  assert.equal(resolvedNoToast.bindings.um, undefined);

  // 2.35.0 style JC (scrollContainerClassName removed, keeps arrowNavigable + matchTriggerWidth + collisionAvoidance / contentRef.current=)
  const jc235 = function LQ({ arrowNavigable: l, matchTriggerWidth: k, collisionAvoidance: n }) { const y = { contentRef: {} }; y.contentRef.current = l || k || n; return y; };
  const resolved235 = makeEnv(toast234, jc235);
  assert.equal(resolved235.names.JC, 'JC');
  assert.equal(resolved235.bindings.JC, jc235);
});

test('overview mounts both progress and overviewQuota in stable order without insertBefore ping-pong', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-ov';
  const children = [];
  let insertCount = 0;
  const syncSiblings = () => {
    for (let i = 0; i < children.length; i++) children[i].nextSibling = children[i + 1] || null;
  };
  const overview = {
    isConnected: true,
    insertBefore(node, before) {
      insertCount++;
      const idx = children.indexOf(node);
      if (idx >= 0) children.splice(idx, 1);
      node.isConnected = true;
      if (before && children.includes(before)) children.splice(children.indexOf(before), 0, node);
      else children.push(node);
      syncSiblings();
    }
  };
  let observerCb = null;
  let scheduled = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  p.context.setTimeout = cb => { scheduled = cb; return 1; };
  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = () => ({ Page: () => null, Sidebar: () => null, Progress: () => null, OverviewQuota: () => null, dispose() {} });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    if (req.method === 'settings.get') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { enabled: true, progress: true, overviewQuota: true }));
      return;
    }
    if (req.method === 'state') {
      queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-ov', turns: [], requests: [], progress: { status: 'complete', tasks: [] } }));
      return;
    }
    queueMicrotask(() => p.context.__agyPowertoolsReceive(req.id, {}));
  };
  p.document.querySelector = sel => sel === '[data-testid="overview-panel"]' ? overview : null;
  p.context.__agyInitialSettings = { enabled: true, progress: true, overviewQuota: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  assert.equal(children.map(c => c.dataset.agyPowertoolsRoot).join(','), 'progress,overview-quota');
  const stableCount = insertCount;
  // Re-trigger mount cycles multiple times -> zero extra insertBefore mutations
  for (let i = 0; i < 4; i++) {
    observerCb?.([{ target: { closest: () => null } }]);
    scheduled?.();
  }
  assert.equal(insertCount, stableCount);
  p.context.__agyPowertools.dispose();
});

test('startAddAccount awaits active sync and calls accounts.completeAdd, and refreshAccount skips quota.observe on credentialMismatch', async () => {
  const p = page(true);
  let capturedEnv = null;
  let currentEmail = 'alpha@example.com';
  const calls = [];
  let mismatchNextSync = false;
  let quotaRemaining = 0.9;

  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({
    email: currentEmail,
    name: currentEmail.split('@')[0],
    plan: 'Google AI Ultra',
    planId: 'g1-ultra-tier'
  });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: {
        groups: [{
          displayName: 'Gemini Models',
          buckets: [{ bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: quotaRemaining }, resetTime: null }]
        }]
      }
    })
  });
  p.context.__agyNativeAdapter.startAccountLogin = async () => {
    currentEmail = 'beta@example.com';
    return { ok: true, email: currentEmail };
  };
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} };
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.autoSwitchCandidate') {
        p.context.__agyPowertoolsReceive(req.id, { candidate: { id: 'acct-a', email: 'alpha@example.com', name: 'Alpha' }, cooldownRemainingMs: 0 });
      } else if (req.method === 'accounts.prepareAdd') {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, backedUpId: 'acct-a', prevCredHash: 'HASH_A', activeId: 'acct-a', accounts: [{ id: 'acct-a', email: 'alpha@example.com', hasCredential: true }] });
      } else if (req.method === 'accounts.syncActive') {
        if (mismatchNextSync) {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [{ id: 'acct-b', email: 'beta@example.com', hasCredential: true }],
            credentialMismatch: { uiEmail: 'beta@example.com', credentialEmail: 'alpha@example.com' }
          });
        } else {
          p.context.__agyPowertoolsReceive(req.id, {
            activeId: 'acct-b',
            accounts: [
              { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
              { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
            ]
          });
        }
      } else if (req.method === 'accounts.completeAdd') {
        p.context.__agyPowertoolsReceive(req.id, {
          ok: true,
          relaunching: false,
          manualRestartRequired: true,
          account: { id: 'acct-b', email: 'beta@example.com', name: 'beta' },
          activeId: 'acct-b',
          accounts: [
            { id: 'acct-a', email: 'alpha@example.com', hasCredential: true },
            { id: 'acct-b', email: 'beta@example.com', hasCredential: true }
          ]
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, autoSwitchAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);

  // Even when the newly signed-in account has a depleted bucket and autoSwitchAccount is enabled,
  // startAddAccount suppresses auto-switch so it never races with completeAdd / relaunch.
  quotaRemaining = 0;
  const addRes = await capturedEnv.startAddAccount('Backup');
  assert.equal(addRes.ok, true);
  assert.equal(addRes.manualRestartRequired, true);
  assert.equal(calls.some(c => c.method === 'accounts.autoSwitchCandidate'), false);
  assert.equal(p.context.document.querySelector('[data-testid="agy-autoswitch-banner"]'), null);
  quotaRemaining = 0.9;
  const methods = calls.map(c => c.method);
  const prepIdx = methods.indexOf('accounts.prepareAdd');
  const syncIdx = methods.lastIndexOf('accounts.syncActive');
  const completeIdx = methods.indexOf('accounts.completeAdd');
  assert.ok(prepIdx >= 0 && syncIdx > prepIdx && completeIdx > syncIdx, `Expected prepareAdd -> syncActive -> completeAdd, got ${methods.join(',')}`);
  const completeCall = calls[completeIdx];
  assert.equal(completeCall.email, 'beta@example.com');
  assert.equal(completeCall.prevEmail, 'alpha@example.com');
  assert.equal(completeCall.prevCredHash, 'HASH_A');
  assert.equal(completeCall.relaunch, true);

  // When syncActive reports credentialMismatch, refreshAccount MUST NOT call quota.observe
  const beforeObserve = calls.filter(c => c.method === 'quota.observe').length;
  mismatchNextSync = true;
  await capturedEnv.refreshAccountQuotas('acct-b');
  const afterObserve = calls.filter(c => c.method === 'quota.observe').length;
  assert.equal(afterObserve, beforeObserve);

  p.context.__agyPowertools.dispose();
});

test('refreshAccount handles out-of-order concurrency, failure retry without 60s lockout, missing buckets, vaultReason preservation, and loadDashboard(true) override', async () => {
  const p = page(true);
  let capturedEnv = null;
  const calls = [];
  const quotaCalls = [];
  let pendingFirstQuota = null;
  let quotaMode = 'stall-first';
  let failSyncActive = false;
  let pendingDashboard = null;
  let stallFirstDashboard = true;

  p.context.ReactDOM = { createRoot() { return { render() {}, unmount() {} }; } };
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.capabilities = () => ({
    email: 'alice@example.com',
    name: 'Alice',
    plan: 'Google AI Ultra',
    planId: 'g1-ultra-tier'
  });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: opts => {
      quotaCalls.push(opts || {});
      if (quotaMode === 'stall-first') {
        quotaMode = 'fresh-second';
        return new Promise(resolve => { pendingFirstQuota = resolve; });
      }
      if (quotaMode === 'fresh-second') {
        quotaMode = 'normal';
        return Promise.resolve({
          response: {
            groups: [
              { displayName: 'Missing Buckets Group' },
              {
                displayName: 'Gemini Models',
                buckets: [
                  { bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.42 }, resetTime: { seconds: 1800000000n } },
                  { bucketId: 'g-untouched', window: 'weekly', remaining: { case: 'remainingFraction', value: 1 }, resetTime: { seconds: 1800600000n }, description: '' },
                  { bucketId: 'g-off', window: '5h', remaining: { case: 'remainingFraction', value: 0 }, disabled: true }
                ]
              }
            ]
          }
        });
      }
      if (quotaMode === 'fail-once') {
        quotaMode = 'normal';
        return Promise.reject(new Error('network blip'));
      }
      return Promise.resolve({
        response: {
          groups: [{
            displayName: 'Gemini Models',
            buckets: [{ bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.66 }, resetTime: null }]
          }]
        }
      });
    }
  });
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, AccountSwitcher: () => null, dispose() {} };
  };
  const baseAccounts = {
    activeId: 'acct-1',
    vaultSupported: false,
    vaultReason: 'Keyring unavailable in sandbox',
    lastAutoSwitchAtMs: 0,
    accounts: [
      { id: 'acct-1', email: 'alice@example.com', name: 'Alice', hasCredential: true },
      { id: 'acct-2', email: 'bob@example.com', name: 'Bob', hasCredential: true }
    ]
  };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    calls.push(req);
    if (req.method === 'dashboard' && stallFirstDashboard && !req.force) {
      stallFirstDashboard = false;
      pendingDashboard = () => p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: 'stale-dash' }] });
      return;
    }
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, { enabled: true, multiAccount: true, language: 'zh-CN' });
      } else if (req.method === 'accounts.list' || req.method === 'accounts.rename' || req.method === 'accounts.refreshLocalQuotas') {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, ...baseAccounts });
      } else if (req.method === 'accounts.syncActive') {
        if (failSyncActive) {
          p.context.__agyPowertoolsReceive(req.id, { error: 'syncActive timeout' });
        } else {
          p.context.__agyPowertoolsReceive(req.id, { ...baseAccounts });
        }
      } else if (req.method === 'dashboard') {
        p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: req.force ? 'fresh-dash' : 'normal-dash' }] });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true, estimates: [] });
      }
    });
  };
  p.context.__agyInitialSettings = { enabled: true, multiAccount: true, language: 'zh-CN' };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.ok(capturedEnv);
  assert.ok(pendingFirstQuota, 'Initial passive refreshAccount should be in-flight');

  // 1. Trigger forced refreshAccountQuotas('acct-1') while passive refresh is still pending
  const refreshPromise = capturedEnv.refreshAccountQuotas('acct-1');
  await refreshPromise;
  // Fresh forced value (0.42) applied; groups sanitized (missing buckets survived, disabled filtered, untouched 100% description:'' stripped)
  assert.equal(p.context.__agyPowertools.account.groups[1].buckets[0].remaining.value, 0.42);
  const lastSync = calls.filter(c => c.method === 'accounts.syncActive').at(-1);
  assert.equal(lastSync.snapshot.groups.length, 2);
  assert.deepEqual(lastSync.snapshot.groups[0].buckets, []);
  assert.equal(lastSync.snapshot.groups[1].buckets.length, 2);
  assert.equal(lastSync.snapshot.groups[1].buckets[1].resetTimeMs, null);
  // Active-target refresh MUST pass accountId: '' to accounts.refreshLocalQuotas so inactive windows update too
  const lastLocal = calls.filter(c => c.method === 'accounts.refreshLocalQuotas').at(-1);
  assert.equal(lastLocal.accountId, '');

  // Now resolve the stale first passive request with 0.99 -> MUST NOT overwrite 0.42!
  pendingFirstQuota({
    response: {
      groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.99 }, resetTime: null }] }]
    }
  });
  await new Promise(r => setTimeout(r, 20));
  assert.equal(p.context.__agyPowertools.account.groups[1].buckets[0].remaining.value, 0.42);

  // 2. 'live-current' also resolves as active refresh and passes accountId: '' to refreshLocalQuotas
  await capturedEnv.refreshAccountQuotas('live-current');
  assert.equal(calls.filter(c => c.method === 'accounts.refreshLocalQuotas').at(-1).accountId, '');

  // 3. vaultReason is preserved across renameAccount and refreshAccountQuotas
  await capturedEnv.renameAccount('acct-1', 'Work');
  assert.equal(p.context.__agyPowertools.accounts.vaultReason, 'Keyring unavailable in sandbox');

  // 4. Failed retrieveUserQuotaSummary propagates error without locking out immediate retry, and syncActive error rejects refreshAccountQuotas
  quotaMode = 'fail-once';
  await assert.rejects(() => capturedEnv.refreshAccountQuotas('acct-1'), /network blip/);
  await capturedEnv.refreshAccountQuotas('acct-1');
  assert.equal(p.context.__agyPowertools.account.groups[0].buckets[0].remaining.value, 0.66);

  failSyncActive = true;
  await assert.rejects(() => capturedEnv.refreshAccountQuotas('acct-1'), /syncActive timeout/);
  failSyncActive = false;

  // 5. loadDashboard(true) while loadDashboard(false) is in-flight MUST NOT be swallowed, and stale dashboard(false) MUST NOT overwrite dashboard(true)
  const passiveDash = capturedEnv.loadDashboard(false);
  const forcedDash = capturedEnv.loadDashboard(true);
  await forcedDash;
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'fresh-dash');
  pendingDashboard();
  await passiveDash;
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'fresh-dash');
  assert.ok(quotaCalls.some(c => c.forceRefresh === true));

  p.context.__agyPowertools.dispose();
});

test('refresh loop triggers forced quota refresh when a conversation turn finishes', async () => {
  const p = page(true);
  p.context.location.pathname = '/c/conv-turn';
  const intervalCbs = [];
  p.context.setInterval = cb => { intervalCbs.push(cb); return intervalCbs.length; };
  let execState = { conversationId: 'conv-turn', status: 2 };
  const quotaCalls = [];
  let fakeNow = 1_795_600_000_000;
  p.context.Date = class extends Date {
    static now() { return fakeNow; }
  };
  p.context.__agyNativeAdapter.executionState = () => execState;
  p.context.__agyNativeAdapter.capabilities = () => ({ email: 'alice@example.com', name: 'Alice' });
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: opts => {
      quotaCalls.push(opts || {});
      return Promise.resolve({ response: { groups: [] } });
    }
  });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, { enabled: true });
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-turn', turns: [], requests: [] });
      else p.context.__agyPowertoolsReceive(req.id, { ok: true });
    });
  };
  p.context.__agyInitialSettings = { enabled: true };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 1);
  assert.equal(Boolean(quotaCalls[0].forceRefresh), false);

  // Advance > 15s and finish the running turn -> triggers forced refresh
  fakeNow += 20_000;
  execState = { conversationId: 'conv-turn', status: 1, terminationReason: 0, notFullyIdle: false };
  intervalCbs[0]();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 2);
  assert.equal(quotaCalls[1].forceRefresh, true);

  // Advance 3 minutes while foreground visible -> periodic poll upgrades to forceRefresh: true
  fakeNow += 180_000;
  intervalCbs[0]();
  await new Promise(r => setTimeout(r, 20));
  assert.equal(quotaCalls.length, 3);
  assert.equal(quotaCalls[2].forceRefresh, true);

  p.context.__agyPowertools.dispose();
});

test('userBubbleStrength updates CSS variables and readable foreground contrast, and worked-for merges split/sibling triggers without duplicates or middle dots', async () => {
  const p = page(true);
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty: (k, v) => styleProps.set(k, v),
    removeProperty: k => styleProps.delete(k)
  };
  const renderedCompletions = [];
  p.context.React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) };
  p.context.HU = m => m?.index;
  p.context.ReactDOM = {
    createRoot: mount => ({
      render(el) {
        if (mount.dataset?.agyPowertoolsRoot === 'completion') renderedCompletions.push(el);
      },
      unmount() {}
    })
  };
  p.context.location.pathname = '/c/conv-worked';

  // Build a turn where native worked-for button lives in the enclosing turn scope (not inside agent-response)
  // and has split spans: "Worked for 8m 28s" + "<dot> 4 updates"
  const mainSpan = { isConnected: true, textContent: 'Worked for 8m 28s', contains: () => false };
  const updSpan = { isConnected: true, textContent: '\u00b7 4 updates', contains: () => false };
  const attrs = new Map();
  const workedBtn = {
    isConnected: true,
    get textContent() { return `${mainSpan.textContent} ${updSpan.textContent}`; },
    closest: () => null,
    querySelectorAll: sel => sel === 'span' ? [mainSpan, updSpan] : [],
    getAttribute: k => attrs.get(k) ?? null,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: k => attrs.delete(k)
  };
  const response = {
    isConnected: true,
    firstChild: null,
    children: [],
    insertBefore(child) { child.isConnected = true; this.children.unshift(child); },
    closest: sel => sel === '[data-turn-content]' ? turnScopeEl : null,
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const turnScopeEl = {
    querySelector: () => null,
    querySelectorAll: sel => sel === 'button,[role="button"]' ? [workedBtn] : []
  };
  p.document.querySelectorAll = sel => sel === '[data-testid="agent-response"]' ? [response] : [];
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.onEditChange = () => () => {};
  p.context.__agyNativeAdapter.fiber = () => ({ memoizedProps: { container: { steps: [{ step: { case: 'userInput' }, metadata: { index: 0 } }] } }, return: null });
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, {
          enabled: true, timing: true, userBubbleTint: true,
          userBubblePreset: 'custom', userBubbleColor: '#173E76', userBubbleStrength: 100, language: 'zh-CN'
        });
      } else if (req.method === 'state') {
        p.context.__agyPowertoolsReceive(req.id, {
          conversationId: 'conv-worked',
          turns: [{ turnNumber: 1, stepIndexStart: 0, stepIndexEnd: 5, status: 'complete', completedAtIso: '2026-11-24T00:00:00Z', durationMs: 508000, toolCalls: [] }],
          requests: []
        });
      } else {
        p.context.__agyPowertoolsReceive(req.id, { ok: true });
      }
    });
  };
  p.context.__agyInitialSettings = {
    enabled: true, timing: true, userBubbleTint: true,
    userBubblePreset: 'custom', userBubbleColor: '#173E76', userBubbleStrength: 100, language: 'zh-CN'
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  // Verify Issue #27 solid tint + readable contrast foreground
  assert.equal(styleProps.get('--agy-bubble-tint'), '#173E76');
  assert.equal(styleProps.get('--agy-bubble-bg'), '100%');
  assert.equal(styleProps.get('--agy-bubble-border'), '100%');
  assert.equal(styleProps.get('--agy-bubble-fg'), '#ffffff');
  assert.equal(p.document.documentElement.hasAttribute('data-agy-bubble-fg'), true);

  // Verify Issue #29 in-place merge without duplicate row or middle dots
  assert.equal(mainSpan.textContent, '用时 8分28秒 4 条进度');
  assert.equal(mainSpan.textContent.includes('\u00b7'), false);
  assert.equal(updSpan.textContent, '');
  assert.equal(attrs.get('data-tooltip-id'), 'agy-completed-conv-worked-1');
  assert.ok(renderedCompletions.length >= 1);
  const findTooltipOnly = node => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.props && 'tooltipOnly' in node.props) return node.props.tooltipOnly;
    for (const c of Array.isArray(node.children) ? node.children : [node.children]) {
      const hit = findTooltipOnly(c);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  assert.equal(findTooltipOnly(renderedCompletions.at(-1)), true);

  // Verify Issue #25 CSS prevents OverviewQuota wrapping
  const panelsSrc = readFileSync(new URL('../lib/native-panels.js', import.meta.url), 'utf8');
  assert.ok(panelsSrc.includes('grid-auto-columns:72px'));
  assert.ok(panelsSrc.includes('width:72px;height:21px;padding:0 6px;border-radius:6px;font-size:11px;white-space:nowrap'));

  // Dispose restores both split worked-for spans and clears bubble CSS vars
  p.context.__agyPowertools.dispose();
  assert.equal(mainSpan.textContent, 'Worked for 8m 28s');
  assert.equal(updSpan.textContent, '\u00b7 4 updates');
  assert.equal(attrs.has('data-tooltip-id'), false);
  assert.equal(styleProps.has('--agy-bubble-bg'), false);
  assert.equal(styleProps.has('--agy-bubble-fg'), false);
});

test('titlebarQuickPanel mounts left of titlebar-more-actions, falls back to overview/aux toggles, and unmounts when disabled', async () => {
  const makeTitlebarEnv = (selectors) => {
    const p = page(true);
    const mounts = [];
    let unmounted = 0;
    const parent = {
      children: [],
      insertBefore(node, before) {
        const idx = this.children.indexOf(node);
        if (idx >= 0) this.children.splice(idx, 1);
        node.isConnected = true;
        if (before && this.children.includes(before)) this.children.splice(this.children.indexOf(before), 0, node);
        else this.children.push(node);
        for (let i = 0; i < this.children.length; i++) this.children[i].nextSibling = this.children[i + 1] || null;
        mounts.push({ node, before });
      }
    };
    const anchors = {};
    for (const key of ['more', 'overview', 'aux']) {
      anchors[key] = { id: key, isConnected: true, parentElement: parent, nextSibling: null };
      if (selectors[key]) parent.children.push(anchors[key]);
    }
    for (let i = 0; i < parent.children.length; i++) parent.children[i].nextSibling = parent.children[i + 1] || null;
    p.context.ReactDOM = { createRoot() { return { render() {}, unmount() { unmounted++; } }; } };
    p.context.__agyNativeAdapter.installPage = () => true;
    let capturedEnv = null;
    p.context.__agyPanels = env => {
      capturedEnv = env;
      return { Page: () => null, Sidebar: () => null, QuickPopover: () => null, dispose() {} };
    };
    p.document.querySelector = sel => {
      if (sel === '[data-testid="titlebar-more-actions"]' && selectors.more) return anchors.more;
      if (sel === '[data-testid="toggle-overview-panel"]' && selectors.overview) return anchors.overview;
      if (sel === '[data-testid="toggle-aux-sidebar"]' && selectors.aux) return anchors.aux;
      return null;
    };
    return { p, mounts, anchors, parent, getUnmounted: () => unmounted, getEnv: () => capturedEnv };
  };

  const primary = makeTitlebarEnv({ more: true, overview: true, aux: true });
  let currentSettings = { enabled: true, titlebarQuickPanel: true };
  primary.p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        primary.p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else if (req.method === 'settings.get') {
        primary.p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else {
        primary.p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  primary.p.context.__agyInitialSettings = { enabled: true, titlebarQuickPanel: true };
  vm.runInContext(source, primary.p.context);
  assert.equal(primary.mounts.length, 1);
  assert.equal(primary.mounts[0].node.dataset.agyPowertoolsRoot, 'titlebar-quick');
  assert.equal(primary.mounts[0].before, primary.anchors.more);

  await primary.getEnv().change({ titlebarQuickPanel: false });
  assert.equal(primary.getUnmounted(), 1);
  primary.p.context.__agyPowertools.dispose();

  const fallback = makeTitlebarEnv({ more: false, overview: false, aux: true });
  fallback.p.context.__agyInitialSettings = { enabled: true, titlebarQuickPanel: true };
  vm.runInContext(source, fallback.p.context);
  assert.equal(fallback.mounts.length, 1);
  assert.equal(fallback.mounts[0].before, fallback.anchors.aux);
  fallback.p.context.__agyPowertools.dispose();
});

test('composerWorkingBeam cross-fades with ComposerQuotaHalo when active and stays idle/unmounted cleanly', async () => {
  const p = page(true);
  const renderedTrees = [];
  let unmounted = 0;
  const card = {
    children: [],
    isConnected: true,
    firstChild: null,
    getBoundingClientRect() { return { width: 640, height: 104 }; },
    insertBefore(node, before) {
      const idx = this.children.indexOf(node);
      if (idx >= 0) this.children.splice(idx, 1);
      node.isConnected = true;
      if (before && this.children.includes(before)) this.children.splice(this.children.indexOf(before), 0, node);
      else this.children.push(node);
      this.firstChild = this.children[0] || null;
      for (let i = 0; i < this.children.length; i++) this.children[i].nextSibling = this.children[i + 1] || null;
    }
  };
  const model = {
    isConnected: true,
    textContent: 'Gemini 4 Neon',
    parentElement: { children: [], insertBefore() {} },
    nextSibling: null,
    closest: sel => sel === '.surface-composer-card' ? card : null
  };
  p.context.getComputedStyle = el => el === card ? { borderRadius: '20px', display: 'flex' } : { display: 'flex', color: 'rgb(66, 133, 244)' };
  p.context.React.createElement = (type, props, ...children) => ({ type, props: props || {}, children });
  p.context.React.Fragment = 'fragment';
  p.context.React.useRef = init => ({ current: init });
  p.context.React.useId = () => ':r1:';
  p.context.React.useState = init => [typeof init === 'function' ? init() : init, () => {}];
  p.context.React.useEffect = fn => { fn(); };
  p.context.__agyNativeAdapter.wrap = el => el;
  p.context.ReactDOM = {
    createRoot(mount) {
      return {
        render(tree) {
          if (mount.dataset?.agyPowertoolsRoot === 'quota-halo') renderedTrees.push(tree);
        },
        unmount() { if (mount.dataset?.agyPowertoolsRoot === 'quota-halo') unmounted++; }
      };
    }
  };
  p.document.querySelectorAll = sel => sel === '[data-testid="model-selector-trigger"]' ? [model] : [];
  let execStatus = 1;
  p.context.__agyNativeAdapter.composerCascadeId = () => 'conv-beam-1';
  p.context.__agyNativeAdapter.executionState = cid => cid === 'conv-beam-1' ? { conversationId: cid, status: execStatus, notFullyIdle: false } : null;
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: async () => ({
      response: { groups: [{ displayName: 'Gemini Models', buckets: [{ bucketId: 'g-5h', window: '5h', remainingFraction: 0.72 }] }] }
    })
  });
  let currentSettings = { enabled: true, composerQuotaHalo: true, composerWorkingBeam: true, composerWorkingBeamPalette: 'aurora' };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.set') {
        currentSettings = { ...currentSettings, ...req.settings };
        p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else if (req.method === 'settings.get') {
        p.context.__agyPowertoolsReceive(req.id, currentSettings);
      } else {
        p.context.__agyPowertoolsReceive(req.id, {});
      }
    });
  };
  let capturedPanelsEnv = null;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => {
    capturedPanelsEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyInitialSettings = { ...currentSettings };
  vm.runInContext(source, p.context);
  await new Promise(r => setTimeout(r, 30));

  const renderNode = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(renderNode);
    if (typeof node.type === 'function') {
      const states = [];
      let idx = 0;
      const prevState = p.context.React.useState;
      const prevEffect = p.context.React.useEffect;
      p.context.React.useState = init => {
        const i = idx++;
        if (!(i in states)) states[i] = typeof init === 'function' ? init() : init;
        return [states[i], v => { states[i] = typeof v === 'function' ? v(states[i]) : v; }];
      };
      p.context.React.useEffect = fn => { fn(); };
      try {
        let out = node.type({ ...node.props, children: node.children });
        idx = 0;
        p.context.React.useEffect = () => {};
        out = node.type({ ...node.props, children: node.children });
        return renderNode(out);
      } finally {
        p.context.React.useState = prevState;
        p.context.React.useEffect = prevEffect;
      }
    }
    return { ...node, children: (Array.isArray(node.children) ? node.children : [node.children]).map(renderNode) };
  };
  const findById = (node, id) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) { for (const x of node) { const r = findById(x, id); if (r) return r; } return null; }
    if (node.props?.['data-testid'] === id) return node;
    return findById(node.children, id);
  };

  assert.ok(renderedTrees.length >= 1);
  // 1. Idle state: quota halo full brightness (not dimmed), working beam inactive
  const idleTree = renderNode(renderedTrees.at(-1));
  const idleQuota = findById(idleTree, 'agy-composer-quota-halo');
  const idleBeam = findById(idleTree, 'agy-composer-working-beam');
  assert.ok(idleQuota);
  assert.equal(idleQuota.props['data-dimmed'], undefined);
  assert.ok(idleBeam);
  assert.equal(idleBeam.props['data-active'], 'false');
  assert.equal(idleBeam.props['data-palette'], 'aurora');

  // 2. Preview toggle forces beam active and completely hides quota halo even while idle
  assert.equal(source.includes('.agy-quota-halo-svg[data-dimmed=true]{opacity:0}'), true);
  capturedPanelsEnv.setBeamPreview(true);
  const previewTree = renderNode(renderedTrees.at(-1));
  assert.equal(findById(previewTree, 'agy-composer-quota-halo').props['data-dimmed'], 'true');
  assert.equal(findById(previewTree, 'agy-composer-working-beam').props['data-active'], 'true');
  capturedPanelsEnv.setBeamPreview(false);
  assert.equal(findById(renderNode(renderedTrees.at(-1)), 'agy-composer-working-beam').props['data-active'], 'false');

  // 3. Running state: Plan A cross-fade hides quota halo and activates beam
  execStatus = 2;
  const activeTree = renderNode(renderedTrees.at(-1));
  const activeQuota = findById(activeTree, 'agy-composer-quota-halo');
  const activeBeam = findById(activeTree, 'agy-composer-working-beam');
  assert.equal(activeQuota.props['data-dimmed'], 'true');
  assert.equal(activeBeam.props['data-active'], 'true');

  p.context.__agyPowertools.dispose();
  assert.ok(unmounted >= 1);
});

test('SSH command paste observes setting changes without reinstalling its listener', async () => {
  const p = page(true);
  const settings = { enabled: true };
  p.context.__agyInitialSettings = settings;
  let change, enabled, installs = 0;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyPanels = env => { change = env.change; return { Page: () => null, Sidebar: () => null, dispose() {} }; };
  p.context.installSshCommandPaste = (_document, options) => { enabled = options.enabled; installs++; };
  p.context.__agyPowertoolsHost = raw => {
    const { id, method, settings: patch } = JSON.parse(raw);
    if (method === 'settings.set') Object.assign(settings, patch);
    queueMicrotask(() => p.context.__agyPowertoolsReceive?.(id, { ...settings }));
  };
  vm.runInContext(source, p.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(enabled(), true);
  await change({ sshCommandPaste: false });
  assert.equal(enabled(), false);
  await change({ sshCommandPaste: true });
  assert.equal(enabled(), true);
  assert.equal(installs, 1);
  p.context.__agyPowertools.dispose();
});

test('long-conversation mount skips redundant document style writes, skips unchanged root renders, and defers during IME/touch', async () => {
  const p = page(true);
  let styleWrites = 0;
  const styleProps = new Map();
  p.document.documentElement.style = {
    setProperty(k, v) { styleWrites++; styleProps.set(k, v); },
    removeProperty(k) { styleProps.delete(k); }
  };
  let renderCount = 0;
  const userActions = { children: [], isConnected: true, insertBefore(n) { n.isConnected = true; this.children.push(n); } };
  const userStep = { isConnected: true, querySelector: sel => sel === '[data-testid="user-message-actions"]' ? userActions : null };
  p.document.querySelectorAll = sel => sel === '[data-testid="user-input-step"]' ? [userStep] : [];
  p.context.location.pathname = '/c/conv-perf-1';
  p.context.ReactDOM = { createRoot() { return { render() { renderCount++; }, unmount() {} }; } };
  let observerCb = null;
  p.context.MutationObserver = class {
    constructor(cb) { observerCb = cb; }
    observe() {}
    disconnect() {}
  };
  const timers = [];
  p.context.setTimeout = (fn, delay) => { const entry = { fn, delay, cleared: false }; timers.push(entry); return entry; };
  p.context.clearTimeout = entry => { if (entry) entry.cleared = true; };
  p.context.__agyInitialSettings = { enabled: true, userBubbleTint: true, userBubblePreset: 'ocean', userBubbleStrength: 40, messageEdit: true };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'settings.get') p.context.__agyPowertoolsReceive(req.id, p.context.__agyInitialSettings);
      else if (req.method === 'state') p.context.__agyPowertoolsReceive(req.id, { conversationId: 'conv-perf-1', turns: [{ turnNumber: 1, status: 'complete' }], contextWindow: {} });
      else p.context.__agyPowertoolsReceive(req.id, {});
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  await new Promise(r => setImmediate(r));
  const writesAfterBoot = styleWrites;
  const rendersAfterBoot = renderCount;
  assert.ok(writesAfterBoot > 0);
  assert.ok(rendersAfterBoot >= 1);

  // Mutations inside [contenteditable] or [data-markdown-root] should be ignored completely
  const timersBefore = timers.length;
  observerCb([{ target: { closest: sel => sel.includes('[contenteditable]') ? {} : null } }]);
  observerCb([{ target: { closest: sel => sel.includes('[data-markdown-root]') ? {} : null } }]);
  assert.equal(timers.length, timersBefore);

  // During active IME composition, non-ignored mutations defer mount until compositionend
  const compStart = p.callbacks.get('compositionstart')?.[0];
  const compEnd = p.callbacks.get('compositionend')?.[0];
  assert.ok(compStart && compEnd);
  compStart();
  observerCb([{ target: { closest: () => null } }]);
  assert.equal(timers.length, timersBefore);
  compEnd();
  assert.ok(timers.length > timersBefore);
  // Running the deferred mount should do ZERO redundant style writes and ZERO redundant MessageEdit renders
  const lastTimer = timers.at(-1);
  lastTimer.fn();
  assert.equal(styleWrites, writesAfterBoot);
  assert.equal(renderCount, rendersAfterBoot);
  p.context.__agyPowertools.dispose();
});

test('loadDashboard returns local dashboard immediately without blocking on slow remote quota RPC', async () => {
  const p = page(true);
  let capturedEnv = null;
  let resolveQuota = null;
  p.context.__agyNativeAdapter.installPage = () => true;
  p.context.__agyNativeAdapter.service = () => ({
    retrieveUserQuotaSummary: () => new Promise(resolve => { resolveQuota = resolve; })
  });
  p.context.__agyPanels = env => {
    capturedEnv = env;
    return { Page: () => null, Sidebar: () => null, dispose() {} };
  };
  p.context.__agyInitialSettings = { enabled: true };
  p.context.__agyPowertoolsHost = raw => {
    const req = JSON.parse(raw);
    queueMicrotask(() => {
      if (req.method === 'dashboard') {
        p.context.__agyPowertoolsReceive(req.id, { requests: [{ id: 'local-fast-1' }], errors: [] });
      } else {
        p.context.__agyPowertoolsReceive(req.id, req.method === 'settings.get' ? { enabled: true } : {});
      }
    });
  };
  vm.runInContext(source, p.context);
  await new Promise(r => setImmediate(r));
  const data = await capturedEnv.loadDashboard(true);
  assert.equal(data.requests[0].id, 'local-fast-1');
  assert.equal(p.context.__agyPowertools.dashboard.requests[0].id, 'local-fast-1');
  resolveQuota?.({ response: { groups: [] } });
  p.context.__agyPowertools.dispose();
});

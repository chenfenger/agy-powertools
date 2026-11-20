(() => {
  const version = '2.12.10';
  if (globalThis.__agyPowertools?.version === version) return;
  globalThis.__agyPowertools?.dispose();
  if (!document.head || !document.body || !globalThis.ReactDOM?.createRoot || typeof HC !== 'function') {
    if (!globalThis.__agyPowertoolsPending) {
      globalThis.__agyPowertoolsPending = true;
      const retry = () => { delete globalThis.__agyPowertoolsPending; initialize(); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', retry, { once: true });
      else setTimeout(retry, 200);
    }
    return;
  }
  initialize();

  function initialize() {
    if (globalThis.__agyPowertools) return;
    if (!document.body || !globalThis.ReactDOM?.createRoot || typeof HC !== 'function') return;
    const R = globalThis.React;
    const h = R.createElement;
    const adapter = globalThis.__agyNativeAdapter;
    if (!adapter) return;
    const roots = new Map(), pending = new Map(), changedLabels = new Map();
    let sequence = 0, state = null, lastId = '', busy = false, disposed = false;
    let nativeRunFork = null, notify = null;
    const defaults = { enabled: true, compact: true, contextRing: true, speedStats: true, timing: true, toolDetails: true, responseBranch: true, messageEdit: true, fileContextMenu: true, progress: true, keepTurnOutline:true, keepOverviewOpen:true, taskbarBadge:true, stageUpdates:true, efficientIO:false, language: 'zh-CN', contextLimit: 0, sidebarProjectLimit: 0 };
    let options = { ...defaults,...globalThis.__agyInitialSettings }, settingsLoaded = false;
    const t = text => globalThis.__agyI18n?.t(text, options.language) || text;
    const localizer = globalThis.__agyLocalization;
    const listeners = new Set(); let revision = 0, dashboard = null, account = null, estimates = [], lastConversation = null, lastAccountAt = 0, lastAccountUpdatedAt = 0, loadingDashboard = null, pageInstalled = false;
    const emit = () => { revision++; for (const listener of listeners) listener(); };
    const useRevision = () => R.useSyncExternalStore(
      listener => { listeners.add(listener); return () => listeners.delete(listener); },
      () => revision
    );
    let renderError='';
    const Boundary=R.Component?class extends R.Component{
      constructor(props){super(props);this.state={failed:false};}
      static getDerivedStateFromError(){return{failed:true};}
      componentDidCatch(error){renderError=error.message;}
      render(){return this.state.failed?(this.props.page?h('div',{role:'alert',className:'p-6 text-muted-foreground'},options.language==='en'?'Powertools needs an update':'Powertools 需要更新'):null):this.props.children;}
    }:null;
    const signalController = new AbortController();
    const densityStyle = document.createElement('style');
    densityStyle.dataset.agyDensityStyle = '';
    densityStyle.textContent = `
      html[data-agy-keep-outline] [data-testid="overview-panel-host"][style*="--overview-panel-reserve: 336px"],
      html[data-agy-keep-outline] [data-testid="overview-panel-host"][style*="--overview-panel-reserve:336px"]{--conversation-nav-reserve:3.5rem}
      .surface-composer-card:has([data-testid="agy-effort-switcher"]) [data-testid="model-selector-trigger"] > span > span.opacity-70{display:none}
      [data-testid="agy-effort-switcher"] .agy-effort-arrow{display:inline-flex;transition:transform 150ms ease;transform:rotate(90deg)}
      [data-testid="agy-effort-switcher"]:is([aria-expanded="true"],[data-popup-open]) .agy-effort-arrow{transform:rotate(180deg)}
      html[data-agy-compact] [data-testid="agent-response"]{line-height:1.4}
      html[data-agy-compact] [data-testid="agent-response"] :is([data-markdown-root],p,li,pre,code,button,.text-base){line-height:1.4}
      html[data-agy-compact] [data-testid="agent-response"] :is(.text-sm,.text-compact){line-height:1.4}
      html[data-agy-compact] [data-testid="agent-response"] :is([data-testid="worked-for-collapsible"],[data-testid="agy-completion-tools-toggle"],[data-testid="tool-group-collapsible"],div.group.min-h-8){min-height:24px;padding-block:2px}
      html[data-agy-compact] [data-testid="agent-response"] [data-testid="cascade-system-message-toolbar"]{gap:4px}
      html[data-agy-compact] [data-testid="cascade-system-message-toolbar"]{line-height:1.4;gap:4px}
      html[data-agy-compact] [data-testid="cascade-system-message-toolbar"] :is([data-markdown-root],p,pre,code,button,.text-base){line-height:1.4}
      html[data-agy-compact] [data-testid="cascade-system-message-toolbar"] :is(p,ul,ol){margin-block:.35em}
      html[data-agy-compact] [data-testid="user-input-step"],html[data-agy-compact] [data-testid="user-input-step"] .text-base{line-height:1.4}
      /* Native markdown is a flex column. Keep one source of block spacing,
         including the host's important heading and divider margins. */
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root]{line-height:1.4;gap:0}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] :is(p,ul,ol,blockquote){margin-block:0}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > :not(style) + :not(style){margin-block-start:8px}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] :is(h1,h2,h3,h4,h5,h6){line-height:1.4}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] li{margin-block:2px}
      html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] :is(li,blockquote) > :not(style) + :not(style){margin-block-start:6px}
      /* Important native utilities live in a cascade layer. An earlier host
         layer is required to override them, regardless of specificity. */
      @layer theme {
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] :is(h1,h2,h3,h4,h5,h6){margin-block:12px 0!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] blockquote > :first-child{margin-block-start:0!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] hr{margin-block:12px!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] hr + :not(style){margin-block-start:0!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > :first-child,html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > style + :not(style){margin-block-start:0!important}
        html[data-agy-compact] [data-testid="agent-response"] [data-markdown-root] > :last-child{margin-block-end:0!important}
      }
      html[data-agy-compact] [data-testid="user-input-step"]{padding-top:.75rem}
      html[data-agy-compact] [data-agy-powertools-root="completion"]{margin-block:.125rem}
      [data-testid="user-input-step"][data-agy-editing-target]{align-items:stretch!important}
      [data-testid="user-input-step"][data-agy-editing-target] > :not([data-agy-editor-slot]){display:none!important}
      [data-agy-editor-slot]{width:100%}
      @keyframes agy-soft-in{from{opacity:0}to{opacity:1}}
      [data-agy-powertools-root="ring"],[data-agy-powertools-root="progress"]{animation:agy-soft-in 140ms ease-out both}
      .agy-composer-footer:has([data-agy-powertools-root="ring"]) > :first-child{overflow:hidden}
      @container input-footer (max-width: 500px){
        [data-testid="agy-speed-stats-trigger"]{width:28px;min-width:28px;padding-inline:0;gap:0;justify-content:center}
        [data-testid="agy-speed-stats-trigger"] .agy-composer-label{display:none}
      }
      @container input-footer (max-width: 400px){
        [data-testid="agy-context-ring-trigger"]{width:28px;min-width:28px;padding-inline:0;gap:0;justify-content:center}
        [data-testid="agy-context-ring-trigger"] .agy-composer-label{display:none}
      }
      @container input-footer (max-width: 240px){
        [data-testid="agy-speed-stats-trigger"]{display:none}
      }
    `;
    document.head.append(densityStyle);
    const request = (method, payload) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(t('连接中断'))); }, method === 'pricing.refresh' ? 18000 : 10000);
      pending.set(id, { resolve, reject, timer });
      globalThis.__agyPowertoolsHost(JSON.stringify({ id, method, ...payload }));
    });
    globalThis.__agyPowertoolsReceive = (id, reply) => {
      const entry = pending.get(id); if (!entry) return;
      clearTimeout(entry.timer); pending.delete(id);
      reply.error ? entry.reject(new Error(reply.error)) : entry.resolve(reply);
    };
    let settingsError = '';
    const applyOptions=()=>{if((!options.enabled||!options.messageEdit)&&adapter.pendingEdit)adapter.cancelEdit?.();if(!options.enabled||!options.fileContextMenu)closeFileContextMenu();adapter.setEnabled?.(options.enabled);adapter.setStageUpdates?.(options.stageUpdates);adapter.setEfficientIO?.(options.efficientIO);adapter.setContextLimit?.(options.contextLimit);adapter.setSidebarProjectLimit?.(options.sidebarProjectLimit);};
    const changeSettings = async patch => {
      try { options = {...defaults,...await request('settings.set', { settings: patch })}; applyOptions();settingsError=''; mount(); }
      catch(error){settingsError=error.message;}
      emit();
    };
    let loadingAccount;
    function refreshAccount(){
      if(loadingAccount)return loadingAccount;
      lastAccountAt=Date.now();
      loadingAccount=adapter.service().retrieveUserQuotaSummary({}).then(reply=>{
        account=reply.response;lastAccountUpdatedAt=Date.now();emit();
        const groups=(account?.groups||[]).map(g=>({displayName:g.displayName,buckets:g.buckets.map(b=>({bucketId:b.bucketId,window:b.window,remainingFraction:b.remaining?.case==='remainingFraction'?b.remaining.value:null,resetTimeMs:b.resetTime?Number(b.resetTime.seconds)*1000:null}))}));
        return request('quota.observe',{groups});
      }).then(reply=>{estimates=reply.estimates;emit();}).finally(()=>{loadingAccount=null;});
      return loadingAccount;
    }
    const loadDashboard = force => {
      if (loadingDashboard) return loadingDashboard;
      loadingDashboard = Promise.all([request('dashboard', {force:!!force}),force?refreshAccount():null]).then(([data])=>{dashboard=data;emit();return data;}).finally(()=>{loadingDashboard=null;});
      return loadingDashboard;
    };
    const panels = globalThis.__agyPanels?.({ adapter, t, version, defaults, project:globalThis.__agyProject, state:()=>state||lastConversation, options:()=>options, account:()=>account,
      currentState:()=>state?.conversationId===currentId()?state:null,
      dashboard:()=>dashboard, estimates:()=>estimates, capabilities:()=>adapter.capabilities?.(), settingsError:()=>settingsError, change:changeSettings, request, loadDashboard,navigateTurn:turn=>adapter.navigateTurn?.(turn),
      subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}, revision:()=>revision });
    const currentId = () => location.pathname.match(/^\/c\/([a-zA-Z0-9_-]+)/)?.[1] || '';
    const stateCache = new Map();
    const rememberState = (id, value) => {
      if (!id || !value) return;
      stateCache.delete(id);
      stateCache.set(id, value);
      if (stateCache.size > 32) stateCache.delete(stateCache.keys().next().value);
    };
    const prefetching = new Set();
    const prefetchConversation = id => {
      if (!id || disposed || !options.enabled || prefetching.has(id) || stateCache.has(id)) return;
      prefetching.add(id);
      void request('state', { conversationId: id, execution: adapter.executionState?.(id) })
        .then(reply => {
          rememberState(id, reply);
          if (id === currentId() && state?.conversationId !== id) {
            state = reply; lastConversation = reply; mount(); emit();
          }
        })
        .catch(() => {})
        .finally(() => prefetching.delete(id));
    };
    let overviewSnapshot=null, overviewNavigation=null, mountedConversationId='';
    const rememberOverview = event => {
      const link=event.target.closest?.('a[href^="/c/"]');
      if(!link||!options.enabled)return;
      const nextId=link.getAttribute('href')?.match(/^\/c\/([a-zA-Z0-9_-]+)/)?.[1];
      if(nextId&&event.type==='pointerdown')prefetchConversation(nextId);
      if(!options.keepOverviewOpen)return;
      const panel=adapter.overview?.();
      if(nextId&&nextId!==currentId()&&panel?.cascadeId===currentId()){
        // Capture before the native outside-click handler dismisses an overlay.
        // Preserve the pointerdown snapshot through the following click event.
        if(overviewNavigation?.id!==nextId)overviewNavigation={id:nextId,open:panel.isPanelVisible,at:Date.now()};
      }
    };
    document.addEventListener('pointerdown',rememberOverview,{capture:true,signal:signalController.signal});
    document.addEventListener('click',rememberOverview,{capture:true,signal:signalController.signal});
    const stopOverviewNavigation=adapter.router?.()?.subscribe?.('onBeforeNavigate',event=>{
      if(adapter.pendingEdit)adapter.cancelEdit?.({restoreDraft:false});
      const id=event.toLocation?.pathname?.match(/^\/c\/([a-zA-Z0-9_-]+)/)?.[1];
      if(id)prefetchConversation(id);
      if(!options.enabled||!options.keepOverviewOpen)return;
      const panel=adapter.overview?.();
      if(id&&panel&&panel.cascadeId!==id&&!(overviewNavigation?.id===id&&Date.now()-overviewNavigation.at<5000)){
        overviewNavigation={id,open:panel.isPanelVisible,at:Date.now()};
      }
    });
    const stopResolvedNavigation=adapter.router?.()?.subscribe?.('onResolved',()=>{
      const id=currentId();
      if(id&&stateCache.has(id)){state=stateCache.get(id);lastId=id;}
      mount();
      void refresh();
    });
    function followOverview(){
      const id=currentId(),panel=adapter.overview?.();
      if(!id||panel?.cascadeId!==id)return;
      if(!options.enabled||!options.keepOverviewOpen){overviewNavigation=null;overviewSnapshot={id,open:panel.isPanelVisible};return;}
      if((overviewNavigation?.id===id||overviewSnapshot&&overviewSnapshot.id!==id)&&options.keepOverviewOpen){
        const carry=overviewNavigation?.id===id&&Date.now()-overviewNavigation.at<5000?overviewNavigation.open:overviewSnapshot?.open;
        overviewNavigation=null;
        if(carry&&!panel.isPanelVisible){
          if(panel.presentation==='dropdown')panel.setDropdownOpen(true);
          else if(panel.breakpoint==='small')panel.setOverlayOpen(true);
          else panel.togglePanel();
        }
      }
      overviewSnapshot={id,open:panel.isPanelVisible};
    }
    const tokens = n => n == null ? '-' : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
    const duration = ms => ms == null ? '-' : options.language==='en' ? ms>=60000?`${Math.floor(ms/60000)}m ${Math.floor(ms%60000/1000)}s`:`${Math.max(0,Math.round(ms/1000))}s` : ms >= 60000 ? `${Math.floor(ms / 60000)}分${Math.floor(ms % 60000 / 1000)}秒` : `${Math.max(0, Math.round(ms / 1000))}秒`;
    const completed = iso => `${options.language==='en'?'Completed at':'完成于'} ${new Date(iso).toLocaleString(options.language, { hour12: false })}`;
    const row = (label, value, key) => h('div', { key, className: 'flex items-center justify-between gap-3 px-2 py-1 text-compact tabular-nums' },
      h('span', { className: 'text-muted-foreground' }, t(label)), h('span', { className: 'text-foreground whitespace-nowrap' }, value));
    function CacheObservation({data}){
      const [now,setNow]=R.useState(Date.now);
      R.useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
      const cache=globalThis.__agyDashboard.cacheObservation(data.requests,now);
      if(!cache)return null;
      const seconds=Math.ceil((cache.remainingMs||0)/1000),value=cache.remainingMs>0?`≈ ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:options.language==='en'?'Unconfirmed':'待确认';
      const tip=options.language==='en'?`Five-minute observation window from the last request start, not a server expiry. Last request cache hits: ${cache.hitPercent}%.`:`按最近请求开始时间计算的五分钟观察窗口，不代表服务端实际到期。最近请求缓存命中 ${cache.hitPercent}%。`;
      return h('div',{title:tip,'data-testid':'agy-cache-observation','data-estimated':'true'},row(options.language==='en'?'Cache window':'缓存观察',value,'cache-window'));
    }
    const separator = key => h('div', { key, className: 'h-px bg-border my-2 -mx-1' });
    const contextPalette = {
      'Chat Messages': '#2563eb',
      'System Prompt': '#ea580c',
      'Tools': '#0d9488',
      'MCP Tools': '#64748b',
      'MCP tools': '#64748b',
      'Skills': '#78716c',
      'Subagents': '#6366f1',
      'Plugins': '#8b5cf6',
      'Rules': '#94a3b8',
      'Memories': '#a1a1aa',
      'Memory files': '#a1a1aa',
      'Unspecified': '#9ca3af',
      '输入上下文': '#2563eb'
    };
    const fallbackSwatches = ['#64748b', '#78716c', '#94a3b8', '#a1a1aa'];
    const contextCategoryName = (raw, en) => {
      const map = en
        ? { 'Chat Messages': 'Messages', 'System Prompt': 'System prompt', 'Tools': 'System tools', 'MCP Tools': 'MCP tools', 'MCP tools': 'MCP tools', 'Skills': 'Skills', 'Subagents': 'Subagents', 'Plugins': 'Plugins', 'Rules': 'Rules', 'Memories': 'Memory files', 'Memory files': 'Memory files', 'Unspecified': 'Other', '输入上下文': 'Input context', '剩余空间': 'Free space' }
        : { 'Chat Messages': '消息', 'System Prompt': '系统提示', 'Tools': '系统工具', 'MCP Tools': 'MCP 工具', 'MCP tools': 'MCP 工具', 'Skills': '技能', 'Subagents': '子智能体', 'Plugins': '插件', 'Rules': '规则', 'Memories': '记忆文件', 'Memory files': '记忆文件', 'Unspecified': '其他开销', '输入上下文': '输入上下文', '剩余空间': '剩余空间' };
      return map[raw] || (en ? raw : t(raw));
    };
    const categoryRank = label => {
      if (label === 'Chat Messages' || label === '输入上下文') return 0;
      if (label === 'System Prompt') return 1;
      if (label === 'Tools') return 2;
      if (label === '剩余空间') return 99;
      return 10;
    };

    function Ring({ percent }) {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 18 18', className: 'shrink-0 -rotate-90', 'aria-hidden': true },
        h('circle', { cx: 9, cy: 9, r: 6.5, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.2, strokeWidth: 2 }),
        h('circle', { cx: 9, cy: 9, r: 6.5, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeDasharray: 40.84,
          strokeDashoffset: 40.84 * (1 - Math.min(100, Math.max(0, percent || 0)) / 100) }));
    }

    function ContextDetails({ data }) {
      const cw = data.contextWindow, stats = data.telemetry, en = options.language === 'en';
      const categories = [...cw.categories].sort((a, b) => {
        const ra = categoryRank(a.label), rb = categoryRank(b.label);
        if (ra !== rb) return ra - rb;
        return (b.tokens || 0) - (a.tokens || 0);
      });
      const colorFor = (c, idx) => c.key === 'free' ? 'var(--secondary)' : (contextPalette[c.label] || fallbackSwatches[idx % fallbackSwatches.length]);
      const freeCat = categories.find(c => c.key === 'free');
      const usedCategories = categories.filter(c => c.key !== 'free' && ((c.tokens || 0) > 0 || (c.percent || 0) > 0));
      const totalUsedTokens = usedCategories.reduce((sum, c) => sum + (c.tokens || 0), 0) || cw.usedTokens || 0;
      const usedPct = cw.usedPercent == null ? null : Math.min(100, Math.max(0, Number(cw.usedPercent) || 0));
      const sectionTip = en
        ? 'Total usage comes from the latest model request; category shares follow client-side estimation.'
        : '总用量来自最近一次模型请求，各分类占比按客户端估算折算。';
      const stepTotalIn = (cw.cacheReadTokens || 0) + (cw.inputTokens || 0);
      const stepCachePctNum = stepTotalIn > 0 ? (cw.cacheReadTokens / stepTotalIn * 100) : 0;
      const stepCachePct = stepTotalIn > 0 ? `${stepCachePctNum.toFixed(1)}%` : null;
      const stepNewPct = stepTotalIn > 0 ? `${(cw.inputTokens / stepTotalIn * 100).toFixed(1)}%` : null;
      const multiModels = Array.isArray(cw.models) ? cw.models : [];
      const showOrchestrator = Boolean(cw.hasOrchestrator) && multiModels.length > 1;

      const r = 33, cx = 42, cy = 42, circ = 2 * Math.PI * r;
      let arcOffset = 0;
      const segments = usedCategories.map((c, i) => {
        const share = usedPct != null
          ? (cw.maxTokens > 0 ? ((c.tokens || 0) / cw.maxTokens) * 100 : (c.percent || 0))
          : (totalUsedTokens > 0 ? ((c.tokens || 0) / totalUsedTokens) * 100 : 0);
        const len = Math.max(0, (share / 100) * circ);
        const seg = { key: c.key, color: colorFor(c, i), len, offset: arcOffset, label: contextCategoryName(c.label, en), tokens: c.tokens, percent: c.percent };
        arcOffset += len;
        return seg;
      });
      const centerMain = usedPct != null ? `${usedPct.toFixed(1)}%` : tokens(cw.usedTokens);
      const centerSub = usedPct != null ? (en ? 'Used' : '已用') : (en ? 'Tokens' : '用量');
      const statusColor = usedPct >= 95 ? 'var(--error)' : usedPct >= 80 ? 'var(--warning)' : '#2563eb';

      return h(R.Fragment, null,
        h('div', { className: 'flex flex-col px-2.5 pt-2 pb-1.5 gap-2.5', 'data-testid': 'agy-context-breakdown' },
          h('div', { className: 'flex items-center justify-between gap-2', title: sectionTip },
            h('span', { className: 'text-compact font-medium text-muted-foreground' }, en ? 'Context Window' : '上下文窗口'),
            cw.compactions > 0 && h('span', {
              style: { fontSize: 11, padding: '1px 7px', borderRadius: 9999, background: 'var(--secondary)', color: 'var(--muted-foreground)' }
            }, en ? `Compacted ${cw.compactions}x` : `已压缩 ${cw.compactions} 次`)),

          h('div', { className: 'flex items-center gap-3.5', title: sectionTip },
            h('div', { className: 'relative shrink-0', style: { width: 84, height: 84 } },
              h('svg', {
                width: 84, height: 84, viewBox: '0 0 84 84',
                className: '-rotate-90',
                role: usedPct == null ? 'img' : 'meter',
                'aria-label': en ? 'Context usage' : '上下文用量',
                'aria-valuenow': usedPct ?? undefined,
                'aria-valuemin': 0,
                'aria-valuemax': 100
              },
                h('circle', { cx, cy, r, fill: 'none', stroke: 'var(--secondary)', strokeWidth: 9 }),
                ...segments.map(seg => seg.len > 0 && h('circle', {
                  key: seg.key,
                  cx, cy, r,
                  fill: 'none',
                  stroke: seg.color,
                  strokeWidth: 9,
                  strokeDasharray: `${seg.len} ${Math.max(0, circ - seg.len)}`,
                  strokeDashoffset: -seg.offset
                }, h('title', null, `${seg.label}: ${tokens(seg.tokens)}${seg.percent != null ? ` (${Number(seg.percent).toFixed(1)}%)` : ''}`)))),
              h('div', {
                className: 'absolute inset-0 flex flex-col items-center justify-center pointer-events-none tabular-nums'
              },
                h('span', { className: 'text-sm font-semibold text-foreground leading-none' }, centerMain),
                h('span', { style: { fontSize: 10, marginTop: 2 }, className: 'text-muted-foreground leading-none' }, centerSub))),

            h('div', { className: 'flex flex-col flex-1 min-w-0 gap-1 tabular-nums' },
              h('div', { className: 'flex items-baseline gap-1.5 flex-wrap' },
                h('span', { className: 'text-base font-semibold text-foreground' }, tokens(cw.usedTokens)),
                cw.maxTokens != null && h('span', { className: 'text-compact text-muted-foreground' }, `/ ${tokens(cw.maxTokens)}`)),
              freeCat && h('div', { className: 'flex items-center gap-1.5 text-compact text-muted-foreground' },
                h('span', { style: { width: 7, height: 7, borderRadius: 2, background: 'var(--secondary)', boxShadow: 'inset 0 0 0 1px var(--border)', flexShrink: 0 } }),
                h('span', { className: 'truncate' }, en ? `Free ${tokens(freeCat.tokens)}` : `剩余 ${tokens(freeCat.tokens)}`),
                freeCat.percent != null && h('span', { className: 'text-foreground/80 font-medium' }, `(${Number(freeCat.percent).toFixed(1)}%)`)),
              usedPct != null && h('div', { className: 'flex items-center gap-1.5 mt-0.5' },
                h('span', {
                  style: {
                    fontSize: 10, padding: '1px 6px', borderRadius: 9999,
                    background: `color-mix(in srgb, ${statusColor} 14%, transparent)`,
                    color: statusColor, fontWeight: 500
                  }
                }, usedPct >= 95 ? (en ? 'Critical' : '接近上限') : usedPct >= 80 ? (en ? 'High' : '占用较高') : (en ? 'Healthy' : '空间充足'))))),

          usedCategories.length > 0 && h('div', { className: 'flex flex-col gap-2 pt-2 border-t border-border' },
            h('div', {
              style: { display: 'flex', height: 8, gap: 1.5, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' }
            },
              usedCategories.map((c, i) => h('span', {
                key: c.key,
                title: `${contextCategoryName(c.label, en)}: ${tokens(c.tokens)} (${Number(c.percent || 0).toFixed(1)}%)`,
                style: { width: `${Math.max(0.6, c.percent || 0)}%`, background: colorFor(c, i), height: '100%' }
              }))),
            h('div', {
              style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 10px' },
              className: 'tabular-nums'
            },
              ...usedCategories.map((c, i) => {
                const color = colorFor(c, i);
                const shareOfUsed = totalUsedTokens > 0 ? Math.min(100, ((c.tokens || 0) / totalUsedTokens) * 100) : 0;
                return h('div', {
                  key: c.key,
                  className: 'flex flex-col gap-0.5 min-w-0',
                  title: `${contextCategoryName(c.label, en)}: ${tokens(c.tokens)}${c.percent != null ? ` (${Number(c.percent).toFixed(1)}%)` : ''}`
                },
                  h('div', { className: 'flex items-center justify-between gap-1 text-compact' },
                    h('div', { className: 'flex items-center gap-1.5 min-w-0' },
                      h('span', { style: { width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: color } }),
                      h('span', { className: 'truncate text-secondary-foreground' }, contextCategoryName(c.label, en))),
                    h('span', { className: 'text-foreground font-medium whitespace-nowrap shrink-0' }, tokens(c.tokens))),
                  h('div', { className: 'flex items-center gap-1.5' },
                    h('div', { style: { flex: 1, height: 3, borderRadius: 9999, background: 'var(--secondary)', overflow: 'hidden' } },
                      h('div', { style: { width: `${Math.max(2, shareOfUsed)}%`, height: '100%', background: color, borderRadius: 9999 } })),
                    h('span', { style: { fontSize: 10, minWidth: '3em' }, className: 'text-muted-foreground text-right whitespace-nowrap' },
                      c.percent == null ? '-' : `${Number(c.percent).toFixed(1)}%`)));
              }))),

          stepTotalIn > 0 && h('div', { className: 'flex flex-col gap-1.5 pt-2 border-t border-border tabular-nums', 'data-testid': 'agy-step-cache-breakdown' },
            h('div', { className: 'flex items-center justify-between gap-2 text-compact' },
              h('span', { className: 'text-muted-foreground' }, en ? 'Step cache hit' : '本步缓存命中'),
              h('span', { className: 'font-semibold', style: { color: stepCachePctNum >= 70 ? '#2563eb' : 'var(--foreground)' } }, stepCachePct)),
            h('div', { style: { display: 'flex', height: 7, gap: 1.5, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' } },
              cw.cacheReadTokens > 0 && h('span', { style: { width: `${stepCachePctNum}%`, background: '#2563eb', height: '100%' } }),
              cw.inputTokens > 0 && h('span', { style: { width: `${100 - stepCachePctNum}%`, background: '#38bdf8', height: '100%' } })),
            h('div', { className: 'flex items-center justify-between gap-2 text-compact' },
              h('div', { className: 'flex items-center gap-1.5 min-w-0', title: en ? 'Prompt tokens served from server cache in the latest request' : '最近一次请求中命中服务端缓存直接复用的上下文 Token' },
                h('span', { style: { width: 7, height: 7, borderRadius: 9999, flexShrink: 0, background: '#2563eb' } }),
                h('span', { className: 'truncate text-secondary-foreground' }, en ? 'Cached' : '缓存复用'),
                h('span', { className: 'font-medium text-foreground whitespace-nowrap' }, tokens(cw.cacheReadTokens))),
              h('div', { className: 'flex items-center gap-1.5 min-w-0', title: en ? 'Fresh non-cached input tokens sent in the latest request' : '最近一次请求中新发送或未命中缓存的输入 Token' },
                h('span', { style: { width: 7, height: 7, borderRadius: 9999, flexShrink: 0, background: '#38bdf8' } }),
                h('span', { className: 'truncate text-secondary-foreground' }, en ? 'New' : '新增'),
                h('span', { className: 'font-medium text-foreground whitespace-nowrap' }, `${tokens(cw.inputTokens)} (${stepNewPct})`))))),
        showOrchestrator && h(R.Fragment, null,
          separator('models-separator'),
          h('div', { className: 'flex flex-col px-2.5 pt-1 pb-1.5 gap-2', 'data-testid': 'agy-model-contexts' },
            h('div', { className: 'text-compact text-muted-foreground' }, en ? 'Orchestrator context' : 'Orchestrator 上下文'),
            ...multiModels.map(entry => {
              const roleText = entry.role === 'execution' ? (en ? 'Exec' : '执行') : entry.role === 'planner' ? (en ? 'Plan' : '规划') : '';
              const barPct = Math.min(100, Math.max(0, entry.usedPercent ?? 0));
              const barColor = entry.usedPercent >= 95 ? 'var(--error)' : entry.usedPercent >= 80 ? 'var(--warning)' : entry.isCurrent ? '#2563eb' : '#60a5fa';
              return h('div', { key: entry.key, className: 'flex flex-col gap-1', title: entry.fullName },
                h('div', { className: 'flex items-center justify-between gap-2 text-compact tabular-nums' },
                  h('div', { className: 'flex items-center gap-1.5 min-w-0' },
                    h('span', {
                      style: {
                        width: 7,
                        height: 7,
                        borderRadius: 9999,
                        flexShrink: 0,
                        background: entry.isCurrent ? '#2563eb' : 'transparent',
                        border: entry.isCurrent ? 'none' : '1.5px solid var(--muted-foreground)'
                      }
                    }),
                    roleText && h('span', {
                      style: { fontSize: 11, padding: '0 4px', borderRadius: 4, background: 'var(--secondary)', color: 'var(--muted-foreground)', flexShrink: 0 }
                    }, roleText),
                    h('span', { className: `truncate ${entry.isCurrent ? 'font-medium text-foreground' : 'text-secondary-foreground'}` }, entry.shortName),
                    entry.isCurrent && h('span', {
                      style: { fontSize: 10, padding: '0 5px', borderRadius: 4, background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--primary)', flexShrink: 0 }
                    }, en ? 'Active' : '当前'),
                    entry.compactions > 0 && h('span', {
                      style: { fontSize: 10, padding: '0 4px', borderRadius: 9999, background: 'var(--secondary)', color: 'var(--muted-foreground)', flexShrink: 0 },
                      title: en ? `Compacted ${entry.compactions} time(s)` : `已压缩 ${entry.compactions} 次`
                    }, `${entry.compactions}`)),
                  h('div', { className: 'flex items-center gap-1.5 whitespace-nowrap shrink-0' },
                    entry.usedPercent != null && h('span', { className: 'font-medium text-foreground' }, `${entry.usedPercent.toFixed(1)}%`))),
                h('div', { className: 'flex items-center gap-2 tabular-nums' },
                  h('div', { style: { flex: 1, height: 4, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' } },
                    h('div', { style: { width: `${barPct}%`, height: '100%', background: barColor, borderRadius: 9999 } })),
                  h('span', { style: { fontSize: 11 }, className: 'text-muted-foreground whitespace-nowrap shrink-0' }, entry.maxTokens ? `${tokens(entry.usedTokens)} / ${tokens(entry.maxTokens)}` : tokens(entry.usedTokens))));
            }))));
    }

    function SessionStatsDetails({ data }) {
      const stats = data.telemetry || {}, en = options.language === 'en';
      const [now, setNow] = R.useState(Date.now);
      R.useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
      const cacheObs = globalThis.__agyDashboard?.cacheObservation?.(data.requests, now);
      const cacheObsSec = cacheObs ? Math.ceil((cacheObs.remainingMs || 0) / 1000) : 0;
      const cacheObsText = cacheObs
        ? (cacheObs.remainingMs > 0 ? `≈ ${Math.floor(cacheObsSec / 60)}:${String(cacheObsSec % 60).padStart(2, '0')}` : (en ? 'Unconfirmed' : '待确认'))
        : null;
      const cacheObsTip = cacheObs
        ? (en
          ? `Five-minute observation window from the last request start, not a server expiry. Last request cache hits: ${cacheObs.hitPercent}%.`
          : `按最近请求开始时间计算的五分钟观察窗口，不代表服务端实际到期。最近请求缓存命中 ${cacheObs.hitPercent}%。`)
        : '';

      const speedSeries = (Array.isArray(data.requests) ? data.requests : [])
        .map(r => Number(r?.tps))
        .filter(v => Number.isFinite(v) && v > 0)
        .slice(-24);
      const liveSpeed = stats.latestTps ?? stats.tps ?? null;
      const speedColor = liveSpeed == null ? 'var(--foreground)' : liveSpeed >= 60 ? 'var(--success)' : liveSpeed < 25 ? 'var(--warning)' : 'var(--foreground)';

      let sparkPath = '', sparkArea = '';
      if (speedSeries.length >= 2) {
        const w = 288, hSvg = 36, pad = 3;
        const minV = Math.min(...speedSeries), maxV = Math.max(...speedSeries);
        const span = Math.max(1, maxV - minV);
        const pts = speedSeries.map((v, i) => {
          const x = (i / (speedSeries.length - 1)) * w;
          const y = pad + (1 - (v - minV) / span) * (hSvg - pad * 2);
          return [x.toFixed(1), y.toFixed(1)];
        });
        sparkPath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
        sparkArea = `${sparkPath} L${w},${hSvg} L0,${hSvg} Z`;
      }

      const tokParts = [
        { key: 'cache', label: en ? 'Cached' : '缓存读取', value: stats.cacheReadTokens || 0, color: '#2563eb' },
        { key: 'input', label: en ? 'Input' : '输入', value: stats.inputTokens || 0, color: '#38bdf8' },
        { key: 'output', label: en ? 'Output' : '输出', value: stats.outputTokens || 0, color: '#0d9488' },
        { key: 'thinking', label: en ? 'Thinking' : '思考', value: stats.thinkingTokens || 0, color: '#8b5cf6' }
      ];
      const tokSum = tokParts.reduce((s, p) => s + p.value, 0);

      const modelMs = stats.modelTimeMs || 0, toolMs = stats.toolTimeMs || 0, timeSum = modelMs + toolMs;
      const modelTimePct = timeSum > 0 ? (modelMs / timeSum) * 100 : 0;
      const toolTimePct = timeSum > 0 ? (toolMs / timeSum) * 100 : 0;
      const cachePct = stats.cacheHitPercent == null ? null : Math.min(100, Math.max(0, Number(stats.cacheHitPercent) || 0));

      return h('div', { className: 'flex flex-col px-2.5 pt-2 pb-1.5 gap-2.5 tabular-nums', 'data-testid': 'agy-session-stats' },
        h('div', { className: 'flex items-center justify-between gap-2 flex-wrap' },
          h('span', { className: 'text-compact font-medium text-muted-foreground whitespace-nowrap' }, t('会话统计')),
          h('div', { className: 'flex items-center gap-1.5 flex-wrap' },
            h('span', {
              className: 'whitespace-nowrap',
              style: { fontSize: 11, padding: '1px 7px', borderRadius: 9999, background: 'var(--secondary)', color: 'var(--muted-foreground)' }
            }, en ? `${stats.turnCount || 0}T · ${stats.stepCount || 0}S` : `${stats.turnCount || 0} 轮 · ${stats.stepCount || 0} 步`),
            (stats.errorCount || 0) > 0 && h('span', {
              className: 'whitespace-nowrap',
              style: { fontSize: 11, padding: '1px 6px', borderRadius: 9999, background: 'color-mix(in srgb, var(--error) 14%, transparent)', color: 'var(--error)', fontWeight: 500 }
            }, en ? `${stats.errorCount} err` : `${stats.errorCount} 错误`),
            stats.costUsd != null && h('span', {
              'data-testid': 'agy-session-cost',
              className: 'whitespace-nowrap',
              title: en ? 'Estimated API reference cost for this conversation' : '本会话按官方参考单价估算的等效费用',
              style: { fontSize: 11, padding: '1px 7px', borderRadius: 9999, background: 'color-mix(in srgb, #2563eb 12%, transparent)', color: '#2563eb', fontWeight: 500 }
            }, `$${Number(stats.costUsd).toFixed(stats.costUsd >= 10 ? 2 : 3)}`))),

        h('div', { className: 'flex flex-col gap-1.5 p-2 rounded-lg', style: { background: 'color-mix(in srgb, var(--secondary) 60%, transparent)' } },
          h('div', { className: 'flex items-baseline justify-between gap-2' },
            h('div', { className: 'flex items-baseline gap-1.5' },
              h('span', { className: 'text-lg font-semibold leading-none', style: { color: speedColor } }, liveSpeed == null ? '-' : `${liveSpeed}`),
              h('span', { className: 'text-xs text-muted-foreground' }, 'tok/s'),
              h('span', { style: { fontSize: 10 }, className: 'text-muted-foreground' }, en ? 'latest' : '最近')),
            h('div', { className: 'flex items-center gap-2.5 text-xs text-muted-foreground' },
              h('span', null, `${en ? 'Avg' : '均值'} `, h('strong', { className: 'text-foreground font-medium' }, stats.tps == null ? '-' : `${stats.tps}`)),
              h('span', { title: t('峰值为单次请求的最高平均速度。') }, `${en ? 'Peak' : '峰值'} `, h('strong', { className: 'text-foreground font-medium' }, stats.peakTps == null ? '-' : `${stats.peakTps}`)))),
          sparkPath && h('svg', { width: '100%', height: 36, viewBox: '0 0 288 36', preserveAspectRatio: 'none', className: 'overflow-visible', 'aria-hidden': true },
            h('path', { d: sparkArea, fill: '#2563eb', fillOpacity: 0.12 }),
            h('path', { d: sparkPath, fill: 'none', stroke: '#2563eb', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' }))),

        h('div', { className: 'flex flex-col gap-1.5' },
          h('div', { className: 'flex items-center justify-between gap-2 text-compact' },
            h('span', { className: 'text-secondary-foreground' }, en ? 'Cache hit rate' : '缓存命中率'),
            h('div', { className: 'flex items-center gap-2' },
              cacheObsText && h('span', {
                'data-testid': 'agy-cache-observation',
                'data-estimated': 'true',
                title: cacheObsTip,
                style: { fontSize: 11, padding: '0 6px', borderRadius: 9999, background: 'var(--secondary)', color: 'var(--muted-foreground)' }
              }, `${en ? 'Window' : '观察'} ${cacheObsText}`),
              h('span', { className: 'font-semibold text-foreground' }, cachePct == null ? '-' : `${cachePct}%`))),
          h('div', { style: { height: 6, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' } },
            cachePct != null && h('div', { style: { width: `${cachePct}%`, height: '100%', background: '#2563eb', borderRadius: 9999 } }))),

        h('div', { className: 'flex flex-col gap-1.5 pt-2 border-t border-border' },
          h('div', { className: 'flex items-center justify-between gap-2 text-compact' },
            h('span', { className: 'text-secondary-foreground' }, en ? 'Total tokens' : '累计 Token'),
            h('span', { className: 'font-semibold text-foreground' }, tokens(stats.totalTokens))),
          tokSum > 0 && h('div', { style: { display: 'flex', height: 6, gap: 1.5, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' } },
            tokParts.filter(p => p.value > 0).map(p => h('span', {
              key: p.key,
              title: `${p.label}: ${tokens(p.value)}`,
              style: { width: `${Math.max(1, (p.value / tokSum) * 100)}%`, background: p.color, height: '100%' }
            }))),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 10px' }, className: 'text-compact' },
            ...tokParts.map(p => h('div', { key: p.key, className: 'flex items-center justify-between gap-1 min-w-0' },
              h('div', { className: 'flex items-center gap-1.5 min-w-0' },
                h('span', { style: { width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: p.color } }),
                h('span', { className: 'truncate text-muted-foreground' }, p.label)),
              h('span', { className: 'text-foreground font-medium whitespace-nowrap' }, tokens(p.value)))))),

        h('div', { className: 'flex flex-col gap-1.5 pt-2 border-t border-border' },
          h('div', { className: 'flex items-center justify-between gap-2 text-compact' },
            h('span', { className: 'text-secondary-foreground' }, en ? 'Time split' : '耗时分布'),
            h('span', { className: 'text-muted-foreground' }, `${en ? 'TTFT' : '首字'} ${duration(stats.avgTtftMs)}`)),
          timeSum > 0 && h('div', { style: { display: 'flex', height: 6, gap: 1.5, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' } },
            modelMs > 0 && h('span', { style: { width: `${modelTimePct}%`, background: '#2563eb', height: '100%' } }),
            toolMs > 0 && h('span', { style: { width: `${toolTimePct}%`, background: '#0d9488', height: '100%' } })),
          h('div', { className: 'flex items-center justify-between gap-2 text-compact' },
            h('div', { className: 'flex items-center gap-1.5' },
              h('span', { style: { width: 7, height: 7, borderRadius: 9999, background: '#2563eb' } }),
              h('span', { className: 'text-muted-foreground' }, en ? 'Model' : '模型'),
              h('span', { className: 'font-medium text-foreground' }, duration(modelMs))),
            h('div', { className: 'flex items-center gap-1.5' },
              h('span', { style: { width: 7, height: 7, borderRadius: 9999, background: '#0d9488' } }),
              h('span', { className: 'text-muted-foreground' }, en ? 'Tools' : '工具'),
              h('span', { className: 'font-medium text-foreground' }, duration(toolMs)))),
          h('div', {
            style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6, marginTop: 2 },
            className: 'pt-1.5 border-t border-border text-center'
          },
            h('div', { className: 'flex flex-col' },
              h('span', { style: { fontSize: 10 }, className: 'text-muted-foreground' }, en ? 'Requests' : '请求次数'),
              h('span', { className: 'text-compact font-semibold text-foreground' }, String(stats.requestCount || 0))),
            h('div', { className: 'flex flex-col' },
              h('span', { style: { fontSize: 10 }, className: 'text-muted-foreground' }, en ? 'Tools' : '工具调用'),
              h('span', { className: 'text-compact font-semibold text-foreground' }, String(stats.toolCount || 0))),
            h('div', { className: 'flex flex-col' },
              h('span', { style: { fontSize: 10 }, className: 'text-muted-foreground' }, en ? 'Errors' : '错误次数'),
              h('span', { className: 'text-compact font-semibold', style: { color: (stats.errorCount || 0) > 0 ? 'var(--error)' : 'var(--foreground)' } }, String(stats.errorCount || 0))))),
        h('div', { className: 'pt-1.5 border-t border-border flex items-center justify-between gap-2' },
          h('span', { style: { fontSize: 11 }, className: 'text-muted-foreground' },
            stats.costUsd != null ? `${en ? 'Est. cost' : '参考费用'} $${Number(stats.costUsd).toFixed(stats.costUsd >= 10 ? 2 : 3)}` : ''),
          h(Uy, {
            variant: 'ghost', size: 'sm', type: 'button',
            'data-testid': 'agy-export-markdown-btn',
            className: 'h-7 px-2 text-xs text-muted-foreground hover:text-foreground',
            onClick: () => { void exportConversationMarkdown(data.conversationId); }
          }, en ? 'Export Markdown' : '导出 Markdown')));
    }

    function formatCountdown(resetMs, en = false) {
      if (!Number.isFinite(resetMs)) return '';
      const diff = resetMs - Date.now();
      if (diff <= 0) return en ? 'now' : '即将';
      const mins = Math.ceil(diff / 60000);
      if (mins < 60) return `${mins}m`;
      const hours = Math.floor(mins / 60), remM = mins % 60;
      if (hours < 24) return remM > 0 ? `${hours}h${remM}m` : `${hours}h`;
      const days = Math.floor(hours / 24), remH = hours % 24;
      return remH > 0 ? `${days}d${remH}h` : `${days}d`;
    }

    async function exportConversationMarkdown(id) {
      const en = options.language === 'en';
      if (!id || !adapter.exportConversation) return;
      try {
        const res = await adapter.exportConversation(id);
        const safeName = String(res.title || id).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || id;
        const blob = new Blob([res.markdown], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${safeName}.md`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        notify?.({
          title: en ? 'Conversation exported' : '已导出会话',
          message: `${safeName}.md`,
          tag: 'agy-export-success'
        });
      } catch (error) {
        notify?.({
          title: en ? 'Export failed' : '导出失败',
          message: error.message,
          tag: 'agy-export-error'
        });
      }
    }

    function SpeedIcon({ tps }) {
      const deg = tps == null ? -80 : Math.round(Math.max(-105, Math.min(105, (tps - 45) * 2.2)));
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round', className: 'shrink-0', 'aria-hidden': true },
        h('circle', { cx: 12, cy: 12, r: 9.1, strokeWidth: 2.15 }),
        h('path', { d: 'M7.7 16.3a6.1 6.1 0 1 1 8.6 0', strokeWidth: 1.55, strokeOpacity: 0.35 }),
        h('line', { x1: 12, y1: 12.2, x2: 12, y2: 6.4, strokeWidth: 2, style: { transformOrigin: '12px 12.2px', transform: `rotate(${deg}deg)`, transition: 'transform 220ms ease-out' } }),
        h('circle', { cx: 12, cy: 12.2, r: 1.5, fill: 'currentColor', stroke: 'none' }));
    }

    function QuotaIcon() {
      return h('svg', { width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'shrink-0', 'aria-hidden': true },
        h('path', { d: 'M3 3v18h18' }),
        h('path', { d: 'M7 16v-4' }),
        h('path', { d: 'M12 16V8' }),
        h('path', { d: 'M17 16v-6' }));
    }

    function QuotaDetails() {
      useRevision();
      const en = options.language === 'en';
      const groups = account?.groups || [];
      const cap = adapter.capabilities?.() || {};
      const plan = cap.subscription || globalThis.__agyDashboard?.subscriptionIdentity?.({ id: cap.planId, name: cap.plan });
      const [refreshing, setRefreshing] = R.useState(false);
      const refreshNow = () => {
        if (refreshing) return;
        setRefreshing(true);
        void refreshAccount().catch(() => {}).finally(() => setRefreshing(false));
      };
      const updatedText = lastAccountUpdatedAt
        ? new Date(lastAccountUpdatedAt).toLocaleTimeString(options.language, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
        : '';
      return h('div', { className: 'flex flex-col px-2.5 pt-2 pb-1.5 gap-2.5', 'data-testid': 'agy-quota-details' },
        h('div', { className: 'flex items-center justify-between gap-2' },
          h('div', { className: 'flex items-center gap-1.5 min-w-0' },
            h('span', { className: 'text-compact font-medium text-muted-foreground whitespace-nowrap' }, en ? 'Model Usage' : '模型用量'),
            plan?.label && h('span', {
              className: 'whitespace-nowrap',
              style: { fontSize: 10, padding: '1px 6px', borderRadius: 9999, background: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)', fontWeight: 500 }
            }, plan.label)),
          h('div', { className: 'flex items-center gap-1 shrink-0' },
            updatedText && !refreshing && h('span', { className: 'text-muted-foreground tabular-nums', style: { fontSize: 10 } }, updatedText),
            h(Uy, {
              variant: 'ghost', size: 'sm', type: 'button',
              onClick: refreshNow, disabled: refreshing,
              'data-testid': 'agy-quota-refresh',
              className: 'h-6 px-2 text-xs text-muted-foreground'
            }, refreshing ? (en ? 'Refreshing…' : '刷新中…') : (en ? 'Refresh' : '刷新')))),
        groups.length === 0
          ? h('div', { className: 'py-4 text-center text-compact text-muted-foreground' },
              refreshing ? (en ? 'Loading usage…' : '正在获取用量…') : (en ? 'No quota data yet. Click Refresh to load.' : '暂未获取到用量数据，点击右上角刷新'))
          : h('div', { className: 'flex flex-col gap-2.5' },
              ...groups.map(group => h('div', { key: group.displayName, className: 'flex flex-col gap-1.5 pt-2 border-t border-border first:pt-0 first:border-t-0' },
                h('div', { className: 'text-compact font-medium text-foreground truncate' }, group.displayName),
                ...group.buckets.map(bucket => {
                  const fraction = bucket.remaining?.case === 'remainingFraction' ? bucket.remaining.value : null;
                  const pct = fraction == null ? 0 : Math.max(0, Math.min(1, fraction)) * 100;
                  const reset = bucket.resetTime ? Number(bucket.resetTime.seconds) * 1000 : null;
                  const barColor = fraction != null && fraction < 0.1 ? 'var(--error)' : fraction != null && fraction < 0.25 ? 'var(--warning)' : '#2563eb';
                  const resetText = reset ? new Date(reset).toLocaleString(options.language, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
                  const cdText = reset ? formatCountdown(reset, en) : '';
                  return h('div', { key: bucket.bucketId, className: 'flex flex-col gap-1 tabular-nums' },
                    h('div', { className: 'flex items-center justify-between gap-2 text-compact' },
                      h('span', { className: 'text-secondary-foreground' }, t(bucket.window === 'weekly' ? '周限额' : '5 小时限额')),
                      h('div', { className: 'flex items-center gap-1.5 whitespace-nowrap' },
                        cdText && h('span', { className: 'text-muted-foreground', style: { fontSize: 11 }, title: resetText }, en ? `in ${cdText} · ${resetText}` : `${cdText}后 · ${resetText}`),
                        h('span', { className: 'font-semibold text-foreground' }, fraction == null ? '-' : `${pct.toFixed(1)}%`))),
                    h('div', { style: { height: 6, borderRadius: 9999, overflow: 'hidden', background: 'var(--secondary)' } },
                      h('div', { style: { width: `${pct}%`, height: '100%', background: barColor, borderRadius: 9999 } })));
                })))),
        h('div', { className: 'pt-1.5 border-t border-border flex justify-end' },
          h(Uy, {
            variant: 'ghost', size: 'sm', type: 'button',
            'data-testid': 'agy-quota-open-dashboard',
            className: 'h-7 px-2 text-xs text-muted-foreground hover:text-foreground',
            onClick: () => {
              const trigger = document.querySelector('[data-testid="agy-management-trigger"]');
              if (trigger) trigger.click();
              else location.assign('/powertools');
            }
          }, en ? 'Open full dashboard →' : '打开完整用量面板 →')));
    }

    function NativeEntry({ data }) {
      useRevision();
      const fork = Mmc();
      const toast = um();
      R.useEffect(() => { nativeRunFork = fork.runFork; notify = toast; }, [fork.runFork, toast]);
      if (!data?.conversationId) return null;
      const en = options.language === 'en';
      const cap = adapter.capabilities?.() || {};
      const activeMatch = String(cap.model || '').match(/^(.*?)\s*\((Minimal|Low|Medium|High|XHigh|Max)\)\s*$/i);
      const effortOrder = ['Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'];
      const effortShort = { Minimal: 'Min', Low: 'Low', Medium: 'Med', High: 'High', XHigh: 'XH', Max: 'Max' };
      const effortVariants = activeMatch
        ? (cap.models || [])
            .map(m => {
              const mm = String(m.label || '').match(/^(.*?)\s*\((Minimal|Low|Medium|High|XHigh|Max)\)\s*$/i);
              if (!mm || mm[1].trim() !== activeMatch[1].trim() || m.modelValue == null) return null;
              const eff = effortOrder.find(e => e.toLowerCase() === mm[2].toLowerCase()) || mm[2];
              return { effort: eff, short: effortShort[eff] || eff, modelValue: m.modelValue, active: eff.toLowerCase() === activeMatch[2].toLowerCase() };
            })
            .filter(Boolean)
            .sort((a, b) => effortOrder.indexOf(a.effort) - effortOrder.indexOf(b.effort))
        : [];
      const activeEffort = effortVariants.find(v => v.active) || effortVariants[0];
      if (effortVariants.length < 2 || !activeEffort) return null;

      return h('span', { className: 'inline-flex items-center' },
        h(HC, { placement: 'top-end', disableMobileSheet: false },
          h(IC, { asChild: true }, h(Uy, {
            variant: 'ghost', size: 'sm', type: 'button',
            'aria-label': en ? 'Switch reasoning effort' : '切换思考深度',
            'data-testid': 'agy-effort-switcher',
            className: 'gap-1 px-2 text-muted-foreground whitespace-nowrap',
            title: en ? 'Switch reasoning effort' : '切换思考深度'
          }, h('span', { className: 'text-xs font-medium text-foreground' }, activeEffort.effort), h('span', { className: 'agy-effort-arrow' }, h(dq, { name: 'keyboard_arrow_down', size: 13 })))),
          h(JC, { className: 'p-1', style: { width: 'max-content', minWidth: 120 }, 'data-testid': 'agy-effort-menu', arrowNavigable: true },
            ...effortVariants.map(v => h(KC, { key: v.effort, asChild: true },
              h(GC, {
                icon: v.active ? h(dq, { name: 'check', size: 14 }) : h('span', { style: { width: 14, display: 'inline-block' } }),
                'data-testid': `agy-effort-${v.effort.toLowerCase()}`,
                onClick: () => { if (adapter.selectModel?.(data.conversationId, v.modelValue)) emit(); }
              }, v.effort))))));
    }

    function BottomStatusBar({ data }) {
      useRevision();
      const en = options.language === 'en';
      const hasConv = Boolean(data?.conversationId);
      const cw = data?.contextWindow, stats = data?.telemetry;
      const ringCapacity = !cw ? '' : (cw.usedTokens || 0) > 0
        ? (cw.maxTokens != null ? `${tokens(cw.usedTokens)} / ${tokens(cw.maxTokens)}` : tokens(cw.usedTokens))
        : '';
      const ringText = !cw ? '' : cw.usedPercent == null
        ? ringCapacity
        : (cw.usedPercent > 0 ? (ringCapacity ? `${cw.usedPercent}% · ${ringCapacity}` : `${cw.usedPercent}%`) : '');
      const liveSpeed = stats?.latestTps ?? stats?.tps ?? null;
      const speedColor = liveSpeed == null ? undefined : liveSpeed >= 60 ? 'var(--success)' : liveSpeed < 25 ? 'var(--warning)' : undefined;

      const groups = account?.groups || [];
      const activeModelName = String(adapter.capabilities?.()?.model || '');
      const matchedGroup = groups.find(g => {
        const dn = String(g.displayName || '');
        if (/argon/i.test(activeModelName)) return /argon/i.test(dn);
        if (/claude|gpt/i.test(activeModelName)) return /claude|gpt/i.test(dn);
        if (/gemini/i.test(activeModelName)) return /gemini/i.test(dn) && !/argon/i.test(dn);
        return false;
      });
      const scopedBuckets = (matchedGroup ? [matchedGroup] : groups).flatMap(g => g.buckets || []);
      const pickMinBucket = win => {
        const list = scopedBuckets
          .filter(b => (win === 'weekly' ? b.window === 'weekly' : b.window !== 'weekly') && b.remaining?.case === 'remainingFraction')
          .map(b => ({ pct: Math.round(b.remaining.value * 100), frac: b.remaining.value, reset: b.resetTime ? Number(b.resetTime.seconds) * 1000 : null }));
        if (!list.length) return null;
        return list.reduce((a, b) => (b.frac < a.frac ? b : a));
      };
      const bucket5h = pickMinBucket('5h');
      const bucketWk = pickMinBucket('weekly');
      const minFrac = [bucket5h?.frac, bucketWk?.frac].filter(v => v != null);
      const lowFrac = minFrac.length ? Math.min(...minFrac) : null;
      const quotaColor = lowFrac == null ? undefined : lowFrac < 0.1 ? 'var(--error)' : lowFrac < 0.25 ? 'var(--warning)' : undefined;

      return h('div', {
        'data-testid': 'agy-bottom-status-bar',
        className: 'flex items-center justify-between gap-2 px-2 pt-1.5 pb-0.5 text-muted-foreground'
      },
        h('span', { className: 'inline-flex items-center gap-1 min-w-0' },
          hasConv && options.contextRing && h(HC, { placement: 'top-start', disableMobileSheet: false },
            h(IC, { asChild: true }, h(Uy, {
              variant: 'ghost', size: ringText ? 'sm' : 'icon', type: 'button',
              'aria-label': t('上下文窗口'), 'data-testid': 'agy-context-ring-trigger',
              className: `${ringText ? 'gap-1.5 ' : ''}h-6 px-1.5 text-muted-foreground`,
              style: { color: cw.usedPercent >= 95 ? 'var(--error)' : cw.usedPercent >= 80 ? 'var(--warning)' : undefined }
            }, h(Ring, { percent: cw.usedPercent }), ringText ? h('span', { className: 'text-xs tabular-nums' }, ringText) : null)),
            h(JC, { className: 'max-h-[80vh] overflow-y-auto', style: { width: 356, maxWidth: 'calc(100vw - 24px)' }, 'data-testid': 'agy-context-popup', 'aria-label': t('上下文窗口'), role: 'dialog' }, h(ContextDetails, { data }))),
          hasConv && options.speedStats && h(HC, { placement: 'top-start', disableMobileSheet: false },
            h(IC, { asChild: true }, h(Uy, {
              variant: 'ghost', size: liveSpeed != null ? 'sm' : 'icon', type: 'button',
              'aria-label': t('会话统计'), 'data-testid': 'agy-speed-stats-trigger',
              className: `${liveSpeed != null ? 'gap-1 ' : ''}h-6 px-1.5 text-muted-foreground`,
              style: { color: speedColor }
            }, h(SpeedIcon, { tps: liveSpeed }), liveSpeed != null ? h('span', { className: 'text-xs tabular-nums' }, `${liveSpeed} tok/s`) : null)),
            h(JC, { className: 'max-h-[80vh] overflow-y-auto', style: { width: 344, maxWidth: 'calc(100vw - 24px)' }, 'data-testid': 'agy-stats-popup', 'aria-label': t('会话统计'), role: 'dialog' }, h(SessionStatsDetails, { data })))),
        h('span', { className: 'inline-flex items-center shrink-0' },
          h(HC, { placement: 'top-end', disableMobileSheet: false },
            h(IC, { asChild: true }, h(Uy, {
              variant: 'ghost', size: 'sm', type: 'button',
              'aria-label': en ? 'View usage' : '查看用量',
              'data-testid': 'agy-quota-trigger',
              className: 'gap-1.5 h-6 px-1.5 text-muted-foreground',
              style: { color: quotaColor },
              onClick: () => { void refreshAccount().catch(() => {}); }
            }, h(QuotaIcon),
              (bucket5h || bucketWk)
                ? h('span', { className: 'inline-flex items-center gap-1.5 text-xs tabular-nums whitespace-nowrap' },
                    bucket5h && h('span', null, `5h ${bucket5h.pct}%${bucket5h.reset ? ` · ${formatCountdown(bucket5h.reset, en)}` : ''}`),
                    bucket5h && bucketWk && h('span', { className: 'opacity-40' }, '|'),
                    bucketWk && h('span', null, `${en ? 'Wk' : '周'} ${bucketWk.pct}%${bucketWk.reset ? ` · ${formatCountdown(bucketWk.reset, en)}` : ''}`))
                : h('span', { className: 'text-xs' }, en ? 'Usage' : '查看用量'))),
            h(JC, { className: '!w-80 max-h-[80vh] overflow-y-auto', 'data-testid': 'agy-quota-popup', 'aria-label': en ? 'Model Usage' : '模型用量', role: 'dialog' }, h(QuotaDetails)))));
    }

    function ToolDetails({ turn }) {
      return h('div', { className: 'flex flex-col pl-3', 'data-testid': 'agy-tool-details' }, ...turn.toolGroups.map(group =>
        h(k0, { key: group.groupKey, trigger: `${group.groupLabel} (${group.items.length})`, defaultExpanded: true },
          ...group.items.map(item => h(k0, { key: item.id, trigger: h('span', { className: 'truncate text-sm' }, item.itemLabel) },
            h('div', { className: 'px-2 py-1 text-sm text-muted-foreground' },
              h('pre', { className: 'whitespace-pre-wrap break-words rounded-md bg-secondary p-2 overflow-auto max-h-52' }, item.detailTitle),
              item.outputPreview && h('pre', { className: 'whitespace-pre-wrap break-words rounded-md bg-secondary p-2 overflow-auto max-h-52' }, item.outputPreview)))))));
    }

    function Completion({ turn, tooltipOnly, tooltipId }) {
      return h(R.Fragment, null,
        !tooltipOnly && (options.toolDetails && turn.toolCalls.length ? h(k0, {
          trigger: h('span', { className: 'text-sm text-muted-foreground', 'data-tooltip-id': tooltipId }, `${options.language==='en'?'Worked for':'用时'} ${duration(turn.durationMs)}`),
          defaultExpanded: false, dataTestId: 'agy-completion-tools-toggle'
        }, h(ToolDetails, { turn })) : h('span', { className: 'inline-flex items-center gap-1 text-sm text-muted-foreground tabular-nums px-2 py-1', tabIndex: 0, 'data-tooltip-id': tooltipId, 'data-testid': 'agy-completion-time' }, `${options.language==='en'?'Worked for':'用时'} ${duration(turn.durationMs)}`)),
        h(Sy, { id: tooltipId, place: 'right' }, completed(turn.completedAtIso)));
    }

    function ResponseActions({ turn, conversationId }) {
      return h(HC, { placement: 'top-end' },
        h(IC, { asChild: true }, h(Uy, { variant: 'ghost', size: 'icon', 'aria-label': t('回答操作'), 'data-testid': 'agy-response-actions' }, h(dq, { name: 'more_horiz', size: 16 }))),
        h(JC, { className: '!w-52', arrowNavigable: true },
          h(KC, { asChild: true }, h(GC, { icon: h(dq, { name: 'fork_left', size: 16 }), 'data-testid': 'agy-fork-response', onClick: () => { void branchAndNavigate(conversationId, turn.stepIndexEnd); } }, t('分支到新聊天')))));
    }

    function MessageEdit({ user }) {
      const message = adapter.userMessage(user);
      R.useEffect(() => () => { if (adapter.pendingEdit?.element === user) adapter.cancelEdit?.({ restoreDraft: false }); }, [user]);
      if (!message) return null;
      const viewOnly = adapter.providers(user).find(p => p.value?.stepHandler)?.value?.stepHandler?.isViewOnlyMode?.();
      if (viewOnly || message.status === I.CortexStepStatus.CLEARED) return null;
      return h(Uy, {
        variant: 'ghost', size: 'icon',
        tooltip: t('编辑消息'),
        'aria-label': t('编辑消息'),
        'data-testid': 'agy-edit-message',
        onClick: async event => {
          event.stopPropagation();
          try {
            await adapter.beginEdit(user, {
              label: options.language === 'en' ? 'Editing message (sending will regenerate from this turn)' : '正在编辑此条消息（发送后将从此处重新生成）',
              cancelLabel: t('取消')
            });
          } catch (failure) { notify?.({ title: t('消息发送失败'), message: failure.message, tag: 'agy-edit-error' }); }
        }
      }, h(dq, { name: 'edit', size: 16 }));
    }

    function renderRoot(key, parent, before, source, element, kind) {
      let entry = roots.get(key);
      if (!entry || !entry.mount.isConnected) {
        if (entry) { entry.root.unmount(); entry.mount.remove(); }
        const mount = document.createElement('span');
        mount.dataset.agyPowertoolsRoot = kind;
        mount.className = kind === 'outline' ? 'contents' : kind === 'completion' ? 'block' : ['management','progress','status-bar'].includes(kind) ? 'block w-full' : 'inline-flex items-center shrink-0';
        parent.insertBefore(mount, before || null);
        entry = { root: ReactDOM.createRoot(mount), mount, source, kind };
        roots.set(key, entry);
      }
      const tree=adapter.wrap(element, source);
      entry.root.render(Boundary?h(Boundary,null,tree):tree);
    }

    function turnFor(response) {
      for (let f = adapter.fiber(response); f; f = f.return) {
        const steps = f.memoizedProps?.container?.steps;
        if (Array.isArray(steps)) {
          const input = steps.find(s => s.step?.case === 'userInput');
          if (input) return state?.turns.find(t => t.stepIndexStart === HU(input.metadata));
          const index = HU(steps.at(-1)?.metadata);
          const turn = state?.turns.find(t => t.stepIndexStart <= index && t.stepIndexEnd >= index);
          if (turn) return turn;
        }
      }
      return null;
    }

    function mount() {
      if (disposed) return;
      if(adapter.pendingEdit?.element&&adapter.pendingEdit.element.isConnected===false)adapter.cancelEdit?.({restoreDraft:true});
      const activeId = currentId();
      if(mountedConversationId!==activeId){
        if(adapter.pendingEdit&&adapter.pendingEdit.cascadeId!==activeId)adapter.cancelEdit?.({restoreDraft:false});
        mountedConversationId=activeId;
        if(activeId&&stateCache.has(activeId)){state=stateCache.get(activeId);lastId=activeId;}
        emit();
        if(activeId&&state?.conversationId!==activeId)void refresh();
      }
      document.documentElement.toggleAttribute('data-agy-compact', options.enabled&&options.compact);
      document.documentElement.toggleAttribute('data-agy-keep-outline', options.enabled&&options.keepTurnOutline);
      followOverview();
      localizer?.apply(options.enabled?options.language:'en',options.enabled);
      for (const [key, entry] of roots) if (!entry.mount.isConnected || !entry.source.isConnected || (entry.kind === 'completion' && !options.timing) || (entry.kind === 'response-actions' && !options.responseBranch) || (entry.kind === 'message-edit' && !options.messageEdit) || (entry.kind === 'progress' && !options.progress) || (entry.kind === 'outline' && !options.keepTurnOutline)) {
        entry.root.unmount(); entry.mount.remove(); roots.delete(key);
      }
      if (!options.timing) restoreLabels();
      if(!options.enabled){
        restoreLabels();
        for(const [key,entry]of roots)if(entry.kind!=='management'){entry.root.unmount();entry.mount.remove();roots.delete(key);}
      }
      const customizations = document.querySelector('a[href="/customizations"]');
      if (!pageInstalled && panels) pageInstalled = adapter.installPage(Boundary?()=>h(Boundary,{page:true},h(panels.Page)):panels.Page);
      if (customizations && panels) renderRoot(customizations, customizations.parentElement, customizations.nextSibling, customizations, h(panels.Sidebar), 'management');
      if(!options.enabled)return;
      const data = state?.conversationId === currentId() ? state : null;
      for (const model of document.querySelectorAll('[data-testid="model-selector-trigger"]')) {
        if (!model.closest('.surface-composer-card')) continue;
        let anchor = model;
        while (anchor.parentElement && getComputedStyle(anchor.parentElement).display !== 'flex') anchor = anchor.parentElement;
        renderRoot(model, anchor.parentElement, anchor.nextSibling, model, h(NativeEntry, { data, placement: 'composer' }), 'ring');
        const composer = model.closest('.surface-composer');
        if (composer?.parentElement) renderRoot(composer, composer.parentElement, composer.nextSibling, composer, h(BottomStatusBar, { data }), 'status-bar');
      }
      if (!data) return;
      const overview = document.querySelector('[data-testid="overview-panel"]');
      if (overview && panels && options.progress) renderRoot(overview,overview,null,overview,h(panels.Progress),'progress');
      const view = document.querySelector('[data-testid="conversation-view"]');
      const nativeOutline=view?.querySelector('[data-testid="conversation-navigator"]');
      if (overview && view && panels && options.keepTurnOutline && !nativeOutline && data.turns.length>1) renderRoot(view,view,null,view,h(panels.Outline),'outline');
      else if(view){const entry=roots.get(view);if(entry?.kind==='outline'){entry.root.unmount();entry.mount.remove();roots.delete(view);}}
      if (options.messageEdit) for (const user of document.querySelectorAll('[data-testid="user-input-step"]')) {
        const actions = user.querySelector('[data-testid="user-message-actions"]');
        if (actions) renderRoot(actions, actions, null, user, h(MessageEdit, { user }), 'message-edit');
      }
      for (const response of document.querySelectorAll('[data-testid="agent-response"]')) {
        const turn = turnFor(response);
        if (!turn) continue;
        if (options.responseBranch && turn.status !== 'running') {
          let scope = response.closest('[data-turn-content]');
          if (!scope) {
            for (let parent = response.parentElement; parent && parent.querySelectorAll('[data-testid="agent-response"]').length === 1; parent = parent.parentElement) {
              if ([...parent.querySelectorAll('button[aria-label="Copy"]')].some(button => !button.closest('[data-testid="user-input-step"]'))) { scope = parent; break; }
            }
          }
          const feedback = scope?.querySelector('[aria-label="Bad response"]') || scope?.querySelector('[aria-label="Good response"]') || [...(scope?.querySelectorAll('button[aria-label="Copy"]') || [])].find(button => !button.closest('[data-testid="user-input-step"]'));
          const actionRow = feedback?.parentElement;
          if (actionRow) renderRoot(actionRow, actionRow, null, response, h(ResponseActions, { turn, conversationId: data.conversationId }), 'response-actions');
        }
        if (!options.timing || !turn.completedAtIso || turn.durationMs == null || turn.status === 'running') continue;
        const tooltipId = `agy-completed-${data.conversationId}-${turn.turnNumber}`;
        const nativeWorked = response.querySelector('[data-testid="worked-for-collapsible"]');
        if (nativeWorked) {
          const label = [...nativeWorked.querySelectorAll('span')].find(el => /^Worked for|^用时 /.test(el.textContent));
          if (label) {
            if (!changedLabels.has(label)) changedLabels.set(label, { text: label.textContent, target: nativeWorked, tooltip: nativeWorked.getAttribute('data-tooltip-id') });
            const text = `${options.language==='en'?'Worked for':'用时'} ${duration(turn.durationMs)}`;
            if (label.textContent !== text) label.textContent = text;
            nativeWorked.setAttribute('data-tooltip-id', tooltipId);
            renderRoot(response, response, response.firstChild, response, h(Completion, { turn, tooltipOnly: true, tooltipId }), 'completion');
          }
        } else renderRoot(response, response, response.querySelector('[data-testid="planner-response-text"]')?.closest('[data-quotable]') === response ? response.children[1] : response.firstChild, response, h(Completion, { turn, tooltipId }), 'completion');
      }
    }

    function restoreLabels() {
      for (const [label, original] of changedLabels) {
        if (label.isConnected) label.textContent = original.text;
        if (original.target.isConnected) original.tooltip == null ? original.target.removeAttribute('data-tooltip-id') : original.target.setAttribute('data-tooltip-id', original.tooltip);
      }
      changedLabels.clear();
    }

    let activeForkDialogCleanup = null;
    function confirmPreSubagentFork(plan) {
      activeForkDialogCleanup?.();
      return new Promise(resolve => {
        const host = document.createElement('div');
        host.dataset.agyPowertoolsRoot = 'fork-dialog';
        document.body.append(host);
        const root = ReactDOM.createRoot(host);
        let settled = false;
        const finish = accepted => {
          if (settled) return;
          settled = true;
          window.removeEventListener('keydown', onKey, true);
          activeForkDialogCleanup = null;
          root.unmount();
          host.remove();
          resolve(accepted);
        };
        const onKey = event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
        };
        window.addEventListener('keydown', onKey, true);
        activeForkDialogCleanup = () => finish(false);
        const en = options.language === 'en';
        const title = en ? 'Branch before subagent invocation?' : '从子智能体调用前创建分支？';
        const body = en
          ? `This conversation invoked a subagent in Turn ${plan.subagentTurnNumber}, and Antigravity does not yet support branching turns that include subagents. Would you like to branch from the end of Turn ${plan.turnNumber} instead?`
          : `当前会话在第 ${plan.subagentTurnNumber} 轮调用了子智能体，官方底层暂不支持包含子智能体的轮次直接分支。是否从子智能体之前的第 ${plan.turnNumber} 轮对话结束处创建分支？`;
        const previewLabel = plan.promptPreview
          ? (en ? `Up to Turn ${plan.turnNumber}: "${plan.promptPreview}"` : `截至第 ${plan.turnNumber} 轮提问：「${plan.promptPreview}」`)
          : '';
        const cancelText = en ? 'Cancel' : '取消';
        const confirmText = en ? `Branch from Turn ${plan.turnNumber}` : `从第 ${plan.turnNumber} 轮创建分支`;
        const dialogBody = h('div', { 'data-testid': 'agy-subagent-fork-dialog', className: 'flex flex-col gap-3' },
          h('p', { className: 'text-foreground opacity-80 leading-relaxed m-0' }, body),
          previewLabel && h('div', {
            className: 'rounded-lg border border-border bg-secondary px-3 py-2 text-compact text-secondary-foreground truncate',
            title: previewLabel
          }, previewLabel),
          h('div', { className: 'flex justify-end gap-3 pt-1' },
            h(Uy, { size: 'md', variant: 'secondary', type: 'button', 'data-testid': 'agy-subagent-fork-cancel', onClick: () => finish(false) }, cancelText),
            h(Uy, { size: 'md', variant: 'primary', type: 'button', 'data-autofocus': 'true', autoFocus: true, 'data-testid': 'agy-subagent-fork-confirm', onClick: () => finish(true) }, confirmText)));
        const modal = typeof Wz === 'function'
          ? h(Wz, {
              isOpen: true,
              positioning: 'fixed',
              onClose: () => finish(false),
              onSubmit: () => finish(true),
              title,
              className: 'max-w-md rounded-xl bg-background',
              innerContentClassName: 'px-1 -mx-1',
              scrollToBottomOnOpen: false
            }, dialogBody)
          : h('div', {
              style: { position: 'fixed', inset: 0, zIndex: 9000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', padding: 16 },
              onMouseDown: event => { if (event.target === event.currentTarget) finish(false); }
            },
              h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title, style: { width: '100%', maxWidth: 420, padding: 20, borderRadius: 12 }, className: 'border border-border bg-background text-foreground shadow-lg flex flex-col gap-3' },
                h('div', { className: 'font-medium text-lg text-foreground' }, title),
                dialogBody));
        const sourceEl = document.querySelector('[data-testid="conversation-view"],a[href="/customizations"]') || document.body.firstElementChild;
        const tree = sourceEl ? adapter.wrap(modal, sourceEl) : modal;
        root.render(Boundary ? h(Boundary, null, tree) : tree);
      });
    }

    async function executeResolvedFork(id, forkAtStepIndex) {
      let newId;
      if (nativeRunFork) {
        newId = await nativeRunFork(id, forkAtStepIndex, 1);
      } else {
        const result = await adapter.fork(id, forkAtStepIndex, { exact: true, autoRename: false });
        newId = result.conversationId;
        location.assign(`/c/${encodeURIComponent(newId)}`);
      }
      if (newId) void adapter.renameForkedConversation?.(id, newId, state?.conversationId === id ? state?.turns?.[0]?.promptTitle : '');
      return newId;
    }

    async function branchAndNavigate(id, stepIndex = -1) {
      try {
        if (!adapter.resolveForkPlan) {
          if (nativeRunFork) return await nativeRunFork(id, await adapter.forkPoint(id, stepIndex), 1);
          const result = await adapter.fork(id, stepIndex); location.assign(`/c/${encodeURIComponent(result.conversationId)}`); return result.conversationId;
        }
        const plan = await adapter.resolveForkPlan(id, stepIndex);
        if (plan.mode === 'direct') return await executeResolvedFork(id, plan.forkAtStepIndex);
        if (plan.mode === 'blocked-first-turn') {
          notify?.({
            title: options.language === 'en' ? 'Unable to branch conversation' : '无法创建会话分支',
            message: options.language === 'en'
              ? 'This conversation invoked a subagent in its first turn, so there is no earlier turn to branch from.'
              : '该会话在第 1 轮即调用了子智能体，之前没有可分支的历史对话轮次。',
            tag: 'agy-branch-error'
          });
          return null;
        }
        if (await confirmPreSubagentFork(plan)) {
          return await executeResolvedFork(id, plan.forkAtStepIndex);
        }
        return null;
      }
      catch (error) { notify?.({ title: options.language === 'en' ? 'Unable to branch conversation' : '无法创建会话分支', message: error.message, tag: 'agy-branch-error' }); }
    }
    const menuName=globalThis.__agyNativeBindings?.names.menu||'lHc';
    const originalMenu = globalThis[menuName];
    const extendedMenu = function (id, menuOptions) {
      const items = originalMenu(id, menuOptions);
      if (!options.enabled || !id) return items;
      let next = items;
      if (options.responseBranch && !menuOptions.isArchived && !next.some(item => item.id === 'agy-native-fork')) {
        const entry = { id: 'agy-native-fork', label: t('分支会话'), icon: h(dq, { name: 'fork_left', size: 16, className: 'shrink-0 text-secondary-foreground' }), testId: 'agy-fork-session-menu-item', onClick: () => { void branchAndNavigate(id); } };
        const index = next.findIndex(item => item.id === 'split');
        next = [...next.slice(0, index < 0 ? 3 : index), entry, ...next.slice(index < 0 ? 3 : index)];
      }
      if (!next.some(item => item.id === 'agy-export-markdown')) {
        const exportEntry = { id: 'agy-export-markdown', label: options.language === 'en' ? 'Export Markdown' : '导出会话 (MD)', icon: h(dq, { name: 'download', size: 16, className: 'shrink-0 text-secondary-foreground' }), testId: 'agy-export-session-menu-item', onClick: () => { void exportConversationMarkdown(id); } };
        const forkIdx = next.findIndex(item => item.id === 'agy-native-fork');
        const insertAt = forkIdx >= 0 ? forkIdx + 1 : 3;
        next = [...next.slice(0, insertAt), exportEntry, ...next.slice(insertAt)];
      }
      return next;
    };
    if (typeof originalMenu === 'function') globalThis[menuName] = extendedMenu;
    let activeFileMenuCleanup = null;
    function closeFileContextMenu() {
      activeFileMenuCleanup?.();
      activeFileMenuCleanup = null;
    }
    function FileContextMenu({ x, y, uri, onClose }) {
      const [open, setOpen] = R.useState(false);
      R.useLayoutEffect(() => { setOpen(true); }, []);
      const runAction = async (method, errorKey, successKey) => {
        onClose();
        try {
          const res = await request(method, { uri });
          if (successKey) notify?.({ title: t(successKey), message: res?.path || '', tag: 'agy-file-action-ok' });
        } catch (error) {
          notify?.({ title: t(errorKey), message: error.message, tag: 'agy-file-action-error' });
        }
      };
      const copyPath = async () => {
        onClose();
        try {
          const res = await request('file.path', { uri });
          await navigator.clipboard.writeText(res.path);
          notify?.({ title: t('已复制文件路径'), message: res.path, tag: 'agy-file-action-ok' });
        } catch (error) {
          notify?.({ title: t('复制路径失败'), message: error.message, tag: 'agy-file-action-error' });
        }
      };
      return h(HC, {
        open,
        onOpenChange: next => { if (!next) onClose(); },
        placement: 'bottom-start',
        disableMobileSheet: true
      },
        h(IC, { asChild: true }, h('span', {
          'aria-hidden': true,
          style: { position: 'fixed', left: x, top: y, width: 1, height: 1, pointerEvents: 'none' }
        })),
        h(JC, { className: '!w-52', arrowNavigable: true, 'data-testid': 'agy-file-context-menu', role: 'menu' },
          h(KC, { asChild: true }, h(GC, {
            icon: h(dq, { name: 'open_in_new', size: 16, className: 'shrink-0 text-secondary-foreground' }),
            'data-testid': 'agy-file-open-default',
            onClick: () => { void runAction('file.open', '打开文件失败'); }
          }, t('用默认应用打开'))),
          h(KC, { asChild: true }, h(GC, {
            icon: h(dq, { name: 'folder_open', size: 16, className: 'shrink-0 text-secondary-foreground' }),
            'data-testid': 'agy-file-open-folder',
            onClick: () => { void runAction('file.reveal', '打开文件夹失败'); }
          }, t('打开所在文件夹'))),
          h(KC, { asChild: true }, h(GC, {
            icon: h(dq, { name: 'file_copy', size: 16, className: 'shrink-0 text-secondary-foreground' }),
            'data-testid': 'agy-file-copy-file',
            onClick: () => { void runAction('file.copy', '复制文件失败', '已复制文件'); }
          }, t('复制文件'))),
          h(KC, { asChild: true }, h(GC, {
            icon: h(dq, { name: 'link', size: 16, className: 'shrink-0 text-secondary-foreground' }),
            'data-testid': 'agy-file-copy-path',
            onClick: () => { void copyPath(); }
          }, t('复制路径')))));
    }
    function showFileContextMenu({ x, y, uri, source }) {
      closeFileContextMenu();
      const host = document.createElement('div');
      host.dataset.agyPowertoolsRoot = 'file-menu';
      document.body.appendChild(host);
      const root = ReactDOM.createRoot(host);
      const menuController = new AbortController();
      let closed = false;
      const cleanup = () => {
        if (closed) return;
        closed = true;
        menuController.abort();
        if (activeFileMenuCleanup === cleanup) activeFileMenuCleanup = null;
        setTimeout(() => { root.unmount(); host.remove(); }, 0);
      };
      activeFileMenuCleanup = cleanup;
      document.addEventListener('keydown', e => { if (e.key === 'Escape') cleanup(); }, { capture: true, signal: menuController.signal });
      document.addEventListener('scroll', e => { if (!e.target?.closest?.('[data-testid="agy-file-context-menu"]')) cleanup(); }, { capture: true, signal: menuController.signal });
      window.addEventListener('resize', cleanup, { signal: menuController.signal });
      window.addEventListener('blur', cleanup, { signal: menuController.signal });
      const menu = h(FileContextMenu, { x, y, uri, onClose: cleanup });
      const sourceEl = source || document.querySelector('[data-testid="conversation-view"],a[href="/customizations"]') || document.body.firstElementChild;
      const tree = sourceEl ? adapter.wrap(menu, sourceEl) : menu;
      root.render(Boundary ? h(Boundary, null, tree) : tree);
    }
    document.addEventListener('contextmenu', event => {
      if(!options.enabled)return;
      const row = event.target.closest?.('.agy-sidebar-row');
      const link = row?.querySelector('a[href^="/c/"]');
      const button = row?.querySelector('button[aria-label="More options"]');
      if (link && button) {
        event.preventDefault(); event.stopPropagation();
        if (button.getAttribute('aria-expanded') !== 'true') button.click();
        return;
      }
      if (!options.fileContextMenu) return;
      const fileTarget = event.target.closest?.('[data-testid="agent-response"] [data-uri^="file://"], [data-testid="agent-response"] a[href^="file://"], [data-testid="user-input-step"] [data-uri^="file://"], [data-testid="user-input-step"] a[href^="file://"]');
      const fileUri = fileTarget?.getAttribute('data-uri') || fileTarget?.getAttribute('href') || '';
      if (fileUri.startsWith('file://')) {
        event.preventDefault(); event.stopPropagation();
        showFileContextMenu({ x: event.clientX, y: event.clientY, uri: fileUri, source: fileTarget });
      }
    }, { capture: true, signal: signalController.signal });

    const unfocusedFinishedIds = new Set();
    let activeRunningId = '', lastTaskbarCount = 0, taskbarFlashed = false, titleSyncing = false;
    const stripTitleBadge = value => String(value || '').replace(/^\(\d+\)\s+/, '');
    function syncTaskbarBadge(execution = null) {
      if (disposed) return;
      const id = currentId();
      const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      if (focused && id) unfocusedFinishedIds.delete(id);
      const exec = execution || (id ? adapter.executionState?.(id) : null);
      if (exec?.conversationId === id) {
        if (exec.status === 2 || exec.status === 4) activeRunningId = id;
        else if (exec.status === 1 && activeRunningId === id) {
          activeRunningId = '';
          if (!focused) unfocusedFinishedIds.add(id);
        }
      }
      const badgeActive = options.enabled && options.taskbarBadge;
      const count = badgeActive ? Math.max(adapter.unreadCount?.(id, focused) || 0, unfocusedFinishedIds.size) : 0;
      if (typeof document.title === 'string' && document.title) {
        const clean = stripTitleBadge(document.title);
        const nextTitle = count > 0 ? `(${count}) ${clean}` : clean;
        if (document.title !== nextTitle) {
          titleSyncing = true;
          try { document.title = nextTitle; } finally { titleSyncing = false; }
        }
      }
      if (count > lastTaskbarCount && !focused) {
        taskbarFlashed = true;
        void request('window.attention', { count }).catch(() => {});
      } else if ((count === 0 || focused) && taskbarFlashed) {
        taskbarFlashed = false;
        void request('window.attention', { count: 0 }).catch(() => {});
      }
      lastTaskbarCount = count;
    }
    const titleElement = document.querySelector?.('title');
    const titleObserver = titleElement ? new MutationObserver(() => { if (!titleSyncing) syncTaskbarBadge(); }) : null;
    if (titleObserver && titleElement) titleObserver.observe(titleElement, { childList: true, characterData: true, subtree: true });
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', () => { const id = currentId(); if (id) unfocusedFinishedIds.delete(id); syncTaskbarBadge(); }, { signal: signalController.signal });
      window.addEventListener('blur', () => syncTaskbarBadge(), { signal: signalController.signal });
    }
    document.addEventListener('visibilitychange', () => syncTaskbarBadge(), { signal: signalController.signal });

    let refreshQueued = false;
    async function refresh() {
      if (disposed) return;
      if (busy) { refreshQueued = true; return; }
      busy = true;
      const id = currentId();
      try {
        if (!settingsLoaded) { options = {...defaults,...await request('settings.get')}; settingsLoaded = true; applyOptions(); mount(); syncTaskbarBadge(); emit(); }
        if(!options.enabled){ syncTaskbarBadge(); return; }
        if (id !== lastId) {
          state = id ? (stateCache.get(id) || null) : null;
          lastId = id;
          if (id && typeof document.hasFocus === 'function' && document.hasFocus()) unfocusedFinishedIds.delete(id);
          mount();
        }
        if (Date.now() - lastAccountAt > 60000) void refreshAccount().catch(()=>{});
        const execution = id ? adapter.executionState?.(id) : null;
        syncTaskbarBadge(execution);
        if (!id) return;
        const reply = await request('state', { conversationId: id, execution });
        rememberState(id, reply);
        if (id === currentId()) { state = reply; lastConversation=reply; if (reply.settings) options = {...defaults,...reply.settings}; mount(); syncTaskbarBadge(execution); emit(); }
      } catch { /* Keep the last confirmed data during a transient host reconnect. */ }
      finally {
        busy = false;
        if (refreshQueued && !disposed) { refreshQueued = false; void refresh(); }
      }
    }
    let mountTimer;
    const observer = new MutationObserver(records => {
      if (records.every(record => record.target.closest?.('[data-agy-powertools-root],[data-agy-editor-slot],[data-testid="agy-edit-banner"],[data-testid="agy-context-popup"],[data-testid="agy-stats-popup"],[data-testid="agy-quota-popup"],[data-testid="agy-file-context-menu"],.react-tooltip'))) return;
      clearTimeout(mountTimer); mountTimer = setTimeout(mount, 24);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timer = setInterval(refresh, 2000);
    globalThis.__agyPowertools = {
      version,
      get status() {
        const expectedRings = (options.enabled && options.contextRing && state?.conversationId === currentId())
          ? [...document.querySelectorAll('[data-testid="model-selector-trigger"]')].filter(el => el.closest('.surface-composer-card')).length
          : 0;
        const actualRings = document.querySelectorAll('[data-testid="agy-context-ring-trigger"]').length;
        const managementExpected=document.querySelector('a[href="/customizations"]');
        const healthy=!disposed&&!renderError&&(!expectedRings||actualRings===expectedRings)&&(!managementExpected||!!document.querySelector('[data-testid="agy-management-trigger"]'));
        return {conversationId:state?.conversationId||'',mounted:[...roots.values()].filter(r=>r.kind==='ring'&&r.mount.isConnected).length,healthy,nativeComponents:true,error:renderError||undefined};
      },
      fork: adapter.fork,
      get settings() { return { ...options }; },
      get account() {return account;},
      get dashboard(){return dashboard;},
      dispose() {
        disposed = true; titleObserver?.disconnect(); if (typeof document.title === 'string') document.title = stripTitleBadge(document.title); closeFileContextMenu(); activeForkDialogCleanup?.(); signalController.abort(); stopOverviewNavigation?.(); stopResolvedNavigation?.(); observer.disconnect(); clearInterval(timer); clearTimeout(mountTimer); stateCache.clear();
        if (globalThis[menuName] === extendedMenu) globalThis[menuName] = originalMenu;
        for (const entry of roots.values()) { entry.root.unmount(); entry.mount.remove(); } roots.clear();
        restoreLabels(); localizer?.dispose(); panels?.dispose(); adapter.dispose?.(); densityStyle.remove(); document.documentElement.removeAttribute('data-agy-compact'); document.documentElement.removeAttribute('data-agy-keep-outline'); listeners.clear();
        for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('已断开')); } pending.clear();
        delete globalThis.__agyPowertools; delete globalThis.__agyPowertoolsReceive;
      }
    };
    mount(); void refresh();
  }
})();

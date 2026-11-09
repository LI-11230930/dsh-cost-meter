/**
 * dsh-cost-meter — 实时花费计量（browser half）
 *
 * 挂载点：官方 conversation.composer.dock slot（order 1）。
 *
 * 为什么是这个 slot：官方 dsh-client-ui-conversation 的 InputBar 里
 *   <div class="…dock">
 *     { renderSlot("conversation.composer.dock") }   // 官方 chat 的 token 用量 pill 注册于此，order 0
 *     { <ContextMeter/> }                            // 上下文占用 meter，紧随其后
 *   </div>
 * 因此注册 order > 0 即**精确落在「token 用量」与「上下文」中间**，
 * 与两者同排、视觉一体，且不改动官方任何文件。
 *
 * 样式与官方 pill 对齐：图标 + 数字，13px、tabular-nums、同色变量、
 * hover 用 interactive-bg-hover，圆角用 --dsw-radius-sm。
 */
window.__ModuleLoader__.load({
  id: "dsh-cost-meter",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");
    let react_dom = require("react-dom");
    let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    let jsxRuntime = require("react/jsx-runtime");

    const NS = "cost-meter";
    const zh = {
      "label": "花费",
      "title": "本次会话花费",
      "peak": "高峰",
      "off": "空闲",
      "now.peak": "当前为高峰时段",
      "now.off": "当前为空闲时段",
      "model": "模型",
      "samples": "采样",
      "unknown": "该模型不在价目表内，未计价（仅统计 token）",
      "reset": "重置本次会话",
      "reset.done": "已重置",
      "detail.peak": "高峰花费",
      "t.uncached": "未缓存输入",
      "t.cacheRead": "缓存读取",
      "t.cacheWrite": "缓存写入",
      "t.output": "输出",
      "t.total": "合计 tokens",
      "t.hitRate": "缓存命中",
      "detail.off": "空闲花费",
      "detail.tokens": "已计量 tokens",
      "detail.unknown": "未计价采样",
      "loading": "计算中…",
      "live": "本轮累计中",
      "rate": "均价",
      "error": "计量服务不可用",
      "perMillion": "元 / 百万 tokens",
      "perMillionUsd": "美元 / 百万 tokens",
      "rates": "当前峰谷单价",
      "byModel": "按模型",
      "unpriced": "未计价",
      "multiCurrency": "多币种",
    };
    const en = {
      "label": "Cost",
      "title": "Session cost",
      "peak": "Peak",
      "off": "Off-peak",
      "now.peak": "Currently peak hours",
      "now.off": "Currently off-peak",
      "model": "Model",
      "samples": "Samples",
      "unknown": "Model not in the price table; counted as tokens only",
      "reset": "Reset this session",
      "reset.done": "Reset",
      "detail.peak": "Peak cost",
      "t.uncached": "Uncached input",
      "t.cacheRead": "Cache read",
      "t.cacheWrite": "Cache write",
      "t.output": "Output",
      "t.total": "Total tokens",
      "t.hitRate": "Cache hit",
      "detail.off": "Off-peak cost",
      "detail.tokens": "Metered tokens",
      "detail.unknown": "Unbilled samples",
      "loading": "Calculating…",
      "live": "Accumulating",
      "rate": "Avg rate",
      "error": "Meter service unavailable",
      "perMillion": "CNY / 1M tokens",
      "perMillionUsd": "USD / 1M tokens",
      "rates": "Current rates",
      "byModel": "By model",
      "unpriced": "Unpriced",
      "multiCurrency": "Multi-currency",
    };

    /**
     * 币种符号。
     *
     * 注意：前端**不再维护价目表副本**。此前 client.js 里有一份 FALLBACK_PRICES，
     * 与 host 的 PRICES 各写一遍，一旦两边不同步就会出现「面板显示的价格与实际计价不符」，
     * 更早还因 rates 为 undefined 抛 TypeError 导致面板一点就消失。
     * 现在价目表只由 host 通过 /ds-cost/session、/ds-cost/pricing 下发（字段 pricing）。
     */
    const SYMBOL = { CNY: "¥", USD: "$" };
    const symbolOf = (c) => SYMBOL[c] ?? "¥";

    const STYLE_ID = "dsh-cost-meter-styles";
    const SHEET = [
      ".cmx-root{box-sizing:border-box;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));justify-content:center;display:inline-flex;align-items:center}",
      // 唯一负责定位的元素：固定定位、底部锚定、限制高度，保证任何窗口尺寸下都在视口内。
      ".cmx-anchor{position:fixed;z-index:1100;max-height:calc(100vh - 80px);overflow:auto;overscroll-behavior:contain}",
      ".cmx-pill{cursor:pointer;white-space:nowrap;background:0 0;border:0;border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);font-family:inherit;font-size:inherit;font-variant-numeric:tabular-nums;line-height:inherit;align-items:center;gap:5px;padding:1px 8px;display:inline-flex;outline:none}",
      ".cmx-pill:hover,.cmx-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".cmx-pill:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}",
      ".cmx-ico{width:14px;height:14px;flex:none;display:block}",
      ".cmx-val{color:var(--dsw-alias-label-primary);font-weight:500}",
      ".cmx-peak{color:var(--dsw-alias-state-warn-primary,#f5a524)}",
      ".cmx-panel{box-sizing:border-box;width:min(272px,100vw - 24px);border-radius:var(--dsw-radius-lg);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-1));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent,0 8px 24px rgba(0,0,0,.28));color:var(--dsw-alias-label-secondary);border:0;padding:12px;font-size:12px;line-height:20px;backdrop-filter:var(--dsw-menu-backdrop-filter)}",
      ".cmx-head{align-items:center;gap:6px;display:flex}",
      ".cmx-fig{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin-left:auto;font-weight:500}",
      ".cmx-sub{color:var(--dsw-alias-label-tertiary);font-size:11px}",
      ".cmx-rows{margin:6px 0 0}",
      ".cmx-row{justify-content:space-between;align-items:baseline;gap:12px;padding:2px 0;display:flex}",
      ".cmx-row dt{flex:1 1 auto;min-width:0}",
      ".cmx-row dd{flex:none;white-space:nowrap}",
      ".cmx-row dt{color:var(--dsw-alias-label-secondary);margin:0}",
      ".cmx-row dd{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);margin:0}",
      ".cmx-rule{border-top:1px solid var(--dsw-alias-border-l1);margin:8px 0 4px}",
      ".cmx-reset{cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-secondary);font-size:11px;padding:2px 8px;margin-top:8px}",
      ".cmx-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
      /* 实时累积中：数字旁的脉冲点，提示"还在涨" */
      ".cmx-live{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#30a46c);flex:none;animation:cmx-pulse 1.1s ease-in-out infinite}",
      "@keyframes cmx-pulse{0%,100%{opacity:.25;transform:scale(.85)}50%{opacity:1;transform:scale(1.15)}}",
      ".cmx-rate{color:var(--dsw-alias-label-tertiary);font-size:11px}",
      ".cmx-turn{margin-top:6px}",
    ].join("");

    /**
     * 面板开关状态放在模块级，而不是组件 state。
     *
     * 原因：dock 槽位的条目在宿主重渲染时可能被重建（inject 每次返回新对象），
     * 组件里的 useState 会随之丢失 —— 表现为"点一下没反应 / 面板刚出现就消失"。
     * 把 open/pos 提到组件外并用 useSyncExternalStore 订阅，重挂载也不会丢状态。
     */
    const uiStore = (() => {
      let state = { open: false, pos: null };
      const listeners = new Set();
      const emit = () => { for (const fn of listeners) { try { fn(); } catch { /* ignore */ } } };
      return {
        get: () => state,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        set(next) { state = { ...state, ...next }; emit(); },
        close() { if (state.open) { state = { ...state, open: false }; emit(); } },
      };
    })();

    function useUiState() {
      return react.useSyncExternalStore(uiStore.subscribe, uiStore.get, uiStore.get);
    }

    function ensureStyles() {
      if (typeof document === "undefined") return;
      if (document.getElementById(STYLE_ID) !== null) return;
      const tag = document.createElement("style");
      tag.id = STYLE_ID;
      tag.dataset.plugin = "dsh-cost-meter";
      tag.textContent = SHEET;
      document.head.appendChild(tag);
    }

    /** 金额格式化：小额多给位，大额两位。 */
    function money(v) {
      const n = Number(v) || 0;
      if (n === 0) return "0";
      if (n < 0.01) return n.toFixed(4);
      if (n < 1) return n.toFixed(3);
      return n.toFixed(2);
    }
    /** 带币种符号的金额。 */
    function moneyC(v, currency) {
      return symbolOf(currency) + " " + money(v);
    }
    /** token 紧凑显示。 */
    function compactTokens(v) {
      const n = Number(v) || 0;
      if (n < 1000) return String(n);
      if (n < 1e6) return (n / 1e3).toFixed(1) + "K";
      return (n / 1e6).toFixed(2) + "M";
    }

    function useCostData(sessionId, active, isRunning) {
      const [data, setData] = react.useState(null);
      const [failed, setFailed] = react.useState(false);
      // 实时链路：SSE 推送（host 每产生一笔 usage 立刻广播），
      // 无需轮询；SSE 不可用时退回 4s 轮询。
      react.useEffect(() => {
        if (!active || typeof sessionId !== "string" || sessionId === "") return void 0;
        let alive = true;
        let source = null;
        let timer = null;

        const pull = () => {
          fetch("/ds-cost/session?id=" + encodeURIComponent(sessionId), { cache: "no-store", headers: { accept: "application/json" } })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
            .then((j) => { if (alive) { setData(j); setFailed(false); } })
            .catch(() => { if (alive) setFailed(true); });
        };

        pull();
        try {
          source = new EventSource("/ds-cost/stream?id=" + encodeURIComponent(sessionId));
          source.addEventListener("cost", (ev) => {
            if (!alive) return;
            try {
              const j = JSON.parse(ev.data);
              setData(j);
              setFailed(false);
            } catch { /* ignore */ }
          });
          source.onerror = () => {
            // 断线由 EventSource 自动重连；同时用轮询兜底，保证数字不会长期停滞。
            if (timer === null) timer = window.setInterval(pull, 4000);
          };
        } catch {
          timer = window.setInterval(pull, 4000);
        }
        return () => {
          alive = false;
          if (source !== null) { try { source.close(); } catch { /* ignore */ } }
          if (timer !== null) window.clearInterval(timer);
        };
      }, [sessionId, active]);
      return { data, failed, stale: false };
    }

    const I = primitives;
    /** 计量图标：Sparkle 缺失时退回 Database，再退回空 span（防御未来改名）。 */
    const CostIcon = I.IconSparkle ?? I.IconDatabaseOutlineRegular ?? function Fallback(props) { return react.createElement("span", props); };

    function Panel(props) {
      const { data, sessionId, t, onClose } = props;
      const entry = data?.entry ?? {};
      // 面板自身计算金额：此前误用了 CostPill 作用域里的 cost（未定义），
      // 点击展开时抛 ReferenceError，被槽位 ErrorBoundary 捕获后把整个 pill 卸载。
      const cost = Number(entry.cost) || 0;
      const currency = entry.currency || "CNY";

      // ---- 多币种：各币种独立展示，绝不相加 ----
      const byCurrency = entry.costByCurrency ?? {};
      const currencies = Object.keys(byCurrency).filter((c) => (byCurrency[c]?.samples ?? 0) > 0);
      const multi = currencies.length > 1;

      // ---- 按模型分组 ----
      const byModel = entry.byModel ?? {};
      const modelRows = Object.keys(byModel)
        .map((k) => ({ key: k, ...byModel[k] }))
        .filter((r) => (r.samples ?? 0) > 0)
        .sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));

      // 金额部分：单币种时沿用峰谷两栏；多币种时逐币种列出。
      const rows = [];
      if (multi) {
        for (const c of currencies) {
          const s = byCurrency[c] ?? {};
          rows.push([c === "USD" ? "USD" : "CNY", moneyC(s.cost, c)]);
        }
      } else {
        rows.push([t("detail.peak"), moneyC(entry.costPeak, currency)]);
        rows.push([t("detail.off"), moneyC(entry.costOff, currency)]);
      }
      if ((entry.unknownSamples ?? 0) > 0) rows.push([t("detail.unknown"), String(entry.unknownSamples)]);

      // token 明细：与官方「Token 用量」面板同一套数字、同一套口径。
      const tk = entry.tokens ?? {};
      const uIn = tk.uncachedInputTokens ?? 0;
      const cR = tk.cacheReadTokens ?? 0;
      const cW = tk.cacheWriteTokens ?? 0;
      const out = tk.outputTokens ?? 0;
      const totalTok = uIn + cR + cW + out;
      // 官方口径的缓存命中率：缓存读取 / (缓存读取 + 未缓存输入)
      const hitBase = cR + uIn;
      const tokenRows = [
        [t("t.hitRate"), hitBase > 0 ? Math.round(cR / hitBase * 100) + "%" : "—"],
        [t("t.uncached"), uIn.toLocaleString("en-US") + " tok"],
        [t("t.cacheRead"), cR.toLocaleString("en-US") + " tok"],
      ];
      if (cW > 0) tokenRows.push([t("t.cacheWrite"), cW.toLocaleString("en-US") + " tok"]);
      tokenRows.push([t("t.output"), out.toLocaleString("en-US") + " tok"]);
      if (totalTok > 0) tokenRows.push([t("t.total"), totalTok.toLocaleString("en-US") + " tok"]);
      if (totalTok > 0 && cost > 0) tokenRows.push([t("rate"), moneyC(cost / totalTok * 1e6, currency) + " / 1M"]);

      const rowList = (items, prefix) => jsxRuntime.jsx("dl", {
        className: "cmx-rows",
        children: items.map(([k, v], i) =>
          jsxRuntime.jsxs("div", { className: "cmx-row", children: [
            react.createElement("dt", { key: "k" }, k),
            react.createElement("dd", { key: "v" }, v),
          ] }, prefix + i)
        ),
      });

      return jsxRuntime.jsxs("div", {
        className: "cmx-panel",
        role: "dialog",
        children: [
          jsxRuntime.jsxs("div", { className: "cmx-head", children: [
            react.createElement(CostIcon, { className: "cmx-ico" }),
            react.createElement("span", { children: t("title") }),
            jsxRuntime.jsx("span", { className: "cmx-fig", children: moneyC(entry.cost, currency) }),
          ]}),
          jsxRuntime.jsx("div", { className: "cmx-sub", children: (data?.inPeak === true ? t("now.peak") : t("now.off")) + (data?.live === true ? " · " + t("live") : "") }),
          jsxRuntime.jsx("div", { className: "cmx-rule" }),
          // 每行包一层 div.cmx-row：CSS 的 .cmx-row 是 flex 左右分布，
          // 此前把 dt/dd 平铺成兄弟节点，导致标签与数值各占一行、面板被撑高一倍。
          rowList(rows, "r"),

          // ---- 按模型分行（同会话换模型时各自独立显示）----
          modelRows.length > 1 ? jsxRuntime.jsxs(react.Fragment, { children: [
            jsxRuntime.jsx("div", { className: "cmx-rule" }),
            jsxRuntime.jsx("div", { className: "cmx-sub", children: t("byModel") }),
            jsxRuntime.jsx("dl", {
              className: "cmx-rows",
              children: modelRows.map((r, i) => jsxRuntime.jsxs("div", { className: "cmx-row", children: [
                react.createElement("dt", { key: "k", title: r.key },
                  (r.label || r.key) + (r.priced === false ? " · " + t("unpriced") : "")),
                react.createElement("dd", { key: "v" },
                  (r.priced === false ? "—" : moneyC(r.cost, r.currency)) + "  " + compactTokens(r.tokens)),
              ] }, "m" + i)),
            }),
          ]}) : null,

          tokenRows.length > 0 ? jsxRuntime.jsxs(react.Fragment, { children: [
            jsxRuntime.jsx("div", { className: "cmx-rule" }),
            rowList(tokenRows, "tk"),
          ]}) : null,

          // ---- 单价：按模型展示其峰/谷价 ----
          modelRows.filter((r) => r.priced !== false).slice(0, 4).map((r, i) => {
            const rp = rateOf(r.key, data?.pricing);
            if (rp === null) return null;
            return jsxRuntime.jsxs(react.Fragment, { children: [
              jsxRuntime.jsx("div", { className: "cmx-rule" }),
              jsxRuntime.jsx("div", { className: "cmx-sub", children: t("rates") + " · " + (r.label || r.key) }),
              rowList([
                [t("peak") + " ↑ / ↓ / out", rp.peak.input + " / " + rp.peak.cacheRead + " / " + rp.peak.output],
                [t("off") + " ↑ / ↓ / out", rp.off.input + " / " + rp.off.cacheRead + " / " + rp.off.output],
              ], "p" + i),
              jsxRuntime.jsx("div", { className: "cmx-sub", children: r.currency === "USD" ? t("perMillionUsd") : t("perMillion") }),
            ]}, "pr" + i);
          }),

          modelRows.length === 1 && modelRows[0].priced === false
            ? jsxRuntime.jsx("div", { className: "cmx-sub", children: t("unknown") }) : null,

          react.createElement("button", {
            type: "button",
            className: "cmx-reset",
            onClick: () => {
              fetch("/ds-cost/reset?id=" + encodeURIComponent(sessionId), { method: "POST" })
                .then(() => { onClose(); })
                .catch(() => {});
            },
          }, t("reset")),
        ].filter(Boolean),
      });
    }

    /**
     * 从 host 下发的 pricing 表里取出某模型的现行单价（用于面板展示）。
     * @returns {{peak:object, off:object} | null}
     */
    function rateOf(modelKey, pricing) {
      if (!pricing || !Array.isArray(pricing.vendors)) return null;
      for (const v of pricing.vendors) {
        for (const m of v.models ?? []) {
          if (m.id !== modelKey) continue;
          // 分档模型：展示第一档（标准档）价格
          if (Array.isArray(m.tiers) && m.tiers.length > 0) {
            const t0 = m.tiers[0];
            return { peak: t0, off: t0 };
          }
          const peak = m.peak ?? m.off;
          const off = m.off ?? m.peak;
          if (!peak || !off) return null;
          return { peak, off };
        }
      }
      return null;
    }

    /**
     * 面板错误边界：面板内部的任何渲染错误都不应连累 pill 本身。
     * 槽位级的 ErrorBoundary 会把"本条目的整棵子树"卸载，所以面板需要自己的边界。
     */
    class PanelBoundary extends react.Component {
      constructor(props) { super(props); this.state = { failed: false }; }
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidCatch() { try { this.props.onError?.(); } catch { /* ignore */ } }
      render() { return this.state.failed ? null : this.props.children; }
    }

    /** 状态栏中间的花费 pill。 */
    function CostPill(props) {
      ensureStyles();
      // 注意：slot 注入的 props 里确实含 sessionId 与 t（实测确认），
      // 但早期渲染/极端时序下可能尚未就绪，故一律做防御性取值，
      // 避免整个 dock 槽位因一次读取失败而崩溃。
      const p = props || {};
      const sessionId = typeof p.sessionId === "string" ? p.sessionId : "";
      const t = typeof p.t === "function" ? p.t : (k) => k;
      // 官方会话 hook：running=true 表示本轮正在流式输出（此时花费正在累积）。
      const running = typeof p.useSession === "function" ? p.useSession((st) => st.running) : false;
      const { data, failed } = useCostData(sessionId, sessionId !== "", running === true);
      const ui = useUiState();
      const open = ui.open;
      const pos = ui.pos;
      const rootRef = react.useRef(null);
      const panelRef = react.useRef(null);
      const setOpen = (v) => { if (v) uiStore.set({ open: true }); else uiStore.close(); };

      // 点击外部关闭
      react.useEffect(() => {
        if (!open) return void 0;
        const onDown = (e) => {
          const root = rootRef.current;
          const panel = panelRef.current;
          if (root !== null && root.contains(e.target)) return;
          if (panel !== null && panel.contains(e.target)) return;
          uiStore.close();
        };
        document.addEventListener("mousedown", onDown, true);
        return () => document.removeEventListener("mousedown", onDown, true);
      }, [open]);

      // 面板定位（与官方弹层一致：贴 pill 上方）
      react.useEffect(() => {
        if (!open) return void 0;
        const place = () => {
          const root = rootRef.current;
          if (root === null) return;
          const r = root.getBoundingClientRect();
          uiStore.set({ pos: { left: Math.max(8, Math.min(r.left, window.innerWidth - 288)), bottom: Math.max(8, window.innerHeight - r.top + 8) } });
        };
        place();
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return () => {
          window.removeEventListener("resize", place);
          window.removeEventListener("scroll", place, true);
        };
      }, [open]);

      if (failed) return null;
      const entry = data?.entry;
      const cost = entry?.cost ?? 0;
      const has = (entry?.samples ?? 0) > 0;
      // 实时：本轮运行中即使还没有新采样，也显示"仍在累积"的脉冲点。
      // 【0.2.1 适配】0.2.1 的 slot 标准 props 不再提供 useSession
      // （uiSession.provide 只声明 hooks: ["conversation","input"]，
      //  props: ["inputActions"]），导致上面的 running 恒为 false、绿点消失。
      // host 侧已在 payload 里给出权威的 live 字段（turn/start→true，
      // turn/end→false），优先用它；useSession 仍在时作为回退。
      const serverLive = data?.live === true;
      const live = has && (serverLive || running === true);
      const label = has ? "¥ " + money(cost) : t("loading");
      const aria = t("title") + (has ? ": ¥ " + money(cost) : "") + (live ? " — " + t("live") : "");

      return jsxRuntime.jsxs("span", {
        ref: rootRef,
        className: "cmx-root",
        children: [
          jsxRuntime.jsxs("button", {
            type: "button",
            className: "cmx-pill",
            "aria-haspopup": "dialog",
            "aria-expanded": open,
            "aria-label": aria,
            title: aria,
            onClick: () => {
              // 打开前同步算好位置，避免依赖 effect 里的 setPos 造成的竞态
              // （面板此前要等 pos 就绪才渲染，窗口期内可能"看不到面板"）。
              const next = !open;
              let nextPos = pos;
              if (next) {
                try {
                  const r = rootRef.current?.getBoundingClientRect();
                  if (r) {
                    // 水平夹紧到视口内；垂直用 bottom 锚定（面板自下向上生长），
                    // 配合 .cmx-anchor 的 max-height，任何窗口都不会跑出屏幕。
                    const width = 288;
                    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
                    const bottom = Math.max(8, window.innerHeight - r.top + 8);
                    nextPos = { left, bottom };
                  }
                } catch { /* ignore */ }
              }
              uiStore.set({ open: next, pos: nextPos });
            },
            children: [
              jsxRuntime.jsx(CostIcon, { className: "cmx-ico" }),
              jsxRuntime.jsx("span", { className: "cmx-val cmx-peak", children: label }),
              live ? jsxRuntime.jsx("span", { className: "cmx-live", title: t("live") }) : null,
            ].filter(Boolean),
          }),
          open ? react_dom.createPortal(
            jsxRuntime.jsx(PanelBoundary, {
              onError: () => setOpen(false),
              children: jsxRuntime.jsx("div", {
                ref: panelRef,
                className: "cmx-anchor",
                style: pos === null
                  ? { left: "8px", bottom: "8px" }
                  : { left: pos.left + "px", bottom: pos.bottom + "px" },
                children: jsxRuntime.jsx(Panel, { data, sessionId, t, onClose: () => setOpen(false) }),
              }),
            }),
            document.body,
          ) : null,
        ],
      });
    }

    const inject = ["slots", "locale"];
    function apply(ctx) {
      ensureStyles();
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "cost-meter: dictionaries");
      const t = ctx.locale.bind(NS);
      // order 1：官方 token 用量 pill 是 order 0，上下文 meter 是它的下一个兄弟节点，
      // 因此 order 1 恰好插在两者中间。
      //
      // 重要：slot 自身注入的是 {keyboard, addFiles, hooks…}，**不含 sessionId**。
      // 必须在本条目自己的 inject(sessionId) 里把 sessionId 传下去，否则组件拿不到，
      // 会在读取 sessionId 时抛错并让整个 dock 槽位崩溃（实测
      // "Cannot read properties of undefined (reading 'sessionId')"）。
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "cost-meter",
            order: 1,
            locale: NS,
            // 防御：sessionId 来自 scope binding 的 key；绑定尚未就绪时
            // 该参数为 undefined，这里一律归一化为字符串，避免下游读取崩溃。
            inject: (sessionId) => ({ sessionId: typeof sessionId === "string" ? sessionId : "" }),
          },
          CostPill,
        ),
      );
    }

    module.exports = { inject, apply, name: "dsh-cost-meter-client", t: undefined };
    return module.exports;
  },
});

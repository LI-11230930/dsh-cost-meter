/**
 * dsh-cost-meter — 实时花费计量（host half）
 *
 * 目标：在官方「对话框下方状态栏」中间（token 用量 pill 与上下文 meter 之间）
 * 显示本次会话的花费金额（元），并按 DeepSeek 峰谷时段分别计价。
 *
 * 设计要点（经真实会话日志逐位比对官方统计后确定）：
 *
 * 1. 与官方 tokenMeter 完全相同的折叠算法
 *    官方 tokenUsage 投影使用 addReplacing + retry 去重 + 同 (turn,step) 唯一：
 *      - llm/retry-started 关闭替换槽（同一 turn/step 重试时旧样本被替换）；
 *      - 同一 (turn,step) 只保留最后一个样本，完全相同则跳过；
 *      - assistant/message 取 data.usage；assistant/attempt 取 stream 里最后一个 usage chunk。
 *    本插件复刻同一套规则，因此展示的 token 数与官方「Token 用量」面板**逐位一致**
 *    （已用真实日志验证：2,788,523 / 297,932,544 / 1,055,506 = 301,776,573 完全吻合）。
 *
 * 2. 逐采样定价（不是总数 × 单一单价）
 *    每个采样用**该事件自身时间戳**判定高峰/空闲，用当时生效的模型取单价，
 *    因此跨时段/跨模型的会话可被精确拆分到高峰与空闲两栏。
 *
 * 3. 冷启动以磁盘日志为准
 *    DSH 重启后 session/event 不会重放历史，因此首次访问时从磁盘会话日志
 *    （多帧 zstd）完整重建（含模型跟踪），记录 baselineSeq；此后只有 seq 更大的
 *    实时事件才累加，既不会丢历史，也不会重复计数。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

export const name = "cost-meter";

/** 官价目表（元 / 百万 tokens）——与 dsh-offpeak 保持一致。 */
export const PRICES = {
  flash: {
    label: "DeepSeek V4.1 Flash",
    peak: { input: 2, output: 8, cacheRead: 0.04 },
    off: { input: 1, output: 4, cacheRead: 0.02 },
  },
  pro: {
    label: "DeepSeek V4 Pro",
    peak: { input: 9, output: 27, cacheRead: 0.3 },
    off: { input: 4.5, output: 13.5, cacheRead: 0.15 },
  },
};

/** 高峰窗口（分钟，含起点不含终点）。 */
const PEAK_WINDOWS = [
  { start: 9 * 60, end: 12 * 60 },
  { start: 14 * 60, end: 18 * 60 },
];

/** 中国法定节假日（与 dsh-offpeak 同表）。 */
const CN_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19", "2026-02-20",
  "2026-04-06",
  "2026-05-01", "2026-05-04", "2026-05-05",
  "2026-06-19",
  "2026-09-25",
  "2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07",
]);

function isHoliday(date) {
  return CN_HOLIDAYS.has(date);
}

/** 北京时间分解。 */
function beijingAt(ms) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return {
    date: p.year + "-" + p.month + "-" + p.day,
    minutes: hour * 60 + Number(p.minute),
  };
}

/** 是否高峰：周一至周五、非法定节假日，且落在高峰窗口内。 */
function isPeak(minutes, date) {
  if (isHoliday(date)) return false;
  const wd = new Date(date + "T00:00:00Z").getUTCDay();
  if (wd === 0 || wd === 6) return false;
  return PEAK_WINDOWS.some((w) => minutes >= w.start && minutes < w.end);
}

/** 模型归类：flash / pro / unknown。 */
function kindOf(model) {
  const m = String(model || "").toLowerCase();
  if (m.length === 0) return "unknown";
  if (/v4[-.]?pro|deepseek-pro|pro$/.test(m)) return "pro";
  if (/flash/.test(m)) return "flash";
  return "unknown";
}

/** 按采样计算花费（元）。cacheWrite 按「缓存未命中」输入价计（官方无单独写入价）。 */
function costOf(kind, peak, u) {
  if (kind === "unknown") return 0;
  const r = PRICES[kind][peak ? "peak" : "off"];
  const miss = (u.uncachedInputTokens || 0) + (u.cacheWriteTokens || 0);
  return (
    (miss / 1e6) * r.input +
    ((u.cacheReadTokens || 0) / 1e6) * r.cacheRead +
    ((u.outputTokens || 0) / 1e6) * r.output
  );
}

//#region 官方 token 折叠原语（逐条复刻 @deepseek-ai/dsh-token-meter）
const zeroBuckets = () => ({ uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

const bucketsFrom = (usage) => ({
  uncachedInputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheReadTokens: usage.cacheReadTokens ?? 0,
  cacheWriteTokens: usage.cacheWriteTokens ?? 0,
});

const bucketsEqual = (a, b) =>
  a.uncachedInputTokens === b.uncachedInputTokens &&
  a.outputTokens === b.outputTokens &&
  a.cacheReadTokens === b.cacheReadTokens &&
  a.cacheWriteTokens === b.cacheWriteTokens;

const addReplacing = (totals, previous, next) => ({
  uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
  outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
  cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
  cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
});

/** 取 stream 里最后一个 usage chunk 的 usage。 */
function lastAssistantStreamChunkUsage(stream) {
  if (!Array.isArray(stream)) return undefined;
  for (let i = stream.length - 1; i >= 0; i -= 1) {
    const c = stream[i];
    if (c !== null && typeof c === "object" && c.chunk?.type === "usage" && c.chunk.usage !== undefined) return c.chunk.usage;
  }
  return undefined;
}

/** 一次 Assistant 落定所上报的 usage（与官方 usageOf 一致）。 */
function usageOf(event) {
  if (event.type === "assistant/message" && event.data?.usage !== undefined) return event.data.usage;
  if (event.type !== "assistant/message" && event.type !== "assistant/attempt") return undefined;
  return lastAssistantStreamChunkUsage(event.data?.stream);
}
//#endregion

/** 空的会话累计。 */
function emptyEntry() {
  return {
    cost: 0, costPeak: 0, costOff: 0,
    tokens: zeroBuckets(),
    tokensPeak: 0, tokensOff: 0,
    samples: 0, unknownSamples: 0, lastAt: 0,
    model: "", provider: "", baselineSeq: 0,
    last: null, openTurn: false,
  };
}

/**
 * 折叠一个事件到会话状态（重建与实时共用同一实现）。
 * @returns 是否有变化
 */
function foldEvent(state, event) {
  if (event === null || typeof event !== "object") return false;

  // 轮次边界：仅用于"本轮累计中"指示，不参与计价。
  if (event.type === "turn/start") { state.openTurn = true; return true; }
  if (event.type === "turn/end") { state.openTurn = false; return true; }

  // 模型跟踪
  if (event.type === "model/selection" || event.type === "request/context") {
    const d = event.data || {};
    if (typeof d.model === "string" && d.model !== "") {
      state.model = d.model;
      state.provider = typeof d.provider === "string" ? d.provider : state.provider;
      return true;
    }
    return false;
  }

  // retry：关闭替换槽（与官方一致）
  if (event.type === "llm/retry-started") {
    if (state.last !== null && state.last !== undefined && state.last.turn === event.data?.turn && state.last.step === event.data?.step) {
      state.last = null;
      return true;
    }
    return false;
  }

  if (event.type !== "assistant/message" && event.type !== "assistant/attempt") return false;
  const sample = usageOf(event);
  if (sample === undefined || sample === null || typeof sample !== "object") return false;

  const turn = event.data?.turn;
  const step = event.data?.step;
  const buckets = bucketsFrom(sample);

  const prev = state.last !== null && state.last !== undefined && state.last.turn === turn && state.last.step === step
    ? state.last
    : undefined;
  // 同一 (turn,step) 的相同样本视为重复，跳过（官方行为）
  if (prev !== undefined && bucketsEqual(prev.buckets, buckets)) return false;

  const kind = kindOf(state.model);
  const at = typeof event.time === "number" && Number.isFinite(event.time) && event.time > 1e12 ? event.time : 0;
  const bj = at !== 0 ? beijingAt(at) : null;
  const peak = bj !== null ? isPeak(bj.minutes, bj.date) : false;
  const cost = at !== 0 ? costOf(kind, peak, buckets) : 0;

  // 官方累计（用于与官方面板逐位对齐）
  state.tokens = addReplacing(state.tokens, prev?.buckets, buckets);

  // 峰谷分栏：先回滚被替换的旧样本，再加入新样本
  const tokenTotal = buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens;
  if (prev !== undefined) {
    const pTotal = prev.tokenTotal ?? 0;
    const pCost = prev.cost ?? 0;
    // 回滚旧样本：cost 与所在分栏必须同步回滚，否则替换会让总额漂移。
    state.cost -= pCost;
    if (prev.peak) { state.tokensPeak -= pTotal; state.costPeak -= pCost; }
    else { state.tokensOff -= pTotal; state.costOff -= pCost; }
    state.samples -= 1;
    if (prev.unknown) state.unknownSamples -= 1;
  }
  state.cost += cost;
  if (peak) { state.tokensPeak += tokenTotal; state.costPeak += cost; }
  else { state.tokensOff += tokenTotal; state.costOff += cost; }
  state.samples += 1;
  if (kind === "unknown") state.unknownSamples += 1;

  state.last = { turn, step, buckets, cost, peak, tokenTotal, unknown: kind === "unknown" };
  if (at !== 0 && at > state.lastAt) state.lastAt = at;
  return true;
}

export function apply(ctx, config = {}) {
  // 存储位置：home 级。会话日志本身就在 <home>/sessions 下、跨 profile 共享，
  // 因此以 sessionId 为键的花费累计放 home 级才正确；此前按 argv 猜 profile，
  // 在 Electron 下退化成 "web"，把文件写到了 profiles/web/。
  const home = typeof process !== "undefined" && process.env.DSH_HOME ? process.env.DSH_HOME : join(homedir(), ".dsh");
  const file = join(home, "cost-meter.json");

  /** sessionId -> 折叠状态 */
  let state = { unit: { name: "cost-meter", version: 2 }, sessions: {} };
  /** sessionId -> 是否已完成磁盘全量重建 */
  const rebuilt = new Set();
  /** sessionId -> 是否处于未闭合轮次 */
  const openTurns = new Map();

  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && parsed.sessions && typeof parsed.sessions === "object") {
        // 旧记录缺 baselineSeq：不信任其累计，丢弃让重建重算。
        for (const [k, v] of Object.entries(parsed.sessions)) {
          if (v && typeof v === "object" && typeof v.baselineSeq === "number") state.sessions[k] = v;
        }
      }
    }
  } catch { /* 损坏则从零开始 */ }

  let saveTimer = null;
  const save = () => {
    if (saveTimer !== null) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
      } catch { /* 忽略写盘失败 */ }
    }, 400);
  };

  const entryOf = (id) => {
    if (state.sessions[id] === undefined) state.sessions[id] = emptyEntry();
    const e = state.sessions[id];
    if (e.last === undefined) e.last = null;
    return e;
  };

  // ---- 实时推送（SSE）----
  const streams = new Map();
  const payloadOf = (id) => {
    const bj = beijingAt(Date.now());
    return JSON.stringify({
      sessionId: id,
      entry: state.sessions[id] ?? emptyEntry(),
      prices: PRICES,
      inPeak: isPeak(bj.minutes, bj.date),
      live: openTurns.get(id) === true,
      serverTime: Date.now(),
    });
  };
  function broadcast(id) {
    const set = streams.get(id);
    if (set === undefined || set.size === 0) return;
    const data = "event: cost\ndata: " + payloadOf(id) + "\n\n";
    for (const res of set) {
      try { res.write(data); } catch { /* 连接已断，忽略 */ }
    }
  }

  // ---- 冷启动重建：以磁盘会话日志为准 ----
  /** 读取多帧 zstd 的会话日志（每帧含若干行 JSON）。 */
  function readSessionEvents(id) {
    const sessionsRoot = join(home, "sessions");
    if (!existsSync(sessionsRoot)) return null;
    let dir = null;
    for (const project of readdirSync(sessionsRoot)) {
      const candidate = join(sessionsRoot, project, id);
      if (existsSync(candidate)) { dir = candidate; break; }
    }
    if (dir === null) return null;
    let logFile = null;
    for (const f of readdirSync(dir)) if (f.endsWith(".zstd")) { logFile = join(dir, f); break; }
    if (logFile === null) return null;

    const buf = readFileSync(logFile);
    const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
    const starts = [];
    let at = 0;
    while ((at = buf.indexOf(MAGIC, at)) !== -1) { starts.push(at); at += 4; }
    const events = [];
    for (let n = 0; n < starts.length; n += 1) {
      const from = starts[n];
      const to = n + 1 < starts.length ? starts[n + 1] : buf.length;
      let text = "";
      try { text = zstdDecompressSync(buf.subarray(from, to)).toString("utf8"); } catch { continue; }
      for (const line of text.split("\n")) {
        if (line === "") continue;
        let rec = null;
        try { rec = JSON.parse(line); } catch { continue; }
        if (rec !== null && typeof rec === "object") events.push(rec);
      }
    }
    return events;
  }

  /** 从磁盘完整重建一个会话（含模型跟踪），并记录 baselineSeq。 */
  function rebuild(id) {
    if (id === "" || rebuilt.has(id)) return false;
    const events = readSessionEvents(id);
    if (events === null || events.length === 0) return false;
    rebuilt.add(id);

    const fresh = emptyEntry();
    let maxSeq = 0;
    for (const e of events) {
      foldEvent(fresh, e);
      if (typeof e.seq === "number" && e.seq > maxSeq) maxSeq = e.seq;
    }
    fresh.baselineSeq = maxSeq;
    state.sessions[id] = fresh;
    openTurns.set(id, fresh.openTurn === true);
    save();
    broadcast(id);
    return true;
  }

  // ---- 会话事件：实时增量（只处理 baselineSeq 之后的事件）----
  ctx.on("session/event", (session, event) => {
    if (event === null || typeof event !== "object") return;
    const id = typeof session?.id === "string" ? session.id : "";
    if (id === "") return;
    // 尚未重建的会话先补齐历史，避免只统计到一半。
    if (!rebuilt.has(id)) rebuild(id);

    const entry = entryOf(id);
    const seq = typeof event.seq === "number" ? event.seq : 0;
    // 已被磁盘重建涵盖的事件不再重复累加。
    if (seq !== 0 && seq <= (entry.baselineSeq ?? 0)) return;
    if (seq !== 0) entry.baselineSeq = seq;

    const changed = foldEvent(entry, event);
    if (changed) {
      if (event.type === "turn/start") openTurns.set(id, true);
      else if (event.type === "turn/end") openTurns.set(id, false);
      save();
      broadcast(id);
    }
  });

  // ---- HTTP 路由：浏览器半边读取 ----
  ctx.inject(["webServer"], (webCtx) => {
    const route = (p, handler) => {
      webCtx.effect(
        () => webCtx.webServer.register({ kind: "exact", path: p, handler }),
        "cost-meter: route " + p,
      );
    };
    const json = (res, code, body) => {
      res.writeHead(code, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(body));
    };

    route("/ds-cost/state", (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
      const now = beijingAt(Date.now());
      json(res, 200, {
        prices: PRICES,
        inPeak: isPeak(now.minutes, now.date),
        peakWindows: PEAK_WINDOWS.map((w) => ({ start: w.start, end: w.end })),
        sessions: state.sessions,
        serverTime: Date.now(),
      });
    });

    route("/ds-cost/session", (req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { Allow: "GET, HEAD" }); res.end(); return; }
      let id = "";
      try { id = new URL(req.url ?? "/", "http://localhost").searchParams.get("id") ?? ""; } catch { /* ignore */ }
      // 冷启动：总是确保已从磁盘重建（历史 + 模型），再用实时增量补齐。
      if (id !== "") rebuild(id);
      const now = beijingAt(Date.now());
      json(res, 200, {
        sessionId: id,
        entry: state.sessions[id] ?? emptyEntry(),
        prices: PRICES,
        inPeak: isPeak(now.minutes, now.date),
        live: openTurns.get(id) === true,
        serverTime: Date.now(),
      });
    });

    // SSE：会话进行中实时推送花费变化（无需轮询）。
    route("/ds-cost/stream", (req, res) => {
      if (req.method !== "GET") { res.writeHead(405, { Allow: "GET" }); res.end(); return; }
      let id = "";
      try { id = new URL(req.url ?? "/", "http://localhost").searchParams.get("id") ?? ""; } catch { /* ignore */ }
      if (id === "") { res.writeHead(400); res.end(); return; }
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-store, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      rebuild(id);
      const set = streams.get(id) ?? new Set();
      set.add(res);
      streams.set(id, set);
      try { res.write("event: cost\ndata: " + payloadOf(id) + "\n\n"); } catch { /* ignore */ }
      const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* ignore */ } }, 25000);
      const done = () => {
        clearInterval(ping);
        const cur = streams.get(id);
        if (cur !== undefined) { cur.delete(res); if (cur.size === 0) streams.delete(id); }
      };
      req.on("close", done);
      req.on("error", done);
      res.on("close", done);
    });

    route("/ds-cost/reset", (req, res) => {
      if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }); res.end(); return; }
      let id = "";
      try { id = new URL(req.url ?? "/", "http://localhost").searchParams.get("id") ?? ""; } catch { /* ignore */ }
      if (id !== "") delete state.sessions[id];
      save();
      broadcast(id);
      json(res, 200, { ok: true, sessionId: id });
    });
  });
}

export { beijingAt, isPeak, kindOf, costOf, CN_HOLIDAYS, PEAK_WINDOWS, usageOf, bucketsFrom, addReplacing, foldEvent, emptyEntry };

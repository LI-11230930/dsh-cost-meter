/**
 * dsh-cost-meter 计价自测（无需 DSH 运行时，纯 node 执行）。
 *
 * 覆盖：
 *   1. 模型名归一化与匹配（provider 前缀、大小写、别名）
 *   2. 峰谷计价
 *   3. 分档计价
 *   4. **同一会话切换模型 → 分别计费**（本次改动的核心需求）
 *   5. 重试替换不导致金额漂移
 *   6. 多币种不相加
 *
 * 运行：node test/pricing.test.mjs
 */
import { PRICING, priceSample, resolveModel, isIgnoredModel } from "../src/pricing.js";
import { foldEvent, emptyEntry } from "../src/index.js";

let pass = 0, fail = 0;
const EPS = 1e-9;

function eq(actual, expected, label) {
  const ok = Math.abs(actual - expected) < EPS;
  if (ok) { pass += 1; }
  else { fail += 1; console.log("  FAIL  " + label + "  实际=" + actual + " 期望=" + expected); }
}
function is(actual, expected, label) {
  if (actual === expected) pass += 1;
  else { fail += 1; console.log("  FAIL  " + label + "  实际=" + JSON.stringify(actual) + " 期望=" + JSON.stringify(expected)); }
}

// ---------- 1. 模型匹配 ----------
console.log("[1] 模型名匹配");
is(resolveModel("deepseek-v4.1-flash")?.model.id, "deepseek-v4.1-flash", "纯名");
is(resolveModel("auto/deepseek-v4.1-flash")?.model.id, "deepseek-v4.1-flash", "带 provider 前缀");
is(resolveModel("DeepSeek-V4.1-Flash")?.model.id, "deepseek-v4.1-flash", "大小写 + 连字符");
is(resolveModel("deepseek-flash")?.model.id, "deepseek-v4.1-flash", "已退役别名归入 Flash");
is(resolveModel("jet-hub-buddy/deepseek-v4.1-flash")?.model.id, "deepseek-v4.1-flash", "workbuddy 前缀");
is(resolveModel("space-bunny"), null, "space-bunny 不计价（MiniMax 灰测模型，已弃用）");
is(resolveModel("lmodel", "qodercn"), null, "lmodel/QoDuck 不计价（免费渠道代号，无官方价）");
is(resolveModel("auto/deepseek-v4.1-flash-sg", "magpie"), null, "新加坡变体不计价（保守不猜）");
is(resolveModel(""), null, "空串返回 null");

// ---------- 1b. 渠道代号 → 官方标准价（渠道免费/打折一律不管）----------
console.log("[1b] 渠道代号按官方标准价计价");
// hy4free 是 CodeBuddy 的免费渠道，但按用户要求按混元4官方标准价计。
is(resolveModel("hy4free", "jet-hub-buddy")?.model.id, "hy4", "hy4free → 混元 Hy4");
is(resolveModel("hy4free", "workbuddy")?.model.id, "hy4", "workbuddy 下 hy4free → Hy4");
is(resolveModel("hy4std", "jet-hub-buddy")?.model.id, "hy4", "hy4std → Hy4");
eq(resolveModel("hy4")?.model.off.input, 6, "Hy4 标准输入价 6（不是限时 5 折的 3）");
eq(resolveModel("hy4")?.model.off.output, 18, "Hy4 标准输出价 18");
eq(resolveModel("hy4")?.model.off.cacheRead, 0.3, "Hy4 缓存命中价 0.3");
// step-5-preview 走 jmodel 代号
is(resolveModel("step-5-preview", "buddy")?.model.id, "step-5-preview", "step-5-preview 直接命中");
is(resolveModel("jmodel", "qodercn")?.model.id, "step-5-preview", "jmodel → Step 5 Preview");
eq(resolveModel("step-5-preview")?.model.off.input, 7, "Step 5 Preview 输入价 7");
eq(resolveModel("step-5-preview")?.model.off.output, 20, "Step 5 Preview 输出价 20");
eq(resolveModel("step-5-preview")?.model.off.cacheRead, 0.7, "Step 5 Preview 缓存命中 0.7");

// ---------- 2. 峰谷计价 ----------
console.log("[2] 峰谷计价（DeepSeek Flash）");
const flash = resolveModel("deepseek-v4.1-flash");
const oneMInput = { uncachedInputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
const oneMOutput = { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1_000_000 };
eq(priceSample(flash, true, oneMInput).amount, 2, "高峰 1M 输入 = 2");
eq(priceSample(flash, false, oneMInput).amount, 1, "空闲 1M 输入 = 1");
eq(priceSample(flash, true, oneMOutput).amount, 8, "高峰 1M 输出 = 8");
eq(priceSample(flash, false, oneMOutput).amount, 4, "空闲 1M 输出 = 4");

// ---------- 3. 分档计价 ----------
console.log("[3] 分档计价（MiniMax M3）");
const m3 = resolveModel("minimax-m3");
const small = { uncachedInputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
const big = { uncachedInputTokens: 600_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };
eq(priceSample(m3, false, small).amount, 2.1 * 0.1, "≤512k 档");
eq(priceSample(m3, false, big).amount, 4.2 * 0.6, ">512k 档");

// ---------- 4. 同一会话切换模型 ----------
console.log("[4] 同会话切换模型分别计费");
const st = emptyEntry();
const T = Date.UTC(2026, 10, 9, 3, 0, 0); // 北京时间 11:00 → 高峰
let seq = 0;
// 注意：真实日志里 assistant/message 100% 带 message.source.model，
// 因此这里始终构造带 source 的样本（provider 仅作附加信息）。
const sampleEvent = (model, usage, provider) => ({
  seq: ++seq, type: "assistant/message", time: T,
  data: {
    turn: 1, step: seq, usage,
    message: { source: { model, ...(provider ? { provider } : {}) } },
  },
});

// 第一段：deepseek-v4.1-flash，1M 未缓存输入
foldEvent(st, sampleEvent("deepseek-v4.1-flash", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }));
eq(st.cost, 2, "切换前 Flash 1M 输入 = 2");
// 第二段：同一会话切换成 deepseek-v4-pro，1M 输出
foldEvent(st, sampleEvent("deepseek-v4-pro", { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0 }));
eq(st.cost, 2 + 27, "切换后累计 = 2 + Pro 高峰 1M 输出 27");
is(Object.keys(st.byModel).sort().join(","), "deepseek-v4-pro,deepseek-v4.1-flash", "两个模型分别成组");
eq(st.byModel["deepseek-v4.1-flash"].cost, 2, "Flash 组金额独立");
eq(st.byModel["deepseek-v4-pro"].cost, 27, "Pro 组金额独立");
eq(st.byModel["deepseek-v4.1-flash"].samples, 1, "Flash 组采样数");
eq(st.byModel["deepseek-v4-pro"].samples, 1, "Pro 组采样数");

// ---------- 5. 重试替换不漂移 ----------
console.log("[5] 重试替换（同 turn/step）不产生金额漂移");
const st2 = emptyEntry();
seq = 0;
const ev = (usage) => ({
  seq: ++seq, type: "assistant/message", time: T,
  data: { turn: 1, step: 1, usage, message: { source: { model: "deepseek-v4.1-flash" } } },
});
foldEvent(st2, ev({ inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }));
const afterFirst = st2.cost;
foldEvent(st2, ev({ inputTokens: 2_000_000, outputTokens: 0, cacheReadTokens: 0 }));
eq(afterFirst, 2, "首次 = 2");
eq(st2.cost, 4, "替换后 = 4（不是 6）");
eq(st2.byModel["deepseek-v4.1-flash"].cost, 4, "模型组同步替换");
eq(st2.samples, 1, "采样数仍为 1");

// ---------- 6. 多币种不相加 ----------
console.log("[6] 多币种独立累计");
const st3 = emptyEntry();
seq = 0;
const evc = (model, usage) => ({
  seq: ++seq, type: "assistant/message", time: T,
  data: { turn: 1, step: seq, usage, message: { source: { model } } },
});
// 构造两个币种：DeepSeek(CNY) + 一个 USD 模型（若价目表尚无 USD 模型，则此段跳过断言）
const usdVendors = PRICING.vendors.filter((v) => v.currency === "USD");
foldEvent(st3, evc("deepseek-v4.1-flash", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }));
eq(st3.costByCurrency.CNY.cost, 2, "CNY 槽 = 2");
is(st3.currency, "CNY", "主币种为 CNY");
if (usdVendors.length > 0) {
  const usdModel = usdVendors[0].models[0].id;
  foldEvent(st3, evc(usdModel, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 }));
  is(st3.costByCurrency.USD !== undefined, true, "USD 槽独立存在（未与 CNY 相加）");
} else {
  console.log("  (价目表暂无 USD 模型，跳过跨币种断言)");
}
// 未计价模型：只计 token，不产生金额
const before = st3.cost;
foldEvent(st3, evc("some-unlisted-model", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }));
eq(st3.cost, before, "未计价模型不产生金额");
is(st3.unknownSamples, 1, "未计价采样被计数");
is(st3.byModel["some-unlisted-model"].priced, false, "未计价模型标记 priced=false");

// ---------- 7. assistant/attempt 无 source 时回退会话级模型 ----------
console.log("[7] attempt 无 source 时回退会话级模型");
const st4 = emptyEntry();
seq = 0;
foldEvent(st4, { seq: ++seq, type: "request/context", time: T, data: { model: "deepseek-v4-pro", provider: "magpie" } });
foldEvent(st4, {
  seq: ++seq, type: "assistant/attempt", time: T,
  data: { turn: 1, step: 1, stream: [{ chunk: { type: "usage", usage: { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0 } } }] },
});
eq(st4.cost, 27, "回退到会话级 Pro 后按 Pro 计价");

// ---------- 8. provider 感知的歧义代号 ----------
// 同一短代号在不同路由组下可能指代不同模型，必须按 provider 区分，
// 否则会按错误单价计费（金额错但不报错，最难发现）。
console.log("[8] provider 感知的歧义代号");
const scoped = (model, provider) => resolveModel(model, provider)?.model.id ?? null;
is(scoped("mmodel", "auto"), "minimax-m3", "auto/mmodel = MiniMax-M3");
is(scoped("mmodel", "qodercn"), "minimax-m3.1-flash", "qodercn/mmodel = MiniMax-M3.1-Flash");
is(scoped("mmodel", "jet-hub-qodercn"), "minimax-m3.1-flash", "jet-hub-qodercn/mmodel 同上");
is(scoped("mmodel", "magpie"), "minimax-m3", "magpie 视同 auto");
is(scoped("kmodel_latest", "auto"), "kimi-k3", "auto/kmodel_latest = Kimi-K3");
is(scoped("kmodel_latest", "qodercn"), "kimi-k3.1-pro", "qodercn/kmodel_latest = Kimi-K3.1-Pro");
is(scoped("mmodel", ""), null, "无 provider 的歧义代号判为未计价（不猜）");
is(scoped("kmodel_latest", ""), null, "无 provider 的歧义代号判为未计价（不猜）");
// 含义一致的代号在任何 provider 下都应命中
is(scoped("dfmodel", "qodercn"), "deepseek-v4.1-flash", "qodercn/dfmodel = DeepSeek Flash");
is(scoped("dfmodel", "auto"), "deepseek-v4.1-flash", "auto/dfmodel = DeepSeek Flash");
is(scoped("dmodel", "qodercn"), "deepseek-v4-pro", "qodercn/dmodel = DeepSeek V4 Pro");
is(scoped("gmodel", "auto"), "glm-5.3", "auto/gmodel = GLM-5.3");
is(scoped("gfmodel", "qodercn"), "glm-5.3-flash", "qodercn/gfmodel = GLM-5.3-Flash");
is(scoped("qmodel_38max", "qodercn"), "qwen3.8-max", "qodercn/qmodel_38max = Qwen3.8-Max");
is(scoped("qfmodel", "auto"), "qwen3.8-flash", "auto/qfmodel = Qwen3.8-Flash");

// ---------- 9. 缓存写入口径 ----------
// cacheWrite 为 0  = 官方明确写入免费（如 MiMo 限时免费、Kimi K2 不支持写入）
// cacheWrite 为 null = 官方未单列写入价 → 按「未命中输入」价计
// 这两者不能混用，否则会把该收的钱算成 0，或把免费项多收钱。
console.log("[9] 缓存写入口径");
const writeCost = (id, prov) => {
  const r = resolveModel(id, prov);
  return priceSample(r, false, { uncachedInputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 1e6, outputTokens: 0 }).amount;
};
eq(writeCost("step-5-preview"), 7, "step-5-preview 写入按未命中输入价 7 计（官方明说包含首次写入）");
eq(writeCost("hy4"), 6, "hy4 写入按未命中输入价 6 计");
eq(writeCost("deepseek-v4.1-flash"), 1, "DeepSeek Flash 空闲写入按输入价 1 计");
eq(writeCost("mimo-v2.6-pro"), 0, "MiMo 写入限时免费 → 0");
eq(writeCost("kimi-k2.6"), 0, "Kimi K2.6 不支持缓存写入 → 0");
eq(writeCost("qwen3.8-max"), 15, "通义 Max 有显式写入价 15");
eq(writeCost("claude-opus-5-5"), 5, "Claude Opus 5.5 写入价 5");

// ---------- 10. 完全忽略的模型 ----------
console.log("[10] 完全忽略的模型");
for (const x of ["space-bunny", "lmodel", "qodercn/lmodel", "deepseek-v4.1-flash-sg", "auto/deepseek-v4.1-flash-sg"]) {
  is(isIgnoredModel(x), true, x + " 应被完全忽略");
}
is(isIgnoredModel("deepseek-v4.1-flash"), false, "正常模型不被忽略");
is(isIgnoredModel("hy4free"), false, "hy4free 要计价，不被忽略");

console.log("");
console.log("通过 " + pass + " 项，失败 " + fail + " 项");
process.exit(fail === 0 ? 0 : 1);

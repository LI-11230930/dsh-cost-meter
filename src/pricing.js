/**
 * dsh-cost-meter — 价目表与计价引擎
 *
 * 设计原则
 * --------
 * 1. **数据与逻辑分离**：价目表是纯数据（PRICING），本文件其余部分是纯函数。
 *    官方调价 / 新增模型只需改 PRICING，不必碰计价逻辑。
 *
 * 2. **逐样本计价**：assistant/message 的 message.source.model 自带真实后端模型，
 *    因此每个采样独立定价 —— 同一会话中途切换模型也能分别准确计费。
 *
 * 3. **币种不混算**：国内厂商用人民币（CNY），国外厂商用美元（USD）。
 *    两者绝不相加，各自独立累计（详见 entry.costByCurrency）。
 *
 * 4. **未知模型不猜价**：匹配不到价目表时返回 priced=false，
 *    只累计 token 不产生金额，并在面板可见，避免金额悄悄偏小。
 *
 * 数据来源与更新时间
 * ------------------
 * 全部价格抓取自各厂商**官方**定价页（见每个 vendor 的 source 字段），
 * 抓取日期 2026-11-09。国内厂商取中国站人民币原价，国外厂商取美元原价。
 * 单元一律为「每 1,000,000 tokens」。
 *
 * 注意：模型与价格会随时间变化，本表需要定期人工核对。
 *       每次更新请同时改 PRICING.updatedAt。
 */

/** 币种符号。 */
export const CURRENCY_SYMBOL = { CNY: "¥", USD: "$" };

/**
 * 价目表。
 *
 * 每个模型字段：
 *   id        主 id（API 调用名）
 *   aliases   识别用的其它写法（大小写不敏感；provider 前缀会被剥离后再比对）
 *   label     面板显示名
 *   peak/off  单价 { input, output, cacheRead, cacheWrite }
 *             没有峰谷差异的厂商，让 off 与 peak 完全相同即可。
 *   tiers     可选。按「本次请求输入 token 数」分档，每档
 *             { upTo: 上限(不含), input, output, cacheRead, cacheWrite }，
 *             按 upTo 升序；都不匹配时用最后一档。用于国内常见的长度阶梯价。
 *   note      备注（说明口径、促销、分档等）
 */
export const PRICING = {
  version: 1,
  updatedAt: "2026-11-09",
  unit: "per 1M tokens",
  vendors: [
    // ==================== 国内（人民币 CNY）====================
    {
      id: "deepseek",
      label: "DeepSeek",
      currency: "CNY",
      /** DeepSeek 官方按北京时间分峰谷，空闲价为高峰价的一半。 */
      peakEnabled: true,
      source: "https://api-docs.deepseek.com/quick_start/pricing",
      note: "官方价以美元公布，此处按约 7.0 的汇率折算为元，与原插件的元价一致。",
      models: [
        {
          id: "deepseek-v4.1-flash",
          // 官方说明：deepseek-flash / deepseek-v4-flash / deepseek-v4-flash-vision-exp
          // 均已退役，请求由 V4.1-Flash-1017 承接并按 Flash 价计费，故归为同一档。
          // dfmodel = 本机路由组里「DeepSeek-Flash」的代号。
          aliases: ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp", "flash"],
          // dfmodel 是本机路由组里「DeepSeek-Flash」的代号，auto 与 qodercn 下含义一致。
          scopedAliases: ["qodercn/dfmodel", "jet-hub-qodercn/dfmodel", "auto/dfmodel"],
          label: "DeepSeek V4.1 Flash",
          peak: { input: 2, output: 8, cacheRead: 0.04, cacheWrite: null },
          off: { input: 1, output: 4, cacheRead: 0.02, cacheWrite: null },
          note: "官方美元价峰时 $0.3/$1.2/$0.006，空闲减半。",
        },
        {
          id: "deepseek-v4-pro",
          aliases: ["deepseek-pro", "pro"],
          scopedAliases: ["qodercn/dmodel", "jet-hub-qodercn/dmodel", "auto/dmodel"],
          label: "DeepSeek V4 Pro",
          peak: { input: 9, output: 27, cacheRead: 0.3, cacheWrite: null },
          off: { input: 4.5, output: 13.5, cacheRead: 0.15, cacheWrite: null },
          note: "官方美元价峰时 $1.32/$3.96/$0.044，空闲减半。",
        },
      ],
    },
    {
      id: "zhipu",
      label: "智谱",
      currency: "CNY",
      peakEnabled: false,
      source: "https://docs.bigmodel.cn/cn/guide/start/pricing",
      note: "无峰谷定价；缓存按「元/百万 tokens/小时」存储计费且当前限时免费，故 cacheWrite 记 0。",
      models: [
        {
          id: "glm-5.3",
          aliases: ["glm-5.3"],
          scopedAliases: ["qodercn/gmodel", "jet-hub-qodercn/gmodel", "auto/gmodel"],
          label: "GLM-5.3",
          peak: { input: 8, output: 28, cacheRead: 2, cacheWrite: null },
          off: { input: 8, output: 28, cacheRead: 2, cacheWrite: null },
        },
        {
          id: "glm-5.3-flash",
          aliases: ["glm-5.3-flash", "glm-5-3-flash"],
          scopedAliases: ["qodercn/gfmodel", "jet-hub-qodercn/gfmodel", "auto/gfmodel"],
          label: "GLM-5.3-Flash",
          peak: { input: 0.8, output: 2.8, cacheRead: 0.23, cacheWrite: null },
          off: { input: 0.8, output: 2.8, cacheRead: 0.23, cacheWrite: null },
        },
        {
          id: "glm-5.3-flashx",
          aliases: ["glm-5.3-flashx", "glm-5.3-flashx-legal"],
          label: "GLM-5.3-FlashX",
          peak: { input: 2, output: 7, cacheRead: 0.57, cacheWrite: null },
          off: { input: 2, output: 7, cacheRead: 0.57, cacheWrite: null },
          note: "GLM-5.3-Flash 的高速版。",
        },
        {
          id: "glm-5.2",
          aliases: ["glm-5.2"],
          label: "GLM-5.2",
          peak: { input: 8, output: 28, cacheRead: 2, cacheWrite: null },
          off: { input: 8, output: 28, cacheRead: 2, cacheWrite: null },
        },
        {
          id: "glm-5.1",
          aliases: ["glm-5.1"],
          label: "GLM-5.1",
          peak: { input: 6, output: 24, cacheRead: 1.3, cacheWrite: null },
          off: { input: 6, output: 24, cacheRead: 1.3, cacheWrite: null },
          tiers: [
            { upTo: 32000, input: 6, output: 24, cacheRead: 1.3, cacheWrite: null },
            { upTo: Infinity, input: 8, output: 28, cacheRead: 2, cacheWrite: null },
          ],
          note: "输入长度 ≥32K 时按 8/28/2 计。",
        },
        {
          id: "glm-5",
          aliases: ["glm-5"],
          label: "GLM-5",
          peak: { input: 4, output: 18, cacheRead: 1, cacheWrite: null },
          off: { input: 4, output: 18, cacheRead: 1, cacheWrite: null },
          tiers: [
            { upTo: 32000, input: 4, output: 18, cacheRead: 1, cacheWrite: null },
            { upTo: Infinity, input: 6, output: 22, cacheRead: 1.5, cacheWrite: null },
          ],
          note: "输入长度 ≥32K 时按 6/22/1.5 计。",
        },
        {
          id: "glm-5-turbo",
          aliases: ["glm-5-turbo"],
          label: "GLM-5-Turbo",
          peak: { input: 5, output: 22, cacheRead: 1.2, cacheWrite: null },
          off: { input: 5, output: 22, cacheRead: 1.2, cacheWrite: null },
          tiers: [
            { upTo: 32000, input: 5, output: 22, cacheRead: 1.2, cacheWrite: null },
            { upTo: Infinity, input: 7, output: 26, cacheRead: 1.8, cacheWrite: null },
          ],
          note: "输入长度 ≥32K 时按 7/26/1.8 计。",
        },
        {
          id: "glm-4.7",
          aliases: ["glm-4.7"],
          label: "GLM-4.7",
          peak: { input: 3, output: 14, cacheRead: 0.6, cacheWrite: null },
          off: { input: 3, output: 14, cacheRead: 0.6, cacheWrite: null },
          note: "取值档：输入 [0,32K)。输入 [32K,200K) 为 4/16/0.8。",
        },
      ],
    },
    {
      id: "qwen",
      label: "通义千问",
      currency: "CNY",
      peakEnabled: false,
      source: "https://help.aliyun.com/zh/model-studio/model-pricing",
      note: "华北2（北京）地域人民币原价。无峰谷定价；有按输入长度的阶梯价。",
      models: [
        {
          id: "qwen3.8-max",
          aliases: ["qwen3.8-max", "qwen3-8-max", "qwen3.7-max"],
          scopedAliases: ["qodercn/qmodel_38max", "jet-hub-qodercn/qmodel_38max", "auto/qmodel_38max"],
          label: "Qwen3.8-Max",
          peak: { input: 12, output: 36, cacheRead: 1.5, cacheWrite: 15 },
          off: { input: 12, output: 36, cacheRead: 1.5, cacheWrite: 15 },
        },
        {
          id: "qwen3.8-flash",
          aliases: ["qwen3.8-flash", "qwen3-8-flash", "qwen3.7-flash"],
          scopedAliases: ["qodercn/qfmodel", "jet-hub-qodercn/qfmodel", "auto/qfmodel"],
          label: "Qwen3.8-Flash",
          peak: { input: 0.8, output: 2.7, cacheRead: 0.1, cacheWrite: 1.25 },
          off: { input: 0.8, output: 2.7, cacheRead: 0.1, cacheWrite: 1.25 },
        },
        {
          id: "qwen3.7-plus",
          aliases: ["qwen3.7-plus"],
          label: "Qwen3.7-Plus",
          peak: { input: 1.6, output: 6.4, cacheRead: 0.32, cacheWrite: 2 },
          off: { input: 1.6, output: 6.4, cacheRead: 0.32, cacheWrite: 2 },
          tiers: [
            { upTo: 256000, input: 1.6, output: 6.4, cacheRead: 0.32, cacheWrite: 2 },
            { upTo: Infinity, input: 4.8, output: 19.2, cacheRead: 0.96, cacheWrite: 2 },
          ],
          note: "取实付价：官方标注「原价 2 元（限时 8 折）」「原价 8 元（限时 8 折）」，实付 1.6/6.4；256K 档原价 6/24 折后 4.8/19.2。",
        },
        {
          id: "qwen3.6-plus",
          aliases: ["qwen3.6-plus"],
          label: "Qwen3.6-Plus",
          peak: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
          off: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
          tiers: [
            { upTo: 256000, input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
            { upTo: Infinity, input: 8, output: 48, cacheRead: 0.8, cacheWrite: 10 },
          ],
          note: "cacheRead 取官方公布的显式缓存命中价。",
        },
        {
          id: "qwen3.5-plus",
          aliases: ["qwen3.5-plus"],
          label: "Qwen3.5-Plus",
          peak: { input: 0.8, output: 4.8, cacheRead: 0.08, cacheWrite: 1 },
          off: { input: 0.8, output: 4.8, cacheRead: 0.08, cacheWrite: 1 },
          tiers: [
            { upTo: 128000, input: 0.8, output: 4.8, cacheRead: 0.08, cacheWrite: 1 },
            { upTo: 256000, input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
            { upTo: Infinity, input: 4, output: 24, cacheRead: 0.4, cacheWrite: 5 },
          ],
        },
        {
          id: "qwen3.5-flash",
          aliases: ["qwen3.5-flash"],
          label: "Qwen3.5-Flash",
          peak: { input: 0.2, output: 2, cacheRead: 0.02, cacheWrite: 0.25 },
          off: { input: 0.2, output: 2, cacheRead: 0.02, cacheWrite: 0.25 },
          tiers: [
            { upTo: 128000, input: 0.2, output: 2, cacheRead: 0.02, cacheWrite: 0.25 },
            { upTo: Infinity, input: 0.8, output: 8, cacheRead: 0.02, cacheWrite: 1 },
          ],
        },
      ],
    },
    {
      id: "minimax",
      label: "MiniMax",
      currency: "CNY",
      peakEnabled: false,
      source: "https://platform.minimaxi.com/document/price",
      models: [
        {
          id: "minimax-m3.1-flash",
          // mmodel 在 qodercn 路由组下对应 MiniMax-M3.1-Flash。
          aliases: ["minimax-m3.1-flash", "m3.1-flash", "minimax-m3-1-flash"],
          // mmodel 在 auto 下是 MiniMax-M3，在 qodercn 下是 M3.1-Flash。
          scopedAliases: ["qodercn/mmodel", "jet-hub-qodercn/mmodel"],
          label: "MiniMax M3.1 Flash",
          peak: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: null },
          off: { input: 1, output: 4, cacheRead: 0.1, cacheWrite: null },
        },
        {
          id: "minimax-m3",
          aliases: ["minimax-m3"],
          scopedAliases: ["auto/mmodel"],
          label: "MiniMax M3",
          peak: { input: 2.1, output: 8.4, cacheRead: 0.42, cacheWrite: null },
          off: { input: 2.1, output: 8.4, cacheRead: 0.42, cacheWrite: null },
          tiers: [
            { upTo: 512000, input: 2.1, output: 8.4, cacheRead: 0.42, cacheWrite: null },
            { upTo: Infinity, input: 4.2, output: 16.8, cacheRead: 0.84, cacheWrite: null },
          ],
          note: ">512k 输入 tokens 单价翻倍（已含永久五折）。",
        },
      ],
    },

    {
      id: "moonshot",
      label: "月之暗面",
      currency: "CNY",
      peakEnabled: false,
      source: "https://platform.kimi.com/docs/pricing/chat",
      note: "Batch API 为标准价 60%；无峰谷差异。Kimi 有独立缓存写入计费，此处取 5 分钟档。",
      models: [
        {
          id: "kimi-k3.1-pro",
          // kmodel_latest = 本机路由组里「Kimi-K3.1-Pro」的代号。
          aliases: ["kimi-k3.1-pro", "kimi-k3-1-pro"],
          // 注意：kmodel_latest 在 auto 下是 Kimi-K3，在 qodercn 下才是 K3.1-Pro，故只登记作用域形式。
          scopedAliases: ["qodercn/kmodel_latest", "jet-hub-qodercn/kmodel_latest"],
          label: "Kimi K3.1 Pro",
          peak: { input: 13, output: 68, cacheRead: 1.3, cacheWrite: 13 },
          off: { input: 13, output: 68, cacheRead: 1.3, cacheWrite: 13 },
          note: "缓存写入 5 分钟档；1 小时档为 13→26。",
        },
        {
          id: "kimi-k3.1-pro-highspeed",
          aliases: ["kimi-k3.1-pro-highspeed"],
          label: "Kimi K3.1 Pro Highspeed",
          peak: { input: 26, output: 136, cacheRead: 1.3, cacheWrite: 26 },
          off: { input: 26, output: 136, cacheRead: 1.3, cacheWrite: 26 },
        },
        {
          id: "kimi-k3",
          aliases: ["kimi-k3"],
          scopedAliases: ["auto/kmodel_latest"],
          label: "Kimi K3",
          peak: { input: 20, output: 100, cacheRead: 2, cacheWrite: 20 },
          off: { input: 20, output: 100, cacheRead: 2, cacheWrite: 20 },
        },
        {
          id: "kimi-k2.7-code",
          aliases: ["kimi-k2.7-code", "kimi-k2-7-code"],
          label: "Kimi K2.7 Code",
          peak: { input: 6.5, output: 27, cacheRead: 1.3, cacheWrite: 0 },
          off: { input: 6.5, output: 27, cacheRead: 1.3, cacheWrite: 0 },
          note: "不支持缓存写入；已停止向新注册用户开放，2026-12 底下线。",
        },
        {
          id: "kimi-k2.7-code-highspeed",
          aliases: ["kimi-k2.7-code-highspeed"],
          label: "Kimi K2.7 Code Highspeed",
          peak: { input: 13, output: 54, cacheRead: 2.6, cacheWrite: 0 },
          off: { input: 13, output: 54, cacheRead: 2.6, cacheWrite: 0 },
        },
        {
          id: "kimi-k2.6",
          aliases: ["kimi-k2.6"],
          label: "Kimi K2.6",
          peak: { input: 6.5, output: 27, cacheRead: 1.1, cacheWrite: 0 },
          off: { input: 6.5, output: 27, cacheRead: 1.1, cacheWrite: 0 },
        },
      ],
    },
    {
      id: "doubao",
      label: "字节豆包",
      currency: "CNY",
      peakEnabled: false,
      source: "https://www.volcengine.com/docs/82379/1099320",
      note: "火山引擎在线推理常规档。豆包本身无峰谷；缓存按存储时长计费，故 cacheWrite 记 0。",
      models: [
        {
          id: "doubao-seed-2.1-pro",
          aliases: ["doubao-seed-2.1-pro"],
          label: "Doubao Seed 2.1 Pro",
          peak: { input: 6, output: 30, cacheRead: 1.2, cacheWrite: null },
          off: { input: 6, output: 30, cacheRead: 1.2, cacheWrite: null },
        },
        {
          id: "doubao-seed-2.1-turbo",
          aliases: ["doubao-seed-2.1-turbo"],
          label: "Doubao Seed 2.1 Turbo",
          peak: { input: 3, output: 15, cacheRead: 0.6, cacheWrite: null },
          off: { input: 3, output: 15, cacheRead: 0.6, cacheWrite: null },
        },
        {
          id: "doubao-seed-2.1-lite",
          aliases: ["doubao-seed-2.1-lite"],
          label: "Doubao Seed 2.1 Lite",
          peak: { input: 0.8, output: 2.7, cacheRead: 0.16, cacheWrite: null },
          off: { input: 0.8, output: 2.7, cacheRead: 0.16, cacheWrite: null },
        },
        {
          id: "doubao-seed-evolving",
          aliases: ["doubao-seed-evolving"],
          label: "Doubao Seed Evolving",
          peak: { input: 6, output: 30, cacheRead: 1.2, cacheWrite: null },
          off: { input: 6, output: 30, cacheRead: 1.2, cacheWrite: null },
        },
      ],
    },
    {
      id: "hunyuan",
      label: "腾讯混元",
      currency: "CNY",
      peakEnabled: false,
      source: "https://cloud.tencent.com/document/product/1823/130055",
      note:
        "Hy4 及后续模型由「大模型服务平台 TokenHub」承载（旧平台 product/1729 已停止新增模型与新增购买），" +
        "hy3 及以下为旧平台存量刊例价。无缓存写入单价。",
      models: [
        {
          id: "hy4",
          // 本机代号：hy4free（auto/workbuddy/jet-hub-buddy）、hy4std（CodeBuddy 标准档）。
          // 按用户要求，渠道是否免费/打折一律不管，统一按官方标准刊例价计。
          aliases: ["hy4", "hunyuan-4", "hunyuan4"],
          scopedAliases: [
            "auto/hy4free", "workbuddy/hy4free", "jet-hub-buddy/hy4free",
            "jet-hub-buddy/hy4std", "auto/hy4std", "workbuddy/hy4std",
          ],
          label: "混元 Hy4",
          peak: { input: 6, output: 18, cacheRead: 0.3, cacheWrite: null },
          off: { input: 6, output: 18, cacheRead: 0.3, cacheWrite: null },
          note:
            "混元4（官方 id hy4）。标准刊例价 6/18/缓存0.3，1M 上下文，无长度分档、无峰谷。" +
            "官方另有「限时 5 折至 2026-12-31」促销（实付 3/9/0.15）与批量推理 5 折，" +
            "按标准价口径不计入。",
        },
        {
          id: "hy4-preview",
          aliases: ["hy4-preview"],
          label: "混元 Hy4 Preview",
          peak: { input: 6, output: 18, cacheRead: 0.3, cacheWrite: null },
          off: { input: 6, output: 18, cacheRead: 0.3, cacheWrite: null },
          note: "与 hy4 正式版同价。",
        },
        {
          id: "hy3",
          aliases: ["hy3", "hunyuan-3"],
          label: "混元 Hy3",
          peak: { input: 1, output: 4, cacheRead: 0.25, cacheWrite: null },
          off: { input: 1, output: 4, cacheRead: 0.25, cacheWrite: null },
          note: "256K 上下文；批量推理 0.5/2/0.125。",
        },
        {
          id: "hunyuan-a13b",
          aliases: ["hunyuan-a13b"],
          label: "混元 A13B",
          peak: { input: 0.5, output: 2, cacheRead: 0, cacheWrite: null },
          off: { input: 0.5, output: 2, cacheRead: 0, cacheWrite: null },
        },
        {
          id: "hunyuan-role-latest",
          aliases: ["hunyuan-role-latest"],
          label: "混元 Role",
          peak: { input: 2.4, output: 9.6, cacheRead: 0, cacheWrite: null },
          off: { input: 2.4, output: 9.6, cacheRead: 0, cacheWrite: null },
        },
        {
          id: "hunyuan-translation",
          aliases: ["hunyuan-translation"],
          label: "混元翻译",
          peak: { input: 1.2, output: 3.6, cacheRead: 0, cacheWrite: null },
          off: { input: 1.2, output: 3.6, cacheRead: 0, cacheWrite: null },
        },
        {
          id: "hunyuan-translation-lite",
          aliases: ["hunyuan-translation-lite"],
          label: "混元翻译 Lite",
          peak: { input: 1, output: 3, cacheRead: 0, cacheWrite: null },
          off: { input: 1, output: 3, cacheRead: 0, cacheWrite: null },
        },
        {
          id: "hunyuan-vision-1.5-instruct",
          aliases: ["hunyuan-vision-1.5-instruct", "hunyuan-turbos-vision", "hunyuan-t1-vision-20250916", "hunyuan-turbos-vision-video"],
          label: "混元视觉",
          peak: { input: 3, output: 9, cacheRead: 0, cacheWrite: null },
          off: { input: 3, output: 9, cacheRead: 0, cacheWrite: null },
          note: "含 Vision 1.5 Instruct / TurboS Vision / T1 Vision / Vision Video 同价档。",
        },
        {
          id: "hunyuan-embedding",
          aliases: ["hunyuan-embedding"],
          label: "混元 Embedding",
          peak: { input: 0.7, output: 0.7, cacheRead: 0, cacheWrite: null },
          off: { input: 0.7, output: 0.7, cacheRead: 0, cacheWrite: null },
          note: "向量模型，仅输入计费。",
        },
      ],
    },
    {
      id: "xiaomi",
      label: "小米 MiMo",
      currency: "CNY",
      peakEnabled: false,
      source: "https://platform.xiaomimimo.com/docs/zh-CN/price/pay-as-you-go",
      note: "国内人民币列；v2.6 系列为当前在售主力（v2.5 已于 2026-10-21 下线）。缓存写入限时免费。",
      models: [
        {
          id: "mimo-v2.6-pro",
          aliases: ["mimo-v2.6-pro"],
          label: "MiMo V2.6 Pro",
          peak: { input: 3, output: 6, cacheRead: 0.025, cacheWrite: 0 },
          off: { input: 3, output: 6, cacheRead: 0.025, cacheWrite: 0 },
          note: "批量推理五折。",
        },
        {
          id: "mimo-v2.6-flash",
          aliases: ["mimo-v2.6-flash"],
          label: "MiMo V2.6 Flash",
          peak: { input: 1, output: 2, cacheRead: 0.02, cacheWrite: 0 },
          off: { input: 1, output: 2, cacheRead: 0.02, cacheWrite: 0 },
        },
        {
          id: "mimo-v2.6-pro-ultraspeed",
          aliases: ["mimo-v2.6-pro-ultraspeed"],
          label: "MiMo V2.6 Pro UltraSpeed",
          peak: { input: 30, output: 60, cacheRead: 0.25, cacheWrite: 0 },
          off: { input: 30, output: 60, cacheRead: 0.25, cacheWrite: 0 },
        },
      ],
    },
    {
      id: "stepfun",
      label: "阶跃星辰",
      currency: "CNY",
      peakEnabled: false,
      source: "https://platform.stepfun.com/docs/zh/guides/pricing/details",
      note: "官方无 Batch 折扣、无峰谷价差、无长度分档。",
      models: [
        {
          id: "step-5-preview",
          // 本机代号：jmodel（Qoder 中国版路由组）。
          aliases: ["step-5-preview"],
          scopedAliases: ["qodercn/jmodel", "jet-hub-qodercn/jmodel", "auto/jmodel"],
          label: "Step 5 Preview",
          peak: { input: 7, output: 20, cacheRead: 0.7, cacheWrite: null },
          off: { input: 7, output: 20, cacheRead: 0.7, cacheWrite: null },
          note:
            "1M 上下文，文本/图片/视频输入，最大输出 64k。官方明确「未命中输入（含首次写入缓存）" +
            "按未命中单价计费」，故无独立 cacheWrite 单价。" +
            "cacheRead 0.7 自北京时间 2026-10-14 00:30 由 0.35 上调；此前已用过按量付费 API 的老账户仍为 0.35。",
        },
        {
          id: "step-3.7-flash",
          aliases: ["step-3.7-flash"],
          label: "Step 3.7 Flash",
          peak: { input: 1.35, output: 8.1, cacheRead: 0.27, cacheWrite: null },
          off: { input: 1.35, output: 8.1, cacheRead: 0.27, cacheWrite: null },
          note: "256K 上下文，多模态推理。",
        },
        {
          id: "step-3.5-flash",
          aliases: ["step-3.5-flash"],
          label: "Step 3.5 Flash",
          peak: { input: 0.7, output: 2.1, cacheRead: 0.14, cacheWrite: null },
          off: { input: 0.7, output: 2.1, cacheRead: 0.14, cacheWrite: null },
        },
        {
          id: "step-3.5-flash-2603",
          aliases: ["step-3.5-flash-2603"],
          label: "Step 3.5 Flash 2603",
          peak: { input: 0.7, output: 2.1, cacheRead: 0.14, cacheWrite: null },
          off: { input: 0.7, output: 2.1, cacheRead: 0.14, cacheWrite: null },
          note: "Agent 场景优化版，低推理模式。",
        },
        {
          id: "step-1o-turbo-vision",
          aliases: ["step-1o-turbo-vision"],
          label: "Step-1o Turbo Vision",
          peak: { input: 2.5, output: 8, cacheRead: 0.5, cacheWrite: null },
          off: { input: 2.5, output: 8, cacheRead: 0.5, cacheWrite: null },
          note: "32K 上下文，图像/视频理解。",
        },
      ],
    },

    // ==================== 国外（美元 USD）====================
    {
      id: "openai",
      label: "OpenAI",
      currency: "USD",
      peakEnabled: false,
      source: "https://developers.openai.com/api/docs/pricing",
      note: "标准价。Batch 5 折、Fast 2 倍、Ultrafast 6 倍。长上下文（>272K 输入）价格更高，未计入。",
      models: [
        {
          id: "gpt-6-astra",
          aliases: ["gpt-6-astra"],
          label: "GPT-6 Astra",
          peak: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
          off: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
          note: "旗舰。cacheWrite 为 30 分钟档；12 小时档 $25。",
        },
        {
          id: "gpt-6.1-sol",
          aliases: ["gpt-6.1-sol"],
          label: "GPT-6.1 Sol",
          peak: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
          off: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
          tiers: [
            { upTo: 272000, input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
            { upTo: Infinity, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 },
          ],
        },
        {
          id: "gpt-6.1-terra",
          aliases: ["gpt-6.1-terra"],
          label: "GPT-6.1 Terra",
          peak: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
          off: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
          tiers: [
            { upTo: 272000, input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 },
            { upTo: Infinity, input: 2, output: 7.5, cacheRead: 0.1, cacheWrite: 2.5 },
          ],
        },
        {
          id: "gpt-6-luna",
          aliases: ["gpt-6-luna"],
          label: "GPT-6 Luna",
          peak: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
          off: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
          tiers: [
            { upTo: 272000, input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
            { upTo: Infinity, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 },
          ],
        },
        {
          id: "gpt-6-sol",
          aliases: ["gpt-6-sol"],
          label: "GPT-6 Sol",
          peak: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
          off: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
          tiers: [
            { upTo: 272000, input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
            { upTo: Infinity, input: 4, output: 15, cacheRead: 0.4, cacheWrite: 5 },
          ],
        },
        {
          id: "gpt-5.6-sol",
          aliases: ["gpt-5.6-sol"],
          label: "GPT-5.6 Sol",
          peak: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
          off: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
          note: "⚠ 促销价，官方标注有效期至 2026-11-30，到期后需核对。",
        },
        {
          id: "gpt-5.6-terra",
          aliases: ["gpt-5.6-terra"],
          label: "GPT-5.6 Terra",
          peak: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
          off: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
        },
        {
          id: "gpt-5.6-luna",
          aliases: ["gpt-5.6-luna"],
          label: "GPT-5.6 Luna",
          peak: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
          off: { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
        },
        {
          id: "gpt-5.5",
          aliases: ["gpt-5.5"],
          label: "GPT-5.5",
          peak: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: null },
          off: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: null },
          tiers: [
            { upTo: 272000, input: 5, output: 30, cacheRead: 0.5, cacheWrite: null },
            { upTo: Infinity, input: 10, output: 45, cacheRead: 1, cacheWrite: null },
          ],
          note: "官方未单列缓存写入价。",
        },
        {
          id: "gpt-5.5-pro",
          aliases: ["gpt-5.5-pro"],
          label: "GPT-5.5 Pro",
          peak: { input: 30, output: 180, cacheRead: 0, cacheWrite: null },
          off: { input: 30, output: 180, cacheRead: 0, cacheWrite: null },
          tiers: [
            { upTo: 272000, input: 30, output: 180, cacheRead: 0, cacheWrite: null },
            { upTo: Infinity, input: 60, output: 270, cacheRead: 0, cacheWrite: null },
          ],
          note: "官方未列缓存价格，缓存读取按 0 计（实际可能不计费）。",
        },
        {
          id: "gpt-5.4",
          aliases: ["gpt-5.4"],
          label: "GPT-5.4",
          peak: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: null },
          off: { input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: null },
        },
        {
          id: "gpt-5.4-pro",
          aliases: ["gpt-5.4-pro"],
          label: "GPT-5.4 Pro",
          peak: { input: 30, output: 180, cacheRead: 0, cacheWrite: null },
          off: { input: 30, output: 180, cacheRead: 0, cacheWrite: null },
          note: "官方未列缓存价格。",
        },
        {
          id: "gpt-5.4-mini",
          aliases: ["gpt-5.4-mini"],
          label: "GPT-5.4 mini",
          peak: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: null },
          off: { input: 0.75, output: 4.5, cacheRead: 0.075, cacheWrite: null },
        },
        {
          id: "gpt-5.4-nano",
          aliases: ["gpt-5.4-nano"],
          label: "GPT-5.4 nano",
          peak: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: null },
          off: { input: 0.2, output: 1.25, cacheRead: 0.02, cacheWrite: null },
        },
      ],
    },
    {
      id: "anthropic",
      label: "Anthropic",
      currency: "USD",
      peakEnabled: false,
      source: "https://platform.claude.com/docs/en/about-claude/pricing",
      note: "标准价。Batch 输入输出各 5 折且可与缓存叠加；无时段折扣。cacheWrite 为 5 分钟档。",
      models: [
        {
          id: "claude-fable-5-1",
          aliases: ["claude-fable-5-1", "claude-fable-5.1"],
          label: "Claude Fable 5.1",
          peak: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
          off: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
          note: "当前最高档模型线（缓存读取 0.025x）。",
        },
        {
          id: "claude-opus-5-5",
          aliases: ["claude-opus-5-5", "claude-opus-5.5"],
          label: "Claude Opus 5.5",
          peak: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
          off: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
        },
        {
          id: "claude-sonnet-5-5",
          aliases: ["claude-sonnet-5-5", "claude-sonnet-5.5"],
          label: "Claude Sonnet 5.5",
          peak: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
          off: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
        },
        {
          id: "claude-haiku-5-5",
          aliases: ["claude-haiku-5-5", "claude-haiku-5.5"],
          label: "Claude Haiku 5.5",
          peak: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
          off: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
          tiers: [
            { upTo: 100000, input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
            { upTo: Infinity, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
          ],
          note: "prompt >100K 时按 0.5/2.5 计。",
        },
        {
          id: "claude-fable-5",
          aliases: ["claude-fable-5"],
          label: "Claude Fable 5",
          peak: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
          off: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
        },
        {
          id: "claude-opus-5",
          aliases: ["claude-opus-5"],
          label: "Claude Opus 5",
          peak: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
          off: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        },
        {
          id: "claude-opus-4-8",
          aliases: ["claude-opus-4-8", "claude-opus-4.8"],
          label: "Claude Opus 4.8",
          peak: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
          off: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
        },
        {
          id: "claude-sonnet-5",
          aliases: ["claude-sonnet-5"],
          label: "Claude Sonnet 5",
          peak: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
          off: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
        },
        {
          id: "claude-sonnet-4-6",
          aliases: ["claude-sonnet-4-6", "claude-sonnet-4.6"],
          label: "Claude Sonnet 4.6",
          peak: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
          off: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
        },
        {
          id: "claude-haiku-4-5",
          aliases: ["claude-haiku-4-5", "claude-haiku-4.5"],
          label: "Claude Haiku 4.5",
          peak: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
          off: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
        },
      ],
    },
    {
      id: "google",
      label: "Google",
      currency: "USD",
      peakEnabled: false,
      source: "https://aistudio.google.com/docs/pricing",
      note: "仅隐式缓存，无缓存写入费（缓存存储费按小时计，未计入）。多模态音频输入价高于文本，此处取文本档。",
      models: [
        {
          id: "gemini-4-carbon",
          aliases: ["gemini-4-carbon", "gemini-4carbon"],
          label: "Gemini 4 Carbon",
          peak: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
          off: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
          note: "⚠ 促销价，2026-12-01 起涨为 $4/$20（cacheRead $0.20）。仅隐式缓存。上下文 1M、最大输出 65K/1M。无免费额度。取 Standard 档（另有 Batch/Flex 半价、Priority 1.8 倍）。",
        },
        {
          id: "gemini-4-argon",
          aliases: ["gemini-4-argon"],
          label: "Gemini 4 Argon",
          peak: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
          off: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
          note: "⚠ 促销价，2026-12-01 起涨为 $4/$20（cacheRead $0.20）。无上下文分档。",
        },
        {
          id: "gemini-decision-1",
          aliases: ["gemini-decision-1", "gemini-decision", "decision-1"],
          label: "Gemini Decision 1",
          peak: { input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0 },
          off: { input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0 },
          note: "多模态决策模型（Decisions API）。输出价为 0：官方明确每题生成 0 个输出 token，只按共享输入计费。不支持缓存、不支持 Batch。",
        },
        {
          id: "gemini-3.8-flash",
          aliases: ["gemini-3.8-flash"],
          label: "Gemini 3.8 Flash",
          peak: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
          off: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
          note: "引导价，2027-01-01 起涨为 $1.5/$7.5。",
        },
        {
          id: "gemini-3.6-flash",
          aliases: ["gemini-3.6-flash"],
          label: "Gemini 3.6 Flash",
          peak: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
          off: { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 },
          note: "引导价，2027-01-01 起涨为 $1.5/$7.5。",
        },
        {
          id: "gemini-3.5-flash-lite",
          aliases: ["gemini-3.5-flash-lite"],
          label: "Gemini 3.5 Flash-Lite",
          peak: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
          off: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
          note: "2026-12-01 后成为 gemini-2.5-flash 的自动路由目标。",
        },
        {
          id: "gemini-3.1-flash-lite",
          aliases: ["gemini-3.1-flash-lite"],
          label: "Gemini 3.1 Flash-Lite",
          peak: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 },
          off: { input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0 },
          note: "音频输入 $0.50（表中为文本价）。",
        },
        {
          id: "gemini-3.1-pro-preview",
          aliases: ["gemini-3.1-pro-preview"],
          label: "Gemini 3.1 Pro Preview",
          peak: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
          off: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
            { upTo: Infinity, input: 4, output: 18, cacheRead: 0.4, cacheWrite: 0 },
          ],
          note: "按 200k 提示长度分档。官方无「Gemini 3 Pro」型号。",
        },
        {
          id: "gemini-3-flash-preview",
          aliases: ["gemini-3-flash-preview"],
          label: "Gemini 3 Flash Preview",
          peak: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
          off: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
          note: "音频输入 $1.00。",
        },
        {
          id: "gemini-2.5-pro",
          aliases: ["gemini-2.5-pro"],
          label: "Gemini 2.5 Pro",
          peak: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
          off: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
            { upTo: Infinity, input: 2.5, output: 15, cacheRead: 0.25, cacheWrite: 0 },
          ],
          note: "已弃用：2026-12-01 起自动路由到 gemini-3.8-flash。",
        },
        {
          id: "gemini-2.5-flash",
          aliases: ["gemini-2.5-flash"],
          label: "Gemini 2.5 Flash",
          peak: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
          off: { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
          note: "已弃用：2026-12-01 起自动路由到 gemini-3.5-flash-lite。",
        },
        {
          id: "gemini-2.5-flash-lite",
          aliases: ["gemini-2.5-flash-lite"],
          label: "Gemini 2.5 Flash-Lite",
          peak: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
          off: { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
        },
      ],
    },
    {
      id: "xai",
      label: "xAI",
      currency: "USD",
      peakEnabled: false,
      source: "https://docs.x.ai/developers/pricing",
      note: "自动缓存，无缓存写入费。所有文本模型按 200k 提示 token 分档，达到阈值后整个请求按长上下文价计费。Batch 8 折。",
      models: [
        {
          id: "grok-4.7",
          aliases: ["grok-4.7"],
          label: "Grok 4.7",
          peak: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
          off: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
            { upTo: Infinity, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 },
          ],
          note: "上下文 500k。US 区域端点 1.1 倍。",
        },
        {
          id: "grok-4.6",
          aliases: ["grok-4.6"],
          label: "Grok 4.6",
          peak: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
          off: { input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 2, output: 6, cacheRead: 0.5, cacheWrite: 0 },
            { upTo: Infinity, input: 4, output: 12, cacheRead: 1, cacheWrite: 0 },
          ],
        },
        {
          id: "grok-4.5",
          aliases: ["grok-4.5"],
          label: "Grok 4.5",
          peak: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
          off: { input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 2, output: 6, cacheRead: 0.3, cacheWrite: 0 },
            { upTo: Infinity, input: 4, output: 12, cacheRead: 0.6, cacheWrite: 0 },
          ],
        },
        {
          id: "grok-4.3",
          aliases: ["grok-4.3", "grok-4", "grok-4-fast", "grok-4-1-fast", "grok-code-fast-1", "grok-3"],
          label: "Grok 4.3",
          peak: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
          off: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
            { upTo: Infinity, input: 2.5, output: 5, cacheRead: 0.4, cacheWrite: 0 },
          ],
          note: "2026-05-15 退役的 grok-4 系列均重定向至此并按本价计费。",
        },
        {
          id: "grok-4.20-0309-reasoning",
          aliases: ["grok-4.20-0309-reasoning"],
          label: "Grok 4.20 Reasoning",
          peak: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
          off: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
            { upTo: Infinity, input: 2.5, output: 5, cacheRead: 0.4, cacheWrite: 0 },
          ],
        },
        {
          id: "grok-4.20-0309-non-reasoning",
          aliases: ["grok-4.20-0309-non-reasoning"],
          label: "Grok 4.20 Non-Reasoning",
          peak: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
          off: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
            { upTo: Infinity, input: 2.5, output: 5, cacheRead: 0.4, cacheWrite: 0 },
          ],
        },
        {
          id: "grok-4.20-multi-agent-0309",
          aliases: ["grok-4.20-multi-agent-0309"],
          label: "Grok 4.20 Multi Agent",
          peak: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
          off: { input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 1.25, output: 2.5, cacheRead: 0.2, cacheWrite: 0 },
            { upTo: Infinity, input: 2.5, output: 5, cacheRead: 0.4, cacheWrite: 0 },
          ],
        },
        {
          id: "grok-build-0.1",
          aliases: ["grok-build-0.1"],
          label: "Grok Build 0.1",
          peak: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 },
          off: { input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 },
          tiers: [
            { upTo: 200000, input: 1, output: 2, cacheRead: 0.2, cacheWrite: 0 },
            { upTo: Infinity, input: 2, output: 4, cacheRead: 0.4, cacheWrite: 0 },
          ],
          note: "无 Batch 折扣。",
        },
      ],
    },
  ],
};

//#region 模型名归一化与匹配

/** 把 provider 前缀剥离：auto/deepseek-v4.1-flash → deepseek-v4.1-flash */
function stripProvider(model) {
  const m = String(model || "");
  const i = m.lastIndexOf("/");
  return i === -1 ? m : m.slice(i + 1);
}

/** 归一化：小写、去空格、把 _ 和空格统一为 -，压缩重复连字符。 */
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-");
}

/**
 * 预建索引。
 *
 * 关键点：**短代号（如 mmodel、kmodel_latest）在不同路由组下可能指代不同模型**，
 * 例如本机配置里：
 *   auto/mmodel         → MiniMax-M3
 *   jet-hub-qodercn/mmodel → MiniMax-M3.1-Flash
 *   auto/kmodel_latest  → Kimi-K3
 *   jet-hub-qodercn/kmodel_latest → Kimi-K3.1-Pro
 * 因此别名支持两种写法：
 *   "global-name"        全局唯一，任何 provider 下含义相同
 *   "scoped/provider/xxx" 带作用域，仅当 provider 匹配时才命中
 * 有歧义的短代号**只登记带作用域的形式**，绝不全局兜底——
 * 宁可判为未计价，也不能按错误单价计费。
 */
const INDEX = (() => {
  const global = new Map();  // 归一化名 → { vendor, model }
  const scoped = new Map();  // 归一化(provider + "/" + name) → { vendor, model }
  for (const v of PRICING.vendors) {
    for (const m of v.models) {
      const names = [m.id, ...(m.aliases ?? []), ...(m.scopedAliases ?? [])];
      for (const n of names) {
        const key = normalize(n);
        if (key === "") continue;
        const isScoped = key.includes("/");
        const target = isScoped ? scoped : global;
        if (!target.has(key)) target.set(key, { vendor: v, model: m });
      }
    }
  }
  return { global, scoped };
})();

/** 本机 provider 名与配置里路由组前缀不一致时的映射（qodercn ↔ jet-hub-qodercn）。 */
const PROVIDER_ALIASES = {
  qodercn: ["qodercn", "jet-hub-qodercn", "jet-hub-qoder-cn"],
  magpie: ["magpie", "auto"],
};

/** 展开 provider 的全部可能写法。 */
function providerVariants(provider) {
  const p = normalize(provider);
  if (p === "") return [];
  for (const [canon, list] of Object.entries(PROVIDER_ALIASES)) {
    if (list.some((x) => normalize(x) === p)) {
      return [...new Set(list.map(normalize))];
    }
  }
  return [p];
}

/**
 * 解析模型名 → 价目表条目。
 *
 * 匹配顺序（先精确、后宽松）：
 *   1. provider 作用域 + 短名   → 处理 mmodel / kmodel_latest 这类歧义代号
 *   2. 原始完整名               → 如 auto/deepseek-v4.1-flash
 *   3. 剥离 provider 后的短名   → 如 deepseek-v4.1-flash
 * 都匹配不到返回 null（未计价，绝不估算）。
 *
 * @param model     模型名（可能自带 provider 前缀）
 * @param provider  样本里的 provider（可选）
 * @returns {{vendor:object, model:object} | null}
 */
export function resolveModel(model, provider) {
  const raw = String(model || "");
  if (raw === "") return null;
  const short = stripProvider(raw);
  const nShort = normalize(short);
  const nRaw = normalize(raw);

  // 1) provider 作用域
  for (const pv of providerVariants(provider)) {
    const hit = INDEX.scoped.get(pv + "/" + nShort);
    if (hit !== undefined) return hit;
  }

  // 2) 原始名（含前缀）——例如别名直接登记成 auto/mmodel
  {
    const hit = INDEX.global.get(nRaw) ?? INDEX.scoped.get(nRaw);
    if (hit !== undefined) return hit;
  }

  // 3) 剥离前缀后的短名
  {
    const hit = INDEX.global.get(nShort);
    if (hit !== undefined) return hit;
  }

  return null;
}

/** 全部可识别名（用于测试与文档）。 */
export function knownModelIds() {
  return [...INDEX.global.keys(), ...INDEX.scoped.keys()].sort();
}

/**
 * 完全忽略的模型（既不计价、也不计入「未计价」统计）。
 *
 * 收录标准：**已知不是真实在用模型**，计进去只会制造噪音。
 * 每一项都必须写明为什么忽略，便于日后复核。
 *
 * 注意：只放"确实应该当作不存在"的；
 * 真实在用但查不到官方价的模型，应保持「未计价」而不是放进这里——
 * 那样会让没算到的 token 悄悄消失。
 */
const IGNORED = new Map([
  // MiniMax 早期灰测模型，从未作为正式产品提供 API 价格，用户明确要求不计。
  ["space-bunny", "MiniMax 灰测模型，无官方定价，不纳入统计"],
  // DeepSeek 的地区部署变体（新加坡节点），价格未单列，用户明确要求不计。
  ["deepseek-v4.1-flash-sg", "DeepSeek 新加坡部署变体，无独立官方定价，不纳入统计"],
  // QoDuck：免费渠道代号，非独立模型。
  ["lmodel", "QoDuck，免费渠道代号，非独立模型"],
]);

/**
 * 该模型是否应被完全忽略（不累计 token、不计入未计价）。
 * @param {string} model 原始模型名（可带 provider 前缀）
 * @returns {boolean}
 */
export function isIgnoredModel(model) {
  const short = normalize(stripProvider(model));
  if (short === "") return false;
  return IGNORED.has(short);
}

//#endregion

//#region 计价

/**
 * 按采样计算花费。
 *
 * @param resolved  resolveModel() 的结果（null 表示未计价）
 * @param peak      该采样是否落在高峰时段
 * @param u         { uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }
 * @returns { amount, currency, priced }
 */
export function priceSample(resolved, peak, u) {
  if (resolved === null) return { amount: 0, currency: null, priced: false };

  const { vendor, model } = resolved;
  const uncached = u.uncachedInputTokens || 0;
  const cacheRead = u.cacheReadTokens || 0;
  const cacheWrite = u.cacheWriteTokens || 0;
  const output = u.outputTokens || 0;

  // 分档：按本次请求的输入总量（未命中 + 命中 + 写入）选档。
  let rates;
  if (Array.isArray(model.tiers) && model.tiers.length > 0) {
    const inputTotal = uncached + cacheRead + cacheWrite;
    rates = model.tiers[model.tiers.length - 1];
    for (const t of model.tiers) {
      if (inputTotal < t.upTo) { rates = t; break; }
    }
  } else {
    rates = model[peak && vendor.peakEnabled === true ? "peak" : "off"] ?? model.peak ?? model.off;
  }
  if (!rates) return { amount: 0, currency: null, priced: false };

  // 缓存写入的计价口径：
  //   cacheWrite 为数字 → 按该价计（0 表示官方明确写入免费）
  //   cacheWrite 为 null/缺失 → 官方未单列写入价，按「未命中输入」价计
  //     （多数厂商的写入本就等同未命中输入，如阶跃星辰官方明说
  //      「未命中的输入 Token（包括首次写入缓存的内容）按未命中单价计费」）
  // 用 hasOwnProperty 区分「写了 0」与「没写」，不能都用 `||` 兜底。
  const hasWriteRate = rates.cacheWrite !== null && rates.cacheWrite !== undefined;
  const writeRate = hasWriteRate ? rates.cacheWrite : rates.input;

  const amount =
    (uncached / 1e6) * rates.input +
    (cacheRead / 1e6) * rates.cacheRead +
    (cacheWrite / 1e6) * writeRate +
    (output / 1e6) * rates.output;

  return { amount, currency: vendor.currency, priced: true };
}

//#endregion

/** 币种是否已知。 */
export function isKnownCurrency(c) {
  return c === "CNY" || c === "USD";
}

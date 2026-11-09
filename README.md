# dsh-cost-meter

> 实时花费计量插件，用于 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）。
> 在对话框下方状态栏的「Token 用量」与「上下文」之间，实时显示本次会话花费，并按峰谷时段与模型分别计价。

![status](https://img.shields.io/badge/DSH-0.2.x-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## 功能特性

- **实时金额**：对话进行中即时累加，数字旁有脉冲圆点提示"仍在上涨"
- **多厂商计价**：内置 12 家厂商、79 个模型的价目表，国内厂商计人民币、国外厂商计美元
- **逐样本按模型计费**：每个采样用**自身携带的** `message.source.model` 定价，
  同一会话中途切换模型也能分别准确计费，面板按模型分行展示
- **峰谷分价**：按每次采样**自身时间戳**判定高峰/空闲（目前 DeepSeek 适用），跨时段会话可精确拆分
- **多币种独立累计**：人民币与美元**绝不相加**，各自独立统计
- **与官方 token 统计逐位一致**：复刻官方 tokenMeter 的 `addReplacing` + 重试去重 + 同 `(turn,step)` 唯一规则
- **冷启动重建**：DSH 重启后不会重放历史事件，首次访问时从磁盘会话日志（多帧 zstd）完整重建并记录 `baselineSeq`
- **零官方文件改动**：纯插件方式，注册到官方 `conversation.composer.dock` 槽位（order 1）
- **点击展开明细**：按模型分项金额、高峰/空闲花费、已计量 tokens、缓存命中率、各自单价等

## 界面位置

插件挂载在官方 InputBar 的 dock 区：

```
[ Token 用量 pill (order 0) ] [ dsh-cost-meter (order 1) ] [ ContextMeter ]
```

因此它**恰好**落在「token 用量」与「上下文」中间，与状态栏同排、视觉一体。

## 安装

> 要求：DSH 0.2.x（内核 `0.2.0-rc.2` / `0.2.1-rc.5` 已验证）

```bash
# 在你的 DSH profile 目录下（例如 ~/.dsh/profiles/desktop）
pnpm add file:/path/to/dsh-cost-meter
```

然后在 profile 的 `package.json` 里把 `dsh-cost-meter` 加入 `dsh.profile.bundles`：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-cost-meter"]
    }
  }
}
```

重启 DSH 客户端后生效。

## 计价规则

价目表维护在 **`src/pricing.js` 的 `PRICING`** 常量中（数据与逻辑分离，改价只需改数据）。
所有价格抓取自各厂商官方定价页，**抓取日期 2026-11-09**，单位均为「每百万 tokens」。

### 币种约定

| 类别 | 币种 | 说明 |
|---|---|---|
| 国内厂商 | **人民币（CNY，¥）** | 取中国站人民币原价 |
| 国外厂商 | **美元（USD，$）** | 取官方美元原价 |

> 两种币种**分别累计、绝不换算相加**。面板在同时存在两种币种时，会逐币种分行显示。

### 内置厂商一览

| 厂商 | 币种 | 模型数 | 峰谷计价 |
|---|---|---|---|
| DeepSeek | ¥ | 2 | ✅ 有峰谷 |
| 智谱 GLM | ¥ | 8 | — |
| 通义千问 | ¥ | 6 | — |
| MiniMax | ¥ | 2 | — |
| 月之暗面 Kimi | ¥ | 6 | — |
| 字节豆包 | ¥ | 4 | — |
| 腾讯混元 | ¥ | 6 | — |
| 小米 MiMo | ¥ | 3 | — |
| OpenAI | $ | 14 | — |
| Anthropic | $ | 10 | — |
| Google Gemini | $ | 10 | — |
| xAI Grok | $ | 8 | — |

### DeepSeek 峰谷价（元 / 百万 tokens）

| 模型 | 时段 | 输入 | 输出 | 缓存读取 |
|---|---|---|---|---|
| DeepSeek V4.1 Flash | 高峰 | 2 | 8 | 0.04 |
| DeepSeek V4.1 Flash | 空闲 | 1 | 4 | 0.02 |
| DeepSeek V4 Pro | 高峰 | 9 | 27 | 0.3 |
| DeepSeek V4 Pro | 空闲 | 4.5 | 13.5 | 0.15 |

**高峰时段**（北京时间）：`09:00–12:00`、`14:00–18:00`
**法定节假日**：按 `CN_HOLIDAYS` 表全天视为空闲价。

### 长度阶梯价

部分厂商按**单次请求的输入长度**分档计价（智谱、通义、MiniMax、Gemini Pro、Grok 等）。
价目表中用 `tiers` 字段表达，计价时按本次采样的输入总量自动选档，例如：

```js
tiers: [
  { upTo: 512000, input: 2.1,  output: 8.4,  cacheRead: 0.42 },
  { upTo: Infinity, input: 4.2, output: 16.8, cacheRead: 0.84 },
]
```

### 未知模型的处理

不在价目表中的模型**不猜价**：只累计 token、不产生金额，并在面板标记「未计价」。
这样可以避免金额悄悄偏小而不被察觉。

> ⚠️ 模型与价格会随时间变化。**请定期核对各厂商官方定价页**，并更新 `PRICING` 与 `updatedAt`。
> 已知的限时价已在对应模型的 `note` 中标注（如 `gpt-5.6-sol`、`gemini-4-argon`、`gemini-3.8-flash`）。

## 工作原理

### Host half（`src/index.js` + `src/pricing.js`）

- 监听 `session/event`，对 `assistant/message` 的 `usage` 采样
- **模型识别优先级**：
  1. `event.data.message.source.model` —— 样本自带的真实后端模型（实测 `assistant/message` 100% 携带）
  2. `state.model` —— 由 `model/selection` / `request/context` 维护的会话级模型，仅作兜底
- 用**该事件自身时间戳**判定高峰/空闲，按当时模型单价累加（而非"总 token × 单一单价"）
- 累计结果持久化到 `<DSH_HOME>/cost-meter.json`（home 级，跨 profile 共享）
- 通过 `webServer` 暴露接口

### Browser half（`client/client.js`）

- 注册到 `conversation.composer.dock`（order 1）
- 通过 `EventSource` 订阅 `/ds-cost/stream`（SSE），失败时 4 秒轮询回退
- 显示金额（按币种带 ¥ / $ 符号），点击弹出明细面板，按模型分行
- **不维护价目表副本**：单价一律由 host 下发（`pricing` 字段），避免两端不同步

## HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ds-cost/state` | 全部会话累计 + 价目表 + 峰谷状态 |
| GET | `/ds-cost/session?id=<sessionId>` | 单会话累计明细（含按模型分组） |
| GET | `/ds-cost/stream?id=<sessionId>` | SSE 实时推送 |
| GET | `/ds-cost/pricing` | 只读价目表（便于核对与调试） |
| POST | `/ds-cost/reset?id=<sessionId>` | 重置该会话计数 |

> 注意：`live` 字段只在 `/ds-cost/session` 与 SSE 推送中返回，`/ds-cost/state` 不含。

## 目录结构

```
dsh-cost-meter/
├── src/
│   ├── index.js          # Host half：事件折叠 + 累计 + HTTP 接口
│   └── pricing.js        # 价目表（PRICING）+ 模型匹配 + 计价纯函数
├── client/client.js      # Browser half：状态栏 pill + 明细面板
├── test/pricing.test.mjs # 计价自测（node 直接运行，无需 DSH）
├── cordis.patch.yml      # 向 profile 注入插件行
├── package.json
├── README.md
└── LICENSE
```

## 测试

```bash
node test/pricing.test.mjs
```

覆盖模型名归一化、峰谷计价、长度阶梯价、**同会话切换模型分别计费**、
重试替换不漂移、多币种独立、`attempt` 无 source 时回退会话级模型。

## 兼容性

| DSH 内核 | 状态 |
|---|---|
| 0.2.0-rc.2 | ✅ 已验证 |
| 0.2.1-rc.2 | ✅ 已验证 |
| 0.2.1-rc.5 | ✅ 已验证 |

## 已知限制

- 价目表为**内置常量**，官方调价后需手动更新（`src/pricing.js` 的 `PRICING`）
- 法定节假日表需按年维护
- 仅统计 `assistant/message` 与 `assistant/attempt` 的 usage，不含其他计费项
  （实测 `assistant/attempt` 均为失败尝试、不含 usage）
- 多模态音频输入价高于文本价，本插件按文本档计价
- 第三方聚合路由（`auto/*` 等）若返回的路由组代号不在价目表中，会判为未计价而非估算

## License

[MIT](./LICENSE)

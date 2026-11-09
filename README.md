# dsh-cost-meter

> 实时花费计量插件，用于 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）。
> 在对话框下方状态栏的「Token 用量」与「上下文」之间，实时显示本次会话花费（元），并按峰谷时段与模型分别计价。

![status](https://img.shields.io/badge/DSH-0.2.x-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## 功能特性

- **实时金额**：对话进行中即时累加，数字旁有脉冲圆点提示"仍在上涨"
- **峰谷分价**：按每次采样**自身时间戳**判定高峰/空闲，跨时段会话可精确拆分到两栏
- **按模型计价**：跟踪 `model/selection` 与 `request/context`，不同模型分别计费
- **与官方 token 统计逐位一致**：复刻官方 tokenMeter 的 `addReplacing` + 重试去重 + 同 `(turn,step)` 唯一规则
- **冷启动重建**：DSH 重启后不会重放历史事件，首次访问时从磁盘会话日志（多帧 zstd）完整重建并记录 `baselineSeq`
- **零官方文件改动**：纯插件方式，注册到官方 `conversation.composer.dock` 槽位（order 1）
- **点击展开明细**：高峰/空闲花费、已计量 tokens、当前峰谷单价、缓存命中率等

## 界面位置

插件挂载在官方 InputBar 的 dock 区：

```
[ Token 用量 pill (order 0) ] [ dsh-cost-meter (order 1) ] [ ContextMeter ]
```

因此它**恰好**落在「token 用量」与「上下文」中间，与状态栏同排、视觉一体。

## 安装

> 要求：DSH 0.2.x（内核 `0.2.0-rc.2` / `0.2.1-rc.2` 均已验证）

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

内置价目表（**元 / 百万 tokens**，可在 `src/index.js` 的 `PRICES` 中修改）：

| 模型 | 时段 | 输入 | 输出 | 缓存读取 |
|---|---|---|---|---|
| DeepSeek V4.1 Flash | 高峰 | 2 | 8 | 0.04 |
| DeepSeek V4.1 Flash | 空闲 | 1 | 4 | 0.02 |
| DeepSeek V4 Pro | 高峰 | 9 | 27 | 0.3 |
| DeepSeek V4 Pro | 空闲 | 4.5 | 13.5 | 0.15 |

**高峰时段**（北京时间）：`09:00–12:00`、`14:00–18:00`
**法定节假日**：按 `CN_HOLIDAYS` 表（与 [dsh-offpeak](https://github.com/) 同源）全天视为空闲价。

> ⚠️ 价目随官方调整，请自行核对 [DeepSeek 定价页](https://api-docs.deepseek.com/quick_start/pricing)。

## 工作原理

### Host half（`src/index.js`）

- 监听 `session/event`，对 `assistant/message` 的 `usage` 采样
- 用**该事件自身时间戳**判定高峰/空闲，按当时模型单价累加（而非"总 token × 单一单价"）
- 累计结果持久化到 `<DSH_HOME>/cost-meter.json`（home 级，跨 profile 共享）
- 通过 `webServer` 暴露以下接口

### Browser half（`client/client.js`）

- 注册到 `conversation.composer.dock`（order 1）
- 通过 `EventSource` 订阅 `/ds-cost/stream`（SSE），失败时 4 秒轮询回退
- 显示 ¥ 金额，点击弹面板

## HTTP 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/ds-cost/state` | 价目表 + 峰谷状态 |
| GET | `/ds-cost/session?id=<sessionId>` | 单会话累计明细 |
| GET | `/ds-cost/stream?id=<sessionId>` | SSE 实时推送 |
| POST | `/ds-cost/reset?id=<sessionId>` | 重置该会话计数 |

## 目录结构

```
dsh-cost-meter/
├── src/index.js          # Host half：事件折叠 + 定价 + HTTP 接口
├── client/client.js      # Browser half：状态栏 pill + 明细面板
├── cordis.patch.yml      # 向 profile 注入插件行
├── package.json
├── README.md
└── LICENSE
```

## 兼容性

| DSH 内核 | 状态 |
|---|---|
| 0.2.0-rc.2 | ✅ 已验证 |
| 0.2.1-rc.2 | ✅ 已验证 |

## 已知限制

- 价格表为**内置常量**，官方调价后需手动更新 `PRICES`
- 法定节假日表需按年维护
- 仅统计 `assistant/message` 与 `assistant/attempt` 的 usage，不含其他计费项

## License

[MIT](./LICENSE)

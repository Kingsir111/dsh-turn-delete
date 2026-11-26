# 设计说明与内核证据

本文解释插件为什么长这样。所有行号来自内核 **0.2.2-rc.3** 随包发布的 TypeScript 源码（`.../app.asar/dsh/node_modules/@deepseek-ai/*/src`）。

## 1. 删除是什么

模型可见历史不是日志本身，而是日志经 `surfaceOp` 投影出来的「表面」：

- `SessionEvent` 上的 `surfaceOp` 有两种形态（`dsh-session/src/types.ts:470`）：
  ```ts
  type SurfaceOp = 'append' | { op: 'replace'; startSeq: SessionSeq; endSeq: SessionSeq }
  ```
- 追加消息时 `surfaceOp: 'append'`；替换一段区间时写 `{ op:'replace', startSeq, endSeq }`，运行时按**恰好 3 个键**严格校形（`surface.ts:290`）。
- 替换节点必须在 `sourceEventSeqs` 里列全它遮蔽的每一个当前表面节点（`surface.ts:361`），且 `assistant/message` 不允许携带 `sourceEventSeqs`（`surface.ts:335`）。
- 空内容的 `system/message` / `developer/message` / `assistant/message` 投影为 `null`（`surface.ts:135`）——这就是「墓碑不产生 wire 消息」的机制来源。

于是删除 = 追加一条**不产生 wire 消息**的替换事件，覆盖目标轮在表面上的连续区间。

## 2. 硬约束一：区间不能碰 system prompt

`assertSystemHeadRewrite`（`surface.ts:491`）：表面节点 0 若是 `system/message`，覆盖它的替换只能是「单节点的 system/message」。

因此 `planTurnDeletion` 把节点 0 排除在目标轮的 origin 集合之外，其余节点仍连续。

## 3. 硬约束二：消息类事件必须落在开启的 turn/step 内

v4 关系表（`dsh-session-format-v3-to-v4/README.md:240`）：

> `system/message`, `developer/message`, `assistant/attempt` — Match an open turn and step.

**写入时不校验，重新加载时才校验**（`assertReleasedV4Relationships` 在会话解码阶段跑）。0.3.0 直接把墓碑追加在 `turn/end` 之后，于是日志在下次启动时报：

```
SessionFormatError: system/message does not match an open turn and step
```

这就是必须换载体的原因。

## 4. 载体矩阵（实测，`test/carrier.mjs`）

同一份真实日志 + 真实 v4 校验器：

| 候选 | 准入 | 附带后果 |
|---|---|---|
| `system/message` 在 `turn/end` 之后 | **拒绝** `does not match an open turn and step` | — |
| `system/message` 携带「最后开启 step」的号 | **拒绝**（那一步也已关闭） | — |
| `user/message`（空内容）在 `turn/end` 之后 | **通过** | 派生历史多一个空 user 节点 |
| `developer/message` 在 `turn/end` 之后 | **拒绝** `turn must be a non-negative integer` 等 | — |
| `system/message` 在新开的 turn/step 内 | **通过** | 需要等下一轮 |
| `plugin:*` 记录（`ignorable`） | **通过** | 不进表面，只作状态 |

结论两条：

1. **零残留 + 立刻** 只能靠空 `user/message`；
2. **零残留 + 延后一轮** 靠下一个开启 step 里的空 `system/message`。

## 5. 为什么按适配器分流

空 user 消息本身是合法消息，会不会「多出一条」取决于序列化器：

```ts
// @deepseek-ai/dsh-llm-deepseek/src/serialize.ts:123
if ((message.role === 'user' || message.role === 'assistant') && content.length === 0) continue
```

DeepSeek 适配器直接丢弃 → 模型侧零残留。
其它适配器（例如 `dsh-llm-pi-ai`，只在 system 分支做空判断）会把空消息发出去，因此那些会话走延后路径。

判定：`agent.model.current().provider` 是否以 `deepseek` 开头。

## 6. 状态与幂等

删除结果不依赖识别墓碑（v4 上墓碑没有生产者身份），而是记插件记录：

- `plugin:turn-delete/request`：`{ turn, assistantMessageId, requestedAt }`
- `plugin:turn-delete/result`：`{ requestSeq, turn, status: 'applied' | 'refused' | 'failed', code?, tombstoneSeq? }`

二者都由内核的 `appendPluginRecord()` 写入（`dsh-session/src/index.ts:498`）：带 `ignorable: true`，不进模型面、其它读者自动跳过、fork/恢复/格式迁移都会带上。

幂等性由两处保证：`planTurnDeletion` 发现目标轮的表面节点已全部消失时直接返回 `alreadyDeleted`；`applyPending` 见到该状态只结单、不写第二条墓碑。

## 7. 拒绝的三类情况

| 代码 | 判据 | 为什么拒绝 |
|---|---|---|
| `TURN_NOT_CLOSED` | 找不到该轮的 `turn/start`/`turn/end` 括号 | 未结束的轮次没有稳定区间 |
| `TURN_COMPACTED` | 某个表面节点的 origin 跨出本轮的集合 | 摘要是整体替换，摘不干净 |
| `TURN_PROTECTED` | 区间包含「最新一个 system 节点」 | 删掉会让后续请求丢失系统提示 |

## 8. 前端那一层

内核没有公开「整轮可见性」扩展点，所以「已删除」的呈现靠：

- `conversation.chat.assistant-actions`：动作行里的垃圾桶（只 `require('react')`，图形内联 SVG）。
- `conversation.chat.turnTail`：读取 `/dsh-turn-delete/deleted` 的状态，把该轮的行隐藏。
- 隐藏依赖 `data-turn-tail` / `data-chat-flow-kind` 两个 DOM 契约；这层失效时，**模型上下文的删除仍然成立**。

## 9. 已知的坑（写给未来的自己）

- `ctx.sessions.create({ seed })` 只把会话放进内存并 announce，**不落盘**；要等这条会话第一次 append 才会写代次文件。给「从文件恢复会话」这类场景用，必须自己把日志写到 `<sanitized cwd>/<sessionId>/session.v4.jsonl.zstd`。
- Electron 的 Node 24 里 `zlib.zstdDecompressSync` 只解第一帧；DSH 的会话日志是多帧 zstd，解包要用系统 Node 26。
- 会话列表来自 Host 的活动会话存储，不是扫描 `sessions` 目录；磁盘上放文件不会出现在侧栏。

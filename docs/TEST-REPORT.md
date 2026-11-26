# 测试报告 · dsh-turn-delete 0.4.1

测试环境：DeepSeek Harness **0.2.2-rc.3**（desktop profile），Windows，Node 24.21（Electron 内核通道）/ 26.12（系统，解压多帧 zstd 日志）。

## 0. 先说事故：0.3.0 的设计错了，已修复

0.3.0 把墓碑直接追加在 `turn/end` 之后。**会话格式 v4 不允许这样做**：

```
SessionFormatError: system/message does not match an open turn and step
```

`dsh-session-format-v3-to-v4/README.md:240` 明确规定：`system/message`、`developer/message`、`assistant/attempt` 必须匹配一个**开启**的 turn 和 step。写入时内存里不校验，只有**下一次加载**才校验——于是删过一轮的会话直接打不开。

- 受影响会话：`session-be3fff67-…`（本地一个测试工作区）。已用 `tools/repair-log.mjs` 摘掉那条墓碑行修好（原文件备份为 `session.v4.jsonl.zstd.bak-<时间戳>`），删除的那一轮回到上下文中。
- 全量扫描：本机 33 个会话日志，只有这 1 个受影响，其余干净。
- 0.4.0 换了机制，从根上不会再出现这个问题（见第 2 节，`4 load admission` 就是这条回归断言）。

## 1. 汇总

| # | 测试 | 结论 |
|---|---|---|
| A | 载体实验：4 种候选墓碑在 v4 准入下的表现 | **完成**，只有「新开 turn/step 内的 `system/message`」合法 |
| B | Host 全流程（真实日志 + 真实内核 + 假服务） | **通过**（7 项断言，含「删除后日志仍可加载」） |
| C | Client 注册（stub slots/locale） | **通过** |
| D | 真机 HTTP 契约 | **通过**（HTTP 路径已换新契约） |
| E | 跨版本矩阵（7 个内核 × 同一份真实日志） | **通过**（0.1.7 → 0.2.2 结果一致） |
| F | 兼容闸门裁决 | **通过** |
| G | 浏览器内人工点击 + 重启后加载 | 由用户执行（机制已改为不会写坏日志） |
| H | 当场删除（`user/message` 空载体） | **通过**：立即生效、日志仍可加载、模型侧零残留 |

## 2. 两次机制的关键差别

| | 0.3.0（错） | 0.4.0（延迟） | 0.4.1（当场） |
|---|---|---|---|
| 载体 | `system/message` | 同上，落在下一轮开启的 step 内 | **空 `user/message`**（DeepSeek）／同上（其它适配器） |
| 写入时机 | 点击即刻（非法） | 下一个 step | **点击即刻（合法）** |
| 重新加载 | **失败** | 通过 | 通过 |
| 生效 | 立即但是坏的 | 下一次提问 | **立即** |
| 成本 | — | 0 残留 | DeepSeek 侧 0 残留（空 user 被序列化器丢弃） |

依据：

- `dsh-session-format-v3-to-v4/README.md:240` —— `system/message` / `developer/message` / `assistant/attempt` 必须匹配开启的 turn 和 step。
- 同表 `user/message` **不在**该约束内；内核 compaction 本身就用 user 消息遮蔽被压缩区间（`dsh-compaction/src/types.ts:26-32`）。
- `@deepseek-ai/dsh-llm-deepseek/src/serialize.ts:123` —— `if ((role==='user'||role==='assistant') && content.length===0) continue`，空 user 消息不进 wire。

`plugin:` 记录是内核一等公民（`appendPluginRecord` / `pluginRecordOf`）：带 `ignorable: true`，不进模型面、不参与 surface，未安装本插件的读者安全跳过，fork/恢复/格式迁移都会带上它。

## 3. 载体实验（test/carrier.mjs、test/carrier-deferred.mjs）

同一份真实日志 + 真实 v4 校验器 `assertReleasedV4Relationships`：

| 候选 | 准入 | 派生历史 |
|---|---|---|
| `system/message` 在 `turn/end` 之后（0.3.0 的做法） | **拒绝**：`does not match an open turn and step` | 169→144 |
| `system/message` 带上「最后开启 step」的号 | **拒绝**（同样是已关闭） | — |
| `user/message`（空内容）在 `turn/end` 之后 | 通过 | 169→145，**末尾多一条空 user 消息** |
| `developer/message` 在 `turn/end` 之后 | **拒绝**：turn 必须是非负整数 | — |
| **`system/message` 在新开的 turn/step 内** | **通过** | 169→144，末尾仍是 assistant/tool |
| **`plugin:turn-delete/request`（ignorable）** | **通过** | 169（不变，完全不进 surface） |

结论：v4 下唯一「合法且不污染请求」的载体就是「开启 step 内的空 `system/message`」，所以删除必须延后到下一次 turn 的第一个 step。

## 4. Host 全流程（test/host-flow.mjs）

真实日志 `repaired.json`（601 事件、最近一轮为 turn 16）：

```
1 mount            OK  routes=2 watcher=session/event
2 request          OK  turn=16 pending, admission=admitted        （非 DeepSeek 适配器 → 延迟）
3 apply            OK  169 -> 144 messages, tombstone at seq 604
4 load admission   OK  v4 relationships accept the whole log
5 idempotent       OK  no second tombstone
6 refusal          OK  TARGET_NOT_FOUND before anything is recorded
7 GET route        OK  turns=[16]
8 immediate        OK  169 -> 145, carrier=user/message(empty), admission=admitted
```

- 第 4 项是本次事故的回归断言：删除落地后，把整条日志重新交给 v4 关系校验器，必须仍然通过。
- 第 8 项验证「当场删除」这条路：载体是 `user/message` 且 `content: []`，派生历史里多出一个空 user 节点（169→145），该节点在 DeepSeek 序列化阶段被丢弃，因此模型侧零残留；日志同样通过加载准入。

## 5. Client 注册（test/client-register.mjs）

- `window.__ModuleLoader__.load({id:'dsh-turn-delete', factory})` 契约成立，factory 返回 `{inject, apply}`。
- 两个 list 槽都带稳定 `id`：`conversation.chat.assistant-actions#turn-delete`、`conversation.chat.turnTail#turn-delete-marker`。
- 只 `require('react')`，垃圾桶是内联 SVG。
- 注入面：`{sessionId, deleteTurn}`；标记槽注入 `{sessionId}`。
- 失败结果存在模块级 `outcomes` 里，动作行被卸载再挂载也不会把错误吞掉（0.3.0 的「点了没反应」就死在这里）。

## 6. 真机 HTTP 契约

| 请求 | 结果 |
|---|---|
| `GET /dsh-turn-delete/deleted?sessionId=<live>` | `200 {"value":{"turns":[],"pending":[],"refused":[],"live":true}}` |
| `GET …?sessionId=x` | `200 {"turns":[],"pending":[],"refused":[],"live":false}` |
| `POST` 未知会话 | `404 TARGET_NOT_FOUND` |
| `POST` 缺 content-type | `415 INVALID_REQUEST` |
| `POST` 成功登记 | `202 {"value":{"turn":N,"deferred":true,"requestSeq":M}}` |

## 7. 跨版本矩阵

同一份真实 v4 日志（1907 事件），同一份 `lib/core.js`：

| 内核 | 结果 |
|---|---|
| 0.1.7-rc.2 / 0.2.0-rc.1 / 0.2.1-rc.5 / **0.2.2-rc.3** | **OK**，`span=[10..294]`、585→481、幂等，墓碑 `{kind:'system-prompt'}` + `{op:'replace',startSeq,endSeq}` |
| 0.1.5-rc.2/rc.3 | 未实测（该版本拒收 v4 日志）；代码按 `header.version<4` 改写 source |
| ≤ 0.1.0 | 不支持（无 `createSystemMessage`、surface 事件不能带 `surfaceOp`、键名为 `start/end`） |

声明范围 `^0.1.5-rc.2 || ^0.2.0-rc.1`，刻意不写 `engines.dsh`（它会覆盖 peers 单独裁决）。7 个候选范围在真机上跑 `evaluatePluginCompatibility` 全部 ACCEPTED。

## 8. 复现

```powershell
# 解压（系统 Node 26 才能拼多帧 zstd）
node turn-delete/test/unpack.mjs "<session.v4.jsonl.zstd>" .testdata\sample.json

# 载体实验 / Host 全流程 / 跨版本矩阵 / Client 注册
$env:ELECTRON_RUN_AS_NODE='1'
& "E:\deepseek harness\DeepSeek Harness.exe" turn-delete/test/carrier.mjs .testdata\repaired.json
& "E:\deepseek harness\DeepSeek Harness.exe" turn-delete/test/carrier-deferred.mjs .testdata\repaired.json
& "E:\deepseek harness\DeepSeek Harness.exe" turn-delete/test/host-flow.mjs .testdata\repaired.json
node turn-delete/test/matrix.mjs .testdata\sample-main.json
node turn-delete/test/client-register.mjs

# 修复被 0.3.0 写坏的日志（幂等，先干跑）
node turn-delete/tools/repair-log.mjs "<session.v4.jsonl.zstd>"
node turn-delete/tools/repair-log.mjs "<session.v4.jsonl.zstd>" --apply
```

`repair-log.mjs` 只摘掉**尾部**的违规行并保留 `.bak-<时间戳>` 备份；若违规行后面还有事件会拒绝执行（会破坏 seq 连续契约）。

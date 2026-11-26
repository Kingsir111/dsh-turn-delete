# 贡献指南

## 三条不变量

改这个插件时，以下三条任一被破坏，就会写出「当场看着正常、下次启动才发现坏了」的日志——0.3.0 就是这么坏过一次：

1. **消息类事件（`system/message`、`developer/message`、`user/message`、`tool/result`）必须落在一个开启的 turn 和 step 内**，否则 v4 加载准入会拒整条日志。
2. **表面节点 0（system prompt）永远不进替换区间**；覆盖它的替换只能是「单节点 system/message」。
3. **`sourceEventSeqs` 必须列全**被遮蔽的每一个当前表面节点，且不能带未来 seq、不能重复。

因此每次改删除路径，都要跑 `test/host-flow.mjs`：它最后一条断言就是「删除落地后整条日志仍通过 v4 加载准入」。

## 本地跑测试

前置：`node_modules/@deepseek-ai/*` 能解析到内核包（目录联接即可，或在 `compat-matrix/v-0.2.2-rc.3/node_modules` 里 `npm i @deepseek-ai/dsh-session@0.2.2-rc.3 @deepseek-ai/dsh-llm@0.2.2-rc.3` 再联接过来）。

```sh
# 1. 纯前端契约（不需要内核）
node test/client-register.mjs

# 2. 需要真实日志：先用系统 Node 26 解包（多帧 zstd）
node test/unpack.mjs "<session.v4.jsonl.zstd>" .testdata/sample.json

# 3. 载体实验 + 宿主全流程（需要内核）
ELECTRON_RUN_AS_NODE=1 "<DSH_NODE_EXECUTABLE>" test/carrier.mjs .testdata/sample.json
ELECTRON_RUN_AS_NODE=1 "<DSH_NODE_EXECUTABLE>" test/host-flow.mjs .testdata/sample.json

# 4. 跨版本矩阵（需要 compat-matrix/v-<version>/node_modules）
node test/matrix.mjs .testdata/sample.json

# 5. 兼容闸门裁决
ELECTRON_RUN_AS_NODE=1 "<DSH_NODE_EXECUTABLE>" test/compat-gate.mjs
```

`DSH_NODE_EXECUTABLE` 是桌面版的 Electron 可执行文件（`DeepSeek Harness.exe`）；`DSH_INSTALL_DIR` 指向 `.../app.asar/dsh/node_modules/@deepseek-ai/dsh`。

## 不要提交

- `.testdata/`：真实会话日志的副产品，含你的对话内容。
- 任何 `*.bak-*`、`*.zstd`、`*.jsonl`：同上。
- `node_modules/`。

## 提 PR 前

- 两个 README 与 `docs/DESIGN.md` 的行为描述要和新代码一致。
- 新增拒绝分支时，给出错误码并更新 README 的「拒绝的情况」表和 `locale/*.json` 文案（中英都要）。
- 升级内核适配时，在 `CHANGELOG.md` 写清实测到哪个版本、哪条规则变了。

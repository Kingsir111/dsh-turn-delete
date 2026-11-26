# GitHub 发布清单

## 一、要提交的文件（完整列表）

```
dsh-turn-delete/
├─ package.json              # 清单：name/version/repository/dsh.bundle/dsh.client/peers
├─ cordis.patch.yml          # 插入插件行：id: turn-delete
├─ icon.svg                  # 插件图标（插件面板/详情页）
├─ LICENSE                   # MIT
├─ README.md                 # 中文主 README（仓库首页）
├─ README.en.md              # 英文 README
├─ CHANGELOG.md              # 版本历史（含 0.3.0 事故与修复）
├─ CONTRIBUTING.md           # 三条不变量 + 测试步骤
├─ .gitignore                # 排除 .testdata / 日志 / 备份
├─ lib/
│  ├─ core.js                # 删除算法（零内核 import，可跨版本复用）
│  ├─ index.js               # Host：三条路由 + step 监听 + 删除执行
│  └─ client.js              # 浏览器：垃圾桶按钮 + 确认 + 已删除标记
├─ locale/
│  ├─ zh.json                # 显示元数据 + UI 文案（中文）
│  └─ en.json                # 同上（英文）
├─ docs/
│  ├─ DETAIL.md              # 插件详情页正文（插件面板里显示）
│  ├─ DESIGN.md              # 设计说明与内核证据（含行号）
│  └─ TEST-REPORT.md         # 测试报告：载体实验/宿主流程/跨版本矩阵
├─ test/                     # 可复现的测试脚本（体积小，建议提交）
│  ├─ unpack.mjs             # 解包多帧 zstd 日志
│  ├─ simulate.mjs           # 离线逐轮删除
│  ├─ carrier.mjs            # 四种候选载体的 v4 准入实验
│  ├─ carrier-deferred.mjs   # 延迟设计 + 插件记录实验
│  ├─ host-flow.mjs          # 宿主全流程（含「删除后仍可加载」回归）
│  ├─ client-register.mjs    # 前端槽位注册契约
│  ├─ matrix.mjs             # 跨内核版本矩阵
│  ├─ compat-gate.mjs        # 兼容闸门裁决
│  └─ proof-context.mjs      # 「文本真的从上下文消失」的证据脚本
└─ tools/                    # 手工救援工具（建议提交）
   ├─ repair-log.mjs         # 修「历史加载失败」的会话
   ├─ clone-session.mjs      # 换 id 克隆会话
   └─ write-session-log.mjs  # 按指定 id 把解包日志落盘
```

## 二、绝对不要提交

- `.testdata/`（解包后的真实会话日志，含你的私人对话）
- 任何 `*.zstd` / `*.jsonl` / `*.bak-*`
- `node_modules/`、`.pnpm-store/`

`.gitignore` 已覆盖这些。提交前用 `git status` 自查一遍有没有多出来的日志文件。

## 三、发布前必须改的占位符

`package.json` 里三处 `YOUR_*`：

```json
"author": "YOUR_NAME <you@example.com>",
"repository": { "url": "git+https://github.com/YOUR_GITHUB_USER/dsh-turn-delete.git" },
"bugs": { "url": "https://github.com/YOUR_GITHUB_USER/dsh-turn-delete/issues" },
"homepage": "https://github.com/YOUR_GITHUB_USER/dsh-turn-delete#readme"
```

README / README.en 里的 `YOUR_GITHUB_USER` 两处也要替换。

## 四、仓库 About 文案

**Description（一行，建议 118 字符内）**

```
Delete one finished turn from a DeepSeek Harness session — the turn leaves the model context, the append-only log stays intact.
```

**Topics**

```
deepseek-harness  dsh  dsh-plugin  ai-agent  context-management  conversation  session  turn-delete  typescript  nodejs
```

**Website** 留空，或填你的 DSH 相关说明页。

## 五、首个 Release（v0.4.2）

**Tag**：`v0.4.2`
**Title**：`v0.4.2 — 当场删除一轮对话（内核 0.2.2-rc.3）`

**Body**

```markdown
在 DeepSeek Harness 的会话里删掉一整轮对话：只删模型上下文，不删会话、不改日志。

## 亮点
- 点击即刻生效（DeepSeek 适配器），零残留：空 `user/message` 表面替换，序列化阶段被丢弃
- 其它适配器自动降级为「下一次提问起生效」，仍然零残留
- 日志一个字节不改：原始提问/回答/工具记录仍可审计、可回放
- 永远不会碰 system prompt 节点；三类危险情况明确拒绝而不是写坏日志
- 附带三个救援工具：修日志、克隆会话、按指定 id 落盘

## 兼容
内核 `0.1.7` → `0.2.2-rc.3` 实测一致（同一份 1907 事件真实日志重放，区间/派生历史/墓碑形状完全相同，且幂等）。

## 安装
```sh
dsh plugin --profile desktop add github:YOUR_GITHUB_USER/dsh-turn-delete
```

## 注意
内核处于 developer preview，会话格式会收紧。升级内核后建议：开一个三轮的临时会话，删中间轮，确认 (1) 该轮从上下文消失 (2) 重启后会话仍能加载（`docs/TEST-REPORT.md` 里第 4 项就是这条回归断言）。
```

## 六、后续可加（非必需）

- `.github/ISSUE_TEMPLATE/bug.yml`：要求贴内核版本 `dsh --version`、错误码、是否 DeepSeek 适配器。
- `.github/workflows/check.yml`：只跑 `node test/client-register.mjs`（它不依赖内核，能作为最小 CI 门禁）。
- `docs/截图.gif`：垃圾桶 → 确认 → 该轮消失，10 秒内。

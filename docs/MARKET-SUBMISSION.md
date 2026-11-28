# 插件市场收录（awesome-dsh-plugin）

目标仓库：**[beancookie/awesome-dsh-plugin](https://github.com/beancookie/awesome-dsh-plugin)**（站点 [awesome-dsh-plugin.com](https://awesome-dsh-plugin.com)，4000+ 条目）
分支：`master`

## 一、投稿形式（和早期笔记不同，已按现状核对）

不是 `data/plugins/*.yml`。**每个语言 README 各加一行**，分类下按 `owner/repo` 字母序排列，CI 用 `scripts/check-order.mjs` 校验；合并后 `scripts/build-site.mjs` 会自动重排、重建站点和 `/plugins.json`。

- 分类：`session` → 中文标题「会话与消息」，英文标题「Sessions & Messages」
- 行格式（中文，以句号结尾）：

```markdown
- [Kingsir111/dsh-turn-delete](https://github.com/Kingsir111/dsh-turn-delete) — 从会话的模型上下文中删除任意轮次，可多选；日志保持追加、可审计。
```

- 行格式（英文，以句点结尾）：

```markdown
- [Kingsir111/dsh-turn-delete](https://github.com/Kingsir111/dsh-turn-delete) - Remove any turn from a session's model context, several at once; the append-only log stays intact.
```

## 二、收录门槛自查

| 要求 | 当前状态 |
|---|---|
| `package.json` 声明 `dsh.bundle.patch` | ✅ `"bundle": { "patch": "./cordis.patch.yml" }` |
| 仓库根有 `cordis.patch.yml` | ✅ 存在 |
| 真实可用代码（非占位/纯 README） | ✅ `lib/core.js`、`lib/index.js`、`lib/client.js` + 测试 |
| 活跃维护 | ✅ 2026-11 持续更新 |
| 仓库带 `dsh-plugin` topic | ⚠️ **需确认**：仓库 Topics 里必须有 `dsh-plugin`（另有若干自定义 topic 无妨） |
| 描述只讲功能、无营销词 | ✅ 见上面的行文 |
| 官方 `@deepseek-ai/*` 用 peerDependencies | ✅ 4 条 peers，无 dependencies |

## 三、提交流程

### 1. 确认 topic

仓库首页 → About 右侧齿轮 → Topics 填入 `dsh-plugin`（回车成 chip）→ 保存。

### 2. Fork + 克隆

```sh
git clone https://github.com/<你的账号>/awesome-dsh-plugin.git
cd awesome-dsh-plugin
```

### 3. 插入两行（用仓库自带的排序规则）

插件仓库里带了一个插入工具，它会按 `owner/repo` 字母序找到正确位置：

```sh
# 干跑，只打印将插入到哪一行、前后是谁
node <插件仓库>/tools/market-entry.mjs .

# 确认无误后写入
node <插件仓库>/tools/market-entry.mjs . --apply
```

### 4. 用榜单自己的校验（必做）

```sh
node scripts/check-order.mjs     # 期望：order OK: plugin lines sorted ...
```

### 5. 提交并推

```sh
git checkout -b add-kingsir111-dsh-turn-delete
git add README.md README.en.md
git commit -m "Add Kingsir111/dsh-turn-delete (session)"
git push -u origin add-kingsir111-dsh-turn-delete
```

### 6. 开 PR

- 标题：`Add Kingsir111/dsh-turn-delete (session)`
- 正文：

```markdown
Adds [Kingsir111/dsh-turn-delete](https://github.com/Kingsir111/dsh-turn-delete) to **会话与消息 / Sessions & Messages**.

Deletes chosen turns from a session's model context — several turns at once — while the append-only event log stays intact and auditable. Works on DSH `0.1.7` through `0.2.x`.

- `package.json` declares `dsh.bundle.patch` → `cordis.patch.yml`
- `@deepseek-ai/*` are peer dependencies only
- Repo carries the `dsh-plugin` topic
- Install: `dsh plugin --profile desktop add github:Kingsir111/dsh-turn-delete`
```

## 四、合并之后

- 站点与 `/plugins.json` 由 CI 自动重建，无需再动别的文件
- 之后别人可以：`dsh plugin --profile web add github:Kingsir111/dsh-turn-delete`
- 如果想让安装跳过 `allowBuilds` 构建授权，把包发到 npm（`npm publish`），榜单会自动探测并优先用 npm 源

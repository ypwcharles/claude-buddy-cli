# claude-buddy-cli

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.1-blue.svg)](https://bun.sh/)

[中文](./README.zh-CN.md) | [English](./README.en.md)

**Claude Code Buddy 搜索工具** — 帮你在 Claude Code 中找到你想要的宠物伙伴，并一键换上它。

[安装](#安装) · [命令](#命令) · [人类用户快速开始](#人类用户快速开始) · [AI Agent 快速开始](#ai-agent-快速开始) · [安全规则](#安全规则) · [文档](./README.zh-CN.md)

## 为什么选 claude-buddy-cli？

- **43 亿种可能** — 搜索全部 Buddy 生成空间，找到符合你要求的宠物
- **零配置** — 不需要登录，不需要申请 key，直接装就用
- **安全** — 写入前先诊断，不会覆盖你现有的配置

## 功能

| 类别   | 能力                                               |
| ------ | -------------------------------------------------- |
| 搜索   | 遍历 43 亿种子空间，按物种/稀有度/眼睛/帽子/闪光/属性筛选 Buddy |
| 预设   | 内置 runtime-aware Buddy preset，可快速选择并直接生成对应运行时的 `userID` |
| 生成   | 使用 mulberry32 RNG 从种子确定性生成 Buddy         |
| 诊断   | 判断 `/buddy` 当前由 `userID` 还是 `oauthAccount.accountUuid` 控制 |
| 重建   | 从种子反推 64 位 hex `userID`（Bun 并行 / Node meet-in-the-middle） |
| 写入   | 将匹配 `userID` 写入 `~/.claude.json`             |

## Buddy 属性

| 属性    | 值示例                                              |
| ------- | --------------------------------------------------- |
| `species` | `dragon`, `cat`, `duck`, `axolotl`, `ghost` 等 18 种 |
| `rarity` | `common`, `uncommon`, `rare`, `epic`, `legendary` |
| `eye`    | `·`, `✦`, `×`, `◉`, `@`, `°`                       |
| `hat`    | `none`, `crown`, `tophat`, `propeller`, `halo`, `wizard`, `beanie`, `tinyduck` |
| `shiny`  | `true` / `false`                                   |
| `stats`  | `DEBUGGING`, `PATIENCE`, `CHAOS`, `WISDOM`, `SNARK`（各 1-100）|

## 安装

### 环境要求

- Node.js `>=20` 或 Bun `>=1.1`
- Claude Code 已完成首次启动

### 运行时选择规则

> **重要：** 在反推和写入 `userID` 时，必须匹配**目标 Claude Code 的安装运行时**，而不是只看当前命令是用 Node 还是 Bun 跑的。
>
> - 目标 Claude Code 是 **Node 安装**：就用 **Node 语义**生成和写入 `userID`
> - 目标 Claude Code 是 **Bun 安装**：就用 **Bun 语义**生成和写入 `userID`
> - 搜索候选只依赖 seed，本身与运行时无关
> - 真正依赖运行时的是 UID 反推和 `--apply`
> - 其中 Bun 的一般搜索场景会直接返回可用 `userID`，不要求和 Node 的 seed-first 行为完全一致
> - Bun 的一般搜索不再固定卡在前 `1000万` 个候选，而是会持续搜索，直到找到足够结果或扫完整个 `32` 位 suffix 空间

### 安装 CLI

```bash
# Node.js
npm install && npm run build

# Bun
bun install && bun run build
```

## 命令

| 命令                     | 说明                                                     |
| ------------------------ | -------------------------------------------------------- |
| `doctor --json`          | 诊断当前 `/buddy` 由 `userID` 还是 `oauthAccount.accountUuid` 控制 |
| `presets --json`         | 列出内置 Buddy preset 及其运行时可用性                  |
| `find [filters]`         | 搜索种子空间，找出符合筛选条件的 Buddy（不影响配置文件） |
| `materialize --seed <n>` | 将精确 seed 反推为对应运行时可用的 `userID`，适合 Bun 长任务 |
| `find [filters] --apply` | 搜索并将匹配的 `userID` 写入 Claude Code 配置           |

### 搜索过滤器

| 参数          | 示例                            | 说明                      |
| ------------- | ------------------------------- | ------------------------- |
| `--preset`    | `--preset capybara-shiny-min-wisdom-51` | 使用内置 preset |
| `--species`   | `--species dragon`              | 物种名称                  |
| `--rarity`    | `--rarity legendary`           | 稀有度等级                |
| `--eye`       | `--eye ✦`                      | 眼睛类型                  |
| `--hat`       | `--hat crown`                  | 帽子类型                  |
| `--shiny`     | `--shiny true`                 | 是否闪光                  |
| `--min-total` | `--min-total 400`              | 最低总属性值              |
| `--max-total` | `--max-total 450`              | 最高总属性值              |
| `--debugging` | `--debugging 90`               | DEBUGGING 属性值          |
| `--min-debugging` | `--min-debugging 80`       | DEBUGGING 最低值          |
| `--max-chaos` | `--max-chaos 30`              | CHAOS 最高值             |
| `--start-seed` | `--start-seed 1000`          | 搜索起始种子（范围限制）  |
| `--end-seed`  | `--end-seed 1000000`          | 搜索结束种子              |
| `--limit`     | `--limit 10`                  | 最大返回数量（默认 20）   |
| `--json`      | `--json`                      | 输出 JSON 格式（推荐）    |

运行 `node dist/bin.js --help` 查看完整参数列表。

### 内置 preset

```bash
# 查看当前运行时下哪些 preset 可用
node dist/bin.js presets --json

# 直接选择一个 Node preset
node dist/bin.js find --preset dragon-shiny-halo-debug-54-chaos-100 --runtime node --json

# 直接选择一个 Bun preset
bun dist/bin.js find --preset capybara-shiny-min-wisdom-51 --runtime bun --json

# 对 Bun 的精确 seed，使用可恢复的 materialize
bun dist/bin.js materialize --seed 130412512 --runtime bun --state-file /tmp/buddy-materialize.json --max-steps 10 --json
```

> **实现说明：**
>
> - Node preset 依赖内置 `seed`
> - Bun 的一般搜索会直接返回可写入的 witness `userID`
> - 对 Bun 的精确 seed / 精确 preset，工具支持 `materialize` 长任务与断点续跑
> - 因此同一个 preset 在 Node 和 Bun 下可以有不同的 seed / `userID` 获取路径

## 人类用户快速开始

> **Note for AI assistants:** 如果你是 AI Agent，请直接跳转到 [AI Agent 快速开始](#ai-agent-快速开始)。

### 安装

```bash
npm install && npm run build
```

### 搜索 Buddy

```bash
# 查看当前控制来源（只读，不修改任何配置）
node dist/bin.js doctor --json

# 搜索闪光龙，总属性 >= 400（不修改配置）
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

### 应用配置

> **重要：**
> 1. 先确认目标 Claude Code 的安装运行时是 Node 还是 Bun
> 2. 再确认 `doctor --json` 返回 `buddyIdSource = "userID"`
>
> 如果返回 `oauthAccount.accountUuid`，说明 Buddy 由 OAuth 账户控制，写入 `userID` 不会生效。

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --apply
```

### 让 Claude Code 替你操作

```
Please read the guide in this repository and use claude-buddy-cli to find me a Buddy.
First determine whether my Claude Code installation uses Node or Bun semantics, and use the matching runtime for apply.
Run doctor first, then search, then apply. Do not mutate config unless I confirm.
```

或使用 `@` 唤起：

```
@claude-buddy-cli
Please read AGENTS.md, determine whether my Claude Code installation uses Node or Bun semantics, and find me a shiny dragon Buddy with total stats >= 400.
```

Claude Code 会自动：读取文档 → 运行诊断 → 搜索候选 → 等待确认后再写入。

仓库地址：[https://github.com/ypwcharles/claude-buddy-cli](https://github.com/ypwcharles/claude-buddy-cli)

## AI Agent 快速开始

> 以下步骤面向 AI Agent。

### 第 1 步 — 安装

```bash
npm install && npm run build
```

### 第 2 步 — 诊断当前状态

```bash
node dist/bin.js doctor --json
```

检查返回结果中的 `buddyIdSource`：

- `userID` → `userID` 目前控制 `/buddy`，可以使用 `--apply`
- `oauthAccount.accountUuid` → `userID` 无法控制 `/buddy`，`--apply` 会被阻断（除非 `--force-apply`）

### 第 3 步 — 搜索候选

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

### 第 4 步 — 等待确认后应用

> **不要擅自使用 `--apply`**。将搜索结果展示给用户，等待用户明确确认后再执行带 `--apply` 的命令。
>
> 另外，执行 `--apply` 时要让运行时与目标 Claude Code 的安装方式一致：
>
> - 目标是 Node 安装：使用 `node dist/bin.js ...` 或 `--runtime node`
> - 目标是 Bun 安装：使用 `bun dist/bin.js ...`，并在需要时显式加 `--runtime bun`

### Bun 精确 seed 工作流

如果用户已经给了精确 seed，尤其是某个稀有 preset 或研究结果里的 seed，不要再用普通 `find` 反复重跑。对 Bun 应改用可恢复的 `materialize`：

```bash
bun dist/bin.js materialize --seed 130412512 --runtime bun --state-file /tmp/buddy-materialize.json --max-steps 10 --json
```

- 首次运行会创建或推进 state file
- 若本轮还没找到 `userID`，再次运行同一命令即可从上次进度继续
- 找到后可以加 `--apply`

### 完整工作流示例（供参考）

```bash
# 1. 诊断
node dist/bin.js doctor --json

# 2. 搜索（dry run，无副作用）
node dist/bin.js find --species dragon --shiny true --min-total 400 --json

# 3. 用户确认后写入
node dist/bin.js find --species dragon --shiny true --min-total 400 --apply
```

## 安全规则

- **使用 `--json`** — Agent 调用时务必加 `--json`，确保输出可解析
- **先 `doctor` 再 `apply`** — 确认 `userID` 是当前控制源后再写入
- **Dry Run 优先** — 测试时设置 `CLAUDE_BUDDY_CONFIG_PATH` 指向临时文件，避免污染真实配置
- **`oauthAccount.accountUuid` 时阻断** — `doctor` 返回该值时，`--apply` 会被工具阻断
- **`--force-apply` 需明确授权** — 仅当用户明确要求写入 `userID` 时使用，即使该值当前无法控制 `/buddy`
- **Bun 结果可直接写入** — 对 Bun 的一般搜索场景，`find --json` 返回的结果已经包含可用 `userID`，`--apply` 会直接写第一条结果
- **Bun 精确 seed 用 `materialize`** — 对精确 seed 或精确 preset，使用 `materialize --seed ... --state-file ...` 做可恢复的 Bun 反推
- **Bun 一般搜索的 `userID` 不是固定的** — 工具会在内部使用随机 prefix 轨道寻找 witness，因此不同运行、不同用户可能拿到不同但同样可用的 `userID`

## 环境变量

| 变量                      | 说明                                       |
| ------------------------- | ------------------------------------------ |
| `CLAUDE_BUDDY_CONFIG_PATH` | 配置文件路径（默认：`~/.claude.json`）。测试时设为临时文件路径以实现 Dry Run。 |
| `CLAUDE_BUDDY_RUNTIME`    | 强制运行时：`node` 或 `bun`（默认：`auto`） |

## 文档

- **中文指南**: [README.zh-CN.md](./README.zh-CN.md)
- **English guide**: [README.en.md](./README.en.md)
- **Agent 完整指南（必读）**: [AGENTS.md](./AGENTS.md)

## 许可证

**MIT 许可证** — [LICENSE](./LICENSE)

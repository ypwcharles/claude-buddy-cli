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
| `find [filters]`         | 搜索种子空间，找出符合筛选条件的 Buddy（不影响配置文件） |
| `find [filters] --apply` | 搜索并将匹配的 `userID` 写入 Claude Code 配置           |

### 搜索过滤器

| 参数          | 示例                            | 说明                      |
| ------------- | ------------------------------- | ------------------------- |
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

> **重要：** 确认 `doctor --json` 返回 `buddyIdSource = "userId"` 后再执行 `--apply`。如果返回 `oauthAccount.accountUuid`，说明 Buddy 由 OAuth 账户控制，写入 `userID` 不会生效。

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --apply
```

### 让 Claude Code 替你操作

```
Please read the guide in this repository and use claude-buddy-cli to find me a Buddy.
Run doctor first, then search, then apply. Do not mutate config unless I confirm.
```

或使用 `@` 唤起：

```
@claude-buddy-cli
Please read AGENTS.md and find me a shiny dragon Buddy with total stats >= 400.
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

- `userId` → `userID` 目前控制 `/buddy`，可以使用 `--apply`
- `oauthAccount.accountUuid` → `userID` 无法控制 `/buddy`，`--apply` 会被阻断（除非 `--force-apply`）

### 第 3 步 — 搜索候选

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

### 第 4 步 — 等待确认后应用

> **不要擅自使用 `--apply`**。将搜索结果展示给用户，等待用户明确确认后再执行带 `--apply` 的命令。

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

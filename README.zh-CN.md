# claude-buddy-cli

面向 Claude Code 的 Buddy 搜索与应用 CLI。它可以按结构化条件实时扫描 Buddy seed 空间，找到符合要求的宠物，反推出可用的 `64` 位 `userID`，并在你明确允许时写入 Claude Code 配置。

- English version: [README.en.md](README.en.md)
- Agent 指南: [AGENTS.md](AGENTS.md)

## 功能

- 实时扫描 Buddy `32` 位 seed 空间
- 按物种、稀有度、眼睛、帽子、闪光、总属性和分项属性筛选
- 为匹配的 seed 反推出可用的 `64` 位十六进制 `userID`
- 在 `--apply` 时将结果写入 Claude Code 配置
- 诊断当前 `/buddy` 由 `oauthAccount.accountUuid` 还是 `userID` 控制

## 安装

Node：

```bash
npm install
npm run build
node dist/bin.js --help
```

Bun：

```bash
bun install
bun run build
bun dist/bin.js --help
```

如果你想全局使用：

```bash
npm link
```

之后可以直接运行：

```bash
claude-buddy --help
```

## 快速开始

先检查 `userID` 当前是否真的能控制 `/buddy`：

```bash
node dist/bin.js doctor --json
```

只搜索候选，不修改配置：

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

确认后再写入配置：

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --apply --json
```

## 给 Claude Code 使用

推荐的人类工作流不是自己手动记命令，而是把这个仓库里的文档链接发给 Claude Code，让 agent 自己按文档调用 CLI。

推荐提示词：

```text
请阅读这个仓库里的 claude-buddy-cli 说明文档，并按文档调用 CLI。
先运行 doctor 判断 userID 是否会生效，再按我的条件搜索 Buddy。
除非我明确确认，否则不要使用 --apply 修改配置。
```

如果你是从 GitHub 页面使用，直接复制本文件或英文文件的 GitHub 链接即可。

## 输出约定

这个 CLI 默认面向 AI agent，因此输出通道有明确约定：

- 结果数据输出到 `stdout`
- 进度输出到 `stderr`
- 带 `--json` 时，`stdout` 保持纯 JSON，方便 agent 解析
- 大范围扫描时会输出简洁、稀疏的进度信息

## 运行时说明

Buddy 的骨架由一个 `32` 位 seed 决定。

- Node 路径：`FNV-1a(userID + "friend-2026-401")`
- Bun 路径：`Bun.hash(userID + salt) & 0xffffffff`

搜索阶段只依赖 seed，因此与运行时无关。  
真正依赖运行时的是 UID 反推阶段。

当前行为：

- `find` 在 Node 和 Bun 下都可用
- `find --apply --runtime node` 可在 Node 或 Bun 进程下执行
- `find --apply --runtime bun` 需要 CLI 本身运行在 Bun 进程里
- 如果你在 Node 进程里请求 `--runtime bun` 且尝试 `--apply`，工具会显式报错

## OAuth 与配置写入

`--apply` 会选择排序第一的候选，生成 `64` 位十六进制 `userID`，再写入 Claude Code 配置。

但如果配置里仍然存在 `oauthAccount.accountUuid`，Claude Code 可能继续忽略 `userID`。因此：

- 默认情况下，诊断发现 `userID` 不会生效时，`--apply` 会阻断
- 只有明确想强制写入时，才使用 `--force-apply`
- 测试时可用 `CLAUDE_BUDDY_CONFIG_PATH` 重定向到临时配置文件

对 OAuth 订阅用户：

- 正常 `claude auth login` 往往会留下 `oauthAccount.accountUuid`
- `CLAUDE_CODE_OAUTH_TOKEN` 可以让 `/buddy` 回退到 `userID`
- 前提是旧的 `oauthAccount` 数据没有残留在配置里
- 不确定时先运行 `node dist/bin.js doctor --json`

## 常用命令

查找高总属性闪光龙：

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

按分项属性精确筛选：

```bash
node dist/bin.js find \
  --species dragon \
  --shiny true \
  --chaos 100 \
  --debugging 54 \
  --hat halo \
  --json
```

使用 Bun 口径：

```bash
bun dist/bin.js find --runtime bun --species dragon --shiny true --json
```

查看帮助：

```bash
node dist/bin.js --help
```

## 开发

```bash
npm test
bun test
npm run build
```

## 文档

- 主 README: [README.md](README.md)
- English version: [README.en.md](README.en.md)
- Agent 指南: [AGENTS.md](AGENTS.md)

## 许可证

MIT

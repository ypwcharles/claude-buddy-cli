# claude-buddy-cli

面向 Claude Code 的 Buddy 搜索与应用 CLI。它可以按结构化条件实时扫描 Buddy seed 空间，找到符合要求的宠物，反推出可用的 `64` 位 `userID`，并在你明确允许时写入 Claude Code 配置。

- English version: [README.en.md](README.en.md)
- Agent 指南: [AGENTS.md](AGENTS.md)

## 功能

- 实时扫描 Buddy `32` 位 seed 空间
- 列出内置的 runtime-aware Buddy preset，便于快速选择
- 按物种、稀有度、眼睛、帽子、闪光、总属性和分项属性筛选
- 为匹配的 seed 反推出可用的 `64` 位十六进制 `userID`
- 在 `--apply` 时将结果写入 Claude Code 配置
- 诊断当前 `/buddy` 由 `oauthAccount.accountUuid` 还是 `userID` 控制

## 安装

## 运行时选择规则

> 重要：在反推和写入 `userID` 时，必须匹配**目标 Claude Code 的安装运行时**，而不是只看当前命令是用 Node 还是 Bun 跑的。
>
> - 目标 Claude Code 是 Node 安装：就用 Node 语义生成和写入
> - 目标 Claude Code 是 Bun 安装：就用 Bun 语义生成和写入
> - 搜索候选只依赖 seed，本身与运行时无关
> - 真正依赖运行时的是 UID 反推和 `--apply`

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

在写入之前，先确认目标 Claude Code 使用的是 Node 语义还是 Bun 语义。

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

如果目标 Claude Code 使用 Bun 语义，则应改用：

```bash
bun dist/bin.js find --runtime bun --species dragon --shiny true --min-total 400 --apply --json
```

查看内置 preset：

```bash
node dist/bin.js presets --json
```

直接解析 preset：

```bash
node dist/bin.js find --preset dragon-shiny-halo-debug-54-chaos-100 --runtime node --json
bun dist/bin.js find --preset capybara-shiny-min-wisdom-51 --runtime bun --json
bun dist/bin.js materialize --seed 130412512 --runtime bun --state-file /tmp/buddy-materialize.json --max-steps 10 --json
```

## 给 Claude Code 使用

推荐的人类工作流不是自己手动记命令，而是把这个仓库里的文档链接发给 Claude Code，让 agent 自己按文档调用 CLI。

推荐提示词：

```text
请阅读这个仓库里的 claude-buddy-cli 说明文档，并按文档调用 CLI。
先判断我的 Claude Code 安装是 Node 语义还是 Bun 语义，并在 apply 时使用对应运行时。
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
- 在 Bun 的一般搜索场景里，`find` 会直接返回满足条件、可直接写入的 `userID`
- Bun 的一般搜索不再固定停在前 `1000万` 个 witness，而是会持续搜索，直到找到足够结果或扫完整个 `32` 位 suffix 空间
- Bun 的一般搜索会在内部使用随机 prefix 轨道，因此不同运行可能返回不同但同样可用的 `userID`
- 内置 preset 也是 runtime-aware 的
- Node preset 依赖内置 seed
- Bun 的一般搜索已经会直接返回可写入的 `userID` witness
- 对 Bun 的精确 seed 或精确 preset，应使用 `materialize --seed ... --state-file ...`，让进度可以断点续跑
- `find --apply --runtime node` 可在 Node 或 Bun 进程下执行
- `find --apply --runtime bun` 需要 CLI 本身运行在 Bun 进程里
- 如果你在 Node 进程里请求 `--runtime bun` 且尝试 `--apply`，工具会显式报错
- 真正“正确”的 `userID`，是与目标 Claude Code 安装运行时匹配的那个 `userID`

## OAuth 与配置写入

`--apply` 会选择排序第一的候选，生成 `64` 位十六进制 `userID`，再写入 Claude Code 配置。

对 Bun 的一般搜索场景，`find` 的结果里已经直接包含可写入的 `userID`，因此 `--apply` 会直接写入第一条结果里的 `userID`，不会再做第二次慢速反推。

对 Bun 的精确 seed，不要反复重跑 `find`，应改用：

```bash
bun dist/bin.js materialize --seed 130412512 --runtime bun --state-file /tmp/buddy-materialize.json --max-steps 10 --json
```

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

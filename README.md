# claude-buddy-cli

Find and apply Claude Code Buddy pets from structured constraints.

中文说明优先：

- [README.zh-CN.md](README.zh-CN.md)
- [README.en.md](README.en.md)

Agent-facing repository instructions:

- [AGENTS.md](AGENTS.md)

## What It Does

- Searches the Buddy `32`-bit seed space in real time
- Filters by species, rarity, eye, hat, shiny state, total stats, and individual stats
- Reconstructs usable `64`-hex `userID` values for matching seeds
- Optionally writes the selected `userID` into Claude Code config with `--apply`
- Diagnoses whether `/buddy` is controlled by `oauthAccount.accountUuid` or `userID`

## Install

Node:

```bash
npm install
npm run build
node dist/bin.js --help
```

Bun:

```bash
bun install
bun run build
bun dist/bin.js --help
```

## Quick Start

Check whether `userID` can currently control `/buddy`:

```bash
node dist/bin.js doctor --json
```

Search without mutating config:

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

Apply only after confirming the diagnosis:

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --apply --json
```

## Use With Claude Code

The intended human workflow is simple:

1. Open the Chinese or English guide in this repository on GitHub.
2. Copy that document link into Claude Code.
3. Ask the agent to follow the guide and operate `claude-buddy-cli` for you.

Recommended prompt:

```text
Please read this repository guide and use claude-buddy-cli accordingly.
Run doctor first, then search for a Buddy that matches my constraints.
Do not mutate config unless I explicitly confirm apply.
```

## Documentation

- Chinese guide: [README.zh-CN.md](README.zh-CN.md)
- English guide: [README.en.md](README.en.md)
- Agent guide: [AGENTS.md](AGENTS.md)

## Development

```bash
npm test
bun test
npm run build
```

## License

[MIT](LICENSE)

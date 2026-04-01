# claude-buddy-cli

Structured CLI for Claude Code Buddy search and apply. It scans Buddy seed space in real time, finds pets that match structured constraints, reconstructs usable `64`-hex `userID` values, and writes to Claude Code config only when you explicitly allow it.

- 中文说明: [README.zh-CN.md](README.zh-CN.md)
- Agent guide: [AGENTS.md](AGENTS.md)

## Features

- Searches the Buddy `32`-bit seed space in real time
- Filters by species, rarity, eye, hat, shiny state, total stats, and individual stats
- Reconstructs usable `64`-hex `userID` values for matching seeds
- Writes the selected `userID` into Claude Code config when `--apply` is used
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

If you want a global command during local development:

```bash
npm link
```

Then run:

```bash
claude-buddy --help
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

The intended human workflow is not to memorize commands. Instead, send one of this repository's documentation links to Claude Code and ask the agent to follow it while operating the CLI.

Recommended prompt:

```text
Please read this repository guide and use claude-buddy-cli accordingly.
Run doctor first to verify whether userID controls /buddy, then search for a Buddy that matches my constraints.
Do not mutate config unless I explicitly confirm apply.
```

If you are using the GitHub UI, copy the GitHub link to this file or the Chinese guide.

## Output Contract

This CLI is designed for AI-agent use, so the output channels are explicit:

- result payloads go to `stdout`
- progress goes to `stderr`
- with `--json`, `stdout` remains pure JSON for machine parsing
- large scans emit compact and sparse progress messages

## Runtime Notes

Buddy bones are determined by a `32`-bit seed.

- Node path: `FNV-1a(userID + "friend-2026-401")`
- Bun path: `Bun.hash(userID + salt) & 0xffffffff`

Searching depends only on seed space, so search itself is runtime-independent.  
UID reconstruction is the runtime-dependent part.

Current behavior:

- `find` works under both Node and Bun
- `find --apply --runtime node` works from either a Node or Bun process
- `find --apply --runtime bun` requires the CLI itself to run under Bun
- requesting `--runtime bun` from a Node process during apply returns an explicit error

## OAuth and Config Writes

`--apply` selects the top-ranked candidate, reconstructs a `64`-hex `userID`, and writes it into Claude Code config.

If config still contains `oauthAccount.accountUuid`, Claude Code may continue ignoring `userID`. Therefore:

- by default, `--apply` is blocked when diagnosis shows that `userID` would not control `/buddy`
- use `--force-apply` only when you intentionally want to write `userID` anyway
- use `CLAUDE_BUDDY_CONFIG_PATH` to redirect writes to a temporary config during testing

For OAuth subscription users:

- normal `claude auth login` usually leaves `oauthAccount.accountUuid` active
- `CLAUDE_CODE_OAUTH_TOKEN` can make `/buddy` fall back to `userID`
- but only if old `oauthAccount` data is no longer stored in config
- if unsure, run `node dist/bin.js doctor --json` first

## Common Commands

Find a high-total shiny dragon:

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

Filter by exact substats:

```bash
node dist/bin.js find \
  --species dragon \
  --shiny true \
  --chaos 100 \
  --debugging 54 \
  --hat halo \
  --json
```

Use Bun semantics:

```bash
bun dist/bin.js find --runtime bun --species dragon --shiny true --json
```

Show built-in help:

```bash
node dist/bin.js --help
```

## Development

```bash
npm test
bun test
npm run build
```

## Docs

- Main README: [README.md](README.md)
- 中文说明: [README.zh-CN.md](README.zh-CN.md)
- Agent guide: [AGENTS.md](AGENTS.md)

## License

MIT

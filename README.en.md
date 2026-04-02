# claude-buddy-cli

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-blue.svg)](https://nodejs.org/)
[![Bun](https://img.shields.io/badge/bun-%3E%3D1.1-blue.svg)](https://bun.sh/)

[中文](./README.md) | [English](./README.en.md)

**Claude Code Buddy search tool** - find the Buddy you want in Claude Code and switch to it in one step.

[Install](#install) · [Commands](#commands) · [Human Quick Start](#human-quick-start) · [AI Agent Quick Start](#ai-agent-quick-start) · [Safety Rules](#safety-rules) · [Docs](#docs)

## Why claude-buddy-cli?

- **4.29 billion possibilities** - scans the full Buddy generation space and finds pets that match your constraints
- **Zero setup** - no login, no API key, install and run
- **Safe** - always diagnose before writing, so existing config is not accidentally overwritten

## Features

| Category | Capability |
| --- | --- |
| Search | Scans the full 4.29B seed space and filters Buddy by species/rarity/eye/hat/shiny/stats |
| Presets | Built-in runtime-aware Buddy presets for fast selection and runtime-matching `userID` generation |
| Generate | Deterministically generates Buddy from seed with mulberry32 RNG |
| Diagnose | Detects whether `/buddy` is currently controlled by `userID` or `oauthAccount.accountUuid` |
| Reconstruct | Reconstructs a `64`-hex `userID` from seed (Bun parallel / Node meet-in-the-middle) |
| Apply | Writes matched `userID` into `~/.claude.json` |

## Buddy Attributes

| Attribute | Example values |
| --- | --- |
| `species` | `duck`, `goose`, `blob`, `cat`, `dragon`, `octopus`, `owl`, `penguin`, `turtle`, `snail`, `ghost`, `axolotl`, `capybara`, `cactus`, `robot`, `rabbit`, `mushroom`, `chonk` |
| `rarity` | `common`, `uncommon`, `rare`, `epic`, `legendary` |
| `eye` | `·`, `✦`, `×`, `◉`, `@`, `°` |
| `hat` | `none`, `crown`, `tophat`, `propeller`, `halo`, `wizard`, `beanie`, `tinyduck` |
| `shiny` | `true` / `false` |
| `stats` | `DEBUGGING`, `PATIENCE`, `CHAOS`, `WISDOM`, `SNARK` (each `1-100`, current generator total max `421`) |

## Generation Limits and Reachability

- Buddy generation is driven by a `32`-bit seed space: `2^32 = 4,294,967,296`
- So the upper bound of reachable pets is `4,294,967,296` (actual unique combinations may be lower, but never higher)
- Hard stat range per attribute is `1-100`; current generator total stat max is `421`
- Structural hard limit: when `rarity=common`, `hat` is always `none`
- Not all filter combinations are reachable; if a full-space scan still returns `0` matches, that combination does not exist under the current generator

## Install

### Requirements

- Node.js `>=20` or Bun `>=1.1`
- Claude Code has been started at least once

### Runtime Selection Rule

> **Important:** For `userID` reconstruction and apply, runtime must match the **target Claude Code installation runtime**, not just the runtime used to execute the current command.
>
> - Target Claude Code installed with **Node**: use **Node semantics** to generate/apply `userID`
> - Target Claude Code installed with **Bun**: use **Bun semantics** to generate/apply `userID`
> - Candidate search itself depends only on seed, not runtime
> - Runtime dependency is in UID reconstruction and `--apply`
> - Bun and Node both use seed-first search: dry-run `find` returns seed candidates
> - Under Bun, `find --apply` materializes the selected seed, then writes `userID`

### Install CLI

```bash
# Node.js
npm install && npm run build

# Bun
bun install && bun run build
```

## Commands

| Command | Description |
| --- | --- |
| `doctor --json` | Diagnose whether `/buddy` is controlled by `userID` or `oauthAccount.accountUuid` |
| `presets --json` | List built-in Buddy presets and runtime availability |
| `find [filters]` | Search seed space for Buddy matching filters (no config mutation) |
| `materialize --seed <n>` | Reconstruct runtime-usable `userID` from exact seed, useful for long Bun tasks |
| `find [filters] --apply` | Search and write matched `userID` to Claude Code config |

### Search Filters

| Parameter | Example | Allowed values / description |
| --- | --- | --- |
| `--preset` | `--preset capybara-shiny-min-wisdom-51` | Use built-in preset (check with `presets --json`) |
| `--species` | `--species dragon` | `duck \| goose \| blob \| cat \| dragon \| octopus \| owl \| penguin \| turtle \| snail \| ghost \| axolotl \| capybara \| cactus \| robot \| rabbit \| mushroom \| chonk` |
| `--rarity` | `--rarity legendary` | `common \| uncommon \| rare \| epic \| legendary` |
| `--eye` | `--eye ✦` | `· \| ✦ \| × \| ◉ \| @ \| °` |
| `--hat` | `--hat crown` | `none \| crown \| tophat \| propeller \| halo \| wizard \| beanie \| tinyduck` |
| `--shiny` | `--shiny true` | `true \| false` |
| `--min-total` / `--max-total` | `--min-total 400 --max-total 421` | Total stat filter (current generator max `421`) |
| `--debugging` / `--min-debugging` / `--max-debugging` | `--min-debugging 80` | Exact or ranged `DEBUGGING`, `1-100` |
| `--patience` / `--min-patience` / `--max-patience` | `--patience 89` | Exact or ranged `PATIENCE`, `1-100` |
| `--chaos` / `--min-chaos` / `--max-chaos` | `--max-chaos 30` | Exact or ranged `CHAOS`, `1-100` |
| `--wisdom` / `--min-wisdom` / `--max-wisdom` | `--min-wisdom 51` | Exact or ranged `WISDOM`, `1-100` |
| `--snark` / `--min-snark` / `--max-snark` | `--snark 88` | Exact or ranged `SNARK`, `1-100` |
| `--start-seed` / `--end-seed` | `--start-seed 0 --end-seed 1000000` | Seed scan range, `start` inclusive / `end` exclusive |
| `--limit` | `--limit 10` | Max returned records (default `20`) |
| `--runtime` | `--runtime bun` | `auto \| node \| bun` |
| `--state-file` | `--state-file /tmp/buddy-state.json` | Bun materialize progress file (resumable) |
| `--chunk-size` | `--chunk-size 1000000` | Per-step per-lane scan size for Bun materialize |
| `--lane-count` | `--lane-count 1` | Lane count for Bun materialize |
| `--max-steps` | `--max-steps 10` | Max steps to execute in current Bun materialize run |
| `--search-seed` | `--search-seed preset:shiny-max-dragon-3716311402` | Pin Bun materialize campaign |
| `--bun-workers` | `--bun-workers 8` | Worker count for Bun materialize parallelism |
| `--json` | `--json` | Machine-readable JSON output (recommended) |
| `--apply` | `--apply` | Write config after explicit confirmation |
| `--force-apply` | `--force-apply` | Force write even if `userID` currently does not control `/buddy` (use with care) |

Run `node dist/bin.js --help` for the complete option list.

### Built-in Presets

```bash
# List presets available for current runtime
node dist/bin.js presets --json

# Select a Node preset directly
node dist/bin.js find --preset dragon-shiny-halo-debug-54-chaos-100 --runtime node --json

# Select a Bun preset directly
bun dist/bin.js find --preset capybara-shiny-min-wisdom-51 --runtime bun --json

# For exact seed under Bun, use resumable materialize
bun dist/bin.js materialize --seed 130412512 --runtime bun --state-file /tmp/buddy-materialize.json --max-steps 10 --json

# Bun preset dry-run returns seed candidate; confirm then apply (materialize + write)
bun dist/bin.js find --preset full421-rabbit-130412512 --runtime bun --json
bun dist/bin.js find --preset full421-rabbit-130412512 --runtime bun --apply --state-file /tmp/buddy-materialize.json --max-steps 10 --json
```

> **Implementation notes:**
>
> - Node presets rely on built-in `seed`
> - Bun and Node both return seed candidates first, with unified semantics
> - Bun generates writable `userID` during `--apply` or `materialize`
> - Long Bun tasks can resume via `--state-file`
> - So the same preset can have different seed / `userID` acquisition paths on Node vs Bun

## Human Quick Start

> **Note for AI assistants:** if you are an AI Agent, jump to [AI Agent Quick Start](#ai-agent-quick-start).

### Install

```bash
npm install && npm run build
```

### Search Buddy

```bash
# Check current control source (read-only, no config mutation)
node dist/bin.js doctor --json

# Search shiny dragon with total stats >= 400 (no config mutation)
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

### Apply Config

> **Important:**
> 1. Confirm whether target Claude Code installation runtime is Node or Bun
> 2. Confirm `doctor --json` returns `buddyIdSource = "userID"`
>
> If it returns `oauthAccount.accountUuid`, Buddy is controlled by OAuth account and writing `userID` will not take effect.

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --apply
```

### Ask Claude Code to Operate for You

```
Please read the guide in this repository and use claude-buddy-cli to find me a Buddy.
First determine whether my Claude Code installation uses Node or Bun semantics, and use the matching runtime for apply.
Run doctor first, then search, then apply. Do not mutate config unless I confirm.
```

Or invoke with `@`:

```
@claude-buddy-cli
Please read AGENTS.md, determine whether my Claude Code installation uses Node or Bun semantics, and find me a shiny dragon Buddy with total stats >= 400.
```

Claude Code will automatically: read docs -> diagnose -> search candidates -> wait for confirmation -> apply.

Repository: [https://github.com/ypwcharles/claude-buddy-cli](https://github.com/ypwcharles/claude-buddy-cli)

## AI Agent Quick Start

> The steps below are for AI Agents.

### Step 1 - Install

```bash
npm install && npm run build
```

### Step 2 - Diagnose Current State

```bash
node dist/bin.js doctor --json
```

Check `buddyIdSource` in the result:

- `userID` -> `userID` currently controls `/buddy`; `--apply` can be used
- `oauthAccount.accountUuid` -> `userID` cannot control `/buddy`; `--apply` is blocked (unless `--force-apply`)

### Step 3 - Search Candidates

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

### Step 4 - Wait For Confirmation Then Apply

> **Do not run `--apply` without permission.** Show search results to user and wait for explicit confirmation before running commands with `--apply`.
>
> Also make runtime match the target Claude Code installation:
>
> - Target is Node install: use `node dist/bin.js ...` or `--runtime node`
> - Target is Bun install: use `bun dist/bin.js ...`, and add `--runtime bun` when needed

### Bun Exact-Seed Workflow

If user already provides an exact seed, especially from a rare preset or research output, do not keep retrying generic `find`. Under Bun, use resumable `materialize`:

```bash
bun dist/bin.js materialize --seed 130412512 --runtime bun --state-file /tmp/buddy-materialize.json --max-steps 10 --json
```

- First run creates or advances state file
- If no `userID` found in current run, rerun the same command to continue from saved progress
- Add `--apply` after a match is found

### Full Workflow Example (Reference)

```bash
# 1. Diagnose
node dist/bin.js doctor --json

# 2. Search (dry run, no side effects)
node dist/bin.js find --species dragon --shiny true --min-total 400 --json

# 3. Write only after user confirmation
node dist/bin.js find --species dragon --shiny true --min-total 400 --apply
```

## Safety Rules

- **Use `--json`** - always include `--json` for agent calls so output is machine-parsable
- **`doctor` before `apply`** - confirm `userID` is active control source before writing
- **Dry run first** - set `CLAUDE_BUDDY_CONFIG_PATH` to a temp file during tests to avoid polluting real config
- **Block on `oauthAccount.accountUuid`** - when doctor returns it, tool blocks `--apply`
- **`--force-apply` requires explicit authorization** - use only when user explicitly asks to write `userID` even if it cannot currently control `/buddy`
- **Unified seed-first for Bun and Node** - `find --json` returns seed candidates; `--apply` materializes then writes `userID`
- **Resumable Bun materialize** - for exact seed or long runs, use `materialize --seed ... --state-file ...`
- **`userID` is not fixed for general Bun searches** - tool uses random prefix lanes internally to find witnesses; different runs/users can get different but valid `userID` values

## Environment Variables

| Variable | Description |
| --- | --- |
| `CLAUDE_BUDDY_CONFIG_PATH` | Config file path (default: `~/.claude.json`). Set to temp path in tests for dry run. |
| `CLAUDE_BUDDY_RUNTIME` | Force runtime: `node` or `bun` (default: `auto`) |

## Docs

- Chinese guide: [README.md](./README.md)
- English guide: [README.en.md](./README.en.md)
- Full Agent guide (required): [AGENTS.md](./AGENTS.md)

## License

**MIT License** - [LICENSE](./LICENSE)

# Agent Usage Guide

This repository provides a structured CLI for Claude Code Buddy search and config application.

## Recommended command order

Before running commands, determine whether the **target Claude Code installation** uses Node semantics or Bun semantics.

- If the target Claude Code was installed via Node, use the Node path for `--apply`
- If the target Claude Code was installed via Bun, use the Bun path for `--apply`
- Search itself is seed-based and runtime-independent
- UID reconstruction and `--apply` are runtime-dependent
- Do not assume Node is correct just because the current shell is running `node`

1. Diagnose current control source:

```bash
node dist/bin.js doctor --json
```

2. Search candidates without changing config:

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

3. Apply only after confirming that `userID` actually controls `/buddy`:

```bash
node dist/bin.js find --species dragon --shiny true --min-total 400 --apply --json
```

Optional: list built-in presets first when the user wants a curated buddy instead of an open-ended search:

```bash
node dist/bin.js presets --json
node dist/bin.js presets --category full421 --json
node dist/bin.js presets --category species-shiny-max --json
node dist/bin.js presets --category species-shiny-max --species dragon --json
node dist/bin.js find --preset full421-rabbit-130412512 --runtime node --json
bun dist/bin.js find --preset shiny-max-dragon-3716311402 --runtime bun --json
```

If the user already has an exact Bun seed and wants a usable `userID`, use `materialize` instead of repeatedly rerunning `find`:

```bash
bun dist/bin.js materialize --seed 130412512 --runtime bun --state-file /tmp/buddy-materialize.json --max-steps 10 --json
```

## Safety rules

- Prefer `--json` for all agent calls.
- Prefer `doctor --json` before any `--apply`.
- Do not use `--apply` in tests against the real config unless the user explicitly wants that.
- For safe dry runs, set `CLAUDE_BUDDY_CONFIG_PATH` to a temporary file.
- If `doctor --json` reports `buddyIdSource = "oauthAccount.accountUuid"`, `--apply` will be blocked by default.
- `--force-apply` exists, but use it only when the user explicitly wants to write `userID` even though it will not control `/buddy`.

## Runtime rules

- `node dist/bin.js ...` uses Node semantics when `--runtime auto`.
- `bun dist/bin.js ...` uses Bun semantics when `--runtime auto`.
- `--runtime node` works from Node or Bun.
- `--runtime bun` must be executed from a Bun process if UID reconstruction or `--apply` is needed.
- A `userID` is only "correct" relative to the runtime used by the target Claude Code installation.
- Node-generated and Bun-generated `userID` values do not need to match each other.
- General Bun `find` now follows seed-first behavior (same as Node): dry-run returns seed-based buddy candidates.
- For Bun, `find --apply` materializes a usable `userID` from the selected seed and then writes it.
- If Bun materialization needs multiple passes, use `--state-file` so progress can resume.
- Built-in Node presets are backed by stored seeds.
- Exact Bun seeds can be materialized with `materialize`, which supports chunked scanning and resume via `--state-file`.
- Bun presets also return seed-based candidates on dry-run; `--apply` materializes/writes for the selected seed.

## Fresh-clone setup

Node-first:

```bash
npm install
npm run build
node dist/bin.js --help
```

Bun-first:

```bash
bun install
bun run build
bun dist/bin.js --help
```

## Safe test example

```bash
export CLAUDE_BUDDY_CONFIG_PATH=/tmp/claude-buddy-test.json
printf '{\"theme\":\"dark\",\"hasCompletedOnboarding\":true}\n' > \"$CLAUDE_BUDDY_CONFIG_PATH\"
node dist/bin.js doctor --json
node dist/bin.js find --species dragon --shiny true --min-total 400 --json
```

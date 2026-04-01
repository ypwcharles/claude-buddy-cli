# Agent Usage Guide

This repository provides a structured CLI for Claude Code Buddy search and config application.

## Recommended command order

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

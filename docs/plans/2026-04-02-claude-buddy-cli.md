# Claude Buddy CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone open-source CLI that finds Claude Code Buddy pets matching structured constraints, reconstructs usable 64-character hex IDs, and optionally writes the chosen ID into `~/.claude.json`.

**Architecture:** The CLI is split into a thin command layer and a deterministic engine layer. The engine handles runtime-specific hashing, seed scanning, pet evaluation, and 64-character UID reconstruction; the command layer parses structured flags, prints AI-friendly help and JSON output, and safely applies updates to Claude Code config only when `--apply` is set.

**Tech Stack:** TypeScript, Node.js, Bun compatibility, `commander` or equivalent CLI parser, Vitest, `tsx` for Node dev execution.

---

### Task 1: Scaffold the standalone repository

**Files:**
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/package.json`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/tsconfig.json`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/.gitignore`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/README.md`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/cli.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/index.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/types.ts`
- Test: `/Users/peiwenyang/Development/claude-buddy-cli/tests/smoke.test.ts`

**Step 1: Write the failing test**

Add a smoke test that expects the CLI entrypoint to load and expose a version/help surface.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because the package and entrypoints do not exist yet.

**Step 3: Write minimal implementation**

Create package metadata, scripts, TS config, and a minimal CLI entrypoint that can print help.

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for the smoke test.

**Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore README.md src tests
git commit -m "feat: scaffold claude buddy cli"
```

### Task 2: Extract the Buddy generation engine

**Files:**
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/buddy/constants.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/buddy/hash.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/buddy/rng.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/buddy/generate.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/buddy/match.ts`
- Test: `/Users/peiwenyang/Development/claude-buddy-cli/tests/generate.test.ts`

**Step 1: Write the failing test**

Add deterministic tests that compare generated Buddy bones against known research fixtures for:
- a real `421` seed
- the global shiny max dragon seed
- at least one common-rarity example

**Step 2: Run test to verify it fails**

Run: `npm test -- generate`
Expected: FAIL because the engine modules do not exist.

**Step 3: Write minimal implementation**

Port the deterministic Buddy logic into isolated modules:
- runtime-specific hashing (`node`, `bun`)
- 32-bit seed derivation
- rarity/species/eye/hat/shiny/stat generation
- total stat calculation
- structured matcher for CLI constraints

**Step 4: Run test to verify it passes**

Run: `npm test -- generate`
Expected: PASS and output matches the known fixtures.

**Step 5: Commit**

```bash
git add src/buddy tests/generate.test.ts
git commit -m "feat: add deterministic buddy engine"
```

### Task 3: Implement search and candidate ranking

**Files:**
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/search/search.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/search/filters.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/search/rank.ts`
- Test: `/Users/peiwenyang/Development/claude-buddy-cli/tests/search.test.ts`

**Step 1: Write the failing test**

Add tests for:
- exact filter matching (`species`, `shiny`, `rarity`)
- max-total search for a species
- top-N ranked results
- deterministic scan windows over seed ranges

**Step 2: Run test to verify it fails**

Run: `npm test -- search`
Expected: FAIL because search modules do not exist.

**Step 3: Write minimal implementation**

Implement a seed scanner that:
- scans `0..2^32-1` in chunks
- evaluates candidates with structured constraints
- supports ranking by total stats, rarity, shiny, and stable tie-breaks
- can emit full candidate objects for JSON output

**Step 4: Run test to verify it passes**

Run: `npm test -- search`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/search tests/search.test.ts
git commit -m "feat: add seed search and candidate ranking"
```

### Task 4: Implement 64-character UID reconstruction with diversity strategy

**Files:**
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/uid/reconstruct.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/uid/diversity.ts`
- Test: `/Users/peiwenyang/Development/claude-buddy-cli/tests/uid.test.ts`

**Step 1: Write the failing test**

Add tests that verify:
- reconstructed IDs hash back to the target seed for Node mode
- reconstructed IDs hash back to the target seed for Bun mode
- repeated requests can produce distinct 64-character hex IDs for the same pet
- all generated IDs are printable lowercase hex strings of length `64`

**Step 2: Run test to verify it fails**

Run: `npm test -- uid`
Expected: FAIL because reconstruction modules do not exist.

**Step 3: Write minimal implementation**

Implement runtime-specific UID reconstruction:
- Node path: deterministic seed-to-UID reconstruction using the researched reverse/FNV approach
- Bun path: runtime-specific search strategy compatible with `Bun.hash(...) & 0xffffffffn`
- diversity strategy that varies high-order prefix material so different users receive different valid IDs for the same pet whenever possible

**Step 4: Run test to verify it passes**

Run: `npm test -- uid`
Expected: PASS for both runtime modes and diversity assertions.

**Step 5: Commit**

```bash
git add src/uid tests/uid.test.ts
git commit -m "feat: add runtime-specific uid reconstruction"
```

### Task 5: Implement Claude Code config detection and apply flow

**Files:**
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/claude/config.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/claude/runtime.ts`
- Test: `/Users/peiwenyang/Development/claude-buddy-cli/tests/config.test.ts`

**Step 1: Write the failing test**

Add tests for:
- locating `~/.claude.json`
- preserving unrelated config keys
- updating only `userID`
- dry-run behavior without `--apply`
- explicit runtime override vs auto-detect

**Step 2: Run test to verify it fails**

Run: `npm test -- config`
Expected: FAIL because config modules do not exist.

**Step 3: Write minimal implementation**

Implement:
- config path resolution
- JSON parse/load/save
- safe mutation of `userID`
- runtime auto-detection with explicit `--runtime` override
- refusal path or warning when `oauthAccount.accountUuid` would make `userID` ineffective

**Step 4: Run test to verify it passes**

Run: `npm test -- config`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/claude tests/config.test.ts
git commit -m "feat: add claude config apply flow"
```

### Task 6: Build AI-friendly structured CLI surface

**Files:**
- Modify: `/Users/peiwenyang/Development/claude-buddy-cli/src/cli.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/commands/find.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/commands/apply.ts`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/src/commands/explain.ts`
- Test: `/Users/peiwenyang/Development/claude-buddy-cli/tests/cli.test.ts`

**Step 1: Write the failing test**

Add CLI tests that assert:
- `--help` documents the command contract clearly for AI agents
- `find` prints machine-readable JSON when requested
- `find` does not mutate config by default
- `find --apply` updates config
- help output explicitly documents runtime semantics and `~/.claude.json` behavior

**Step 2: Run test to verify it fails**

Run: `npm test -- cli`
Expected: FAIL because the command surface is incomplete.

**Step 3: Write minimal implementation**

Implement commands:
- `find`: search by structured filters and print ranked results
- `apply`: write a provided or selected candidate into `~/.claude.json`
- `explain`: explain why a candidate matched or why no result was found

Design `--help` so agents can parse:
- purpose
- command contract
- required/optional flags
- JSON output mode
- runtime selection
- safety notes for `--apply`

**Step 4: Run test to verify it passes**

Run: `npm test -- cli`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/commands src/cli.ts tests/cli.test.ts
git commit -m "feat: add ai-friendly cli commands"
```

### Task 7: Documentation and verification

**Files:**
- Modify: `/Users/peiwenyang/Development/claude-buddy-cli/README.md`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/examples/find-dragon.json`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/examples/help.txt`
- Create: `/Users/peiwenyang/Development/claude-buddy-cli/examples/workflow.md`

**Step 1: Write the failing test**

Add docs-oriented snapshot or smoke checks that ensure README commands remain valid.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL until docs/examples align with the implementation.

**Step 3: Write minimal implementation**

Document:
- installation
- Node and Bun support
- structured commands for AI agents
- output examples
- `--help` examples
- config apply behavior
- limitations and runtime caveats

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

**Step 5: Commit**

```bash
git add README.md examples tests
git commit -m "docs: add usage and agent integration examples"
```


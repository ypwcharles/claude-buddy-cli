import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { hashUserIdToSeed } from "../src/buddy/hash.js";
import { runCli } from "../src/cli.js";
import {
  buildBunWitnessPrefix,
} from "../src/uid/reconstruct.js";

describe("runCli", () => {
  const expectedRuntime = typeof Bun !== "undefined" ? "bun" : "node";
  const bunOnly = typeof Bun !== "undefined" ? it : it.skip;

  it("renders AI-friendly help", async () => {
    const output: string[] = [];

    const exitCode = await runCli(["--help"], {
      write: (chunk) => output.push(chunk),
    });

    const text = output.join("");
    expect(exitCode).toBe(0);
    expect(text).toContain("Claude Code Buddy");
    expect(text).toContain("COMMAND");
    expect(text).toContain("find");
    expect(text).toContain("materialize");
    expect(text).toContain("presets");
    expect(text).toContain("--category");
    expect(text).toContain("--preset");
    expect(text).toContain("--species");
    expect(text).toContain("--min-debugging");
    expect(text).toContain("--runtime");
    expect(text).toContain("--apply");
    expect(text).toContain("AI AGENT CONTRACT");
  });

  it("materializes a Node userID directly from an exact seed", async () => {
    const output: string[] = [];

    const exitCode = await runCli(
      [
        "materialize",
        "--seed",
        "3716311402",
        "--runtime",
        "node",
        "--json",
      ],
      {
        write: (chunk) => output.push(chunk),
      },
    );

    expect(exitCode).toBe(0);

    const parsed = JSON.parse(output.join(""));
    expect(parsed.command).toBe("materialize");
    expect(parsed.searchStrategy).toBe("node-seed-reconstruction");
    expect(parsed.done).toBe(true);
    expect(parsed.result.userID).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUserIdToSeed(parsed.result.userID, "node")).toBe(3716311402);
  });

  it("supports structured find filters and json output", async () => {
    const output: string[] = [];

    const exitCode = await runCli(
      [
        "find",
        "--species",
        "dragon",
        "--shiny",
        "true",
        "--min-wisdom",
        "90",
        "--min-total",
        "230",
        "--start-seed",
        "0",
        "--end-seed",
        "5000",
        "--limit",
        "2",
        "--runtime",
        "node",
        "--json",
      ],
      {
        write: (chunk) => output.push(chunk),
      },
    );

    expect(exitCode).toBe(0);

    const parsed = JSON.parse(output.join(""));
    expect(parsed.command).toBe("find");
    expect(parsed.runtime).toBe("node");
    expect(parsed.resolvedRuntime).toBe("node");
    expect(parsed.applied).toBe(false);
    expect(parsed.results).toHaveLength(2);
    expect(parsed.results[0].seed).toBe(1497);
    expect(parsed.results[1].seed).toBe(849);
  });

  it("applies the first Node candidate to Claude config when --apply is used", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-cli-"));
    const configPath = path.join(directory, ".claude.json");
    await writeFile(configPath, `${JSON.stringify({ theme: "dark" }, null, 2)}\n`, "utf8");
    process.env.CLAUDE_BUDDY_CONFIG_PATH = configPath;

    try {
      const output: string[] = [];
      const exitCode = await runCli(
        [
          "find",
          "--species",
          "dragon",
          "--shiny",
          "true",
          "--chaos",
          "100",
          "--debugging",
          "54",
          "--hat",
          "halo",
          "--start-seed",
          "3716311402",
          "--end-seed",
          "3716311403",
          "--limit",
          "1",
          "--runtime",
          "node",
          "--apply",
          "--json",
        ],
        {
          write: (chunk) => output.push(chunk),
        },
      );

      expect(exitCode).toBe(0);

      const parsed = JSON.parse(output.join(""));
      expect(parsed.applied).toBe(true);
      expect(parsed.appliedUserID).toMatch(/^[0-9a-f]{64}$/);
      expect(parsed.results).toHaveLength(1);

      const saved = JSON.parse(await readFile(configPath, "utf8")) as {
        theme: string;
        userID: string;
      };

      expect(saved.theme).toBe("dark");
      expect(saved.userID).toBe(parsed.appliedUserID);
    } finally {
      delete process.env.CLAUDE_BUDDY_CONFIG_PATH;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("diagnoses when env-token mode can fall back to userID", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-diag-"));
    const configPath = path.join(directory, ".claude.json");
    await writeFile(
      configPath,
      `${JSON.stringify({ hasCompletedOnboarding: true, theme: "dark", userID: "custom-id" }, null, 2)}\n`,
      "utf8",
    );
    process.env.CLAUDE_BUDDY_CONFIG_PATH = configPath;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token";

    try {
      const output: string[] = [];
      const exitCode = await runCli(["doctor", "--json"], {
        write: (chunk) => output.push(chunk),
      });

      expect(exitCode).toBe(0);

      const parsed = JSON.parse(output.join(""));
      expect(parsed.command).toBe("doctor");
      expect(parsed.buddyIdSource).toBe("userID");
      expect(parsed.userIDControlsBuddy).toBe(true);
      expect(parsed.envTokenMode).toBe(true);
      expect(parsed.compatibilityMode).toBe("env-token-userid-compatible");
    } finally {
      delete process.env.CLAUDE_BUDDY_CONFIG_PATH;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("diagnoses when stored oauthAccount blocks userID even in env-token mode", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-diag-"));
    const configPath = path.join(directory, ".claude.json");
    await writeFile(
      configPath,
      `${JSON.stringify({
        userID: "custom-id",
        oauthAccount: { accountUuid: "account-uuid-1" },
      }, null, 2)}\n`,
      "utf8",
    );
    process.env.CLAUDE_BUDDY_CONFIG_PATH = configPath;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "test-token";

    try {
      const output: string[] = [];
      const exitCode = await runCli(["doctor", "--json"], {
        write: (chunk) => output.push(chunk),
      });

      expect(exitCode).toBe(0);

      const parsed = JSON.parse(output.join(""));
      expect(parsed.buddyIdSource).toBe("oauthAccount.accountUuid");
      expect(parsed.userIDControlsBuddy).toBe(false);
      expect(parsed.compatibilityMode).toBe("env-token-blocked-by-config-oauthAccount");
      expect(parsed.recommendation).toContain("Remove oauthAccount");
    } finally {
      delete process.env.CLAUDE_BUDDY_CONFIG_PATH;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("blocks --apply when oauthAccount.accountUuid still controls buddy", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-block-"));
    const configPath = path.join(directory, ".claude.json");
    await writeFile(
      configPath,
      `${JSON.stringify({
        userID: "custom-id",
        oauthAccount: { accountUuid: "account-uuid-1" },
      }, null, 2)}\n`,
      "utf8",
    );
    process.env.CLAUDE_BUDDY_CONFIG_PATH = configPath;

    try {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runCli(
        [
          "find",
          "--species",
          "dragon",
          "--shiny",
          "true",
          "--chaos",
          "100",
          "--debugging",
          "54",
          "--hat",
          "halo",
          "--start-seed",
          "3716311402",
          "--end-seed",
          "3716311403",
          "--limit",
          "1",
          "--runtime",
          "node",
          "--apply",
          "--json",
        ],
        {
          writeStdout: (chunk) => stdout.push(chunk),
          writeStderr: (chunk) => stderr.push(chunk),
          stderrIsTTY: false,
        },
      );

      expect(exitCode).toBe(1);
      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toContain("userID would not control /buddy");

      const saved = JSON.parse(await readFile(configPath, "utf8")) as {
        userID: string;
      };
      expect(saved.userID).toBe("custom-id");
    } finally {
      delete process.env.CLAUDE_BUDDY_CONFIG_PATH;
      await rm(directory, { recursive: true, force: true });
    }
  });

  bunOnly("applies a Bun candidate when running under Bun", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-bun-"));
    const configPath = path.join(directory, ".claude.json");
    await writeFile(
      configPath,
      `${JSON.stringify({ hasCompletedOnboarding: true, theme: "dark" }, null, 2)}\n`,
      "utf8",
    );
    process.env.CLAUDE_BUDDY_CONFIG_PATH = configPath;

    try {
      const searchSeed = "vitest-cli-bun-apply-seed";
      const prefix = buildBunWitnessPrefix(searchSeed, 0);
      const expectedUid = `${prefix}00000000`;
      const seed = hashUserIdToSeed(expectedUid, "bun");

      const output: string[] = [];
      const exitCode = await runCli(
        [
          "find",
          "--start-seed",
          String(seed),
          "--end-seed",
          String(seed + 1),
          "--limit",
          "1",
          "--runtime",
          "bun",
          "--search-seed",
          searchSeed,
          "--apply",
          "--json",
        ],
        {
          write: (chunk) => output.push(chunk),
        },
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(output.join(""));
      expect(parsed.applied).toBe(true);
      expect(parsed.appliedUserID).toBe(expectedUid);

      const saved = JSON.parse(await readFile(configPath, "utf8")) as {
        userID: string;
      };
      expect(saved.userID).toBe(expectedUid);
    } finally {
      delete process.env.CLAUDE_BUDDY_CONFIG_PATH;
      await rm(directory, { recursive: true, force: true });
    }
  });

  bunOnly("persists and resumes Bun exact materialization with a state file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-materialize-"));
    const stateFile = path.join(directory, "materialize-state.json");
    const searchSeed = "vitest-cli-materialize";
    const prefix = buildBunWitnessPrefix(searchSeed, 0);
    const suffix = 1_500_000;
    const expectedUid = `${prefix}${suffix.toString(16).padStart(8, "0")}`;
    const seed = hashUserIdToSeed(expectedUid, "bun");

    try {
      const firstOutput: string[] = [];
      const firstExitCode = await runCli(
        [
          "materialize",
          "--seed",
          String(seed),
          "--runtime",
          "bun",
          "--state-file",
          stateFile,
          "--search-seed",
          searchSeed,
          "--chunk-size",
          "1000000",
          "--lane-count",
          "1",
          "--max-steps",
          "1",
          "--bun-workers",
          "1",
          "--json",
        ],
        {
          write: (chunk) => firstOutput.push(chunk),
        },
      );

      expect(firstExitCode).toBe(0);
      const firstParsed = JSON.parse(firstOutput.join(""));
      expect(firstParsed.done).toBe(false);
      expect(firstParsed.result).toBeUndefined();
      expect(firstParsed.progress.scanned).toBe(1000000);

      const secondOutput: string[] = [];
      const secondExitCode = await runCli(
        [
          "materialize",
          "--seed",
          String(seed),
          "--runtime",
          "bun",
          "--state-file",
          stateFile,
          "--search-seed",
          searchSeed,
          "--chunk-size",
          "1000000",
          "--lane-count",
          "1",
          "--max-steps",
          "1",
          "--bun-workers",
          "1",
          "--json",
        ],
        {
          write: (chunk) => secondOutput.push(chunk),
        },
      );

      expect(secondExitCode).toBe(0);
      const secondParsed = JSON.parse(secondOutput.join(""));
      expect(secondParsed.resumed).toBe(true);
      expect(secondParsed.done).toBe(true);
      expect(secondParsed.result.userID).toBe(expectedUid);
      expect(secondParsed.result.seed).toBe(seed);
      expect(secondParsed.progress.scanned).toBeGreaterThan(1000000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  bunOnly("applies a materialized Bun userID once found", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-materialize-apply-"));
    const stateFile = path.join(directory, "materialize-state.json");
    const configPath = path.join(directory, ".claude.json");
    await writeFile(
      configPath,
      `${JSON.stringify({ hasCompletedOnboarding: true, theme: "dark" }, null, 2)}\n`,
      "utf8",
    );
    process.env.CLAUDE_BUDDY_CONFIG_PATH = configPath;

    try {
      const searchSeed = "vitest-cli-materialize-apply";
      const prefix = buildBunWitnessPrefix(searchSeed, 0);
      const expectedUid = `${prefix}00000000`;
      const seed = hashUserIdToSeed(expectedUid, "bun");

      const output: string[] = [];
      const exitCode = await runCli(
        [
          "materialize",
          "--seed",
          String(seed),
          "--runtime",
          "bun",
          "--state-file",
          stateFile,
          "--search-seed",
          searchSeed,
          "--chunk-size",
          "1000000",
          "--lane-count",
          "1",
          "--bun-workers",
          "1",
          "--apply",
          "--json",
        ],
        {
          write: (chunk) => output.push(chunk),
        },
      );

      expect(exitCode).toBe(0);
      const parsed = JSON.parse(output.join(""));
      expect(parsed.applied).toBe(true);
      expect(parsed.result.userID).toBe(expectedUid);
      expect(parsed.appliedUserID).toBe(expectedUid);

      const saved = JSON.parse(await readFile(configPath, "utf8")) as {
        userID: string;
      };
      expect(saved.userID).toBe(expectedUid);
    } finally {
      delete process.env.CLAUDE_BUDDY_CONFIG_PATH;
      await rm(directory, { recursive: true, force: true });
    }
  });

  bunOnly("returns seed candidates for Bun dry-run search", async () => {
    const output: string[] = [];

    const exitCode = await runCli(
      [
        "find",
        "--species",
        "capybara",
        "--shiny",
        "true",
        "--min-wisdom",
        "51",
        "--start-seed",
        "0",
        "--end-seed",
        "1000000",
        "--limit",
        "1",
        "--runtime",
        "bun",
        "--json",
      ],
      {
        write: (chunk) => output.push(chunk),
      },
    );

    expect(exitCode).toBe(0);

    const parsed = JSON.parse(output.join(""));
    expect(parsed.applied).toBe(false);
    expect(parsed.searchStrategy).toBe("seed-search");
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].userID).toBeUndefined();
    expect(parsed.results[0].species).toBe("capybara");
    expect(parsed.results[0].shiny).toBe(true);
    expect(parsed.results[0].stats.WISDOM).toBeGreaterThanOrEqual(51);
  });

  bunOnly("applies a Bun seed-search result via materialization", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-bun-"));
    const configPath = path.join(directory, ".claude.json");
    await writeFile(
      configPath,
      `${JSON.stringify({ hasCompletedOnboarding: true, theme: "dark" }, null, 2)}\n`,
      "utf8",
    );
    process.env.CLAUDE_BUDDY_CONFIG_PATH = configPath;

    try {
      const searchSeed = "vitest-cli-bun-apply-from-seed-search";
      const prefix = buildBunWitnessPrefix(searchSeed, 0);
      const expectedUid = `${prefix}00000000`;
      const seed = hashUserIdToSeed(expectedUid, "bun");

      const output: string[] = [];
      const exitCode = await runCli(
        [
          "find",
          "--start-seed",
          String(seed),
          "--end-seed",
          String(seed + 1),
          "--limit",
          "1",
          "--runtime",
          "bun",
          "--search-seed",
          searchSeed,
          "--apply",
          "--json",
        ],
        {
          write: (chunk) => output.push(chunk),
        },
      );

      expect(exitCode).toBe(0);

      const parsed = JSON.parse(output.join(""));
      expect(parsed.applied).toBe(true);
      expect(parsed.searchStrategy).toBe("seed-search");
      expect(parsed.appliedStrategy).toBe("bun-seed-materialization");
      expect(parsed.appliedUserID).toBe(expectedUid);
      expect(parsed.appliedSeed).toBe(parsed.results[0].seed);
      expect(parsed.appliedResult.userID).toBe(parsed.appliedUserID);
      expect(hashUserIdToSeed(parsed.appliedUserID, "bun")).toBe(parsed.appliedSeed);

      const saved = JSON.parse(await readFile(configPath, "utf8")) as {
        userID: string;
      };
      expect(saved.userID).toBe(parsed.appliedUserID);
    } finally {
      delete process.env.CLAUDE_BUDDY_CONFIG_PATH;
      await rm(directory, { recursive: true, force: true });
    }
  });
});

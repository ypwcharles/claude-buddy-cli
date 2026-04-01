import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applyUserIdToConfig,
  getClaudeConfigPath,
  loadClaudeConfig,
} from "../src/claude/config.js";

const createdDirs: string[] = [];

afterEach(async () => {
  delete process.env.CLAUDE_BUDDY_CONFIG_PATH;
  while (createdDirs.length > 0) {
    const directory = createdDirs.pop();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

async function makeTempConfig(initialConfig: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "claude-buddy-cli-"));
  createdDirs.push(directory);
  const filePath = path.join(directory, ".claude.json");
  await writeFile(filePath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8");
  process.env.CLAUDE_BUDDY_CONFIG_PATH = filePath;
  return filePath;
}

describe("claude config helpers", () => {
  it("resolves config path from environment override", () => {
    process.env.CLAUDE_BUDDY_CONFIG_PATH = "/tmp/custom-claude.json";

    expect(getClaudeConfigPath()).toBe("/tmp/custom-claude.json");
  });

  it("loads and updates only userID while preserving unrelated keys", async () => {
    const filePath = await makeTempConfig({
      theme: "dark",
      userID: "old-id",
      oauthAccount: null,
      nested: { keep: true },
    });

    const loaded = await loadClaudeConfig();
    expect(loaded.data.theme).toBe("dark");

    const result = await applyUserIdToConfig("new-id-64");
    expect(result.path).toBe(filePath);
    expect(result.warning).toBeUndefined();

    const updated = JSON.parse(await readFile(filePath, "utf8")) as {
      theme: string;
      userID: string;
      nested: { keep: boolean };
    };

    expect(updated).toEqual({
      theme: "dark",
      userID: "new-id-64",
      oauthAccount: null,
      nested: { keep: true },
    });
  });

  it("returns a warning when oauth account UUID would override userID", async () => {
    await makeTempConfig({
      oauthAccount: {
        accountUuid: "oauth-uuid",
      },
      userID: "old-id",
    });

    const result = await applyUserIdToConfig("new-id-64");

    expect(result.warning).toContain("oauthAccount.accountUuid");
  });
});

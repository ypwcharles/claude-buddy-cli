import { describe, expect, it } from "vitest";

import { buildCli } from "../src/cli.js";

describe("buildCli", () => {
  it("returns a help surface with the expected base description", () => {
    const cli = buildCli();

    expect(cli.name).toBe("claude-buddy");
    expect(cli.description).toContain("Claude Code Buddy");
  });
});

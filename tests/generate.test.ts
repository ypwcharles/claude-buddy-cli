import { describe, expect, it } from "vitest";

import { generateBuddyFromSeed, getTotalStats } from "../src/buddy/generate.js";

describe("generateBuddyFromSeed", () => {
  it("matches a known real 421-total legendary fixture", () => {
    const buddy = generateBuddyFromSeed(130412512);

    expect(buddy.rarity).toBe("legendary");
    expect(buddy.species).toBe("rabbit");
    expect(buddy.eye).toBe("✦");
    expect(buddy.hat).toBe("tinyduck");
    expect(buddy.shiny).toBe(false);
    expect(buddy.stats).toEqual({
      DEBUGGING: 54,
      PATIENCE: 100,
      CHAOS: 89,
      WISDOM: 89,
      SNARK: 89,
    });
    expect(getTotalStats(buddy.stats)).toBe(421);
  });

  it("matches the known top shiny dragon fixture", () => {
    const buddy = generateBuddyFromSeed(3716311402);

    expect(buddy.rarity).toBe("legendary");
    expect(buddy.species).toBe("dragon");
    expect(buddy.eye).toBe("@");
    expect(buddy.hat).toBe("halo");
    expect(buddy.shiny).toBe(true);
    expect(buddy.stats).toEqual({
      DEBUGGING: 54,
      PATIENCE: 89,
      CHAOS: 100,
      WISDOM: 89,
      SNARK: 88,
    });
    expect(getTotalStats(buddy.stats)).toBe(420);
  });

  it("matches a simple common-seed fixture", () => {
    const buddy = generateBuddyFromSeed(0);

    expect(buddy.rarity).toBe("common");
    expect(buddy.species).toBe("duck");
    expect(buddy.eye).toBe("✦");
    expect(buddy.hat).toBe("none");
    expect(buddy.shiny).toBe(false);
    expect(buddy.stats).toEqual({
      DEBUGGING: 30,
      PATIENCE: 23,
      CHAOS: 72,
      WISDOM: 1,
      SNARK: 8,
    });
    expect(getTotalStats(buddy.stats)).toBe(134);
  });
});

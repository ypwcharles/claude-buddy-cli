import { describe, expect, it } from "vitest";

import { searchSeeds } from "../src/search/search.js";

describe("searchSeeds", () => {
  it("filters by appearance fields and ranks by total stats descending", () => {
    const results = searchSeeds(
      {
        species: "duck",
        rarity: "common",
        shiny: false,
      },
      { startSeed: 0, endSeed: 2000, limit: 3 },
    );

    expect(results.map((result) => ({
      seed: result.seed,
      totalStats: result.totalStats,
      species: result.buddy.species,
      rarity: result.buddy.rarity,
      shiny: result.buddy.shiny,
    }))).toEqual([
      {
        seed: 52,
        totalStats: 184,
        species: "duck",
        rarity: "common",
        shiny: false,
      },
      {
        seed: 6,
        totalStats: 181,
        species: "duck",
        rarity: "common",
        shiny: false,
      },
      {
        seed: 1692,
        totalStats: 181,
        species: "duck",
        rarity: "common",
        shiny: false,
      },
    ]);
  });

  it("filters by exact stat values and appearance", () => {
    const results = searchSeeds(
      {
        species: "dragon",
        shiny: true,
        chaos: 100,
        debugging: 54,
        hat: "halo",
      },
      { startSeed: 3716311402, endSeed: 3716311403, limit: 5 },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.seed).toBe(3716311402);
    expect(results[0]?.totalStats).toBe(420);
    expect(results[0]?.buddy.stats).toEqual({
      DEBUGGING: 54,
      PATIENCE: 89,
      CHAOS: 100,
      WISDOM: 89,
      SNARK: 88,
    });
  });

  it("supports ranged stat filters", () => {
    const results = searchSeeds(
      {
        species: "dragon",
        shiny: true,
        minWisdom: 90,
        minTotal: 230,
      },
      { startSeed: 0, endSeed: 5000, limit: 2 },
    );

    expect(results.map((result) => ({
      seed: result.seed,
      totalStats: result.totalStats,
      wisdom: result.buddy.stats.WISDOM,
    }))).toEqual([
      {
        seed: 1497,
        totalStats: 264,
        wisdom: 94,
      },
      {
        seed: 849,
        totalStats: 233,
        wisdom: 91,
      },
    ]);
  });

  it("emits throttled progress events during scanning", () => {
    const events: Array<{
      scanned: number;
      total: number;
      matches: number;
      done: boolean;
    }> = [];

    const results = searchSeeds(
      {
        species: "duck",
      },
      {
        startSeed: 0,
        endSeed: 12,
        limit: 2,
        progressIntervalSeeds: 3,
        progressIntervalMs: 0,
        onProgress: (event) => {
          events.push({
            scanned: event.scanned,
            total: event.total,
            matches: event.matches,
            done: event.done,
          });
        },
      },
    );

    expect(results).toHaveLength(2);
    expect(events).toEqual([
      { scanned: 3, total: 12, matches: 2, done: false },
      { scanned: 6, total: 12, matches: 3, done: false },
      { scanned: 9, total: 12, matches: 4, done: false },
      { scanned: 12, total: 12, matches: 4, done: false },
      { scanned: 12, total: 12, matches: 4, done: true },
    ]);
  });
});

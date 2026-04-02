import { describe, expect, it } from "vitest";

import { generateBuddyFromSeed, getTotalStats } from "../src/buddy/generate.js";
import { hashUserIdToSeed } from "../src/buddy/hash.js";
import {
  advanceBunMaterializationState,
  buildBunWitnessPrefix,
  buildDeterministicHexPrefix,
  createBunMaterializationState,
  materializeBunUidForSeedChunked,
  reconstructUidForSeed,
  searchBunWitnesses,
  searchBunWitnessesForSeeds,
} from "../src/uid/reconstruct.js";

describe("reconstructUidForSeed", () => {
  it("reconstructs a 64-char hex userID for a known Node seed", () => {
    const uid = reconstructUidForSeed(3716311402, { runtime: "node" });

    expect(uid).toMatch(/^[0-9a-f]{64}$/);
    expect(hashUserIdToSeed(uid, "node")).toBe(3716311402);
  });

  it("can generate distinct userIDs for the same Node seed", () => {
    const first = reconstructUidForSeed(130412512, {
      runtime: "node",
      variant: 0,
    });
    const second = reconstructUidForSeed(130412512, {
      runtime: "node",
      variant: 1,
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
    expect(hashUserIdToSeed(first, "node")).toBe(130412512);
    expect(hashUserIdToSeed(second, "node")).toBe(130412512);
  });

  const bunOnly = typeof Bun !== "undefined" ? it : it.skip;

  bunOnly("reconstructs a Bun userID for a synthetic early-hit seed", () => {
    const prefix = buildDeterministicHexPrefix("bun", 56, 0);
    const expectedUid = `${prefix}00000000`;
    const seed = hashUserIdToSeed(expectedUid, "bun");

    const reconstructed = reconstructUidForSeed(seed, {
      runtime: "bun",
      variant: 0,
      bunPrefixAttempts: 1,
    });

    expect(reconstructed).toBe(expectedUid);
    expect(hashUserIdToSeed(reconstructed, "bun")).toBe(seed);
  });

  bunOnly("supports worker-partitioned Bun reconstruction", () => {
    const prefix = buildDeterministicHexPrefix("bun", 56, 0);
    const expectedUid = `${prefix}00000000`;
    const seed = hashUserIdToSeed(expectedUid, "bun");

    const reconstructed = reconstructUidForSeed(seed, {
      runtime: "bun",
      variant: 0,
      bunPrefixAttempts: 1,
      bunWorkers: 2,
    });

    expect(reconstructed).toBe(expectedUid);
    expect(hashUserIdToSeed(reconstructed, "bun")).toBe(seed);
  });

  bunOnly("derives different Bun witness prefixes from different internal search seeds", () => {
    const first = buildBunWitnessPrefix("search-a", 0);
    const second = buildBunWitnessPrefix("search-b", 0);

    expect(first).toMatch(/^[0-9a-f]{56}$/);
    expect(second).toMatch(/^[0-9a-f]{56}$/);
    expect(first).not.toBe(second);
  });

  bunOnly("continues Bun witness search beyond the first 10 million suffixes when needed", () => {
    const searchSeed = "vitest-beyond-10m";
    const prefix = buildBunWitnessPrefix(searchSeed, 0);
    const suffix = 12_345_678;
    const expectedUid = `${prefix}${suffix.toString(16).padStart(8, "0")}`;
    const seed = hashUserIdToSeed(expectedUid, "bun");
    const buddy = generateBuddyFromSeed(seed);
    const totalStats = getTotalStats(buddy.stats);

    const results = searchBunWitnesses(
      {
        species: buddy.species,
        rarity: buddy.rarity,
        eye: buddy.eye,
        hat: buddy.hat,
        shiny: buddy.shiny,
        debugging: buddy.stats.DEBUGGING,
        patience: buddy.stats.PATIENCE,
        chaos: buddy.stats.CHAOS,
        wisdom: buddy.stats.WISDOM,
        snark: buddy.stats.SNARK,
        minTotal: totalStats,
        maxTotal: totalStats,
      },
      {
        limit: 1,
        searchSeed,
        laneCount: 1,
      },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.userID).toBe(expectedUid);
    expect(results[0]?.seed).toBe(seed);
  });

  bunOnly("finds a Bun witness directly from a target seed set", async () => {
    const searchSeed = "vitest-seed-set";
    const prefix = buildBunWitnessPrefix(searchSeed, 0);
    const expectedUid = `${prefix}00000000`;
    const seed = hashUserIdToSeed(expectedUid, "bun");

    const results = await searchBunWitnessesForSeeds([seed], {
      limit: 1,
      searchSeed,
      bunWorkers: 1,
      startSuffix: 0,
      endSuffix: 1,
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.userID).toBe(expectedUid);
    expect(results[0]?.seed).toBe(seed);
  });

  bunOnly("resumes exact Bun materialization across chunks", () => {
    const searchSeed = "vitest-materialize-resume";
    const prefix = buildBunWitnessPrefix(searchSeed, 0);
    const suffix = 2_100_123;
    const expectedUid = `${prefix}${suffix.toString(16).padStart(8, "0")}`;
    const seed = hashUserIdToSeed(expectedUid, "bun");

    const state = createBunMaterializationState(seed, {
      searchSeed,
      laneCount: 1,
      chunkSize: 1_000_000,
    });

    const first = advanceBunMaterializationState(state, { bunWorkers: 1 });
    expect(first.found).toBeUndefined();
    expect(first.done).toBe(false);
    expect(first.state.lanes[0]?.nextSuffix).toBe(1_000_000);

    const second = advanceBunMaterializationState(state, { bunWorkers: 1 });
    expect(second.found).toBeUndefined();
    expect(second.done).toBe(false);
    expect(second.state.lanes[0]?.nextSuffix).toBe(2_000_000);

    const third = advanceBunMaterializationState(state, { bunWorkers: 1 });
    expect(third.found?.userID).toBe(expectedUid);
    expect(third.found?.seed).toBe(seed);
    expect(third.done).toBe(true);
  });

  bunOnly("can continue from serialized Bun materialization state", () => {
    const searchSeed = "vitest-materialize-serialized";
    const prefix = buildBunWitnessPrefix(searchSeed, 0);
    const suffix = 1_234_567;
    const expectedUid = `${prefix}${suffix.toString(16).padStart(8, "0")}`;
    const seed = hashUserIdToSeed(expectedUid, "bun");

    const initial = createBunMaterializationState(seed, {
      searchSeed,
      laneCount: 1,
      chunkSize: 1_000_000,
    });
    const partial = materializeBunUidForSeedChunked(seed, {
      state: initial,
      bunWorkers: 1,
      maxSteps: 1,
    });

    expect(partial.found).toBeUndefined();
    expect(partial.done).toBe(false);

    const resumedState = JSON.parse(JSON.stringify(partial.state));
    const resumed = materializeBunUidForSeedChunked(seed, {
      state: resumedState,
      bunWorkers: 1,
      maxSteps: 1,
    });

    expect(resumed.found?.userID).toBe(expectedUid);
    expect(resumed.found?.seed).toBe(seed);
    expect(resumed.done).toBe(true);
  });
});

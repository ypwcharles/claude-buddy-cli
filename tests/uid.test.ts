import { describe, expect, it } from "vitest";

import { hashUserIdToSeed } from "../src/buddy/hash.js";
import {
  buildDeterministicHexPrefix,
  reconstructUidForSeed,
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
});

import crypto from "node:crypto";
import os from "node:os";
import { Worker } from "node:worker_threads";

import { generateBuddyFromSeed, getTotalStats } from "../buddy/generate.js";
import {
  BUDDY_SALT,
  hashFNV1a,
  type RuntimeMode,
} from "../buddy/hash.js";
import {
  matchesFilters,
  type SearchCandidate,
  type SearchFilters,
} from "../search/filters.js";
import { rankCandidates } from "../search/rank.js";

const FNV_INV_PRIME = 899433627 >>> 0;
const HEX_ALPHABET = "0123456789abcdef";
const HEX_16 = Array.from(
  { length: 65536 },
  (_, value) => value.toString(16).padStart(4, "0"),
);
const HEX_BYTES = new TextEncoder().encode(HEX_ALPHABET);
const BUN_SUFFIX_START = 56;
const BUN_SUFFIX_END = 64;
const UINT32_LIMIT = 0x1_0000_0000;
const BUN_SCAN_WORKER_CODE = `
const { workerData } = require("node:worker_threads");
const state = new Int32Array(workerData.shared);
const bytes = new TextEncoder().encode(workerData.prefix + "00000000" + workerData.salt);
const hexBytes = new TextEncoder().encode("0123456789abcdef");

for (let suffix = workerData.start; suffix < workerData.end; suffix++) {
  if (Atomics.load(state, 0) !== 0) break;

  let value = suffix >>> 0;
  bytes[63] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[62] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[61] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[60] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[59] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[58] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[57] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[56] = hexBytes[value & 0xf];

  const candidateSeed = Number(BigInt(Bun.hash(bytes)) & 0xffffffffn);
  if (candidateSeed === (workerData.targetSeed >>> 0)) {
    if (Atomics.compareExchange(state, 0, 0, 1) === 0) {
      Atomics.store(state, 2, suffix | 0);
      Atomics.notify(state, 0);
    }
    break;
  }
}

if (Atomics.add(state, 1, 1) + 1 === workerData.workerCount) {
  if (Atomics.compareExchange(state, 0, 0, 2) === 0) {
    Atomics.notify(state, 0);
  }
}
`;

const BUN_SEED_SET_SCAN_WORKER_CODE = `
const { workerData } = require("node:worker_threads");
const state = new Int32Array(workerData.shared);
const bytes = new TextEncoder().encode(workerData.prefix + "00000000" + workerData.salt);
const hexBytes = new TextEncoder().encode("0123456789abcdef");
const targetSeeds = new Set(workerData.targetSeeds.map((value) => value >>> 0));

for (let suffix = workerData.start; suffix < workerData.end; suffix++) {
  if (Atomics.load(state, 0) !== 0) break;

  let value = suffix >>> 0;
  bytes[63] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[62] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[61] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[60] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[59] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[58] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[57] = hexBytes[value & 0xf]; value >>>= 4;
  bytes[56] = hexBytes[value & 0xf];

  const candidateSeed = Number(BigInt(Bun.hash(bytes)) & 0xffffffffn);
  if (!targetSeeds.has(candidateSeed)) {
    continue;
  }

  if (Atomics.compareExchange(state, 0, 0, 1) === 0) {
    Atomics.store(state, 2, suffix | 0);
    Atomics.store(state, 3, candidateSeed | 0);
    Atomics.notify(state, 0);
  }
  break;
}

if (Atomics.add(state, 1, 1) + 1 === workerData.workerCount) {
  if (Atomics.compareExchange(state, 0, 0, 2) === 0) {
    Atomics.notify(state, 0);
  }
}
`;

function getRequiredBun(): NonNullable<typeof Bun> {
  if (typeof Bun === "undefined") {
    throw new Error("Bun runtime is required for this operation.");
  }
  return Bun;
}

function getDefaultBunWorkerCount(): number {
  return Math.max(
    1,
    Math.min(
      typeof os.availableParallelism === "function"
        ? os.availableParallelism()
        : os.cpus().length,
      8,
    ),
  );
}

function reverseAsciiSuffix(finalHash: number, suffix: string): number {
  let hash = finalHash >>> 0;
  for (let index = suffix.length - 1; index >= 0; index--) {
    hash = Math.imul(hash, FNV_INV_PRIME) >>> 0;
    hash = (hash ^ suffix.charCodeAt(index)) >>> 0;
  }
  return hash >>> 0;
}

function reverseKnownSuffix(finalHash: number, suffix: string): number {
  return reverseAsciiSuffix(finalHash, suffix);
}

let hexPrefixMap: Map<number, string> | undefined;

function buildHexPrefixMap(): Map<number, string> {
  if (hexPrefixMap) {
    return hexPrefixMap;
  }

  const map = new Map<number, string>();
  for (let a = 0; a < HEX_ALPHABET.length; a++) {
    for (let b = 0; b < HEX_ALPHABET.length; b++) {
      for (let c = 0; c < HEX_ALPHABET.length; c++) {
        for (let d = 0; d < HEX_ALPHABET.length; d++) {
          const prefix =
            HEX_ALPHABET[a] +
            HEX_ALPHABET[b] +
            HEX_ALPHABET[c] +
            HEX_ALPHABET[d];
          const hash = hashFNV1a(prefix);
          if (!map.has(hash)) {
            map.set(hash, prefix);
          }
        }
      }
    }
  }

  hexPrefixMap = map;
  return map;
}

export function buildDeterministicHexPrefix(
  scope: string | number,
  prefixLength: number,
  attempt: number,
): string {
  let output = "";
  let counter = 0;
  while (output.length < prefixLength) {
    output += crypto
      .createHash("sha256")
      .update(`claude-buddy:${scope}:${attempt}:${counter}`)
      .digest("hex");
    counter++;
  }
  return output.slice(0, prefixLength);
}

function suffixToHex(suffix: number): string {
  const value = suffix >>> 0;
  return `${HEX_16[value >>> 16]}${HEX_16[value & 0xffff]}`;
}

function writeSuffixHex(bytes: Uint8Array, suffix: number): void {
  let value = suffix >>> 0;
  bytes[BUN_SUFFIX_END - 1] = HEX_BYTES[value & 0xf];
  value >>>= 4;
  bytes[BUN_SUFFIX_END - 2] = HEX_BYTES[value & 0xf];
  value >>>= 4;
  bytes[BUN_SUFFIX_END - 3] = HEX_BYTES[value & 0xf];
  value >>>= 4;
  bytes[BUN_SUFFIX_END - 4] = HEX_BYTES[value & 0xf];
  value >>>= 4;
  bytes[BUN_SUFFIX_END - 5] = HEX_BYTES[value & 0xf];
  value >>>= 4;
  bytes[BUN_SUFFIX_END - 6] = HEX_BYTES[value & 0xf];
  value >>>= 4;
  bytes[BUN_SUFFIX_END - 7] = HEX_BYTES[value & 0xf];
  value >>>= 4;
  bytes[BUN_SUFFIX_START] = HEX_BYTES[value & 0xf];
}

function resolveBunSearchSeed(searchSeed?: string): string {
  if (searchSeed && searchSeed.length > 0) {
    return searchSeed;
  }

  const envSeed = process.env.CLAUDE_BUDDY_BUN_SEARCH_SEED;
  if (envSeed && envSeed.length > 0) {
    return envSeed;
  }

  if (process.env.VITEST) {
    return "vitest";
  }

  return crypto.randomUUID();
}

export function buildBunWitnessPrefix(searchSeed: string, laneIndex = 0): string {
  return buildDeterministicHexPrefix(`bun-search:${searchSeed}`, 56, laneIndex);
}

function findHexBridgeFromState(startState: number, endState: number): string | null {
  const forward = new Map<number, string>();

  for (let a = 0; a < HEX_ALPHABET.length; a++) {
    for (let b = 0; b < HEX_ALPHABET.length; b++) {
      for (let c = 0; c < HEX_ALPHABET.length; c++) {
        for (let d = 0; d < HEX_ALPHABET.length; d++) {
          const left =
            HEX_ALPHABET[a] +
            HEX_ALPHABET[b] +
            HEX_ALPHABET[c] +
            HEX_ALPHABET[d];
          const state = hashFNV1aFromState(startState, left);
          if (!forward.has(state)) {
            forward.set(state, left);
          }
        }
      }
    }
  }

  for (let a = 0; a < HEX_ALPHABET.length; a++) {
    for (let b = 0; b < HEX_ALPHABET.length; b++) {
      for (let c = 0; c < HEX_ALPHABET.length; c++) {
        for (let d = 0; d < HEX_ALPHABET.length; d++) {
          const right =
            HEX_ALPHABET[a] +
            HEX_ALPHABET[b] +
            HEX_ALPHABET[c] +
            HEX_ALPHABET[d];
          const state = reverseAsciiSuffix(endState, right);
          const left = forward.get(state);
          if (left) {
            return left + right;
          }
        }
      }
    }
  }

  return null;
}

function hashFNV1aFromState(state: number, text: string): number {
  let hash = state >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function findFixedLengthHexUidForHash(
  targetHash: number,
  totalLength: number,
  variant: number,
): string | null {
  if (totalLength < 8) {
    return null;
  }

  if (totalLength === 8) {
    return findPrintableHexUidForHash(targetHash);
  }

  const prefixLength = totalLength - 8;
  const startAttempt = Math.max(0, variant) * 512;
  const endAttempt = startAttempt + 512;

  for (let attempt = startAttempt; attempt < endAttempt; attempt++) {
    const prefix = buildDeterministicHexPrefix(targetHash, prefixLength, attempt);
    const bridge = findHexBridgeFromState(hashFNV1a(prefix), targetHash);
    if (bridge) {
      return prefix + bridge;
    }
  }

  return null;
}

function findPrintableHexUidForHash(targetHash: number): string | null {
  const prefixMap = buildHexPrefixMap();

  for (let a = 0; a < HEX_ALPHABET.length; a++) {
    for (let b = 0; b < HEX_ALPHABET.length; b++) {
      for (let c = 0; c < HEX_ALPHABET.length; c++) {
        for (let d = 0; d < HEX_ALPHABET.length; d++) {
          const suffix =
            HEX_ALPHABET[a] +
            HEX_ALPHABET[b] +
            HEX_ALPHABET[c] +
            HEX_ALPHABET[d];
          const prior = reverseAsciiSuffix(targetHash, suffix);
          const prefix = prefixMap.get(prior);
          if (prefix) {
            return prefix + suffix;
          }
        }
      }
    }
  }

  return null;
}

function scanBunSuffixRange(
  prefix: string,
  targetSeed: number,
  start: number,
  end: number,
): number | null {
  const bun = getRequiredBun();
  const bytes = new TextEncoder().encode(prefix + "00000000" + BUDDY_SALT);

  for (let suffix = start; suffix < end; suffix++) {
    writeSuffixHex(bytes, suffix);

    const candidateSeed = Number(BigInt(bun.hash(bytes)) & 0xffffffffn);
    if (candidateSeed === (targetSeed >>> 0)) {
      return suffix >>> 0;
    }
  }

  return null;
}

function scanBunSeedSetRange(
  prefix: string,
  targetSeeds: Set<number>,
  start: number,
  end: number,
): { seed: number; suffix: number } | null {
  const bun = getRequiredBun();
  const bytes = new TextEncoder().encode(prefix + "00000000" + BUDDY_SALT);

  for (let suffix = start; suffix < end; suffix++) {
    writeSuffixHex(bytes, suffix);

    const candidateSeed = Number(BigInt(bun.hash(bytes)) & 0xffffffffn);
    if (!targetSeeds.has(candidateSeed)) {
      continue;
    }

    return {
      seed: candidateSeed >>> 0,
      suffix: suffix >>> 0,
    };
  }

  return null;
}

function scanBunSuffixParallel(
  prefix: string,
  targetSeed: number,
  workerCount: number,
): number | null {
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 3);
  const state = new Int32Array(shared);
  const span = Math.floor(0x1_0000_0000 / workerCount);
  const workers: Worker[] = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    const start = workerIndex * span;
    const end =
      workerIndex === workerCount - 1
        ? 0x1_0000_0000
        : start + span;

    workers.push(
      new Worker(BUN_SCAN_WORKER_CODE, {
        eval: true,
        workerData: {
          prefix,
          salt: BUDDY_SALT,
          targetSeed,
          start,
          end,
          workerCount,
          shared,
        },
      }),
    );
  }

  while (true) {
    const status = Atomics.load(state, 0);
    if (status === 1) {
      const foundSuffix = Atomics.load(state, 2) >>> 0;
      for (const worker of workers) {
        void worker.terminate();
      }
      return foundSuffix;
    }
    if (status === 2) {
      for (const worker of workers) {
        void worker.terminate();
      }
      return null;
    }
    Atomics.wait(state, 0, 0);
  }
}

function scanBunSeedSetParallel(
  prefix: string,
  targetSeeds: number[],
  workerCount: number,
  start: number,
  end: number,
): { seed: number; suffix: number } | null {
  const shared = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4);
  const state = new Int32Array(shared);
  const total = end - start;
  const span = Math.floor(total / workerCount);
  const workers: Worker[] = [];

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex++) {
    const workerStart = start + workerIndex * span;
    const workerEnd =
      workerIndex === workerCount - 1
        ? end
        : workerStart + span;

    workers.push(
      new Worker(BUN_SEED_SET_SCAN_WORKER_CODE, {
        eval: true,
        workerData: {
          prefix,
          salt: BUDDY_SALT,
          targetSeeds,
          start: workerStart,
          end: workerEnd,
          workerCount,
          shared,
        },
      }),
    );
  }

  while (true) {
    const status = Atomics.load(state, 0);
    if (status === 1) {
      const foundSuffix = Atomics.load(state, 2) >>> 0;
      const foundSeed = Atomics.load(state, 3) >>> 0;
      for (const worker of workers) {
        void worker.terminate();
      }
      return {
        seed: foundSeed,
        suffix: foundSuffix,
      };
    }
    if (status === 2) {
      for (const worker of workers) {
        void worker.terminate();
      }
      return null;
    }
    Atomics.wait(state, 0, 0);
  }
}

function findBunUidForSeed(
  seed: number,
  options: {
    length: number;
    variant: number;
    bunPrefixAttempts: number;
    bunWorkers: number;
  },
): string {
  if (typeof Bun === "undefined") {
    throw new Error(
      "Bun UID reconstruction requires running the CLI under Bun.",
    );
  }

  if (options.length !== 64) {
    throw new Error("Bun UID reconstruction currently supports 64-character hex IDs only.");
  }

  const prefixLength = options.length - 8;
  const startAttempt = Math.max(0, options.variant);
  const endAttempt = startAttempt + Math.max(1, options.bunPrefixAttempts);
  const workerCount = Math.max(1, options.bunWorkers);

  for (let attempt = startAttempt; attempt < endAttempt; attempt++) {
    const prefix = buildDeterministicHexPrefix("bun", prefixLength, attempt);
    const suffix =
      workerCount === 1
        ? scanBunSuffixRange(prefix, seed >>> 0, 0, 0x1_0000_0000)
        : scanBunSuffixParallel(prefix, seed >>> 0, workerCount);
    if (suffix !== null) {
      return `${prefix}${suffixToHex(suffix)}`;
    }
  }

  throw new Error(`Unable to reconstruct a Bun uid for seed ${seed}.`);
}

export type BunWitnessCandidate = SearchCandidate & {
  userID: string;
  prefixAttempt: number;
  suffix: number;
};

export function searchBunWitnesses(
  filters: SearchFilters,
  options: {
    limit?: number;
    startSuffix?: number;
    endSuffix?: number;
    prefixAttempts?: number;
    variant?: number;
    searchSeed?: string;
    laneCount?: number;
  } = {},
): BunWitnessCandidate[] {
  const bun = getRequiredBun();
  const limit = options.limit ?? 20;
  const startSuffix = Math.max(0, options.startSuffix ?? 0);
  const endSuffix = Math.max(startSuffix, options.endSuffix ?? UINT32_LIMIT);
  const laneCount = Math.max(
    1,
    options.laneCount ?? options.prefixAttempts ?? 1,
  );
  const searchSeed = resolveBunSearchSeed(options.searchSeed);
  const matches: BunWitnessCandidate[] = [];
  const lanes = Array.from({ length: laneCount }, (_, laneIndex) => {
    const prefix = buildBunWitnessPrefix(searchSeed, laneIndex);
    return {
      prefix,
      bytes: new TextEncoder().encode(prefix + "00000000" + BUDDY_SALT),
      prefixAttempt: laneIndex,
    };
  });

  const insertCandidate = (candidate: BunWitnessCandidate): void => {
    if (matches.length === 0) {
      matches.push(candidate);
      return;
    }

    for (let index = 0; index < matches.length; index++) {
      if (rankCandidates(candidate, matches[index]!) < 0) {
        matches.splice(index, 0, candidate);
        if (matches.length > limit) {
          matches.pop();
        }
        return;
      }
    }

    if (matches.length < limit) {
      matches.push(candidate);
    }
  }

  for (let suffix = startSuffix; suffix < endSuffix; suffix++) {
    for (const lane of lanes) {
      writeSuffixHex(lane.bytes, suffix);
      const seed = Number(BigInt(bun.hash(lane.bytes)) & 0xffffffffn);
      const buddy = generateBuddyFromSeed(seed);
      const candidate: SearchCandidate = {
        seed,
        buddy,
        totalStats: getTotalStats(buddy.stats),
      };

      if (!matchesFilters(candidate, filters)) {
        continue;
      }

      insertCandidate({
        ...candidate,
        userID: `${lane.prefix}${suffixToHex(suffix)}`,
        prefixAttempt: lane.prefixAttempt,
        suffix: suffix >>> 0,
      });

      if (matches.length >= limit) {
        return matches.slice(0, limit);
      }
    }
  }

  return matches.slice(0, limit);
}

export async function searchBunWitnessesForSeeds(
  targetSeeds: number[],
  options: {
    limit?: number;
    startSuffix?: number;
    endSuffix?: number;
    prefixAttempts?: number;
    searchSeed?: string;
    bunWorkers?: number;
  } = {},
): Promise<BunWitnessCandidate[]> {
  getRequiredBun();

  if (targetSeeds.length === 0) {
    return [];
  }

  const normalizedTargets = Array.from(
    new Set(targetSeeds.map((seed) => seed >>> 0)),
  );
  const remainingTargets = new Set(normalizedTargets);
  const limit = Math.max(1, options.limit ?? 1);
  const prefixAttempts = Math.max(1, options.prefixAttempts ?? limit);
  const startSuffix = Math.max(0, options.startSuffix ?? 0);
  const endSuffix = Math.max(startSuffix, options.endSuffix ?? UINT32_LIMIT);
  const searchSeed = resolveBunSearchSeed(options.searchSeed);
  const workerCount = Math.max(1, options.bunWorkers ?? getDefaultBunWorkerCount());
  const matches: BunWitnessCandidate[] = [];

  const insertCandidate = (candidate: BunWitnessCandidate): void => {
    if (matches.length === 0) {
      matches.push(candidate);
      return;
    }

    for (let index = 0; index < matches.length; index++) {
      if (rankCandidates(candidate, matches[index]!) < 0) {
        matches.splice(index, 0, candidate);
        if (matches.length > limit) {
          matches.pop();
        }
        return;
      }
    }

    if (matches.length < limit) {
      matches.push(candidate);
    }
  };

  for (
    let prefixAttempt = 0;
    prefixAttempt < prefixAttempts && matches.length < limit && remainingTargets.size > 0;
    prefixAttempt++
  ) {
    const prefix = buildBunWitnessPrefix(searchSeed, prefixAttempt);
    const found =
      workerCount === 1
        ? scanBunSeedSetRange(prefix, remainingTargets, startSuffix, endSuffix)
        : scanBunSeedSetParallel(
            prefix,
            Array.from(remainingTargets),
            workerCount,
            startSuffix,
            endSuffix,
          );

    if (!found) {
      continue;
    }

    remainingTargets.delete(found.seed);
    const buddy = generateBuddyFromSeed(found.seed);
    insertCandidate({
      seed: found.seed,
      buddy,
      totalStats: getTotalStats(buddy.stats),
      userID: `${prefix}${suffixToHex(found.suffix)}`,
      prefixAttempt,
      suffix: found.suffix,
    });
  }

  return matches.slice(0, limit);
}

export type BunMaterializationLaneState = {
  prefixAttempt: number;
  nextSuffix: number;
  completed: boolean;
};

export type BunMaterializationState = {
  targetSeed: number;
  searchSeed: string;
  laneCount: number;
  chunkSize: number;
  scanned: number;
  lanes: BunMaterializationLaneState[];
};

export type BunMaterializationResult = {
  userID: string;
  seed: number;
  prefixAttempt: number;
  suffix: number;
};

export type BunMaterializationStep = {
  state: BunMaterializationState;
  scannedThisStep: number;
  found?: BunMaterializationResult;
  done: boolean;
};

export function createBunMaterializationState(
  targetSeed: number,
  options: {
    searchSeed?: string;
    laneCount?: number;
    chunkSize?: number;
  } = {},
): BunMaterializationState {
  const laneCount = Math.max(1, options.laneCount ?? 1);
  const chunkSize = Math.max(1, options.chunkSize ?? 1_000_000);
  return {
    targetSeed: targetSeed >>> 0,
    searchSeed: resolveBunSearchSeed(options.searchSeed),
    laneCount,
    chunkSize,
    scanned: 0,
    lanes: Array.from({ length: laneCount }, (_, laneIndex) => ({
      prefixAttempt: laneIndex,
      nextSuffix: 0,
      completed: false,
    })),
  };
}

export function advanceBunMaterializationState(
  state: BunMaterializationState,
  options: {
    bunWorkers?: number;
  } = {},
): BunMaterializationStep {
  getRequiredBun();

  const workerCount = Math.max(1, options.bunWorkers ?? getDefaultBunWorkerCount());
  const targetSeed = state.targetSeed >>> 0;
  let scannedThisStep = 0;

  for (const lane of state.lanes) {
    if (lane.completed) {
      continue;
    }

    const start = Math.max(0, lane.nextSuffix >>> 0);
    if (start >= UINT32_LIMIT) {
      lane.completed = true;
      continue;
    }

    const end = Math.min(UINT32_LIMIT, start + state.chunkSize);
    const prefix = buildBunWitnessPrefix(state.searchSeed, lane.prefixAttempt);
    const found =
      workerCount === 1
        ? scanBunSeedSetRange(prefix, new Set([targetSeed]), start, end)
        : scanBunSeedSetParallel(prefix, [targetSeed], workerCount, start, end);

    const scannedInLane = found ? found.suffix - start + 1 : end - start;
    scannedThisStep += scannedInLane;
    state.scanned += scannedInLane;

    if (found) {
      lane.nextSuffix = found.suffix + 1;
      if (lane.nextSuffix >= UINT32_LIMIT) {
        lane.completed = true;
      }
      return {
        state,
        scannedThisStep,
        found: {
          userID: `${prefix}${suffixToHex(found.suffix)}`,
          seed: found.seed,
          prefixAttempt: lane.prefixAttempt,
          suffix: found.suffix,
        },
        done: true,
      };
    }

    lane.nextSuffix = end;
    if (end >= UINT32_LIMIT) {
      lane.completed = true;
    }
  }

  return {
    state,
    scannedThisStep,
    done: state.lanes.every((lane) => lane.completed),
  };
}

export function materializeBunUidForSeedChunked(
  targetSeed: number,
  options: {
    searchSeed?: string;
    laneCount?: number;
    chunkSize?: number;
    maxSteps?: number;
    bunWorkers?: number;
    state?: BunMaterializationState;
  } = {},
): BunMaterializationStep {
  const state =
    options.state ?? createBunMaterializationState(targetSeed, options);
  const maxSteps = Math.max(1, options.maxSteps ?? Number.MAX_SAFE_INTEGER);
  let totalScanned = 0;

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex++) {
    const step = advanceBunMaterializationState(state, {
      bunWorkers: options.bunWorkers,
    });
    totalScanned += step.scannedThisStep;

    if (step.found || step.done) {
      return {
        state: step.state,
        scannedThisStep: totalScanned,
        found: step.found,
        done: step.done,
      };
    }
  }

  return {
    state,
    scannedThisStep: totalScanned,
    done: state.lanes.every((lane) => lane.completed),
  };
}

export function reconstructUidForSeed(
  seed: number,
  options: {
    runtime: RuntimeMode;
    variant?: number;
    length?: number;
    bunPrefixAttempts?: number;
    bunWorkers?: number;
  },
): string {
  const runtime = options.runtime === "auto" ? "node" : options.runtime;
  if (runtime === "bun") {
    return findBunUidForSeed(seed, {
      length: options.length ?? 64,
      variant: options.variant ?? 0,
      bunPrefixAttempts: options.bunPrefixAttempts ?? 8,
      bunWorkers: options.bunWorkers ?? getDefaultBunWorkerCount(),
    });
  }

  const targetHash = reverseKnownSuffix(seed, BUDDY_SALT);
  const uid = findFixedLengthHexUidForHash(
    targetHash,
    options.length ?? 64,
    options.variant ?? 0,
  );

  if (!uid) {
    throw new Error(`Unable to reconstruct a ${options.length ?? 64}-char uid for seed ${seed}.`);
  }

  return uid;
}

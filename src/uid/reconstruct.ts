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

const GLOBAL_HEX16_TABLE = new Uint8Array(65536 * 4);
for (let i = 0; i < 65536; i++) {
  GLOBAL_HEX16_TABLE[i * 4 + 0] = HEX_BYTES[(i >>> 12) & 0xf];
  GLOBAL_HEX16_TABLE[i * 4 + 1] = HEX_BYTES[(i >>> 8) & 0xf];
  GLOBAL_HEX16_TABLE[i * 4 + 2] = HEX_BYTES[(i >>> 4) & 0xf];
  GLOBAL_HEX16_TABLE[i * 4 + 3] = HEX_BYTES[i & 0xf];
}

let _nativeFFI: any = null;
let _nativeAttempted = false;

const NULL_PTR = BigInt(0);

function normalizeSuffixBoundary(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(UINT32_LIMIT, Math.trunc(value)));
}

function loadNativeFFI(): any {
  if (_nativeAttempted) return _nativeFFI;
  _nativeAttempted = true;
  if (typeof Bun === "undefined") return null;

  try {
    const ffi = require("bun:ffi");
    const { join, dirname } = require("node:path");
    const { existsSync, statSync } = require("node:fs");
    const { spawnSync } = require("node:child_process");

    // 从 dist/uid/ 往上找到项目根，再定位 src/uid/native
    const projectRoot = dirname(dirname(import.meta.dirname));
    const nativeSrcDir = join(projectRoot, "src", "uid", "native");
    if (!existsSync(nativeSrcDir)) return null;

    const ext = process.platform === "darwin" ? "dylib" : process.platform === "win32" ? "dll" : "so";
    const dylibPath = join(nativeSrcDir, `scan.${process.arch}.${ext}`);
    const scanSourcePath = join(nativeSrcDir, "scan.c");
    const wyhashHeaderPath = join(nativeSrcDir, "wyhash.h");

    const shouldRebuild =
      !existsSync(dylibPath) ||
      statSync(dylibPath).mtimeMs <
        Math.max(
          statSync(scanSourcePath).mtimeMs,
          existsSync(wyhashHeaderPath) ? statSync(wyhashHeaderPath).mtimeMs : 0,
        );

    if (shouldRebuild) {
      const { status } = spawnSync(
        "clang",
        ["-O3", "-shared", "-fPIC", scanSourcePath, "-o", dylibPath],
        { stdio: "pipe" }
      );
      if (status !== 0) return null;
    }

    const lib = ffi.dlopen(dylibPath, {
      scan_single_target: {
        args: ["ptr", "u32", "u32", "u64", "u64", "ptr"],
        returns: "i64"
      },
      scan_set_target: {
        args: ["ptr", "u32", "ptr", "u32", "u64", "u64", "ptr", "ptr"],
        returns: "i64"
      }
    });

    _nativeFFI = { lib: lib.symbols, dylibPath };
  } catch (e) {
    _nativeFFI = null;
  }
  return _nativeFFI;
}
const BUN_SUFFIX_START = 56;
const BUN_SUFFIX_END = 64;
const UINT32_LIMIT = 0x1_0000_0000;
const BUN_SCAN_WORKER_CODE = `
const { workerData } = require("node:worker_threads");
const state = new Int32Array(workerData.shared);
const bytes = new TextEncoder().encode(workerData.prefix + "00000000" + workerData.salt);
const targetSeed = workerData.targetSeed >>> 0;
const start = Math.max(0, Math.min(0x1_0000_0000, Math.trunc(Number(workerData.start) || 0)));
const end = Math.max(start, Math.min(0x1_0000_0000, Math.trunc(Number(workerData.end) || 0)));

let nativeLib = null;
try {
  const ffi = require("bun:ffi");
  if (workerData.dylibPath) {
    nativeLib = { ffi, sym: ffi.dlopen(workerData.dylibPath, {
      scan_single_target: { args: ["ptr", "u32", "u32", "u64", "u64", "ptr"], returns: "i64" }
    }).symbols };
  }
} catch(e) {}

if (nativeLib) {
  // C 扫描：不传 state 指针（BigInt(0) = NULL），只拿返回的 suffix
  let usedNative = false;
  try {
    const res = nativeLib.sym.scan_single_target(
      nativeLib.ffi.ptr(bytes), bytes.length, targetSeed, BigInt(start), BigInt(end), BigInt(0)
    );
    usedNative = true;
    if (res !== -1n) {
      if (Atomics.compareExchange(state, 0, 0, 1) === 0) {
        Atomics.store(state, 2, Number(res) | 0);
        Atomics.notify(state, 0);
      }
    }
  } catch(e) { /* 降级到 JS */ }
  if (!usedNative) { nativeLib = null; }
}

if (!nativeLib) {
  const hex16 = new Uint8Array(65536 * 4);
  const hexChars = new TextEncoder().encode("0123456789abcdef");
  for (let i = 0; i < 65536; i++) {
    hex16[i * 4 + 0] = hexChars[(i >>> 12) & 0xf];
    hex16[i * 4 + 1] = hexChars[(i >>> 8) & 0xf];
    hex16[i * 4 + 2] = hexChars[(i >>> 4) & 0xf];
    hex16[i * 4 + 3] = hexChars[i & 0xf];
  }
  for (let suffix = start; suffix < end; suffix++) {
    if ((suffix & 1023) === 0 && Atomics.load(state, 0) !== 0) break;
    const high = suffix >>> 16;
    const low = suffix & 0xffff;
    bytes[56] = hex16[high * 4 + 0];
    bytes[57] = hex16[high * 4 + 1];
    bytes[58] = hex16[high * 4 + 2];
    bytes[59] = hex16[high * 4 + 3];
    bytes[60] = hex16[low * 4 + 0];
    bytes[61] = hex16[low * 4 + 1];
    bytes[62] = hex16[low * 4 + 2];
    bytes[63] = hex16[low * 4 + 3];
    const h = Bun.hash(bytes);
    const candidateSeed = typeof h === "bigint" ? Number(h & 0xffffffffn) : (h >>> 0);
    if (candidateSeed === targetSeed) {
      if (Atomics.compareExchange(state, 0, 0, 1) === 0) {
        Atomics.store(state, 2, suffix | 0);
        Atomics.notify(state, 0);
      }
      break;
    }
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
const start = Math.max(0, Math.min(0x1_0000_0000, Math.trunc(Number(workerData.start) || 0)));
const end = Math.max(start, Math.min(0x1_0000_0000, Math.trunc(Number(workerData.end) || 0)));

let nativeLib = null;
try {
  const ffi = require("bun:ffi");
  if (workerData.dylibPath) {
    nativeLib = { ffi, sym: ffi.dlopen(workerData.dylibPath, {
      scan_set_target: { args: ["ptr", "u32", "ptr", "u32", "u64", "u64", "ptr", "ptr"], returns: "i64" }
    }).symbols };
  }
} catch(e) {}

if (nativeLib) {
  // C 扫描：不传 state/matched_seed_out 指针，只拿返回的 suffix
  let usedNative = false;
  try {
    const seedsArray = new Uint32Array(workerData.targetSeeds);
    const matchedOut = new Uint32Array(1);
    const res = nativeLib.sym.scan_set_target(
      nativeLib.ffi.ptr(bytes), bytes.length,
      nativeLib.ffi.ptr(seedsArray), seedsArray.length,
      BigInt(start), BigInt(end),
      BigInt(0), nativeLib.ffi.ptr(matchedOut)
    );
    usedNative = true;
    if (res !== -1n) {
      if (Atomics.compareExchange(state, 0, 0, 1) === 0) {
        Atomics.store(state, 2, Number(res) | 0);
        Atomics.store(state, 3, matchedOut[0] | 0);
        Atomics.notify(state, 0);
      }
    }
  } catch(e) { /* 降级到 JS */ }
  if (!usedNative) { nativeLib = null; }
}

if (!nativeLib) {
  const hex16 = new Uint8Array(65536 * 4);
  const hexChars = new TextEncoder().encode("0123456789abcdef");
  for (let i = 0; i < 65536; i++) {
    hex16[i * 4 + 0] = hexChars[(i >>> 12) & 0xf];
    hex16[i * 4 + 1] = hexChars[(i >>> 8) & 0xf];
    hex16[i * 4 + 2] = hexChars[(i >>> 4) & 0xf];
    hex16[i * 4 + 3] = hexChars[i & 0xf];
  }
  const targetSeeds = new Set(workerData.targetSeeds.map(v => v >>> 0));
  for (let suffix = start; suffix < end; suffix++) {
    if ((suffix & 1023) === 0 && Atomics.load(state, 0) !== 0) break;
    const high = suffix >>> 16;
    const low = suffix & 0xffff;
    bytes[56] = hex16[high * 4 + 0];
    bytes[57] = hex16[high * 4 + 1];
    bytes[58] = hex16[high * 4 + 2];
    bytes[59] = hex16[high * 4 + 3];
    bytes[60] = hex16[low * 4 + 0];
    bytes[61] = hex16[low * 4 + 1];
    bytes[62] = hex16[low * 4 + 2];
    bytes[63] = hex16[low * 4 + 3];
    const h = Bun.hash(bytes);
    const candidateSeed = typeof h === "bigint" ? Number(h & 0xffffffffn) : (h >>> 0);
    if (!targetSeeds.has(candidateSeed)) continue;
    if (Atomics.compareExchange(state, 0, 0, 1) === 0) {
      Atomics.store(state, 2, suffix | 0);
      Atomics.store(state, 3, candidateSeed | 0);
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
  const high = suffix >>> 16;
  const low = suffix & 0xffff;

  bytes[56] = GLOBAL_HEX16_TABLE[high * 4 + 0];
  bytes[57] = GLOBAL_HEX16_TABLE[high * 4 + 1];
  bytes[58] = GLOBAL_HEX16_TABLE[high * 4 + 2];
  bytes[59] = GLOBAL_HEX16_TABLE[high * 4 + 3];

  bytes[60] = GLOBAL_HEX16_TABLE[low * 4 + 0];
  bytes[61] = GLOBAL_HEX16_TABLE[low * 4 + 1];
  bytes[62] = GLOBAL_HEX16_TABLE[low * 4 + 2];
  bytes[63] = GLOBAL_HEX16_TABLE[low * 4 + 3];
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
  const ffiSetup = loadNativeFFI();
  if (ffiSetup) {
    const bytes = new TextEncoder().encode(prefix + "00000000" + BUDDY_SALT);
    const ffi = require("bun:ffi");
    const res = ffiSetup.lib.scan_single_target(
      ffi.ptr(bytes),
      bytes.length,
      targetSeed >>> 0,
      BigInt(start),
      BigInt(end),
      NULL_PTR,
    );
    if (res !== -1n) return Number(res);
    return null;
  }

  const bun = getRequiredBun();
  const bytes = new TextEncoder().encode(prefix + "00000000" + BUDDY_SALT);

  for (let suffix = start; suffix < end; suffix++) {
    writeSuffixHex(bytes, suffix);

    const h = bun.hash(bytes);
    const candidateSeed = typeof h === "bigint" ? Number(h & 0xffffffffn) : (h >>> 0);
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
  const ffiSetup = loadNativeFFI();
  if (ffiSetup) {
    const bytes = new TextEncoder().encode(prefix + "00000000" + BUDDY_SALT);
    const ffi = require("bun:ffi");
    const seedsArray = new Uint32Array([...targetSeeds]);
    const matchedOut = new Uint32Array(1);
    const res = ffiSetup.lib.scan_set_target(
      ffi.ptr(bytes),
      bytes.length,
      ffi.ptr(seedsArray),
      seedsArray.length,
      BigInt(start),
      BigInt(end),
      NULL_PTR,
      ffi.ptr(matchedOut),
    );
    if (res !== -1n) {
      return { seed: matchedOut[0], suffix: Number(res) };
    }
    return null;
  }

  const bun = getRequiredBun();
  const bytes = new TextEncoder().encode(prefix + "00000000" + BUDDY_SALT);

  for (let suffix = start; suffix < end; suffix++) {
    writeSuffixHex(bytes, suffix);

    const h = bun.hash(bytes);
    const candidateSeed = typeof h === "bigint" ? Number(h & 0xffffffffn) : (h >>> 0);
    
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
          dylibPath: loadNativeFFI()?.dylibPath,
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
          dylibPath: loadNativeFFI()?.dylibPath,
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
      const h = bun.hash(lane.bytes);
      const seed = typeof h === "bigint" ? Number(h & 0xffffffffn) : (h >>> 0);
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
  nextPrefixAttempt: number;
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
  const chunkSize = Math.max(1, options.chunkSize ?? UINT32_LIMIT);
  return {
    targetSeed: targetSeed >>> 0,
    searchSeed: resolveBunSearchSeed(options.searchSeed),
    laneCount,
    chunkSize,
    scanned: 0,
    nextPrefixAttempt: laneCount,
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
    if (lane.completed && !Number.isFinite(lane.nextSuffix)) {
      lane.nextSuffix = UINT32_LIMIT;
    }

    if (lane.completed && normalizeSuffixBoundary(lane.nextSuffix) >= UINT32_LIMIT) {
      lane.prefixAttempt = state.nextPrefixAttempt++;
      lane.nextSuffix = 0;
      lane.completed = false;
    }

    const start = normalizeSuffixBoundary(lane.nextSuffix);
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
      done: false,
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
    done: false,
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

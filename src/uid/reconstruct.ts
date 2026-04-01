import crypto from "node:crypto";
import os from "node:os";
import { Worker } from "node:worker_threads";

import {
  BUDDY_SALT,
  hashFNV1a,
  type RuntimeMode,
} from "../buddy/hash.js";

const FNV_INV_PRIME = 899433627 >>> 0;
const HEX_ALPHABET = "0123456789abcdef";
const HEX_16 = Array.from(
  { length: 65536 },
  (_, value) => value.toString(16).padStart(4, "0"),
);
const HEX_BYTES = new TextEncoder().encode(HEX_ALPHABET);
const BUN_SUFFIX_START = 56;
const BUN_SUFFIX_END = 64;
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

function getRequiredBun(): NonNullable<typeof Bun> {
  if (typeof Bun === "undefined") {
    throw new Error("Bun runtime is required for this operation.");
  }
  return Bun;
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

    const candidateSeed = Number(BigInt(bun.hash(bytes)) & 0xffffffffn);
    if (candidateSeed === (targetSeed >>> 0)) {
      return suffix >>> 0;
    }
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
      bunWorkers:
        options.bunWorkers ??
        Math.max(
          1,
          Math.min(
            typeof os.availableParallelism === "function"
              ? os.availableParallelism()
              : os.cpus().length,
            8,
          ),
        ),
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

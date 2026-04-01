import { generateBuddyFromSeed, getTotalStats } from "../buddy/generate.js";
import { matchesFilters, type SearchCandidate, type SearchFilters } from "./filters.js";
import { rankCandidates } from "./rank.js";

export type SearchOptions = {
  startSeed?: number;
  endSeed?: number;
  limit?: number;
  onProgress?: (event: SearchProgressEvent) => void;
  progressIntervalSeeds?: number;
  progressIntervalMs?: number;
};

export type SearchProgressEvent = {
  scanned: number;
  total: number;
  matches: number;
  elapsedMs: number;
  currentSeedExclusive: number;
  done: boolean;
};

const DEFAULT_LIMIT = 20;
const UINT32_LIMIT = 0x1_0000_0000;
const DEFAULT_PROGRESS_INTERVAL_SEEDS = 1 << 20;
const DEFAULT_PROGRESS_INTERVAL_MS = 500;

export function searchSeeds(
  filters: SearchFilters,
  options: SearchOptions = {},
): SearchCandidate[] {
  const startSeed = options.startSeed ?? 0;
  const endSeed = options.endSeed ?? UINT32_LIMIT;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const matches: SearchCandidate[] = [];
  const total = Math.max(0, endSeed - startSeed);
  const progressIntervalSeeds =
    options.progressIntervalSeeds ?? DEFAULT_PROGRESS_INTERVAL_SEEDS;
  const progressIntervalMs = options.progressIntervalMs ?? DEFAULT_PROGRESS_INTERVAL_MS;
  const startedAt = Date.now();
  let lastProgressAt = startedAt;

  for (let seed = startSeed; seed < endSeed; seed++) {
    const buddy = generateBuddyFromSeed(seed >>> 0);
    const candidate: SearchCandidate = {
      seed: seed >>> 0,
      buddy,
      totalStats: getTotalStats(buddy.stats),
    };

    if (!matchesFilters(candidate, filters)) {
      const scanned = seed - startSeed + 1;
      if (
        options.onProgress &&
        scanned % progressIntervalSeeds === 0 &&
        Date.now() - lastProgressAt >= progressIntervalMs
      ) {
        const now = Date.now();
        lastProgressAt = now;
        options.onProgress({
          scanned,
          total,
          matches: matches.length,
          elapsedMs: now - startedAt,
          currentSeedExclusive: seed + 1,
          done: false,
        });
      }
      continue;
    }

    matches.push(candidate);

    const scanned = seed - startSeed + 1;
    if (
      options.onProgress &&
      scanned % progressIntervalSeeds === 0 &&
      Date.now() - lastProgressAt >= progressIntervalMs
    ) {
      const now = Date.now();
      lastProgressAt = now;
      options.onProgress({
        scanned,
        total,
        matches: matches.length,
        elapsedMs: now - startedAt,
        currentSeedExclusive: seed + 1,
        done: false,
      });
    }
  }

  matches.sort(rankCandidates);
  if (options.onProgress) {
    options.onProgress({
      scanned: total,
      total,
      matches: matches.length,
      elapsedMs: Date.now() - startedAt,
      currentSeedExclusive: endSeed,
      done: true,
    });
  }
  return matches.slice(0, limit);
}

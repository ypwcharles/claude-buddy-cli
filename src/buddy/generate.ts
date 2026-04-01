import { RARITY_FLOOR, RARITY_WEIGHTS } from "./constants.js";
import { mulberry32 } from "./rng.js";
import {
  EYES,
  HATS,
  RARITIES,
  SPECIES,
  STAT_NAMES,
  type BuddyBones,
  type BuddyStats,
  type Rarity,
} from "../types.js";

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

function rollRarity(rng: () => number): Rarity {
  const totalWeight = Object.values(RARITY_WEIGHTS).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  let roll = rng() * totalWeight;

  for (const rarity of RARITIES) {
    roll -= RARITY_WEIGHTS[rarity];
    if (roll < 0) {
      return rarity;
    }
  }

  return "common";
}

function rollStats(rng: () => number, rarity: Rarity): BuddyStats {
  const floor = RARITY_FLOOR[rarity];
  const peak = pick(rng, STAT_NAMES);
  let dump = pick(rng, STAT_NAMES);

  while (dump === peak) {
    dump = pick(rng, STAT_NAMES);
  }

  const stats = {} as BuddyStats;
  for (const name of STAT_NAMES) {
    if (name === peak) {
      stats[name] = Math.min(100, floor + 50 + Math.floor(rng() * 30));
      continue;
    }

    if (name === dump) {
      stats[name] = Math.max(1, floor - 10 + Math.floor(rng() * 15));
      continue;
    }

    stats[name] = floor + Math.floor(rng() * 40);
  }

  return stats;
}

export function generateBuddyFromSeed(seed: number): BuddyBones {
  const rng = mulberry32(seed);
  const rarity = rollRarity(rng);

  return {
    rarity,
    species: pick(rng, SPECIES),
    eye: pick(rng, EYES),
    hat: rarity === "common" ? "none" : pick(rng, HATS),
    shiny: rng() < 0.01,
    stats: rollStats(rng, rarity),
  };
}

export function getTotalStats(stats: BuddyStats): number {
  return Object.values(stats).reduce((sum, value) => sum + value, 0);
}

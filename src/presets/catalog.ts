import { generateBuddyFromSeed, getTotalStats } from "../buddy/generate.js";
import type { SearchFilters } from "../search/filters.js";
import { RESEARCH_BUDDY_PRESETS } from "./research.js";

export type BuddyPreset = {
  id: string;
  name: string;
  description: string;
  category?: string;
  source?: string;
  filters: SearchFilters;
  node?: {
    seed: number;
    userID?: string;
  };
  bun?: {
    seed: number;
    userID: string;
  };
  bunTargetSeeds?: readonly number[];
};

export type PresetSearchStrategy =
  | "preset-node-seed"
  | "preset-bun-witness"
  | "preset-bun-seed-set-search";

const CURATED_BUDDY_PRESETS: BuddyPreset[] = [
  {
    id: "dragon-shiny-halo-debug-54-chaos-100",
    name: "Perfect Halo Dragon",
    description: "Shiny dragon with halo, DEBUGGING 54, CHAOS 100, and total stats 400+.",
    filters: {
      species: "dragon",
      shiny: true,
      hat: "halo",
      debugging: 54,
      chaos: 100,
      minTotal: 400,
    },
    node: {
      seed: 3716311402,
    },
  },
  {
    id: "capybara-shiny-min-wisdom-51",
    name: "Wise Shiny Capybara",
    description: "Shiny capybara with WISDOM at least 51.",
    filters: {
      species: "capybara",
      shiny: true,
      minWisdom: 51,
    },
    node: {
      seed: 280000,
    },
    bun: {
      seed: 3384746897,
      userID: "0769dcbf63a7d8de374c6a92295349b815148982670a06ab4f56aa91000e6cd8",
    },
  },
  {
    id: "ghost-epic-eye-at",
    name: "Epic Ghost @ Eyes",
    description: "Epic ghost with @ eyes.",
    filters: {
      species: "ghost",
      rarity: "epic",
      eye: "@",
    },
    node: {
      seed: 72113,
    },
    bun: {
      seed: 1503679284,
      userID: "0769dcbf63a7d8de374c6a92295349b815148982670a06ab4f56aa910059b5ce",
    },
  },
  {
    id: "duck-common-max-chaos-20",
    name: "Calm Common Duck",
    description: "Common duck with CHAOS at most 20.",
    filters: {
      species: "duck",
      rarity: "common",
      maxChaos: 20,
    },
    node: {
      seed: 196036,
    },
    bun: {
      seed: 3165231805,
      userID: "0769dcbf63a7d8de374c6a92295349b815148982670a06ab4f56aa91004c88e4",
    },
  },
  {
    id: "robot-crown-min-debugging-60-max-chaos-40",
    name: "Crowned Debug Robot",
    description: "Robot with crown, DEBUGGING at least 60, and CHAOS at most 40.",
    filters: {
      species: "robot",
      hat: "crown",
      minDebugging: 60,
      maxChaos: 40,
    },
    bun: {
      seed: 3417099271,
      userID: "0769dcbf63a7d8de374c6a92295349b815148982670a06ab4f56aa91003e90df",
    },
  },
];

const BUDDY_PRESETS: BuddyPreset[] = [
  ...CURATED_BUDDY_PRESETS,
  ...RESEARCH_BUDDY_PRESETS.map((preset) => ({
    ...preset,
  })),
];

export function listBuddyPresets(): BuddyPreset[] {
  return BUDDY_PRESETS.slice();
}

export function getBuddyPreset(id: string): BuddyPreset | undefined {
  return BUDDY_PRESETS.find((preset) => preset.id === id);
}

export function presetSupportsRuntime(
  preset: BuddyPreset,
  runtime: "node" | "bun",
): boolean {
  if (runtime === "node") {
    return preset.node !== undefined;
  }

  return preset.bun !== undefined || (preset.bunTargetSeeds?.length ?? 0) > 0;
}

export function resolvePresetForRuntime(
  presetId: string,
  runtime: "node" | "bun",
): {
  preset: BuddyPreset;
  searchStrategy: PresetSearchStrategy;
  result: {
    seed: number;
    totalStats: number;
    rarity: ReturnType<typeof generateBuddyFromSeed>["rarity"];
    species: ReturnType<typeof generateBuddyFromSeed>["species"];
    eye: ReturnType<typeof generateBuddyFromSeed>["eye"];
    hat: ReturnType<typeof generateBuddyFromSeed>["hat"];
    shiny: ReturnType<typeof generateBuddyFromSeed>["shiny"];
    stats: ReturnType<typeof generateBuddyFromSeed>["stats"];
    userID?: string;
  };
} {
  const preset = getBuddyPreset(presetId);
  if (!preset) {
    throw new Error(`Unknown preset: ${presetId}`);
  }

  if (runtime === "node") {
    if (!presetSupportsRuntime(preset, "node") || !preset.node) {
      throw new Error(`Preset ${presetId} is not available for node runtime.`);
    }

    const buddy = generateBuddyFromSeed(preset.node.seed);
    return {
      preset,
      searchStrategy: "preset-node-seed",
      result: {
        seed: preset.node.seed,
        totalStats: getTotalStats(buddy.stats),
        rarity: buddy.rarity,
        species: buddy.species,
        eye: buddy.eye,
        hat: buddy.hat,
        shiny: buddy.shiny,
        stats: buddy.stats,
      },
    };
  }

  if (!preset.bun) {
    throw new Error(`Preset ${presetId} does not have a direct Bun witness.`);
  }

  const buddy = generateBuddyFromSeed(preset.bun.seed);
  return {
    preset,
    searchStrategy: "preset-bun-witness",
    result: {
      seed: preset.bun.seed,
      totalStats: getTotalStats(buddy.stats),
      rarity: buddy.rarity,
      species: buddy.species,
      eye: buddy.eye,
      hat: buddy.hat,
      shiny: buddy.shiny,
      stats: buddy.stats,
      userID: preset.bun.userID,
    },
  };
}

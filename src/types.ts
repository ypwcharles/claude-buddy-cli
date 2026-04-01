export const RARITIES = [
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
] as const;

export type Rarity = (typeof RARITIES)[number];

export const SPECIES = [
  "duck",
  "goose",
  "blob",
  "cat",
  "dragon",
  "octopus",
  "owl",
  "penguin",
  "turtle",
  "snail",
  "ghost",
  "axolotl",
  "capybara",
  "cactus",
  "robot",
  "rabbit",
  "mushroom",
  "chonk",
] as const;

export type Species = (typeof SPECIES)[number];

export const EYES = ["·", "✦", "×", "◉", "@", "°"] as const;
export type Eye = (typeof EYES)[number];

export const HATS = [
  "none",
  "crown",
  "tophat",
  "propeller",
  "halo",
  "wizard",
  "beanie",
  "tinyduck",
] as const;

export type Hat = (typeof HATS)[number];

export const STAT_NAMES = [
  "DEBUGGING",
  "PATIENCE",
  "CHAOS",
  "WISDOM",
  "SNARK",
] as const;

export type StatName = (typeof STAT_NAMES)[number];
export type BuddyStats = Record<StatName, number>;

export type BuddyBones = {
  rarity: Rarity;
  species: Species;
  eye: Eye;
  hat: Hat;
  shiny: boolean;
  stats: BuddyStats;
};

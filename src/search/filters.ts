import type { BuddyBones, Eye, Hat, Rarity, Species } from "../types.js";

export type SearchFilters = {
  species?: Species;
  rarity?: Rarity;
  eye?: Eye;
  hat?: Hat;
  shiny?: boolean;
  minTotal?: number;
  maxTotal?: number;
  debugging?: number;
  minDebugging?: number;
  maxDebugging?: number;
  patience?: number;
  minPatience?: number;
  maxPatience?: number;
  chaos?: number;
  minChaos?: number;
  maxChaos?: number;
  wisdom?: number;
  minWisdom?: number;
  maxWisdom?: number;
  snark?: number;
  minSnark?: number;
  maxSnark?: number;
};

export type SearchCandidate = {
  seed: number;
  buddy: BuddyBones;
  totalStats: number;
};

function matchesStatRange(
  value: number,
  exact: number | undefined,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (exact !== undefined && value !== exact) {
    return false;
  }
  if (min !== undefined && value < min) {
    return false;
  }
  if (max !== undefined && value > max) {
    return false;
  }
  return true;
}

export function matchesFilters(
  candidate: SearchCandidate,
  filters: SearchFilters,
): boolean {
  const { buddy, totalStats } = candidate;

  if (filters.species !== undefined && buddy.species !== filters.species) {
    return false;
  }
  if (filters.rarity !== undefined && buddy.rarity !== filters.rarity) {
    return false;
  }
  if (filters.eye !== undefined && buddy.eye !== filters.eye) {
    return false;
  }
  if (filters.hat !== undefined && buddy.hat !== filters.hat) {
    return false;
  }
  if (filters.shiny !== undefined && buddy.shiny !== filters.shiny) {
    return false;
  }
  if (filters.minTotal !== undefined && totalStats < filters.minTotal) {
    return false;
  }
  if (filters.maxTotal !== undefined && totalStats > filters.maxTotal) {
    return false;
  }

  if (
    !matchesStatRange(
      buddy.stats.DEBUGGING,
      filters.debugging,
      filters.minDebugging,
      filters.maxDebugging,
    )
  ) {
    return false;
  }
  if (
    !matchesStatRange(
      buddy.stats.PATIENCE,
      filters.patience,
      filters.minPatience,
      filters.maxPatience,
    )
  ) {
    return false;
  }
  if (
    !matchesStatRange(
      buddy.stats.CHAOS,
      filters.chaos,
      filters.minChaos,
      filters.maxChaos,
    )
  ) {
    return false;
  }
  if (
    !matchesStatRange(
      buddy.stats.WISDOM,
      filters.wisdom,
      filters.minWisdom,
      filters.maxWisdom,
    )
  ) {
    return false;
  }
  if (
    !matchesStatRange(
      buddy.stats.SNARK,
      filters.snark,
      filters.minSnark,
      filters.maxSnark,
    )
  ) {
    return false;
  }

  return true;
}

import type { SearchCandidate } from "./filters.js";

export function rankCandidates(
  left: SearchCandidate,
  right: SearchCandidate,
): number {
  if (right.totalStats !== left.totalStats) {
    return right.totalStats - left.totalStats;
  }

  if (left.buddy.shiny !== right.buddy.shiny) {
    return Number(right.buddy.shiny) - Number(left.buddy.shiny);
  }

  return left.seed - right.seed;
}

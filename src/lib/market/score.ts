import type { MarketObjective } from "./types";

/**
 * Selection is not a weighted grade. Constraints, then the Pareto frontier,
 * then `objectivePriorities` in pareto.ts decide the policy.
 */
export function objectiveLabel(objective: MarketObjective): string {
  switch (objective) {
    case "stable":
      return "price stability";
    case "controlled-discovery":
      return "controlled price discovery";
    case "participation":
      return "broad participation";
    case "fast-graduation":
      return "reaching graduation quickly";
    case "long-runway":
      return "a long discovery runway";
    case "whale-protection":
      return "limiting the price impact of large buys";
  }
}

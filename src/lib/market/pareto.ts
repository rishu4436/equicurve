import type { MarketObjective } from "./types";

/** Lower impact is better. Higher progress and a drawdown closer to zero are better. */
export type FrontierMetrics = {
  referenceImpactBps: number;
  whaleImpactBps: number;
  drawdownBps: number;
  retailProgress: number;
  lateProgress: number;
  stressGraduation: number;
};

export function dominates(a: FrontierMetrics, b: FrontierMetrics): boolean {
  const ge =
    a.referenceImpactBps <= b.referenceImpactBps &&
    a.whaleImpactBps <= b.whaleImpactBps &&
    a.drawdownBps >= b.drawdownBps &&
    a.retailProgress >= b.retailProgress &&
    a.lateProgress >= b.lateProgress &&
    a.stressGraduation >= b.stressGraduation;
  const gt =
    a.referenceImpactBps < b.referenceImpactBps ||
    a.whaleImpactBps < b.whaleImpactBps ||
    a.drawdownBps > b.drawdownBps ||
    a.retailProgress > b.retailProgress ||
    a.lateProgress > b.lateProgress ||
    a.stressGraduation > b.stressGraduation;
  return ge && gt;
}

export function paretoFrontier<T>(items: T[], metrics: (item: T) => FrontierMetrics): T[] {
  return items.filter((item, i) => {
    const mine = metrics(item);
    return !items.some((other, j) => j !== i && dominates(metrics(other), mine));
  });
}

/** Explicit order used to pick one policy from the frontier. First metric wins ties. */
export function objectivePriorities(objective: MarketObjective): (keyof FrontierMetrics)[] {
  switch (objective) {
    case "stable":
      return ["referenceImpactBps", "whaleImpactBps", "drawdownBps", "retailProgress", "lateProgress", "stressGraduation"];
    case "controlled-discovery":
      return ["whaleImpactBps", "referenceImpactBps", "retailProgress", "lateProgress", "drawdownBps", "stressGraduation"];
    case "participation":
      return ["retailProgress", "lateProgress", "stressGraduation", "referenceImpactBps", "whaleImpactBps", "drawdownBps"];
    case "fast-graduation":
      return ["retailProgress", "stressGraduation", "lateProgress", "whaleImpactBps", "referenceImpactBps", "drawdownBps"];
    case "long-runway":
      return ["lateProgress", "drawdownBps", "retailProgress", "referenceImpactBps", "whaleImpactBps", "stressGraduation"];
    case "whale-protection":
      return ["whaleImpactBps", "referenceImpactBps", "drawdownBps", "retailProgress", "lateProgress", "stressGraduation"];
  }
}

const LOWER_BETTER = new Set<keyof FrontierMetrics>(["referenceImpactBps", "whaleImpactBps"]);

export function prefer(objective: MarketObjective, a: FrontierMetrics, b: FrontierMetrics): number {
  for (const key of objectivePriorities(objective)) {
    if (a[key] === b[key]) continue;
    const aWins = LOWER_BETTER.has(key) ? a[key] < b[key] : a[key] > b[key];
    return aWins ? -1 : 1;
  }
  return 0;
}

import type { AssetKind, MarketObjective } from "./types";

/**
 * Hard limits a candidate must pass before it can be chosen.
 * Asset kind sets the range. The objective tightens it.
 * These are market-design limits, not statements about legal status.
 */
export type DesignConstraints = {
  multipleMin: number;
  multipleMax: number;
  /** Graduation threshold must land within this fraction of the requested raise. */
  maxThresholdGap: number;
  maxReferenceImpactBps: number;
  maxWhaleImpactBps: number;
  /** 0..1. Largest buy's share of filled quote. */
  maxConcentration: number;
  /** 0..1. Retail sample must fill at least this much of the threshold. */
  minRetailProgress: number;
};

const ASSET_BASE: Record<AssetKind, Omit<DesignConstraints, "maxThresholdGap">> = {
  "tokenized-equity": { multipleMin: 2, multipleMax: 8, maxReferenceImpactBps: 800, maxWhaleImpactBps: 1_500, maxConcentration: 0.45, minRetailProgress: 0.2 },
  "private-company": { multipleMin: 3, multipleMax: 15, maxReferenceImpactBps: 1_200, maxWhaleImpactBps: 2_200, maxConcentration: 0.55, minRetailProgress: 0.25 },
  commodity: { multipleMin: 2, multipleMax: 8, maxReferenceImpactBps: 700, maxWhaleImpactBps: 1_400, maxConcentration: 0.4, minRetailProgress: 0.2 },
  rwa: { multipleMin: 2, multipleMax: 10, maxReferenceImpactBps: 800, maxWhaleImpactBps: 1_600, maxConcentration: 0.45, minRetailProgress: 0.2 },
  "pre-launch": { multipleMin: 4, multipleMax: 25, maxReferenceImpactBps: 1_800, maxWhaleImpactBps: 3_000, maxConcentration: 0.6, minRetailProgress: 0.3 },
  "ai-agent": { multipleMin: 4, multipleMax: 25, maxReferenceImpactBps: 1_800, maxWhaleImpactBps: 3_000, maxConcentration: 0.6, minRetailProgress: 0.3 },
  community: { multipleMin: 8, multipleMax: 40, maxReferenceImpactBps: 2_500, maxWhaleImpactBps: 4_000, maxConcentration: 0.5, minRetailProgress: 0.45 },
  speculative: { multipleMin: 8, multipleMax: 50, maxReferenceImpactBps: 3_000, maxWhaleImpactBps: 5_000, maxConcentration: 0.7, minRetailProgress: 0.4 },
};

export function constraintsFor(asset: AssetKind, objective: MarketObjective): DesignConstraints {
  const base = { ...ASSET_BASE[asset], maxThresholdGap: 0.05 };
  switch (objective) {
    case "stable":
      return {
        ...base,
        multipleMax: Math.min(base.multipleMax, 6),
        maxReferenceImpactBps: Math.min(base.maxReferenceImpactBps, 500),
        maxWhaleImpactBps: Math.min(base.maxWhaleImpactBps, 1_000),
        maxConcentration: Math.min(base.maxConcentration, 0.35),
      };
    case "controlled-discovery":
      return {
        ...base,
        multipleMax: Math.min(base.multipleMax, 12),
        maxWhaleImpactBps: Math.min(base.maxWhaleImpactBps, 1_800),
      };
    case "participation":
      return {
        ...base,
        maxConcentration: Math.min(base.maxConcentration, 0.35),
        minRetailProgress: Math.max(base.minRetailProgress, 0.5),
      };
    case "fast-graduation":
      return { ...base, minRetailProgress: Math.max(base.minRetailProgress, 0.8) };
    case "long-runway":
      return { ...base, multipleMin: Math.max(base.multipleMin, 12) };
    case "whale-protection":
      return {
        ...base,
        maxWhaleImpactBps: Math.min(base.maxWhaleImpactBps, 800),
        maxReferenceImpactBps: Math.min(base.maxReferenceImpactBps, 1_000),
      };
  }
}

/** How a scenario treats order flow. Asset kind changes these. It does not create a legal claim. */
export type ScenarioAssumptions = {
  whaleMultiple: number;
  sellFractionBps: number;
  /** Late buyers start this far through the fee window, 0..1. */
  lateStart: number;
  /** Cohort whale orders, in hundredths of a typical order. */
  cohortWhaleHundredths: number;
};

export function scenarioAssumptions(asset: AssetKind): ScenarioAssumptions {
  switch (asset) {
    case "tokenized-equity":
    case "commodity":
    case "rwa":
      return { whaleMultiple: 4, sellFractionBps: 2_000, lateStart: 0.8, cohortWhaleHundredths: 250 };
    case "private-company":
      return { whaleMultiple: 8, sellFractionBps: 3_500, lateStart: 0.65, cohortWhaleHundredths: 600 };
    case "pre-launch":
    case "ai-agent":
      return { whaleMultiple: 12, sellFractionBps: 4_500, lateStart: 0.45, cohortWhaleHundredths: 900 };
    case "community":
    case "speculative":
      return { whaleMultiple: 20, sellFractionBps: 6_000, lateStart: 0.25, cohortWhaleHundredths: 1_600 };
  }
}

export function multiplesIn(c: DesignConstraints): number[] {
  const min = c.multipleMin;
  const max = Math.max(c.multipleMax, min + 1);
  const mid = Math.round((min + max) / 2);
  return [...new Set([min, mid, max])];
}

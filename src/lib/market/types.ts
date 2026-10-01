import type { PresetId, QuoteLabel } from "@/lib/dbc/types";

/** What the issuer says the token is. This does not create legal rights. */
export type AssetKind =
  | "tokenized-equity"
  | "private-company"
  | "commodity"
  | "rwa"
  | "pre-launch"
  | "ai-agent"
  | "community"
  | "speculative";

/**
 * The market behavior the issuer wants from the bonding curve.
 * The engine scores every profile against this. It does not look the answer up.
 */
export type MarketObjective =
  | "stable"
  | "controlled-discovery"
  | "participation"
  | "fast-graduation"
  | "long-runway"
  | "whale-protection";

export type LaunchBrief = {
  asset: AssetKind;
  objective: MarketObjective;
  quote: QuoteLabel;
  /** Raise the curve must hold before graduation, in quote units ("3.09", "500000"). */
  targetRaise: string;
  /** Typical order size, in quote units. */
  typicalTrade: string;
  /** Expected number of buyers. Named scenarios sample at most 64 of them and say so. */
  participants: number;
  totalSupply?: number;
  /** Creator share of the non-protocol trading fee, 0–100. Default 70, matching Create. */
  creatorPct?: number;
  /** Permanent partner LP lock. Default 100. Clamped to the on-chain minimum. */
  lpLockPct?: number;
  /** Sets enableFirstSwapWithMinFee on the config. Default true, matching Create. */
  antiSniper?: boolean;
  /** Synthetic cohort paths. Default 16. */
  stressPaths?: number;
  /** Deterministic stress seed. Default 0xec0c. */
  seed?: number;
};

export type ScenarioId = "retail" | "whale" | "late" | "sell-pressure" | "volatile";

export type ScenarioReport = {
  id: ScenarioId;
  label: string;
  /** Buyers the brief asked for, when the scenario is a sample of them. */
  participantsAsked: number | null;
  ordersRun: number;
  ordersSkipped: number;
  /** Quote that entered the curve (counts toward graduation), atoms. */
  quoteFilledAtoms: string;
  /** Quote the traders paid, including fees, atoms. */
  quotePaidAtoms: string;
  feesAtoms: string;
  /** quote reserve / migration threshold, capped at 1. */
  progress: number;
  graduated: boolean;
  /** Largest single buy's price move, in basis points. */
  largestBuyImpactBps: number;
  /** End price versus the opening price, basis points. Negative means the price fell. */
  endMoveBps: number;
  /** Fall from the highest price in the scenario to the end, basis points. Zero if the price never fell. */
  drawdownBps: number;
  /** Largest buy's filled quote divided by all filled quote. 0 when nothing filled. */
  concentration: number;
  note: string;
  /** Opening-price move and threshold progress after each order. Synthetic. */
  trace: ScenarioTracePoint[];
};

export type ScenarioTracePoint = {
  step: number;
  /** Price versus the opening price, basis points. */
  priceMoveBps: number;
  /** Quote reserve / graduation threshold, capped at 1. */
  progress: number;
};

export type ReferenceImpact = {
  tradeAtoms: string;
  impactBps: number;
  graduated: boolean;
};

/** Enough to rebuild the exact config the simulation scored. */
export type PolicyRecipe = {
  presetId: PresetId;
  quote: QuoteLabel;
  initialMarketCap: number;
  migrationMarketCap: number;
  totalSupply: number;
  creatorTradingFeePercentage: number;
  lpLockPct: number;
  antiSniper: boolean;
};

export type DynamicFeeStatus = "simulated" | "base-only" | "not-used";

/**
 * Issuer constraint budget. Raising an upper bound, or lowering minRetailProgress,
 * is a loosening. The search may apply a loosening only after the issuer accepts it.
 */
export type ConstraintBudget = {
  maxThresholdGap: number;
  maxReferenceImpactBps: number;
  maxWhaleImpactBps: number;
  /** 0..1. Largest buy's share of filled quote. */
  maxConcentration: number;
  /** 0..1. Retail sample must fill at least this much of the threshold. */
  minRetailProgress: number;
};

/**
 * What happened to the issuer's constraints.
 * satisfied: a row passed the requested budget.
 * needs-decision: nothing did. The chosen row is for inspection. Deploy stays blocked.
 * accepted: the issuer accepted a wider budget, and the chosen row passes that budget.
 * The original constraints are still recorded as failed.
 */
export type ConstraintNegotiation = {
  status: "satisfied" | "needs-decision" | "accepted";
  requested: ConstraintBudget;
  /** Budget used to select a deployable row. Equals requested unless the issuer accepted a loosening. */
  applied: ConstraintBudget;
  /** Smallest loosening of requested that admits the inspection candidate. Null when a row already passed. */
  proposal: ConstraintBudget | null;
  /** Why the chosen row misses the requested budget. Empty when status is satisfied. */
  blocking: string[];
};

/** Compact record stored with a launch so a later chain read can be compared. */
export type DesignedMarket = {
  policyId: string;
  modelVersion: string;
  sdkVersion: string;
  seed: number;
  configHash: string;
  asset: AssetKind;
  objective: MarketObjective;
  presetId: PresetId;
  /** Display name of the selected row, for example "Exponential · 3×". */
  profileName?: string;
  thresholdAtoms: string;
  referenceImpactBps: number;
  retailProgress: number;
  whaleImpactBps: number;
  stressGraduationRate: number;
  stressPaths: number;
  /** 10th percentile of cohort progress, 0..1. Lower is the worse tail. */
  stressP10Progress: number;
  /** Lowest cohort-path progress, 0..1. */
  stressWorstProgress: number;
  /** Fingerprint of the config the simulator scored. Must match review and deploy. */
  configFingerprint: string;
  /**
   * True only when this row passed the original constraints.
   * False when it failed them, including after the issuer accepted a wider budget.
   * Missing on older local records.
   */
  constraintsPassed?: boolean;
  /** Set when the issuer accepted a wider budget. Absent when the original constraints passed. */
  acceptedRelaxation?: ConstraintBudget;
  candidateCount?: number;
  fullyFeasibleCount?: number;
  rejected?: string[];
};

export type MarketProfileId =
  | "stable"
  | "controlled"
  | "participation"
  | "fast"
  | "runway"
  | "protected";

export type CandidateReport = {
  /** Fee preset plus price multiple, for example "equity-3x". */
  profileId: string;
  profileName: string;
  recipe: PolicyRecipe;
  /** On-chain migration quote threshold, atoms. */
  thresholdAtoms: string;
  /** How far that threshold is from the requested raise, as a fraction. 0 is exact. */
  thresholdGap: number;
  feeLabel: string;
  priceMultiple: number;
  reference: ReferenceImpact;
  scenarios: ScenarioReport[];
  /** Share of synthetic cohort paths that reached the threshold. */
  stressGraduationRate: number;
  stressPaths: number;
  /** Median progress across synthetic paths, 0..1. */
  stressMedianProgress: number;
  /** 10th percentile of cohort progress, 0..1. */
  stressP10Progress: number;
  /** Lowest progress among cohort paths, 0..1. */
  stressWorstProgress: number;
  /** Market-config fingerprint of the curve this row scored. */
  configFingerprint: string;
  /** 100 for the selected frontier point. Lower numbers are other frontier points. Not a weighted grade. */
  score: number;
  dynamicFeeStatus: DynamicFeeStatus;
  feasible: boolean;
  rejected: string[];
};

export type LaunchPolicy = {
  version: 1;
  policyId: string;
  modelVersion: string;
  sdkVersion: string;
  seed: number;
  configHash: string;
  createdAt: string;
  brief: LaunchBrief;
  targetRaiseAtoms: string;
  priorities: string[];
  chosen: CandidateReport;
  /** Other frontier points, selected order. */
  alternatives: CandidateReport[];
  candidates: CandidateReport[];
  why: string[];
  limits: string[];
  /** What the search actually evaluated. Not a claim of global optimality. */
  search: SearchCoverage;
  /** Whether the requested constraints were met, left unresolved, or explicitly widened. */
  negotiation: ConstraintNegotiation;
  observedLaunches: null;
  observedNote: string;
};

export type SearchCoverage = {
  stage: "coarse-to-fine";
  presets: string[];
  /** Price multiples that were built and scored. */
  multiples: number[];
  candidateCount: number;
  note: string;
};

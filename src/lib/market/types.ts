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
  /** Synthetic paths in the stress test. Default 64. Each path is labelled synthetic. */
  stressPaths?: number;
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
};

export type MarketProfileId =
  | "stable"
  | "controlled"
  | "participation"
  | "fast"
  | "runway"
  | "protected";

export type CandidateReport = {
  profileId: MarketProfileId;
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
  /** Share of synthetic paths that reached the threshold. */
  stressGraduationRate: number;
  stressPaths: number;
  /** Median progress across synthetic paths, 0..1. */
  stressMedianProgress: number;
  score: number;
  /** False when the preset enables a dynamic fee. Volatility is not replayed, so that fee stays at zero. */
  dynamicFeeModeled: boolean;
};

export type LaunchPolicy = {
  brief: LaunchBrief;
  targetRaiseAtoms: string;
  chosen: CandidateReport;
  alternatives: CandidateReport[];
  why: string[];
  /** Always present. Empty only when every number on the policy is fully modeled. */
  limits: string[];
  observedLaunches: null;
  observedNote: string;
};

import type { ConstraintBudget, ConstraintChange } from "@/lib/market/types";

export type PassportKind = "live" | "scheduled";
export type PassportStatus = "verified" | "mismatch" | "unknown" | "not_applicable";
export type MonitorState =
  | "inside"
  | "near"
  | "outside"
  | "matched"
  | "mismatch"
  | "unknown"
  | "informational";

export type PassportCheck = {
  id: string;
  label: string;
  designed: string | number | null;
  observed: string | number | boolean | null;
  state: MonitorState;
  note?: string;
};

export type PassportRobustness = {
  scenarioCount: number;
  insideCount: number | null;
  source: "synthetic_assumption_shocks" | "synthetic_cohort";
  note: string;
};

export type PassportDesign = {
  fingerprint: string | null;
  policyId: string | null;
  configHash: string | null;
  presetId: string | null;
  profileName: string | null;
  asset: string | null;
  objective: string | null;
  constraintsPassed: boolean | null;
  requestedConstraints: ConstraintBudget | null;
  appliedConstraints: ConstraintBudget | null;
  acceptedRelaxations: ConstraintChange[];
  originalIntent: {
    targetRaise: number | string | null;
    typicalTrade: string | null;
    expectedParticipants: number | null;
    totalSupply: number | null;
    quote: string | null;
  };
  robustness: PassportRobustness | null;
  migrationThresholdAtoms: string | null;
  lpLockPct: number | null;
  concentrationLimit: number | null;
};

export type PassportMarket = {
  id: string;
  kind: PassportKind;
  pool: string | null;
  mint: string | null;
  config: string | null;
  creator: string | null;
  quote: string | null;
  website: string | null;
  xProfile: string | null;
  imageUrl: string | null;
  name: string;
  ticker: string;
  lifecycle: "Raising" | "Curve complete" | "Migrated" | "DAMM v2 active" | "Scheduled" | "Unknown";
  activeVenue: "DBC" | "DAMM v2" | "Pending" | "Unknown";
};

export type PassportDeployment = {
  status: PassportStatus;
  verified: boolean | null;
  poolFound: boolean | null;
  configMatch: boolean | null;
  fingerprintMatch: boolean | null;
  mintMatch: boolean | null;
  thresholdMatch: boolean | null;
  quoteMintMatch: boolean | null;
  creatorMatch: boolean | null;
  checkedAt: string | null;
};

export type PassportObserved = {
  quoteProgress: number | null;
  migrationComplete: boolean | null;
  lpLockPct: number | null;
  holders: number | null;
  observedSwapCount: number | null;
  largestObservedTrade: string | null;
  largestObservedTokenAccountShare: number | null;
  currentVenue: PassportMarket["activeVenue"];
  checkedAt: string | null;
};

export type PassportMonitor = {
  status: "available" | "partial" | "unknown" | "not_applicable";
  checks: PassportCheck[];
  checkedAt: string | null;
  note?: string;
};

export type PassportResponse = {
  ok: true;
  schemaVersion: "1";
  market: PassportMarket;
  design: PassportDesign;
  deployment: PassportDeployment;
  observed: PassportObserved;
  monitor: PassportMonitor;
  schedule: {
    status: string;
    scheduledForUtc: string;
    note: "No market exists on-chain yet";
  } | null;
};

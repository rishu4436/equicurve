import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { FEE_BY_PRESET } from "@/lib/dbc/presets";
import { EquiCurveError } from "@/lib/errors";
import { openBook } from "./book";
import { constraintFieldLabel } from "./constraintBudget";
import { scenarioAssumptions } from "./constraints";
import { materializeRecipe, parseBrief } from "./policy";
import { namedScenarios, referenceBuy } from "./scenarios";
import type { CandidateReport, ConstraintBudget, ConstraintField, LaunchBrief, ScenarioReport } from "./types";

export type RobustnessMetricId = "threshold" | "reference" | "whale" | "concentration" | "retail";

const METRIC_FIELDS: Record<RobustnessMetricId, ConstraintField> = {
  threshold: "maxThresholdGap",
  reference: "maxReferenceImpactBps",
  whale: "maxWhaleImpactBps",
  concentration: "maxConcentration",
  retail: "minRetailProgress",
};

export type RobustnessMetric = {
  id: RobustnessMetricId;
  label: string;
  /** Basis points, or a 0..1 fraction for the gap, concentration, and retail fill. */
  kind: "bps" | "fraction";
  value: number;
  limit: number;
  /** Retail is a minimum. Every other limit is a maximum. */
  bound: "minimum" | "maximum";
  passed: boolean;
  /** True for the assumption this case moved. */
  focus: boolean;
};

export type RobustnessCase = {
  id: "base" | "whale-plus" | "typical-plus" | "participants-minus";
  label: string;
  note: string;
  insideBudget: boolean;
  metrics: RobustnessMetric[];
  blocking: string[];
};

export type RobustnessReport = {
  fingerprint: string;
  cases: RobustnessCase[];
  insideCount: number;
  caseCount: 4;
  note: string;
};

/** 25% fewer participants, and never below one. */
export function scaledParticipants(participants: number): number {
  return Math.max(1, Math.floor(participants * 0.75));
}

function bumpAtoms(atoms: bigint): bigint {
  return (atoms * 125n) / 100n;
}

function scenario(row: CandidateReport, id: ScenarioReport["id"]): ScenarioReport | undefined {
  return row.scenarios.find((item) => item.id === id);
}

export type ConstraintSnapshot = {
  thresholdGap: number;
  referenceImpactBps: number;
  whaleImpactBps: number;
  concentration: number;
  retailProgress: number;
};

export function snapshotOf(row: CandidateReport): ConstraintSnapshot {
  const retail = scenario(row, "retail");
  return {
    thresholdGap: row.thresholdGap,
    referenceImpactBps: row.reference.impactBps,
    whaleImpactBps: scenario(row, "whale")?.largestBuyImpactBps ?? 0,
    concentration: retail?.concentration ?? 0,
    retailProgress: retail?.progress ?? 0,
  };
}

/** Every limit, with the measured value beside it. A failed whale line cannot hide a failed retail line. */
export function readConstraintMetrics(
  snapshot: ConstraintSnapshot,
  budget: ConstraintBudget,
  focus: readonly RobustnessMetricId[] = [],
): RobustnessMetric[] {
  const rows: Array<[RobustnessMetricId, number, number]> = [
    ["threshold", snapshot.thresholdGap, budget.maxThresholdGap],
    ["reference", snapshot.referenceImpactBps, budget.maxReferenceImpactBps],
    ["whale", snapshot.whaleImpactBps, budget.maxWhaleImpactBps],
    ["concentration", snapshot.concentration, budget.maxConcentration],
    ["retail", snapshot.retailProgress, budget.minRetailProgress],
  ];
  return rows.map(([id, value, limit]) => {
    const field = METRIC_FIELDS[id];
    const bound = id === "retail" ? "minimum" : "maximum";
    return {
      id,
      label: constraintFieldLabel(field),
      kind: id === "reference" || id === "whale" ? "bps" : "fraction",
      value,
      limit,
      bound,
      passed: bound === "minimum" ? value >= limit : value <= limit,
      focus: focus.includes(id),
    };
  });
}

function asCase(
  id: RobustnessCase["id"],
  label: string,
  note: string,
  row: CandidateReport,
  budget: ConstraintBudget,
  focus: readonly RobustnessMetricId[],
): RobustnessCase {
  const metrics = readConstraintMetrics(snapshotOf(row), budget, focus);
  const blocking = metrics.filter((item) => !item.passed).map((item) => item.label);
  return {
    id,
    label,
    note,
    insideBudget: blocking.length === 0,
    metrics,
    blocking,
  };
}

/**
 * Rerun one curve under four assumption sets.
 * The recipe, fingerprint, and selected design are left unchanged.
 */
export function assessRobustness(args: {
  chosen: CandidateReport;
  brief: LaunchBrief;
  budget: ConstraintBudget;
}): RobustnessReport {
  const parsed = parseBrief(args.brief);
  const built = materializeRecipe(args.chosen.recipe);
  const fingerprint = marketConfigFingerprint(built);
  if (fingerprint !== args.chosen.configFingerprint) {
    throw new EquiCurveError(
      "Robustness stopped because the rebuilt config does not match this design.",
      "SDK",
    );
  }
  const book = openBook(built, parsed.decimals);
  const assumptions = scenarioAssumptions(parsed.brief.asset);
  const feeDuration = FEE_BY_PRESET[args.chosen.recipe.presetId].totalDuration;
  const baseWhale = parsed.typicalAtoms * BigInt(assumptions.whaleMultiple);
  const fewer = scaledParticipants(parsed.brief.participants);

  const probe = (typicalAtoms: bigint, participants: number, whaleSizeAtoms: bigint): CandidateReport => {
    const scenarios = namedScenarios({
      book,
      typicalAtoms,
      participants,
      feeDurationSec: feeDuration,
      asset: parsed.brief.asset,
      whaleSizeAtoms,
    });
    return {
      ...args.chosen,
      reference: referenceBuy(book, typicalAtoms),
      scenarios,
      rejected: [],
    };
  };

  const cases: RobustnessCase[] = [
    asCase(
      "base",
      "Base design",
      "The brief as written.",
      args.chosen,
      args.budget,
      ["reference", "whale", "retail"],
    ),
    asCase(
      "whale-plus",
      "Whale size +25%",
      "The five launch whale buys are 25% larger. The typical order and the participant count stay as written.",
      probe(parsed.typicalAtoms, parsed.brief.participants, bumpAtoms(baseWhale)),
      args.budget,
      ["whale"],
    ),
    asCase(
      "typical-plus",
      "Typical trade +25%",
      "The typical order is 25% larger. Whale buys stay at their original size. The participant count stays as written.",
      probe(bumpAtoms(parsed.typicalAtoms), parsed.brief.participants, baseWhale),
      args.budget,
      ["reference"],
    ),
    asCase(
      "participants-minus",
      "Participants −25%",
      fewer === parsed.brief.participants
        ? "The brief already has one participant, so the retail sample stays as written."
        : `Participants fall from ${parsed.brief.participants} to ${fewer}. The typical order and the whale buys stay as written.`,
      probe(parsed.typicalAtoms, fewer, baseWhale),
      args.budget,
      ["retail"],
    ),
  ];

  return {
    fingerprint,
    cases,
    insideCount: cases.filter((item) => item.insideBudget).length,
    caseCount: 4,
    note: "These cases rerun this curve. They do not select another design, and they are not written into the signed record.",
  };
}

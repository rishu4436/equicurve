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
  /** True for the assumption this case moved, when that assumption is one of the five limits. */
  focus: boolean;
};

export type RobustnessAxisId = "whale" | "typical" | "participants" | "sell" | "late";
export type RobustnessLevel = "minus" | "base" | "plus";

/** A path measurement that is not one of the five budget limits. */
export type RobustnessObservation = {
  label: string;
  detail: string;
};

export type RobustnessCell = {
  axis: RobustnessAxisId;
  level: RobustnessLevel;
  insideBudget: boolean;
  metrics: RobustnessMetric[];
  blocking: string[];
  note: string;
  observation: RobustnessObservation | null;
};

export type RobustnessAxis = {
  id: RobustnessAxisId;
  label: string;
  cells: RobustnessCell[];
  /** Shocks whose budget result differs from the base cell. The base cell is not a shock. */
  departures: number;
};

export type RobustnessReport = {
  fingerprint: string;
  axes: RobustnessAxis[];
  baseInside: boolean;
  baseBlocking: string[];
  /** Five assumptions, each with a −25% shock and a +25% shock. */
  shockCount: 10;
  shockInsideCount: number;
  /** Empty when no shock changes the budget result, or when every assumption changes it equally. */
  mostSensitive: string[];
  leastSensitive: string[];
  tied: boolean;
  note: string;
};

const AXES: ReadonlyArray<{ id: RobustnessAxisId; label: string; focus: readonly RobustnessMetricId[] }> = [
  { id: "whale", label: "Whale size", focus: ["whale"] },
  { id: "typical", label: "Typical trade", focus: ["reference"] },
  { id: "participants", label: "Participants", focus: ["retail"] },
  { id: "sell", label: "Sell pressure", focus: [] },
  { id: "late", label: "Late capital", focus: [] },
];

/** 25% fewer participants, and never below one. */
export function scaledParticipants(participants: number): number {
  return scaledCount(participants, 75);
}

export function scaledCount(participants: number, percent: 75 | 125): number {
  return Math.max(1, Math.floor((participants * percent) / 100));
}

function bumpAtoms(atoms: bigint, percent: 75 | 125): bigint {
  const next = (atoms * BigInt(percent)) / 100n;
  return next > 0n ? next : 1n;
}

function scaleSellBps(bps: number, percent: 75 | 125): { value: number; capped: boolean } {
  const raw = Math.round((bps * percent) / 100);
  const value = Math.min(10_000, Math.max(1, raw));
  return { value, capped: value !== raw };
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

function budgetKey(blocking: string[], inside: boolean): string {
  return `${inside ? "in" : "out"}:${blocking.join("|")}`;
}

function sellObservation(row: CandidateReport, sellBps: number): RobustnessObservation {
  const drawdown = scenario(row, "sell-pressure")?.drawdownBps;
  const measured = drawdown == null ? "This row has no sell-pressure path." : `Drawdown ${drawdown} bps.`;
  return {
    label: "Sell-pressure path",
    detail: `Sell fraction ${sellBps} bps. ${measured} Drawdown is not one of the five budget limits.`,
  };
}

function lateObservation(row: CandidateReport): RobustnessObservation {
  const progress = scenario(row, "late")?.progress;
  const measured =
    progress == null
      ? "This row has no late-capital path."
      : `Late progress ${Math.round(progress * 1000) / 10}%.`;
  return {
    label: "Late-capital path",
    detail: `${measured} Late progress is not one of the five budget limits.`,
  };
}

function participantNote(from: number, to: number): string {
  if (to === from) {
    return from === 1
      ? "The brief already has one participant, so the retail sample stays as written."
      : `Participants stay at ${from}. The typical order and the whale buys stay as written.`;
  }
  const verb = to < from ? "fall" : "rise";
  const cap =
    to > 64 && from > 64
      ? " The retail sample stays at 64 orders."
      : to > 64
        ? " The retail sample is capped at 64 orders."
        : "";
  return `Participants ${verb} from ${from} to ${to}. The typical order and the whale buys stay as written.${cap}`;
}

/**
 * Rerun one curve across five assumptions, each at −25%, the base design, and +25%.
 * The recipe, fingerprint, and selected design are left unchanged.
 * The result is an envelope. It is not a score, and it is not stored.
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
  const baseLate = parsed.typicalAtoms * 4n;
  const participants = parsed.brief.participants;

  const probe = (spec: {
    typicalAtoms: bigint;
    participants: number;
    whaleSizeAtoms?: bigint;
    sellFractionBps?: number;
    lateBuyAtoms?: bigint;
    reprice: boolean;
  }): CandidateReport => {
    const scenarios = namedScenarios({
      book,
      typicalAtoms: spec.typicalAtoms,
      participants: spec.participants,
      feeDurationSec: feeDuration,
      asset: parsed.brief.asset,
      whaleSizeAtoms: spec.whaleSizeAtoms,
      sellFractionBps: spec.sellFractionBps,
      lateBuyAtoms: spec.lateBuyAtoms,
    });
    return {
      ...args.chosen,
      reference: spec.reprice ? referenceBuy(book, spec.typicalAtoms) : args.chosen.reference,
      scenarios,
      rejected: [],
    };
  };

  const asCell = (
    axis: (typeof AXES)[number],
    level: RobustnessLevel,
    row: CandidateReport,
    note: string,
    observation: RobustnessObservation | null,
  ): RobustnessCell => {
    const metrics = readConstraintMetrics(snapshotOf(row), args.budget, axis.focus);
    const blocking = metrics.filter((item) => !item.passed).map((item) => item.label);
    return {
      axis: axis.id,
      level,
      insideBudget: blocking.length === 0,
      metrics,
      blocking,
      note,
      observation,
    };
  };

  const axes: RobustnessAxis[] = AXES.map((axis) => {
    const base = asCell(axis, "base", args.chosen, "The brief as written.", null);
    let minus: RobustnessCell;
    let plus: RobustnessCell;
    if (axis.id === "whale") {
      const smaller = bumpAtoms(baseWhale, 75);
      const larger = bumpAtoms(baseWhale, 125);
      minus = asCell(
        axis,
        "minus",
        probe({ typicalAtoms: parsed.typicalAtoms, participants, whaleSizeAtoms: smaller, reprice: false }),
        "The five launch whale buys are 25% smaller. The typical order and the participant count stay as written.",
        null,
      );
      plus = asCell(
        axis,
        "plus",
        probe({ typicalAtoms: parsed.typicalAtoms, participants, whaleSizeAtoms: larger, reprice: false }),
        "The five launch whale buys are 25% larger. The typical order and the participant count stay as written.",
        null,
      );
    } else if (axis.id === "typical") {
      const smaller = bumpAtoms(parsed.typicalAtoms, 75);
      const larger = bumpAtoms(parsed.typicalAtoms, 125);
      minus = asCell(
        axis,
        "minus",
        probe({ typicalAtoms: smaller, participants, whaleSizeAtoms: baseWhale, reprice: true }),
        "The typical order is 25% smaller. Whale buys stay at their original size. The participant count stays as written.",
        null,
      );
      plus = asCell(
        axis,
        "plus",
        probe({ typicalAtoms: larger, participants, whaleSizeAtoms: baseWhale, reprice: true }),
        "The typical order is 25% larger. Whale buys stay at their original size. The participant count stays as written.",
        null,
      );
    } else if (axis.id === "participants") {
      const fewer = scaledCount(participants, 75);
      const more = scaledCount(participants, 125);
      minus = asCell(
        axis,
        "minus",
        probe({ typicalAtoms: parsed.typicalAtoms, participants: fewer, reprice: false }),
        participantNote(participants, fewer),
        null,
      );
      plus = asCell(
        axis,
        "plus",
        probe({ typicalAtoms: parsed.typicalAtoms, participants: more, reprice: false }),
        participantNote(participants, more),
        null,
      );
    } else if (axis.id === "sell") {
      const down = scaleSellBps(assumptions.sellFractionBps, 75);
      const up = scaleSellBps(assumptions.sellFractionBps, 125);
      const downRow = probe({
        typicalAtoms: parsed.typicalAtoms,
        participants,
        sellFractionBps: down.value,
        reprice: false,
      });
      const upRow = probe({
        typicalAtoms: parsed.typicalAtoms,
        participants,
        sellFractionBps: up.value,
        reprice: false,
      });
      const cap = (capped: boolean) => (capped ? " The sell is capped at 100% of the base held." : "");
      minus = asCell(
        axis,
        "minus",
        downRow,
        `Buyers sell 25% less of the base they received. The typical order, the whale buys, and the participant count stay as written.${cap(down.capped)}`,
        sellObservation(downRow, down.value),
      );
      plus = asCell(
        axis,
        "plus",
        upRow,
        `Buyers sell 25% more of the base they received. The typical order, the whale buys, and the participant count stay as written.${cap(up.capped)}`,
        sellObservation(upRow, up.value),
      );
      base.observation = sellObservation(args.chosen, assumptions.sellFractionBps);
    } else {
      const downRow = probe({
        typicalAtoms: parsed.typicalAtoms,
        participants,
        lateBuyAtoms: bumpAtoms(baseLate, 75),
        reprice: false,
      });
      const upRow = probe({
        typicalAtoms: parsed.typicalAtoms,
        participants,
        lateBuyAtoms: bumpAtoms(baseLate, 125),
        reprice: false,
      });
      minus = asCell(
        axis,
        "minus",
        downRow,
        "The four late buys are 25% smaller. The four launch buys stay at the typical size.",
        lateObservation(downRow),
      );
      plus = asCell(
        axis,
        "plus",
        upRow,
        "The four late buys are 25% larger. The four launch buys stay at the typical size.",
        lateObservation(upRow),
      );
      base.observation = lateObservation(args.chosen);
    }

    const cells = [minus, base, plus];
    const baseResult = budgetKey(base.blocking, base.insideBudget);
    const departures = [minus, plus].filter(
      (cell) => budgetKey(cell.blocking, cell.insideBudget) !== baseResult,
    ).length;
    return { id: axis.id, label: axis.label, cells, departures };
  });

  const shocks = axes.flatMap((axis) => axis.cells.filter((cell) => cell.level !== "base"));
  const departures = axes.map((axis) => axis.departures);
  const highest = Math.max(...departures);
  const lowest = Math.min(...departures);
  const tied = highest > 0 && highest === lowest;
  const mostSensitive = highest === 0 || tied ? [] : axes.filter((axis) => axis.departures === highest).map((axis) => axis.label);
  const leastSensitive = highest === 0 || tied ? [] : axes.filter((axis) => axis.departures === lowest).map((axis) => axis.label);
  const base = axes[0]?.cells.find((cell) => cell.level === "base");

  return {
    fingerprint,
    axes,
    baseInside: base?.insideBudget ?? false,
    baseBlocking: base?.blocking ?? [],
    shockCount: 10,
    shockInsideCount: shocks.filter((cell) => cell.insideBudget).length,
    mostSensitive,
    leastSensitive,
    tied,
    note: "These shocks rerun this curve. They do not select another design, and they are not written into the signed record. There is no robustness score.",
  };
}

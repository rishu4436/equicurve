import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { FEE_BY_PRESET } from "@/lib/dbc/presets";
import { EquiCurveError } from "@/lib/errors";
import { openBook } from "./book";
import { scenarioAssumptions } from "./constraints";
import { constraintViolations, materializeRecipe, parseBrief } from "./policy";
import { namedScenarios, referenceBuy } from "./scenarios";
import type { CandidateReport, ConstraintBudget, LaunchBrief, ScenarioReport } from "./types";

export type RobustnessMetric = {
  id: "reference" | "whale" | "retail";
  label: string;
  kind: "bps" | "progress";
  value: number;
  passed: boolean;
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

function metric(
  id: RobustnessMetric["id"],
  row: CandidateReport,
  budget: ConstraintBudget,
): RobustnessMetric {
  if (id === "reference") {
    const value = row.reference.impactBps;
    return {
      id,
      label: "Typical buy impact",
      kind: "bps",
      value,
      passed: value <= budget.maxReferenceImpactBps,
    };
  }
  if (id === "whale") {
    const value = scenario(row, "whale")?.largestBuyImpactBps ?? 0;
    return {
      id,
      label: "Whale buy impact",
      kind: "bps",
      value,
      passed: value <= budget.maxWhaleImpactBps,
    };
  }
  const value = scenario(row, "retail")?.progress ?? 0;
  return {
    id,
    label: "Retail fill",
    kind: "progress",
    value,
    passed: value >= budget.minRetailProgress,
  };
}

function asCase(
  id: RobustnessCase["id"],
  label: string,
  note: string,
  row: CandidateReport,
  budget: ConstraintBudget,
  shown: RobustnessMetric["id"][],
): RobustnessCase {
  const blocking = constraintViolations(row, budget);
  return {
    id,
    label,
    note,
    insideBudget: blocking.length === 0,
    metrics: shown.map((item) => metric(item, row, budget)),
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

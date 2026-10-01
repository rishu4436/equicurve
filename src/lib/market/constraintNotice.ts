import type { DesignedMarket, LaunchPolicy } from "./types";

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

/**
 * Copy for a search where the preferred row did not pass every constraint.
 * Returns null when the selected design itself passed.
 */
export function constraintFailureCopy(policy: LaunchPolicy): string[] | null {
  if (policy.chosen.feasible) return null;
  const evaluated = policy.candidates.length;
  const feasible = policy.candidates.filter((row) => row.feasible).length;
  const chosen = policy.chosen;
  const whale = chosen.scenarios.find((item) => item.id === "whale");
  const retailFailed = chosen.rejected.some((reason) => /retail/i.test(reason));
  const lines = [
    "Constraint failure",
    feasible === 0 ? "No candidate meets all constraints" : "The selected design does not meet every constraint",
    `${evaluated} candidates evaluated · ${feasible} fully feasible`,
    `Selected for comparison: ${chosen.profileName}`,
  ];
  if (chosen.rejected.length === 0) {
    lines.push("Constraint result: failed, with no reason recorded");
  } else if (retailFailed) {
    lines.push("Retail-progress constraint: Failed");
    for (const reason of chosen.rejected.filter((item) => !/retail/i.test(item))) {
      lines.push(`Other constraint: ${reason}`);
    }
  } else {
    for (const reason of chosen.rejected) lines.push(`Constraint: ${reason}`);
  }
  lines.push(
    `Opening buy impact: ${chosen.reference.impactBps} bps`,
    `Whale sample impact: ${whale?.largestBuyImpactBps ?? "unknown"} bps`,
    `Simulated graduation: ${pct(chosen.stressGraduationRate)} across ${chosen.stressPaths} paths`,
    feasible === 0
      ? "This is a tradeoff example, not a fully feasible recommendation."
      : "Other evaluated candidates passed the constraints. This row is not one of them.",
  );
  return lines;
}

/** Same notice from the compact record stored on a launch. Null when the row passed, or when older records never stored the flag. */
export function constraintFailureFromDesigned(designed: DesignedMarket): string[] | null {
  if (designed.constraintsPassed !== false) return null;
  const evaluated = designed.candidateCount ?? 0;
  const feasible = designed.fullyFeasibleCount ?? 0;
  const rejected = designed.rejected ?? [];
  const retailFailed = rejected.some((reason) => /retail/i.test(reason));
  const lines = [
    "Constraint failure",
    feasible === 0 ? "No candidate meets all constraints" : "The selected design does not meet every constraint",
    `${evaluated} candidates evaluated · ${feasible} fully feasible`,
    `Selected for comparison: ${designed.profileName ?? designed.presetId}`,
  ];
  if (rejected.length === 0) {
    lines.push("Constraint result: failed, with no reason recorded");
  } else if (retailFailed) {
    lines.push("Retail-progress constraint: Failed");
    for (const reason of rejected.filter((item) => !/retail/i.test(item))) {
      lines.push(`Other constraint: ${reason}`);
    }
  } else {
    for (const reason of rejected) lines.push(`Constraint: ${reason}`);
  }
  lines.push(
    `Opening buy impact: ${designed.referenceImpactBps} bps`,
    `Whale sample impact: ${designed.whaleImpactBps} bps`,
    `Simulated graduation: ${pct(designed.stressGraduationRate)} across ${designed.stressPaths} paths`,
    feasible === 0
      ? "This is a tradeoff example, not a fully feasible recommendation."
      : "Other evaluated candidates passed the constraints. This row is not one of them.",
  );
  return lines;
}

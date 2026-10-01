import { constraintFieldLabel, constraintPolicyFrom, formatConstraintValue } from "./constraintBudget";
import type { ConstraintBudget, ConstraintPolicy, DesignedMarket, LaunchPolicy } from "./types";

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

/** Fields where `next` is looser than `requested`. Empty when nothing moved. */
export function constraintBudgetChanges(requested: ConstraintBudget, next: ConstraintBudget): string[] {
  const lines: string[] = [];
  if (next.maxThresholdGap > requested.maxThresholdGap) {
    lines.push(
      `Threshold gap up to ${(next.maxThresholdGap * 100).toFixed(2)}% (requested ${(requested.maxThresholdGap * 100).toFixed(2)}%).`,
    );
  }
  if (next.maxReferenceImpactBps > requested.maxReferenceImpactBps) {
    lines.push(`Typical buy impact up to ${next.maxReferenceImpactBps} bps (requested ${requested.maxReferenceImpactBps}).`);
  }
  if (next.maxWhaleImpactBps > requested.maxWhaleImpactBps) {
    lines.push(`Whale buy impact up to ${next.maxWhaleImpactBps} bps (requested ${requested.maxWhaleImpactBps}).`);
  }
  if (next.maxConcentration > requested.maxConcentration) {
    lines.push(
      `Largest buy up to ${Math.round(next.maxConcentration * 100)}% of filled quote (requested ${Math.round(requested.maxConcentration * 100)}%).`,
    );
  }
  if (next.minRetailProgress < requested.minRetailProgress) {
    lines.push(
      `Retail fill down to ${Math.round(next.minRetailProgress * 100)}% (requested ${Math.round(requested.minRetailProgress * 100)}%).`,
    );
  }
  return lines;
}

function acceptedPolicyLines(policy: ConstraintPolicy): string[] {
  return [
    "The issuer accepted a wider budget. The original constraints were not met.",
    ...policy.relaxed.map(
      (change) =>
        `${constraintFieldLabel(change.field)} ${formatConstraintValue(change.field, change.from)} → ${formatConstraintValue(change.field, change.to)}.`,
    ),
  ];
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
  if (policy.negotiation.status === "accepted") {
    lines.push(...acceptedPolicyLines(constraintPolicyFrom(policy.negotiation.requested, policy.negotiation.applied)));
  }
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
  if (designed.constraintPolicy && designed.constraintPolicy.relaxed.length > 0) {
    lines.push(...acceptedPolicyLines(designed.constraintPolicy));
  }
  return lines;
}

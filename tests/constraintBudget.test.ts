import { describe, expect, it } from "vitest";
import {
  budgetOnlyLoosens,
  constraintBudgetError,
  constraintFieldProposal,
  constraintPolicyFrom,
  explicitBudgetDecision,
  formatConstraintInput,
  loosenConstraintBudget,
  parseConstraintInput,
} from "@/lib/market/constraintBudget";
import type { ConstraintBudget } from "@/lib/market/types";

const requested: ConstraintBudget = {
  maxThresholdGap: 0.05,
  maxReferenceImpactBps: 1200,
  maxWhaleImpactBps: 1800,
  maxConcentration: 0.55,
  minRetailProgress: 0.25,
};

describe("constraint budget ranges", () => {
  it("accepts the requested private-company budget", () => {
    expect(constraintBudgetError(requested)).toBeNull();
  });

  it("rejects a gap, concentration, or retail value outside 0..1, and a negative impact", () => {
    expect(constraintBudgetError({ ...requested, maxThresholdGap: 100 })).toBe("Threshold gap must be from 0 to 1.");
    expect(constraintBudgetError({ ...requested, maxConcentration: 12 })).toBe("Concentration must be from 0 to 1.");
    expect(constraintBudgetError({ ...requested, minRetailProgress: -5 })).toBe("Retail progress must be from 0 to 1.");
    expect(constraintBudgetError({ ...requested, maxReferenceImpactBps: -1 })).toBe(
      "Typical buy impact must be zero or greater.",
    );
    expect(constraintBudgetError({ ...requested, maxWhaleImpactBps: -1 })).toBe("Whale buy impact must be zero or greater.");
  });

  it("records only the field the issuer widened", () => {
    const applied = { ...requested, maxWhaleImpactBps: 2000 };
    expect(constraintPolicyFrom(requested, applied)).toEqual({
      requested,
      applied,
      relaxed: [{ field: "maxWhaleImpactBps", from: 1800, to: 2000 }],
    });
    expect(constraintPolicyFrom(requested, requested).relaxed).toEqual([]);
    expect(budgetOnlyLoosens(requested, applied)).toBe(true);
    expect(budgetOnlyLoosens(requested, { ...requested, minRetailProgress: 1 })).toBe(false);
  });

  it("drops a tighter edit and keeps every other limit", () => {
    expect(
      loosenConstraintBudget(requested, { ...requested, maxWhaleImpactBps: 100, minRetailProgress: 1 }),
    ).toEqual(requested);
    const mixed = explicitBudgetDecision(requested, {
      ...requested,
      maxWhaleImpactBps: 1000,
      minRetailProgress: 0.1,
    });
    expect(mixed).toEqual({
      ok: true,
      budget: { ...requested, minRetailProgress: 0.1 },
      ignored: ["maxWhaleImpactBps"],
    });
    const whaleOnly = explicitBudgetDecision(requested, { ...requested, maxWhaleImpactBps: 2000 });
    expect(whaleOnly).toEqual({
      ok: true,
      budget: { ...requested, maxWhaleImpactBps: 2000 },
      ignored: [],
    });
    expect(explicitBudgetDecision(requested, { ...requested, maxWhaleImpactBps: 1000 })).toEqual({
      ok: false,
      error: "Widen at least one limit. A tighter limit stays at the requested value.",
    });
    expect(explicitBudgetDecision(requested, { ...requested, maxConcentration: 12 }).ok).toBe(false);
  });

  it("offers an in-range suggestion and withholds one that cannot be signed", () => {
    const proposal = { ...requested, maxWhaleImpactBps: 2000, maxThresholdGap: 1.2, minRetailProgress: 0.1 };
    expect(constraintFieldProposal("maxWhaleImpactBps", requested, proposal)).toEqual({ value: 2000, inRange: true });
    expect(constraintFieldProposal("minRetailProgress", requested, proposal)).toEqual({ value: 0.1, inRange: true });
    expect(constraintFieldProposal("maxThresholdGap", requested, proposal)).toEqual({ value: 1.2, inRange: false });
    expect(constraintFieldProposal("maxConcentration", requested, proposal)).toBeNull();
    expect(constraintFieldProposal("maxReferenceImpactBps", requested, { ...requested, maxReferenceImpactBps: 1000 })).toBeNull();
  });

  it("parses a loose percent input without tightening the limit", () => {
    expect(parseConstraintInput("minRetailProgress", formatConstraintInput("minRetailProgress", 0.25))).toBe(0.25);
    expect(parseConstraintInput("maxWhaleImpactBps", formatConstraintInput("maxWhaleImpactBps", 1800))).toBe(1800);
    const awkward = 1 / 3;
    const upper = parseConstraintInput("maxConcentration", formatConstraintInput("maxConcentration", awkward, "loose"));
    const lower = parseConstraintInput("minRetailProgress", formatConstraintInput("minRetailProgress", awkward, "loose"));
    expect(upper).not.toBeNull();
    expect(lower).not.toBeNull();
    expect(upper!).toBeGreaterThanOrEqual(awkward);
    expect(lower!).toBeLessThanOrEqual(awkward);
    expect(parseConstraintInput("maxThresholdGap", "")).toBeNull();
    expect(parseConstraintInput("maxWhaleImpactBps", "nope")).toBeNull();
  });
});

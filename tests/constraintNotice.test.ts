import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FEE_BY_PRESET } from "@/lib/dbc/presets";
import { openBook } from "@/lib/market/book";
import { describeCohortPaths, runCohortStress } from "@/lib/market/cohorts";
import { constraintPolicyFrom } from "@/lib/market/constraintBudget";
import { constraintFailureCopy, constraintFailureFromDesigned } from "@/lib/market/constraintNotice";
import { scenarioAssumptions } from "@/lib/market/constraints";
import { deploymentAllowed, designPolicy, materializeRecipe, parseBrief, toDesignedMarket } from "@/lib/market/policy";
import type { LaunchPolicy } from "@/lib/market/types";
import { expectMismatches, loadSavedBrief, type PolicyShape } from "../scripts/demo/saved-brief";

const REQUIRED_LINES = [
  "Constraint failure",
  "No candidate meets all constraints",
  "20 candidates evaluated · 0 fully feasible",
  "Selected for comparison: Exponential · 3×",
  "Retail-progress constraint: Failed",
  "Opening buy impact: 26 bps",
  "Whale sample impact: 214 bps",
  "Simulated graduation: 0% across 4 paths",
  "This is a tradeoff example, not a fully feasible recommendation.",
];

function stubPolicy(): LaunchPolicy {
  const base = {
    profileId: "exponential-3x",
    profileName: "Exponential · 3×",
    recipe: {
      presetId: "exponential" as const,
      quote: "SOL" as const,
      initialMarketCap: 1,
      migrationMarketCap: 3,
      totalSupply: 1_000_000_000,
      creatorTradingFeePercentage: 70,
      lpLockPct: 100,
      antiSniper: true,
    },
    thresholdAtoms: "1",
    thresholdGap: 0,
    feeLabel: "fee",
    priceMultiple: 3,
    reference: { tradeAtoms: "1", impactBps: 26, graduated: false },
    scenarios: [
      {
        id: "whale" as const,
        label: "Whale",
        participantsAsked: null,
        ordersRun: 5,
        ordersSkipped: 0,
        quoteFilledAtoms: "0",
        quotePaidAtoms: "0",
        feesAtoms: "0",
        progress: 0,
        graduated: false,
        largestBuyImpactBps: 214,
        endMoveBps: 0,
        drawdownBps: 0,
        concentration: 0,
        note: "",
        trace: [],
      },
    ],
    stressGraduationRate: 0,
    stressPaths: 4,
    stressMedianProgress: 0,
    stressP10Progress: 0,
    stressWorstProgress: 0,
    configFingerprint: "16ac1e49b68f4a4c",
    score: 100,
    dynamicFeeStatus: "simulated" as const,
    feasible: false,
    rejected: ["retail sample fills 4%"],
  };
  return {
    version: 1,
    policyId: "EQ-test",
    modelVersion: "0.3.0",
    sdkVersion: "1.5.12",
    seed: 60428,
    configHash: "abc",
    createdAt: "2026-10-01T00:00:00.000Z",
    brief: {
      asset: "private-company",
      objective: "controlled-discovery",
      quote: "SOL",
      targetRaise: "100",
      typicalTrade: "0.2",
      participants: 20,
      stressPaths: 4,
      seed: 60428,
    },
    targetRaiseAtoms: "100000000000",
    priorities: [],
    chosen: base,
    alternatives: [],
    candidates: Array.from({ length: 20 }, () => ({ ...base, feasible: false })),
    why: [],
    limits: [],
    search: { stage: "coarse-to-fine", presets: [], multiples: [], candidateCount: 20, note: "" },
    negotiation: {
      status: "needs-decision",
      requested: {
        maxThresholdGap: 0.05,
        maxReferenceImpactBps: 1200,
        maxWhaleImpactBps: 1800,
        maxConcentration: 0.55,
        minRetailProgress: 0.25,
      },
      applied: {
        maxThresholdGap: 0.05,
        maxReferenceImpactBps: 1200,
        maxWhaleImpactBps: 1800,
        maxConcentration: 0.55,
        minRetailProgress: 0.25,
      },
      proposal: null,
      blocking: ["retail sample fills 4%"],
      budgetError: null,
    },
    observedLaunches: null,
    observedNote: "",
  };
}

describe("constraint failure copy", () => {
  it("states that the preferred row is a tradeoff when nobody passed", () => {
    expect(constraintFailureCopy(stubPolicy())).toEqual(REQUIRED_LINES);
  });

  it("says nothing when the selected row passed", () => {
    const policy = stubPolicy();
    policy.chosen = { ...policy.chosen, feasible: true, rejected: [] };
    expect(constraintFailureCopy(policy)).toBeNull();
  });

  it("keeps the saved 100 SOL brief pinned to the recorded search", () => {
    const saved = loadSavedBrief(resolve(__dirname, ".."));
    const raw = JSON.parse(readFileSync(resolve(__dirname, "../scripts/demo/local-brief.json"), "utf8")) as {
      brief: typeof saved.brief;
    };
    expect(raw.brief).toEqual(saved.brief);
    const policy = designPolicy(saved.brief);
    if (!saved.expect) throw new Error("Saved brief is missing its expect pin.");
    expect(expectMismatches(policy as PolicyShape, saved.expect)).toEqual([]);
    expect(constraintFailureCopy(policy)).toEqual(REQUIRED_LINES);
    const designed = toDesignedMarket(policy);
    expect(designed.constraintsPassed).toBe(false);
    expect(designed.candidateCount).toBe(20);
    expect(designed.fullyFeasibleCount).toBe(0);
    expect(designed.profileName).toBe("Exponential · 3×");
    expect(constraintFailureFromDesigned(designed)).toEqual(REQUIRED_LINES);

    const parsed = parseBrief(saved.brief);
    const assumptions = scenarioAssumptions(saved.brief.asset);
    const book = openBook(materializeRecipe(policy.chosen.recipe), parsed.decimals);
    const paths = describeCohortPaths({
      book,
      typicalAtoms: parsed.typicalAtoms,
      feeDurationSec: FEE_BY_PRESET[policy.chosen.recipe.presetId].totalDuration,
      paths: parsed.paths,
      seed: parsed.seed,
      whaleHundredths: assumptions.cohortWhaleHundredths,
      participants: saved.brief.participants,
    });
    const stress = runCohortStress({
      book,
      typicalAtoms: parsed.typicalAtoms,
      feeDurationSec: FEE_BY_PRESET[policy.chosen.recipe.presetId].totalDuration,
      paths: parsed.paths,
      seed: parsed.seed,
      whaleHundredths: assumptions.cohortWhaleHundredths,
      participants: saved.brief.participants,
    });
    expect(paths).toHaveLength(4);
    expect(paths.map((path) => path.seed)).toEqual([0, 1, 2, 3].map((index) => (saved.brief.seed + index * 997) >>> 0));
    expect(paths.map((path) => path.progress.toFixed(4)).join(",")).toBe(stress.signature);
    expect(stress.seed).toBe(60428);
    expect(stress.graduationRate).toBe(0);
    expect(policy.negotiation.status).toBe("needs-decision");
    expect(policy.negotiation.budgetError).toBeNull();
    expect(policy.limits.join(" ")).not.toMatch(/were relaxed/i);
    expect(policy.limits.join(" ")).not.toMatch(/closest curves are shown/i);
    expect(deploymentAllowed(policy)).toBe(false);
    expect(policy.negotiation.proposal).not.toBeNull();
    expect(toDesignedMarket(policy).constraintPolicy).toBeUndefined();
    const proposalChanges = constraintPolicyFrom(policy.negotiation.requested, policy.negotiation.proposal!).relaxed;
    expect(proposalChanges.map((change) => change.field)).toEqual(["minRetailProgress"]);

    const accepted = designPolicy(saved.brief, { acceptedBudget: policy.negotiation.proposal! });
    expect(accepted.negotiation.status).toBe("accepted");
    expect(accepted.chosen.feasible).toBe(false);
    expect(deploymentAllowed(accepted)).toBe(true);
    const designedAccepted = toDesignedMarket(accepted);
    expect(designedAccepted.constraintsPassed).toBe(false);
    expect(designedAccepted.constraintPolicy).toEqual(
      constraintPolicyFrom(accepted.negotiation.requested, accepted.negotiation.applied),
    );
    expect(designedAccepted.constraintPolicy?.requested).toEqual(policy.negotiation.requested);
    expect(designedAccepted.constraintPolicy?.relaxed.map((change) => change.field)).toEqual(["minRetailProgress"]);
    expect(constraintFailureFromDesigned(designedAccepted)?.join(" ")).toMatch(/accepted a wider budget/i);
    expect(constraintFailureFromDesigned(designedAccepted)?.join(" ")).toMatch(/Minimum retail fill/);

    const retailOnly = designPolicy(saved.brief, {
      acceptedBudget: {
        ...policy.negotiation.requested,
        minRetailProgress: policy.negotiation.proposal!.minRetailProgress,
      },
    });
    expect(retailOnly.negotiation.status).toBe("accepted");
    expect(retailOnly.negotiation.applied).toEqual({
      ...policy.negotiation.requested,
      minRetailProgress: policy.negotiation.proposal!.minRetailProgress,
    });
    expect(toDesignedMarket(retailOnly).constraintPolicy?.relaxed).toEqual([
      {
        field: "minRetailProgress",
        from: policy.negotiation.requested.minRetailProgress,
        to: policy.negotiation.proposal!.minRetailProgress,
      },
    ]);
    expect(retailOnly.chosen.feasible).toBe(false);
    expect(deploymentAllowed(retailOnly)).toBe(true);

    const whaleOnly = designPolicy(saved.brief, {
      acceptedBudget: { ...policy.negotiation.requested, maxWhaleImpactBps: 2000 },
    });
    expect(whaleOnly.negotiation.status).toBe("needs-decision");
    expect(whaleOnly.negotiation.applied).toEqual(policy.negotiation.requested);
    expect(whaleOnly.negotiation.budgetError).toBeNull();
    expect(toDesignedMarket(whaleOnly).constraintPolicy).toBeUndefined();
    expect(deploymentAllowed(whaleOnly)).toBe(false);

    const tightened = designPolicy(saved.brief, {
      acceptedBudget: { ...policy.negotiation.requested, minRetailProgress: 1 },
    });
    expect(tightened.negotiation.status).toBe("needs-decision");
    expect(tightened.negotiation.applied).toEqual(policy.negotiation.requested);
    expect(tightened.negotiation.budgetError).toBeNull();
    expect(tightened.chosen.configFingerprint).toBe(policy.chosen.configFingerprint);
    expect(deploymentAllowed(tightened)).toBe(false);

    const invalid = designPolicy(saved.brief, {
      acceptedBudget: {
        ...policy.negotiation.requested,
        maxThresholdGap: 100,
        maxConcentration: 12,
        minRetailProgress: -5,
      },
    });
    expect(invalid.negotiation.budgetError).toBe("Threshold gap must be from 0 to 1.");
    expect(invalid.negotiation.status).toBe("needs-decision");
    expect(invalid.negotiation.applied).toEqual(policy.negotiation.requested);
    expect(invalid.chosen.configFingerprint).toBe(policy.chosen.configFingerprint);
    expect(toDesignedMarket(invalid).constraintPolicy).toBeUndefined();
    expect(deploymentAllowed(invalid)).toBe(false);
  }, 400_000);
});

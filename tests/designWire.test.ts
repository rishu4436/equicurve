import { describe, expect, it } from "vitest";
import { buildLaunchReview } from "@/lib/dbc/launchReview";
import { applyWizardPatch, INITIAL_WIZARD, resolveWizardStep } from "@/components/create/wizardTypes";

const reviewBase = {
  presetId: "short" as const,
  quote: "SOL" as const,
  quoteMint: "So11111111111111111111111111111111111111112",
  transferProfile: "open-spl" as const,
  totalSupply: 1_000_000_000,
  creatorPct: 70,
  lpLockPct: 100,
  mintRenounce: true,
  antiSniper: true,
  feeClaimer: "",
  wallet: null,
  seedBuy: "0",
  cluster: "devnet",
  sharedConfig: null,
};

describe("wizard design wiring", () => {
  it("resolves the old step names", () => {
    expect(resolveWizardStep("curve")).toBe("design");
    expect(resolveWizardStep("offering")).toBe("goals");
    expect(resolveWizardStep("fees")).toBe("terms");
    expect(resolveWizardStep("design")).toBe("design");
    expect(resolveWizardStep(null)).toBe("basics");
  });

  it("drops a selected design when a term changes, and keeps one written in the same patch", () => {
    const selected = applyWizardPatch(INITIAL_WIZARD, {
      presetId: "equity",
      marketCaps: { initial: 20, migration: 100 },
      designed: {
        policyId: "EQ-abc",
        modelVersion: "0.2.0",
        sdkVersion: "1.5.12",
        seed: 1,
        configHash: "deadbeef",
        asset: "private-company",
        objective: "controlled-discovery",
        presetId: "equity",
        thresholdAtoms: "1",
        referenceImpactBps: 1,
        retailProgress: 0.5,
        whaleImpactBps: 2,
        stressGraduationRate: 0,
        stressPaths: 8,
      },
      designWhy: ["because"],
      designLimits: ["synthetic"],
    });
    expect(selected.marketCaps).toEqual({ initial: 20, migration: 100 });
    const cleared = applyWizardPatch(selected, { feeIssuer: 40 });
    expect(cleared.marketCaps).toBeNull();
    expect(cleared.designed).toBeNull();
    expect(cleared.designWhy).toEqual([]);
  });

  it("refuses a shared config when the review is showing searched caps", () => {
    const blocked = buildLaunchReview({
      ...reviewBase,
      sharedConfig: "SharedConfig11111111111111111111111111111111",
      marketCaps: { initial: 4, migration: 20 },
    });
    expect(blocked.errors.join(" ")).toMatch(/shared/i);
    const custom = buildLaunchReview({ ...reviewBase, marketCaps: { initial: 4, migration: 20 } });
    const plain = buildLaunchReview(reviewBase);
    expect(custom.errors).toEqual([]);
    expect(custom.migrationQuoteThresholdAtoms).not.toBe(plain.migrationQuoteThresholdAtoms);
  });
});

import { describe, expect, it } from "vitest";
import { buildLaunchReview } from "@/lib/dbc/launchReview";
import {
  applyWizardPatch,
  canContinue,
  DESIGN_INPUT_KEYS,
  INITIAL_WIZARD,
  resolveWizardStep,
  type WizardState,
} from "@/components/create/wizardTypes";
import type { DesignedMarket } from "@/lib/market/types";

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
        stressP10Progress: 0,
        stressWorstProgress: 0,
        configFingerprint: "abc123",
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
    expect(custom.configFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(custom.configFingerprint).not.toBe(plain.configFingerprint);
  });

  it("clears a selected design for every design input, and for a preset change", () => {
    const selected = applyWizardPatch(INITIAL_WIZARD, {
      presetId: "equity",
      marketCaps: { initial: 20, migration: 100 },
      designed: designedFixture(),
      designWhy: ["because"],
      designLimits: ["synthetic"],
    });
    const replacements: Record<(typeof DESIGN_INPUT_KEYS)[number], Partial<WizardState>> = {
      feeIssuer: { feeIssuer: 40 },
      lpLockPct: { lpLockPct: 50 },
      antiSniper: { antiSniper: false },
      targetRaise: { targetRaise: "50" },
      typicalTrade: { typicalTrade: "2" },
      participants: { participants: 12 },
      assetKind: { assetKind: "rwa" },
      objective: { objective: "stable" },
      quote: { quote: "USDC" },
      totalSupply: { totalSupply: 2_000_000_000 },
      stressPaths: { stressPaths: 32 },
    };
    for (const key of DESIGN_INPUT_KEYS) {
      const cleared = applyWizardPatch(selected, replacements[key]);
      expect(cleared.designed, key).toBeNull();
      expect(cleared.marketCaps, key).toBeNull();
      expect(cleared.designWhy, key).toEqual([]);
    }
    expect(applyWizardPatch(selected, { presetId: "flat" }).designed).toBeNull();
    const kept = applyWizardPatch(selected, {
      presetId: "long",
      marketCaps: { initial: 10, migration: 80 },
    });
    expect(kept.designed?.policyId).toBe("EQ-abc");
    expect(kept.presetId).toBe("long");
  });

  it("blocks review and deploy when no current design is selected", () => {
    const base: WizardState = {
      ...INITIAL_WIZARD,
      name: "Acme Robotics",
      ticker: "ACME",
      thesis: "Tokenized exposure to a robotics issuer.",
      docMemo: true,
      docRisk: true,
      docIssuer: true,
      ackBonding: true,
      ackDocs: true,
      ackFees: true,
      ackClaimer: true,
      marketCaps: { initial: 20, migration: 100 },
    };
    expect(canContinue("review", base)).toBe(false);
    expect(canContinue("launch", base)).toBe(false);
    expect(canContinue("design", base)).toBe(true);
    const withDesign = { ...base, designed: designedFixture() };
    expect(canContinue("review", withDesign)).toBe(true);
    expect(canContinue("launch", withDesign)).toBe(true);
    expect(canContinue("review", { ...withDesign, ackBonding: false })).toBe(false);
  });
});

function designedFixture(): DesignedMarket {
  return {
    policyId: "EQ-abc",
    modelVersion: "0.3.0",
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
    stressP10Progress: 0,
    stressWorstProgress: 0,
    configFingerprint: "abc123",
  };
}

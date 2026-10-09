import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PoolSnapshot } from "@/lib/dbc/types";
import type { RegistryLaunch } from "@/lib/registry/types";
import type { RegistryDesign } from "@/lib/registry/design";
import type { ScheduledLaunch } from "@/lib/schedule/types";
import type { PassportDesign } from "@/lib/passport/types";
import { buildLivePassportFromReadings, buildMonitor, buildScheduledPassport, largestTokenAccountShare } from "@/lib/passport/query";

const POOL = "11111111111111111111111111111111";
const MINT = "So11111111111111111111111111111111111111112";
const CREATOR = "11111111111111111111111111111111";

const designRecord = {
  fingerprint: "0123456789abcdef0123456789abcdef",
  migrationQuoteThresholdAtoms: "1000",
  canonicalConfig: "canonical-config",
  expected: { migrationQuoteThreshold: "1000", partnerPermanentLockedLiquidityPercentage: "100" },
  profileName: "Exponential · 3×",
  constraintsPassed: false,
  constraintPolicy: {
    requested: { maxThresholdGap: 0.1, maxReferenceImpactBps: 100, maxWhaleImpactBps: 1800, maxConcentration: 0.2, minRetailProgress: 0.25 },
    applied: { maxThresholdGap: 0.1, maxReferenceImpactBps: 100, maxWhaleImpactBps: 3453, maxConcentration: 0.2, minRetailProgress: 0.25 },
    relaxed: [{ field: "maxWhaleImpactBps", from: 1800, to: 3453 }],
  },
} as unknown as RegistryDesign;

const registry = {
  pool: POOL, mint: MINT, config: "Config1111111111111111111111111111111111111", creator: CREATOR, quoteMint: MINT, quote: "SOL",
  feeClaimer: CREATOR, lockPct: 100, creatorFeePct: 70, status: "raising", isMigrated: false, dammPool: null,
  name: "Passport Market", ticker: "PASS", thesis: "A test market", sector: "Other", presetId: "exponential", raiseTarget: 100, website: "https://example.com/pass", xProfile: "https://x.com/pass",
  cluster: "devnet", createdAt: "2026-10-09T00:00:00.000Z", registeredAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z",
  chainCheckedAt: "2026-10-09T00:00:00.000Z", authSigner: CREATOR, authIssuedAt: "2026-10-09T00:00:00.000Z", design: designRecord,
} as unknown as RegistryLaunch;

const scheduled = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", creatorWallet: CREATOR, cluster: "devnet", status: "scheduled",
  createdAt: "2026-10-09T00:00:00.000Z", updatedAt: "2026-10-09T00:00:00.000Z", authIssuedAt: "2026-10-09T00:00:00.000Z", authSignature: "signature",
  name: "Upcoming Passport", ticker: "UP", thesis: "Scheduled", sector: "Other", website: "https://example.com/upcoming", xProfile: "https://x.com/upcoming", image: "/uploads/token-images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png", presetId: "exponential", raiseTarget: 100, quote: "SOL", totalSupply: 1_000_000,
  seedBuy: "0", feeIssuerPct: 70, lpLockPct: 100, antiSniper: true, mintRenounce: true, feeClaimer: "", transferProfile: "open-spl", designFingerprint: designRecord.fingerprint, design: designRecord,
  scheduledForUtc: "2026-10-10T00:00:00.000Z", marketCaps: { initial: 1, migration: 10 }, designed: {
    policyId: "policy-1", modelVersion: "0.3.0", sdkVersion: "1.5.12", seed: 1, configHash: "hash", asset: "community", objective: "participation", presetId: "exponential", profileName: "Exponential · 3×", thresholdAtoms: "1000", referenceImpactBps: 10, retailProgress: 0.3, whaleImpactBps: 100, stressGraduationRate: 0.9, stressPaths: 10, stressP10Progress: 0.3, stressWorstProgress: 0.1, configFingerprint: designRecord.fingerprint, constraintPolicy: designRecord.constraintPolicy,
  },
} as unknown as ScheduledLaunch;

const snapshot = {
  pool: POOL, config: registry.config, baseMint: MINT, quoteMint: MINT, creator: CREATOR, kind: "dbc", feeClaimer: CREATOR,
  quoteReserve: "500", migrationQuoteThreshold: "1000", isMigrated: false, migrationProgress: 0, migrationOption: 1, migrationFeeOption: 2,
  baseDecimals: 9, quoteDecimals: 9, lockPct: 100, creatorFeePct: 70, curve: { phase: "raising", progress: 0.5 }, quoteProgress: 0.5, baseProgress: 0.4, configRead: true, checkedAt: "2026-10-09T12:00:00.000Z",
} as unknown as PoolSnapshot;

function monitorDesign(overrides: Partial<PassportDesign> = {}): PassportDesign {
  return {
    fingerprint: "fingerprint", policyId: "policy", configHash: "hash", presetId: "exponential", profileName: "Exponential · 3×", asset: "community", objective: "participation", constraintsPassed: true,
    requestedConstraints: { maxThresholdGap: 0.1, maxReferenceImpactBps: 100, maxWhaleImpactBps: 1800, maxConcentration: 0.2, minRetailProgress: 0.25 },
    appliedConstraints: { maxThresholdGap: 0.1, maxReferenceImpactBps: 100, maxWhaleImpactBps: 1800, maxConcentration: 0.2, minRetailProgress: 0.25 }, acceptedRelaxations: [],
    originalIntent: { targetRaise: 100, typicalTrade: "1", expectedParticipants: 100, totalSupply: 1_000_000, quote: "SOL" }, robustness: { scenarioCount: 10, insideCount: 9, source: "synthetic_assumption_shocks", note: "Deterministic simulation coverage under the selected assumptions." }, migrationThresholdAtoms: "1000", lpLockPct: 100, concentrationLimit: 0.2,
    ...overrides,
  };
}

function observed(overrides: Partial<Parameters<typeof buildMonitor>[0]["observed"]> = {}) {
  return { quoteProgress: 0.5, migrationComplete: false, lpLockPct: 100, holders: null, observedSwapCount: 4, largestObservedTrade: null, largestObservedTokenAccountShare: 0.1, currentVenue: "DBC" as const, checkedAt: "2026-10-09T12:00:00.000Z", ...overrides };
}

function deployment(overrides: Partial<Parameters<typeof buildMonitor>[0]["deployment"]> = {}) {
  return { status: "verified" as const, verified: true, poolFound: true, configMatch: true, fingerprintMatch: true, mintMatch: true, thresholdMatch: true, quoteMintMatch: true, creatorMatch: true, checkedAt: "2026-10-09T12:00:00.000Z", ...overrides };
}

describe("Market Passport", () => {
  it("builds a scheduled pre-launch Passport", () => {
    const result = buildScheduledPassport(scheduled);
    expect(result.market.kind).toBe("scheduled");
    expect(result.market.pool).toBeNull();
    expect(result.market.website).toBe("https://example.com/upcoming");
    expect(result.market.xProfile).toBe("https://x.com/upcoming");
    expect(result.market.imageUrl).toContain("/uploads/token-images/");
    expect(result.schedule?.note).toBe("No market exists on-chain yet");
    expect(result.observed.quoteProgress).toBeNull();
    expect(result.monitor.status).toBe("not_applicable");
  });

  it("builds a live Passport without inventing unavailable readbacks", () => {
    const result = buildLivePassportFromReadings({ id: POOL, registry, catalog: null, snapshot, onChain: null, destination: null, holders: null, swapCount: null, checkedAt: "2026-10-09T12:00:00.000Z" });
    expect(result.market.kind).toBe("live");
    expect(result.market.pool).toBe(POOL);
    expect(result.market.website).toBe("https://example.com/pass");
    expect(result.market.xProfile).toBe("https://x.com/pass");
    expect(result.market.imageUrl).toBeNull();
    expect(result.deployment.status).toBe("unknown");
    expect(result.observed.quoteProgress).toBe(0.5);
    expect(result.observed.observedSwapCount).toBeNull();
  });

  it("keeps core RPC failure at unknown verification", () => {
    const result = buildLivePassportFromReadings({ id: POOL, registry, catalog: null, snapshot: null, onChain: null, destination: null, holders: null, swapCount: null, checkedAt: "2026-10-09T12:00:00.000Z" });
    expect(result.deployment).toMatchObject({ status: "unknown", verified: null, configMatch: null });
    expect(result.monitor.checks.find((check) => check.id === "configuration-match")?.state).toBe("unknown");
  });

  it("uses explicit nulls and exposes no secret or environment values", () => {
    const result = buildLivePassportFromReadings({ id: POOL, registry, catalog: null, snapshot: null, onChain: null, destination: null, holders: null, swapCount: null, checkedAt: "2026-10-09T12:00:00.000Z" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE_KEY");
    expect(JSON.stringify(result)).not.toContain("RPC_URL");
    expect(result.observed.largestObservedTrade).toBeNull();
  });

  it("calculates largest token-account share exactly", () => {
    expect(largestTokenAccountShare("1000", [{ amountAtoms: "250" }, { amountAtoms: "100" }])).toBe(0.25);
    expect(largestTokenAccountShare("0", [{ amountAtoms: "1" }])).toBeNull();
    expect(largestTokenAccountShare(null, [{ amountAtoms: "1" }])).toBeNull();
  });

  it("matches configuration when the deployment readback matches", () => {
    const result = buildMonitor({ design: monitorDesign(), deployment: deployment(), observed: observed() });
    expect(result.checks.find((check) => check.id === "configuration-match")?.state).toBe("matched");
  });

  it("reports configuration mismatch without calling it unhealthy", () => {
    const result = buildMonitor({ design: monitorDesign(), deployment: deployment({ status: "mismatch", verified: false, configMatch: false }), observed: observed() });
    expect(result.checks.find((check) => check.id === "configuration-match")?.state).toBe("mismatch");
    expect(JSON.stringify(result)).not.toMatch(/healthy|unhealthy|safe|unsafe/);
  });

  it("maps migration progress to inside, near, and matched", () => {
    expect(buildMonitor({ design: monitorDesign(), deployment: deployment(), observed: observed({ quoteProgress: 0.9 }) }).checks.find((check) => check.id === "migration-target")?.state).toBe("inside");
    expect(buildMonitor({ design: monitorDesign(), deployment: deployment(), observed: observed({ quoteProgress: 0.95 }) }).checks.find((check) => check.id === "migration-target")?.state).toBe("near");
    expect(buildMonitor({ design: monitorDesign(), deployment: deployment(), observed: observed({ migrationComplete: true, quoteProgress: 1 }) }).checks.find((check) => check.id === "migration-target")?.state).toBe("matched");
  });

  it("maps upper-bound concentration to inside, near, outside, and unknown", () => {
    const state = (share: number | null) => buildMonitor({ design: monitorDesign(), deployment: deployment(), observed: observed({ largestObservedTokenAccountShare: share }) }).checks.find((check) => check.id === "holder-concentration")?.state;
    expect(state(0.1)).toBe("inside");
    expect(state(0.19)).toBe("near");
    expect(state(0.21)).toBe("outside");
    expect(state(null)).toBe("unknown");
  });

  it("matches or mismatches LP lock categorically", () => {
    expect(buildMonitor({ design: monitorDesign(), deployment: deployment(), observed: observed({ lpLockPct: 100 }) }).checks.find((check) => check.id === "lp-lock")?.state).toBe("matched");
    expect(buildMonitor({ design: monitorDesign(), deployment: deployment(), observed: observed({ lpLockPct: 80 }) }).checks.find((check) => check.id === "lp-lock")?.state).toBe("mismatch");
  });

  it("keeps participation and swaps informational", () => {
    const result = buildMonitor({ design: monitorDesign(), deployment: deployment(), observed: observed() });
    expect(result.checks.find((check) => check.id === "participation")?.state).toBe("informational");
    expect(result.checks.find((check) => check.id === "observed-swaps")?.state).toBe("informational");
  });

  it("degrades holder and history sections independently", () => {
    const result = buildLivePassportFromReadings({ id: POOL, registry, catalog: null, snapshot, onChain: null, destination: null, holders: null, swapCount: null, checkedAt: "2026-10-09T12:00:00.000Z" });
    expect(result.observed.largestObservedTokenAccountShare).toBeNull();
    expect(result.observed.observedSwapCount).toBeNull();
    expect(result.observed.quoteProgress).toBe(0.5);
  });

  it("preserves robustness as deterministic simulation coverage", () => {
    const result = buildScheduledPassport(scheduled);
    expect(result.design.robustness).toMatchObject({ scenarioCount: 10, insideCount: 9, source: "synthetic_cohort" });
    expect(result.design.robustness?.note).not.toMatch(/probability|chance|success/);
  });

  it("exposes accepted widening and no-relaxation state", () => {
    expect(buildScheduledPassport(scheduled).design.acceptedRelaxations).toHaveLength(1);
    expect(buildMonitor({ design: monitorDesign({ acceptedRelaxations: [] }), deployment: deployment(), observed: observed() })).toBeTruthy();
  });

  it("uses explicit lifecycle and active venue values", () => {
    const result = buildLivePassportFromReadings({ id: POOL, registry, catalog: null, snapshot, onChain: null, destination: null, holders: null, swapCount: 4, checkedAt: "2026-10-09T12:00:00.000Z" });
    expect(result.market.lifecycle).toBe("Raising");
    expect(result.market.activeVenue).toBe("DBC");
    expect(result.observed.currentVenue).toBe("DBC");
  });
});

describe("Passport contracts", () => {
  it("uses the versioned API route and GET-only semantics", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/api/v1/markets/[id]/passport/route.ts"), "utf8");
    expect(route).toContain("export async function GET");
    expect(route).not.toContain("export async function POST");
    expect(route).toContain("Cache-Control");
    expect(route).toContain("rate_limited");
  });

  it("adds the primary live Passport tab and scheduled view", () => {
    const live = readFileSync(resolve(process.cwd(), "src/components/offering/OfferingDetailClient.tsx"), "utf8");
    const upcoming = readFileSync(resolve(process.cwd(), "src/components/upcoming/UpcomingDetailClient.tsx"), "utf8");
    expect(live).toContain('"Passport"');
    expect(live).toContain("<PassportPanel");
    expect(upcoming).toContain('kind="scheduled"');
  });

  it("documents fingerprint, monitor, concentration, and failure semantics", () => {
    const docs = readFileSync(resolve(process.cwd(), "docs/MARKET_PASSPORT.md"), "utf8");
    expect(docs).toContain("stored on-chain");
    expect(docs).toContain("above 90% through 100%");
    expect(docs).toContain("beneficial owners");
    expect(docs).toContain("Live Design Monitor compares observable state");
    expect(docs).toContain("fair-value assessment.");
    expect(docs).toContain("History failures");
  });

  it("does not touch Market Terminal chart architecture", () => {
    expect(readFileSync(resolve(process.cwd(), "src/components/offering/OfferingDetailClient.tsx"), "utf8")).toContain("PriceHistoryChart");
    expect(readFileSync(resolve(process.cwd(), "src/components/offering/PriceHistoryChart.tsx"), "utf8")).not.toContain("Passport");
  });
});

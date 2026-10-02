import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { launchCurveConfig } from "@/lib/dbc/create";
import {
  canonicalConfigText,
  compareDeploymentReadback,
  expectedFromConfig,
  verifiedPanelVisible,
} from "@/lib/dbc/deploymentReadback";
import { authorizeRegistration, refreshFromChain } from "@/lib/registry/authorize";
import { constraintPolicyFrom } from "@/lib/market/constraintBudget";
import type { ConstraintBudget } from "@/lib/market/types";
import { parseStoredDesign, registryDesignSchema, resolveDeploymentRecord, type RegistryDesign } from "@/lib/registry/design";
import { coerceStoredLaunch, toPublicLaunch } from "@/lib/registry/normalize";
import { getRecordedDeployment } from "@/lib/registry/publicDeployments";
import { WSOL_MINT } from "@/lib/constants";
import { MINT, POOL, signed, snapshot } from "./helpers";

const USDC = ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"];
const JOURNEY = "Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF";
const PYLON = "3SdvXsHRW7RYrzjGsskJvVUSa8ZFTtiqpQFnAos8zQ5J";

function attest(over: { presetId?: "flat" | "exponential"; antiSniper?: boolean } = {}): RegistryDesign {
  const cfg = launchCurveConfig({
    presetId: over.presetId ?? "flat",
    totalSupply: 1_000_000_000,
    creatorTradingFeePercentage: 50,
    lpLockPct: 100,
    mintRenounce: true,
    antiSniper: over.antiSniper ?? false,
    quoteDecimals: 9,
    transferProfile: "open-spl",
  });
  const expected = expectedFromConfig(cfg);
  return {
    fingerprint: marketConfigFingerprint(cfg),
    migrationQuoteThresholdAtoms: expected.migrationQuoteThreshold,
    canonicalConfig: canonicalConfigText(cfg),
    expected,
    profileName: over.presetId === "exponential" ? "Exponential trial" : "Flat trial",
    constraintsPassed: false,
  };
}

function deps(kp: Keypair, nowMs: number) {
  return {
    serverCluster: "devnet",
    nowMs,
    lookup: async () => ({ status: "verified" as const, snapshot: snapshot({ creator: kp.publicKey.toBase58() }) }),
    getExisting: async () => null,
    usdcMints: USDC,
  };
}

describe("registry design attestation", () => {
  it("stores a consistent creator-signed design and ignores a checks flag", async () => {
    const kp = Keypair.generate();
    const now = Date.now();
    const design = attest();
    const body = await signed(kp, { design }, new Date(now));
    const stored = await authorizeRegistration({ body, ...deps(kp, now) });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.entry.design?.fingerprint).toBe(design.fingerprint);
    expect(stored.entry.design).not.toHaveProperty("checks");
    expect(toPublicLaunch(stored.entry).verified).toBe(true);

    const spoofed = await authorizeRegistration({
      body: { ...body, payload: { ...body.payload, design: { ...design, checks: { readback: true } } } },
      ...deps(kp, now),
    });
    expect(spoofed).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a fingerprint or threshold that does not match the canonical config", async () => {
    const kp = Keypair.generate();
    const now = Date.now();
    const design = attest();
    const badFingerprint = await authorizeRegistration({
      body: await signed(kp, { design: { ...design, fingerprint: "0123456789abcdef0123456789abcdef" } }, new Date(now)),
      ...deps(kp, now),
    });
    expect(badFingerprint).toMatchObject({ ok: false, status: 400 });
    if (badFingerprint.ok) return;
    expect(badFingerprint.error).toContain("fingerprint does not match the canonical config");

    const badThreshold = await authorizeRegistration({
      body: await signed(kp, { design: { ...design, migrationQuoteThresholdAtoms: "1" } }, new Date(now)),
      ...deps(kp, now),
    });
    expect(badThreshold).toMatchObject({ ok: false, status: 400 });
    if (badThreshold.ok) return;
    expect(badThreshold.error).toContain("migration threshold does not match the canonical config");
  });

  it("keeps an omitted design, replays an identical one, and rejects an older different one", async () => {
    const kp = Keypair.generate();
    const now = Date.now();
    const design = attest();
    const firstBody = await signed(kp, { design }, new Date(now - 30_000));
    const first = await authorizeRegistration({ body: firstBody, ...deps(kp, now) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = await authorizeRegistration({
      body: firstBody,
      ...deps(kp, now),
      getExisting: async () => first.entry,
    });
    expect(replay).toMatchObject({ ok: true, unchanged: true });

    const newer = await signed(kp, {}, new Date(now));
    const kept = await authorizeRegistration({
      body: newer,
      ...deps(kp, now),
      getExisting: async () => first.entry,
    });
    expect(kept.ok).toBe(true);
    if (!kept.ok) return;
    expect(kept.entry.design).toEqual(first.entry.design);

    const older = await signed(kp, { design: attest({ presetId: "exponential" }) }, new Date(now - 120_000));
    const stale = await authorizeRegistration({
      body: older,
      ...deps(kp, now),
      getExisting: async () => first.entry,
    });
    expect(stale).toMatchObject({ ok: false, status: 409, code: "stale_authorization" });
  });

  it("refresh and coerce keep a valid design and drop a design that fails its own check", async () => {
    const kp = Keypair.generate();
    const now = Date.now();
    const design = attest();
    const first = await authorizeRegistration({
      body: await signed(kp, { design }, new Date(now)),
      ...deps(kp, now),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const refreshed = await refreshFromChain({
      body: { pool: POOL },
      serverCluster: "devnet",
      nowMs: now,
      lookup: async () => ({ status: "verified", snapshot: snapshot({ creator: kp.publicKey.toBase58() }) }),
      getExisting: async () => first.entry,
      usdcMints: USDC,
    });
    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) return;
    expect(refreshed.entry.design).toEqual(first.entry.design);

    const roundTrip = coerceStoredLaunch(first.entry);
    expect(roundTrip?.design?.fingerprint).toBe(design.fingerprint);
    expect(roundTrip?.pool).toBe(POOL);
    expect(roundTrip?.mint).toBe(MINT);

    const dropped = coerceStoredLaunch({
      ...first.entry,
      design: { ...design, fingerprint: "0123456789abcdef" },
    });
    expect(dropped?.pool).toBe(POOL);
    expect(dropped?.design).toBeNull();

    const flagged = coerceStoredLaunch({
      ...first.entry,
      design: { ...design, verified: true },
    });
    expect(flagged?.design).toBeNull();
    expect(flagged?.name).toBe(first.entry.name);
  });
});

describe("resolveDeploymentRecord", () => {
  it("prefers a consistent registration over the static catalog", () => {
    const catalog = getRecordedDeployment(JOURNEY);
    const design = attest();
    expect(catalog?.fingerprint).not.toBe(design.fingerprint);
    const resolved = resolveDeploymentRecord({
      pool: JOURNEY,
      registry: {
        pool: JOURNEY,
        config: "registry-config",
        mint: catalog!.mint,
        quote: "SOL",
        design,
      },
      catalog,
    });
    expect(resolved?.source).toBe("registry");
    expect(resolved?.fingerprint).toBe(design.fingerprint);
    expect(resolved?.config).toBe("registry-config");
  });

  it("uses the catalog when the registration has no design or an inconsistent one", () => {
    const catalog = getRecordedDeployment(JOURNEY);
    const bare = resolveDeploymentRecord({
      pool: JOURNEY,
      registry: { pool: JOURNEY, config: catalog!.config, mint: catalog!.mint, quote: "SOL", design: null },
      catalog,
    });
    expect(bare?.source).toBe("catalog");
    expect(bare?.fingerprint).toBe("16ac1e49b68f4a4c");

    const inconsistent = resolveDeploymentRecord({
      pool: JOURNEY,
      registry: {
        pool: JOURNEY,
        config: "registry-config",
        mint: catalog!.mint,
        quote: "SOL",
        design: { ...attest(), fingerprint: "0123456789abcdef" },
      },
      catalog,
    });
    expect(inconsistent?.source).toBe("catalog");
    expect(inconsistent?.config).toBe(catalog!.config);
  });

  it("hides the chip when the live comparison fails", () => {
    const catalog = getRecordedDeployment(JOURNEY);
    const resolved = resolveDeploymentRecord({ pool: JOURNEY, registry: null, catalog });
    expect(resolved?.source).toBe("catalog");
    const verdict = compareDeploymentReadback({
      expected: resolved!.expected,
      canonicalConfig: resolved!.canonicalConfig,
      fingerprint: resolved!.fingerprint,
      identity: {
        pool: resolved!.pool,
        config: resolved!.config,
        mint: resolved!.mint,
        threshold: "1",
        quoteMint: WSOL_MINT.toBase58(),
      },
      snapshot: {
        pool: resolved!.pool,
        config: resolved!.config,
        baseMint: resolved!.mint,
        quoteMint: WSOL_MINT.toBase58(),
        migrationQuoteThreshold: "1",
      },
      chain: { migrationQuoteThreshold: "1", quoteMint: WSOL_MINT.toBase58() },
    });
    expect(verdict.verified).toBe(false);
    expect(verifiedPanelVisible({ verified: verdict.verified, checks: verdict.checks })).toBe(false);
    expect(verifiedPanelVisible({ verified: true, checks: { ...verdict.checks, readback: true, migrationThreshold: true } })).toBe(false);
  });

  it("stores a one-field relaxation and rejects an invalid or incomplete policy", () => {
    const requested: ConstraintBudget = {
      maxThresholdGap: 0.05,
      maxReferenceImpactBps: 1200,
      maxWhaleImpactBps: 1800,
      maxConcentration: 0.55,
      minRetailProgress: 0.25,
    };
    const whale = constraintPolicyFrom(requested, { ...requested, maxWhaleImpactBps: 2000 });
    const withWhale = registryDesignSchema.safeParse({ ...attest(), constraintPolicy: whale });
    expect(withWhale.success).toBe(true);
    if (!withWhale.success) return;
    expect(withWhale.data.constraintPolicy?.relaxed).toEqual([{ field: "maxWhaleImpactBps", from: 1800, to: 2000 }]);
    const resolved = resolveDeploymentRecord({
      pool: POOL,
      registry: {
        pool: POOL,
        config: "Config1111111111111111111111111111111111111",
        mint: MINT,
        quote: "SOL",
        design: withWhale.data,
      },
      catalog: null,
    });
    expect(resolved?.constraintPolicy?.requested.maxWhaleImpactBps).toBe(1800);
    expect(resolved?.constraintPolicy?.applied.maxWhaleImpactBps).toBe(2000);
    expect(resolved?.constraintPolicy?.applied.minRetailProgress).toBe(0.25);

    const older = registryDesignSchema.safeParse(attest());
    expect(older.success).toBe(true);
    if (older.success) expect(older.data.constraintPolicy).toBeUndefined();

    expect(
      registryDesignSchema.safeParse({
        ...attest(),
        constraintPolicy: constraintPolicyFrom(requested, { ...requested, maxConcentration: 12 }),
      }).success,
    ).toBe(false);
    expect(
      registryDesignSchema.safeParse({
        ...attest(),
        constraintPolicy: constraintPolicyFrom(requested, { ...requested, minRetailProgress: -5 }),
      }).success,
    ).toBe(false);
    expect(
      registryDesignSchema.safeParse({
        ...attest(),
        constraintPolicy: constraintPolicyFrom(requested, { ...requested, maxThresholdGap: 100 }),
      }).success,
    ).toBe(false);
    expect(
      registryDesignSchema.safeParse({
        ...attest(),
        constraintPolicy: { ...whale, relaxed: [] },
      }).success,
    ).toBe(false);
    expect(
      registryDesignSchema.safeParse({
        ...attest(),
        constraintPolicy: constraintPolicyFrom(requested, { ...requested, maxWhaleImpactBps: 1000 }),
      }).success,
    ).toBe(false);
    expect(
      registryDesignSchema.safeParse({
        ...attest(),
        constraintsPassed: true,
        constraintPolicy: whale,
      }).success,
    ).toBe(false);
    expect(registryDesignSchema.safeParse({ ...attest(), acceptedRelaxation: requested }).success).toBe(false);
  });

  it("accepts the recorded Pylon design as stored and rejects it as a new signature", () => {
    const row = getRecordedDeployment(PYLON);
    expect(row).not.toBeNull();
    const recorded = {
      fingerprint: row!.fingerprint,
      migrationQuoteThresholdAtoms: row!.migrationQuoteThresholdAtoms,
      canonicalConfig: row!.canonicalConfig,
      expected: row!.expected,
      profileName: row!.profileName,
      constraintsPassed: row!.constraintsPassed,
      transaction: row!.transaction,
    };
    expect(row!.fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(parseStoredDesign(recorded)?.fingerprint).toBe(row!.fingerprint);
    expect(registryDesignSchema.safeParse(recorded).success).toBe(false);
  });
});

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { launchCurveConfig } from "@/lib/dbc/create";
import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import {
  canonicalConfigText,
  compareDeploymentReadback,
  expectedFromConfig,
  recordedFingerprintMatches,
  verifiedPanelVisible,
} from "@/lib/dbc/deploymentReadback";
import { getPublicDeployment, getRecordedDeployment } from "@/lib/registry/publicDeployments";
import { WSOL_MINT } from "@/lib/constants";
import { loadBriefAt } from "../scripts/demo/saved-brief";

function proof(dir: string) {
  return JSON.parse(readFileSync(resolve(__dirname, "../demo-evidence", dir, "readback.json"), "utf8")) as {
    snapshot: {
      pool: string;
      config: string;
      baseMint: string;
      quoteMint: string | null;
      migrationQuoteThreshold: string | null;
    };
    config: Record<string, unknown>;
  };
}

function check(pool: string, dir: string) {
  const row = getRecordedDeployment(pool);
  if (!row) throw new Error("missing record");
  const chain = proof(dir);
  return compareDeploymentReadback({
    expected: row.expected,
    canonicalConfig: row.canonicalConfig,
    fingerprint: row.fingerprint,
    identity: {
      pool: row.pool,
      config: row.config,
      mint: row.mint,
      threshold: row.migrationQuoteThresholdAtoms,
      quoteMint: WSOL_MINT.toBase58(),
    },
    snapshot: chain.snapshot,
    chain: chain.config,
  });
}

describe("deployment readback", () => {
  it("matches the Journey chain proof and keeps the stored fingerprint honest", () => {
    const row = getPublicDeployment("Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF");
    expect(row?.fingerprint).toBe("16ac1e49b68f4a4c");
    expect(row?.expected.migrationFeeOption).toBeUndefined();
    expect(recordedFingerprintMatches(row!.canonicalConfig, row!.fingerprint)).toBe(true);
    expect(check(row!.pool, "public-devnet").checks).toEqual({
      fingerprint: true,
      poolConfiguration: true,
      migrationThreshold: true,
      readback: true,
    });
  });

  it("matches the Northline chain proof, a different design", () => {
    const row = getPublicDeployment("FhxqSm5YQKyKhgqFwd8dMyYb2WGAA9HsQDrBSy3G4KWd");
    const journey = getPublicDeployment("Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF");
    expect(row?.fingerprint).toBe("e1bfccfe19434469");
    expect(row?.fingerprint).not.toBe(journey?.fingerprint);
    expect(check(row!.pool, "public-devnet-northline").verified).toBe(true);
  });

  it("fails closed when the chain threshold, fingerprint, or panel flags do not pass", () => {
    const row = getRecordedDeployment("Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF");
    const chain = proof("public-devnet");
    const mismatched = compareDeploymentReadback({
      expected: row!.expected,
      canonicalConfig: row!.canonicalConfig,
      fingerprint: row!.fingerprint,
      identity: {
        pool: row!.pool,
        config: row!.config,
        mint: row!.mint,
        threshold: "1",
        quoteMint: WSOL_MINT.toBase58(),
      },
      snapshot: { ...chain.snapshot, migrationQuoteThreshold: "1" },
      chain: { ...chain.config, migrationQuoteThreshold: "1" },
    });
    expect(mismatched.verified).toBe(false);
    expect(mismatched.checks.migrationThreshold).toBe(false);
    expect(mismatched.checks.readback).toBe(false);
    expect(verifiedPanelVisible(mismatched)).toBe(false);
    expect(verifiedPanelVisible({ verified: true, checks: { ...mismatched.checks, readback: true, migrationThreshold: true, fingerprint: false, poolConfiguration: true } })).toBe(false);
    expect(verifiedPanelVisible({ verified: false, checks: { fingerprint: true, poolConfiguration: true, migrationThreshold: true, readback: true } })).toBe(false);
    expect(getPublicDeployment("not-a-pool")).toBeNull();
  });

  it("drops a catalog row whose fingerprint does not match its canonical config", () => {
    const row = getRecordedDeployment("Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF");
    expect(recordedFingerprintMatches(row!.canonicalConfig, "0000000000000000")).toBe(false);
    const verdict = compareDeploymentReadback({
      expected: row!.expected,
      canonicalConfig: row!.canonicalConfig,
      fingerprint: "0000000000000000",
      identity: {
        pool: row!.pool,
        config: row!.config,
        mint: row!.mint,
        threshold: row!.migrationQuoteThresholdAtoms,
        quoteMint: WSOL_MINT.toBase58(),
      },
      snapshot: proof("public-devnet").snapshot,
      chain: proof("public-devnet").config,
    });
    expect(verdict.checks.fingerprint).toBe(false);
    expect(verdict.verified).toBe(false);
  });

  it("refuses a brief that is missing its shape or uses a non-https metadata URI", () => {
    const dir = mkdtempSync(join(tmpdir(), "eq-brief-"));
    const badUri = join(dir, "uri.json");
    const saved = JSON.parse(readFileSync(resolve(__dirname, "../scripts/demo/briefs/northline.json"), "utf8")) as {
      launch: { uri: string };
    };
    saved.launch.uri = "data:application/json,{}";
    writeFileSync(badUri, JSON.stringify(saved));
    expect(() => loadBriefAt(badUri)).toThrow(/https/);
    writeFileSync(join(dir, "empty.json"), "{}");
    expect(() => loadBriefAt(join(dir, "empty.json"))).toThrow(/missing brief/);
  });

  it("attests the migration fee and the DAMM v2 destination on a new design", () => {
    const cfg = launchCurveConfig({
      presetId: "exponential",
      totalSupply: 1_000_000_000,
      creatorTradingFeePercentage: 70,
      lpLockPct: 100,
      mintRenounce: true,
      antiSniper: true,
      quoteDecimals: 9,
      transferProfile: "open-spl",
    });
    const expected = expectedFromConfig(cfg);
    const canonical = canonicalConfigText(cfg);
    const fingerprint = marketConfigFingerprint(cfg);
    const damm = "Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp";
    expect(expected.migrationFeeOption).toBe("2");
    expect(expected.migrationFeePercentage).toBe("0");
    expect(expected.creatorMigrationFeePercentage).toBe("0");
    expect(expected.migratedPoolFeeBps).toBe("0");
    expect(expected.dammV2Config).toBe(damm);
    expect(canonical.endsWith(`2\n0\n0\n0\n0\n0\n0\n${damm}`)).toBe(true);
    expect(recordedFingerprintMatches(canonical, fingerprint)).toBe(true);

    const pool = "Pool111111111111111111111111111111111111111";
    const config = "Cfg1111111111111111111111111111111111111111";
    const mint = "Mint111111111111111111111111111111111111111";
    const quoteMint = WSOL_MINT.toBase58();
    const chain = {
      sqrtStartPrice: expected.sqrtStartPrice,
      curve: expected.curve,
      migrationQuoteThreshold: expected.migrationQuoteThreshold,
      creatorTradingFeePercentage: expected.creatorTradingFeePercentage,
      partnerPermanentLockedLiquidityPercentage: expected.partnerPermanentLockedLiquidityPercentage,
      partnerLiquidityPercentage: expected.partnerLiquidityPercentage,
      creatorPermanentLockedLiquidityPercentage: expected.creatorPermanentLockedLiquidityPercentage,
      creatorLiquidityPercentage: expected.creatorLiquidityPercentage,
      enableFirstSwapWithMinFee: expected.enableFirstSwapWithMinFee,
      collectFeeMode: expected.collectFeeMode,
      migrationOption: expected.migrationOption,
      tokenQuoteDecimal: expected.tokenQuoteDecimal,
      tokenBaseDecimal: expected.tokenBaseDecimal,
      migrationFeeOption: expected.migrationFeeOption,
      migrationFeePercentage: expected.migrationFeePercentage,
      creatorMigrationFeePercentage: expected.creatorMigrationFeePercentage,
      migratedCollectFeeMode: expected.migratedCollectFeeMode,
      migratedDynamicFee: expected.migratedDynamicFee,
      migratedPoolFeeBps: expected.migratedPoolFeeBps,
      migratedPoolBaseFeeMode: expected.migratedPoolBaseFeeMode,
      poolFees: {
        baseFee: expected.baseFee,
        dynamicFee: expected.dynamicFee
          ? { ...expected.dynamicFee, initialized: expected.dynamicFee.initialized === "" ? 1 : expected.dynamicFee.initialized }
          : null,
      },
      quoteMint,
    };
    const identity = {
      pool,
      config,
      mint,
      threshold: expected.migrationQuoteThreshold,
      quoteMint,
    };
    const snapshot = {
      pool,
      config,
      baseMint: mint,
      quoteMint,
      migrationQuoteThreshold: expected.migrationQuoteThreshold,
    };
    expect(
      compareDeploymentReadback({
        expected,
        canonicalConfig: canonical,
        fingerprint,
        identity,
        snapshot,
        chain,
      }).verified,
    ).toBe(true);

    const moved = compareDeploymentReadback({
      expected,
      canonicalConfig: canonical,
      fingerprint,
      identity,
      snapshot,
      chain: { ...chain, migrationFeeOption: 3 },
    });
    expect(moved.checks.fingerprint).toBe(false);
    expect(moved.verified).toBe(false);

    const {
      migrationFeeOption: _option,
      migrationFeePercentage: _fee,
      creatorMigrationFeePercentage: _creatorFee,
      migratedCollectFeeMode: _mode,
      migratedDynamicFee: _dynamic,
      migratedPoolFeeBps: _bps,
      migratedPoolBaseFeeMode: _baseMode,
      dammV2Config: _damm,
      ...legacy
    } = expected;
    expect(
      compareDeploymentReadback({
        expected: legacy,
        canonicalConfig: canonical,
        fingerprint,
        identity,
        snapshot,
        chain: { ...chain, migrationFeeOption: 3 },
      }).checks.fingerprint,
    ).toBe(true);
  });
});

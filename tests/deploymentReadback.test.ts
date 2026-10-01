import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compareDeploymentReadback,
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
});

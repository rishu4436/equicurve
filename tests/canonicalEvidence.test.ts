import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("canonical Journey evidence", () => {
  const doc = read("docs/canonical-evidence.md");
  const manifest = JSON.parse(read("demo-evidence/public-devnet/manifest.json")) as {
    pool: string;
    fingerprint: string;
    transaction: string;
    migrationQuoteThresholdAtoms: string;
  };
  const review = JSON.parse(read("demo-evidence/local-validator/policy-review.json")) as {
    search: { candidateCount: number };
    designed: { retailProgress: number; configFingerprint: string; profileName: string };
  };
  const catalog = JSON.parse(read("src/lib/registry/publicDeployments.json")) as Array<{
    pool: string;
    fingerprint: string;
    constraintsPassed: boolean;
    constraintPolicy?: unknown;
    checks: { fingerprint: boolean; poolConfiguration: boolean; migrationThreshold: boolean; readback: boolean };
  }>;
  const journey = catalog.find((row) => row.pool === manifest.pool);

  it("follows the thirteen steps in order", () => {
    const steps = [
      "## 01 Issuer brief",
      "## 02 Requested constraints",
      "## 03 Search coverage",
      "## 04 Infeasible result",
      "## 05 Explicit constraint relaxation",
      "## 06 Resulting candidate",
      "## 07 Fingerprint",
      "## 08 Wallet authorization",
      "## 09 Create transaction",
      "## 10 On-chain readback",
      "## 11 Registry attestation",
      "## 12 Robustness report",
      "## 13 Final verification",
    ];
    let at = 0;
    for (const step of steps) {
      const next = doc.indexOf(step, at);
      expect(next).toBeGreaterThan(at - 1);
      at = next + step.length;
    }
  });

  it("cites the deployed Journey proof and does not relabel the tradeoff", () => {
    expect(journey).toBeTruthy();
    expect(doc).toContain(manifest.pool);
    expect(doc).toContain(manifest.transaction);
    expect(doc).toContain(manifest.fingerprint);
    expect(doc).toContain(manifest.migrationQuoteThresholdAtoms);
    expect(doc).toContain(review.designed.profileName);
    expect(review.designed.retailProgress).toBe(0.0384);
    expect(doc).toContain("0.0384");
    expect(review.search.candidateCount).toBe(20);
    expect(doc).toContain("no robustness score");
    expect(doc).toContain("did not record an accepted relaxation");
    expect(journey?.constraintsPassed).toBe(false);
    expect(journey?.constraintPolicy).toBeUndefined();
    expect(journey?.checks).toEqual({
      fingerprint: true,
      poolConfiguration: true,
      migrationThreshold: true,
      readback: true,
    });
    expect(doc).toContain("d44dbb02bb2d68ef");
    expect(review.designed.configFingerprint).toBe(manifest.fingerprint);
  });
});
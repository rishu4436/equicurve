import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JOURNEY_PROOF, JOURNEY_READBACK } from "../src/lib/home/journeyProof";

const root = resolve(__dirname, "..");

function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

describe("homepage Journey proof", () => {
  const sources = ["src/app/page.tsx", "src/components/home/JourneyProofCard.tsx", "src/lib/home/journeyProof.ts"]
    .map(read)
    .join("\n");

  it("uses the deployed Journey fingerprint and the infeasible search", () => {
    expect(JOURNEY_PROOF.fingerprint).toBe("16ac1e49b68f4a4c");
    expect(JOURNEY_PROOF.pool).toBe("Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF");
    expect(JOURNEY_PROOF.evaluated).toBe("20");
    expect(JOURNEY_PROOF.feasible).toBe("0");
    expect(JOURNEY_PROOF.profile).toBe("Exponential · 3×");
    expect(JOURNEY_PROOF.whaleLimit).toBe("≤ 1,800 bps");
    expect(JOURNEY_PROOF.retailFill).toBe("3.84%");
    expect(JOURNEY_PROOF.retailMinimum).toBe("≥ 25%");
    expect(JOURNEY_READBACK).toEqual([
      "Simulated",
      "Config signed on devnet",
      "Deployed",
      "Readback matched",
    ]);
  });

  it("does not claim the search found one feasible design", () => {
    expect(sources).toContain("16ac1e49b68f4a4c");
    expect(sources).toContain("Constraints not met");
    expect(sources).not.toContain("19 rejected");
    expect(sources).not.toContain("22%");
    expect(sources).not.toContain("d44dbb02bb2d68ef");
  });
});

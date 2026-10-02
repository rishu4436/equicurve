/**
 * Recorded public-devnet Journey deployment.
 * Source: docs/canonical-evidence.md and demo-evidence/public-devnet.
 * A fresh search of the same brief can fingerprint differently.
 * This panel does not describe that later hash.
 */
export const JOURNEY_PROOF = {
  pool: "Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF",
  policyId: "EQ-af7ef6d94314",
  raise: "100 SOL",
  typical: "0.20 SOL",
  participants: "20",
  whaleLimit: "≤ 1,800 bps",
  retailMinimum: "≥ 25%",
  concentrationLimit: "≤ 55%",
  evaluated: "20",
  feasible: "0",
  profile: "Exponential · 3×",
  retailFill: "3.84%",
  retailEditor: "3.8%",
  openingBps: "26 bps",
  whaleSampleBps: "214 bps",
  fingerprint: "16ac1e49b68f4a4c",
} as const;

export const JOURNEY_READBACK = [
  "Simulated",
  "Config signed on devnet",
  "Deployed",
  "Readback matched",
] as const;

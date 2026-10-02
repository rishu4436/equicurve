import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AssetKind, MarketObjective } from "@/lib/market/types";

export type SavedBriefFile = {
  label: string;
  clusterLabel: string;
  clusterNote: string;
  rpc: string;
  brief: {
    asset: AssetKind;
    objective: MarketObjective;
    quote: "SOL" | "USDC";
    targetRaise: string;
    typicalTrade: string;
    participants: number;
    totalSupply: number;
    creatorPct: number;
    lpLockPct: number;
    antiSniper: boolean;
    stressPaths: number;
    seed: number;
  };
  /**
   * When true, a search with no feasible row is rerun under the inspection proposal.
   * --send refuses an unresolved search unless this is set. Existing proofs leave it unset.
   */
  acceptRelaxation?: boolean;
  launch: {
    name: string;
    symbol: string;
    uri: string;
    transferProfile: "open-spl" | "token-2022" | "transfer-hook";
    mintRenounce: boolean;
    seedBuyAmount: string;
    thesis?: string;
    sector?: "Equity" | "RWA" | "Fund" | "Private Co" | "Other";
  };
  /** Present when this file pins a previously recorded search. */
  expect?: {
    candidateCount: number;
    feasibleCount: number;
    profileId: string;
    profileName: string;
    configFingerprint: string;
    policyId: string;
    seed: number;
    openingBuyImpactBps: number;
    whaleImpactBps: number;
    stressGraduationRate: number;
    stressPaths: number;
    metadataUri: string;
    seedBuyAmount: string;
  };
};

export type PolicyShape = {
  policyId: string;
  seed: number;
  candidates: { feasible: boolean }[];
  chosen: {
    profileId: string;
    profileName: string;
    configFingerprint: string;
    stressGraduationRate: number;
    stressPaths: number;
    reference: { impactBps: number };
    scenarios: { id: string; largestBuyImpactBps: number }[];
  };
};

export function loadBriefAt(path: string): SavedBriefFile {
  const raw = readFileSync(path, "utf8");
  const file = JSON.parse(raw) as SavedBriefFile;
  if (!file.brief || !file.launch) {
    throw new Error(`Saved brief ${path} is missing brief or launch. Refusing to continue.`);
  }
  if (file.expect && file.launch.uri !== file.expect.metadataUri) {
    throw new Error(
      `Saved brief metadata URI (${JSON.stringify(file.launch.uri)}) does not match expect.metadataUri (${JSON.stringify(file.expect.metadataUri)}). Refusing to substitute a URI.`,
    );
  }
  if (file.expect && file.launch.seedBuyAmount !== file.expect.seedBuyAmount) {
    throw new Error(
      `Saved brief seed buy (${JSON.stringify(file.launch.seedBuyAmount)}) does not match expect.seedBuyAmount. Refusing to substitute a seed buy.`,
    );
  }
  if (!file.launch.uri.startsWith("https://")) {
    throw new Error("Saved brief metadata URI must be an https URL. Refusing to inline a data URI.");
  }
  return file;
}

export function loadSavedBrief(root: string): SavedBriefFile {
  return loadBriefAt(resolve(root, "scripts/demo/local-brief.json"));
}

/** Differences between a fresh search and the pinned expect block. Empty means the selected design is the saved one. */
export function expectMismatches(
  policy: PolicyShape,
  expect: NonNullable<SavedBriefFile["expect"]>,
): string[] {
  const whale = policy.chosen.scenarios.find((item) => item.id === "whale");
  const feasible = policy.candidates.filter((row) => row.feasible).length;
  const mismatches: string[] = [];
  const check = (name: string, actual: unknown, expected: unknown) => {
    if (name === "configFingerprint" && typeof actual === "string" && typeof expected === "string") {
      if ((expected.length === 16 || expected.length === 32) && /^[0-9a-f]+$/.test(expected) && actual.startsWith(expected)) return;
    }
    if (actual !== expected) mismatches.push(`${name}: search returned ${JSON.stringify(actual)}, saved brief expects ${JSON.stringify(expected)}`);
  };
  check("candidateCount", policy.candidates.length, expect.candidateCount);
  check("feasibleCount", feasible, expect.feasibleCount);
  check("profileId", policy.chosen.profileId, expect.profileId);
  check("profileName", policy.chosen.profileName, expect.profileName);
  check("configFingerprint", policy.chosen.configFingerprint, expect.configFingerprint);
  check("policyId", policy.policyId, expect.policyId);
  check("seed", policy.seed, expect.seed);
  check("openingBuyImpactBps", policy.chosen.reference.impactBps, expect.openingBuyImpactBps);
  check("whaleImpactBps", whale?.largestBuyImpactBps, expect.whaleImpactBps);
  check("stressGraduationRate", policy.chosen.stressGraduationRate, expect.stressGraduationRate);
  check("stressPaths", policy.chosen.stressPaths, expect.stressPaths);
  return mismatches;
}

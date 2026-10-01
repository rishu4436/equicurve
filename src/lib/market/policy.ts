import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { formatAtomsExact, parseUiAmount } from "@/lib/amounts";
import {
  buildPresetConfig,
  FEE_BY_PRESET,
  getPreset,
  validateEquiCurveConfig,
} from "@/lib/dbc/presets";
import type { PresetId } from "@/lib/dbc/types";
import { EquiCurveError } from "@/lib/errors";
import { openBook } from "./book";
import { namedScenarios, referenceBuy, stressPaths } from "./scenarios";
import { objectiveLabel, scoreCandidate } from "./score";
import type {
  AssetKind,
  CandidateReport,
  LaunchBrief,
  LaunchPolicy,
  MarketProfileId,
  PolicyRecipe,
} from "./types";

const ASSETS = new Set<AssetKind>([
  "tokenized-equity",
  "private-company",
  "commodity",
  "rwa",
  "pre-launch",
  "ai-agent",
  "community",
  "speculative",
]);

const OBJECTIVES = new Set<LaunchBrief["objective"]>([
  "stable",
  "controlled-discovery",
  "participation",
  "fast-graduation",
  "long-runway",
  "whale-protection",
]);

const PROFILES: { id: MarketProfileId; name: string; multiple: number; presetId: PresetId }[] = [
  { id: "stable", name: "Stable", multiple: 3, presetId: "equity" },
  { id: "controlled", name: "Controlled discovery", multiple: 8, presetId: "flat" },
  { id: "participation", name: "Participation", multiple: 15, presetId: "flat" },
  { id: "fast", name: "Fast graduation", multiple: 5, presetId: "short" },
  { id: "runway", name: "Long runway", multiple: 40, presetId: "long" },
  { id: "protected", name: "Whale protection", multiple: 12, presetId: "exponential" },
];

const DEFAULT_SUPPLY = 1_000_000_000;
const OBSERVED_NOTE =
  "No live launches are attached. Every score on this policy comes from the simulator.";

function quoteDecimals(quote: LaunchBrief["quote"]): 6 | 9 {
  return quote === "USDC" ? 6 : 9;
}

function roundCap(n: number): number {
  if (!(n > 0) || !Number.isFinite(n)) {
    throw new EquiCurveError("Market cap search produced a non-positive cap.", "VALIDATION");
  }
  const p = 10 ** (6 - Math.floor(Math.log10(n)) - 1);
  return Math.round(n * p) / p;
}

type ParsedBrief = {
  brief: LaunchBrief;
  targetAtoms: bigint;
  typicalAtoms: bigint;
  decimals: 6 | 9;
  supply: number;
  paths: number;
};

export function parseBrief(input: LaunchBrief): ParsedBrief {
  if (!ASSETS.has(input.asset)) {
    throw new EquiCurveError("Unknown asset kind.", "VALIDATION");
  }
  if (!OBJECTIVES.has(input.objective)) {
    throw new EquiCurveError("Unknown market objective.", "VALIDATION");
  }
  if (input.quote !== "SOL" && input.quote !== "USDC") {
    throw new EquiCurveError("Quote must be SOL or USDC.", "VALIDATION");
  }
  if (!Number.isInteger(input.participants) || input.participants < 1 || input.participants > 1_000_000) {
    throw new EquiCurveError("Participants must be a whole number from 1 to 1,000,000.", "VALIDATION");
  }
  const supply = input.totalSupply ?? DEFAULT_SUPPLY;
  if (!Number.isInteger(supply) || supply < 1 || supply > 1_000_000_000_000) {
    throw new EquiCurveError("Total supply must be a whole number from 1 to 1e12.", "VALIDATION");
  }
  const paths = input.stressPaths ?? 64;
  if (!Number.isInteger(paths) || paths < 1 || paths > 5_000) {
    throw new EquiCurveError("Stress paths must be a whole number from 1 to 5,000.", "VALIDATION");
  }
  const decimals = quoteDecimals(input.quote);
  let targetAtoms: bigint;
  let typicalAtoms: bigint;
  try {
    targetAtoms = parseUiAmount(input.targetRaise, decimals);
    typicalAtoms = parseUiAmount(input.typicalTrade, decimals);
  } catch (e) {
    throw new EquiCurveError(e instanceof Error ? e.message : "Invalid amount.", "VALIDATION", e);
  }
  if (typicalAtoms > targetAtoms * 1_000n) {
    throw new EquiCurveError("Typical trade is more than 1,000× the target raise.", "VALIDATION");
  }
  return { brief: { ...input, totalSupply: supply, stressPaths: paths }, targetAtoms, typicalAtoms, decimals, supply, paths };
}

function thresholdOf(cfg: ConfigParameters): bigint {
  return BigInt((cfg as { migrationQuoteThreshold: { toString(): string } }).migrationQuoteThreshold.toString());
}

function buildAt(
  presetId: PresetId,
  decimals: 6 | 9,
  supply: number,
  initial: number,
  migration: number,
): ConfigParameters | null {
  try {
    const cfg = buildPresetConfig(presetId, {
      quoteDecimals: decimals,
      totalTokenSupply: supply,
      marketCaps: { initial, migration },
      lpLockPct: 100,
    });
    if (validateEquiCurveConfig(cfg).length > 0) return null;
    return cfg;
  } catch {
    return null;
  }
}

function searchCaps(args: {
  presetId: PresetId;
  multiple: number;
  decimals: 6 | 9;
  supply: number;
  targetAtoms: bigint;
  targetUi: number;
}): { initial: number; migration: number; threshold: bigint } {
  const { presetId, multiple, decimals, supply, targetAtoms, targetUi } = args;
  let lo = Math.max(targetUi * 0.05, 1e-4);
  let hi = Math.max(targetUi * 40, lo * 4);
  const evalAt = (migration: number) => {
    const mig = roundCap(migration);
    const initial = roundCap(mig / multiple);
    if (!(mig > initial)) return null;
    const cfg = buildAt(presetId, decimals, supply, initial, mig);
    if (!cfg) return null;
    return { initial, migration: mig, threshold: thresholdOf(cfg) };
  };
  for (let expand = 0; expand < 6; expand++) {
    const low = evalAt(lo);
    const high = evalAt(hi);
    if (low && low.threshold > targetAtoms) lo /= 4;
    else if (high && high.threshold < targetAtoms) hi *= 4;
    else break;
  }
  let best = evalAt(lo) ?? evalAt(hi);
  if (!best) {
    throw new EquiCurveError(`Could not build a ${presetId} curve for this raise.`, "SDK");
  }
  for (let i = 0; i < 24; i++) {
    const mid = evalAt((lo + hi) / 2);
    if (!mid) {
      lo = (lo + hi) / 2;
      continue;
    }
    const better = absGap(mid.threshold, targetAtoms) < absGap(best.threshold, targetAtoms);
    if (better) best = mid;
    if (mid.threshold < targetAtoms) lo = (lo + hi) / 2;
    else hi = (lo + hi) / 2;
  }
  return best;
}

function absGap(threshold: bigint, target: bigint): bigint {
  return threshold >= target ? threshold - target : target - threshold;
}

function gapFraction(threshold: bigint, target: bigint): number {
  if (target === 0n) return 1;
  const gap = absGap(threshold, target);
  return Number((gap * 1_000_000n) / target) / 1_000_000;
}

function evaluateProfile(parsed: ParsedBrief, profile: (typeof PROFILES)[number]): CandidateReport {
  const targetUi = Number(parsed.targetAtoms) / 10 ** parsed.decimals;
  const caps = searchCaps({
    presetId: profile.presetId,
    multiple: profile.multiple,
    decimals: parsed.decimals,
    supply: parsed.supply,
    targetAtoms: parsed.targetAtoms,
    targetUi,
  });
  const cfg = buildAt(profile.presetId, parsed.decimals, parsed.supply, caps.initial, caps.migration);
  if (!cfg) {
    throw new EquiCurveError(`Curve build failed for ${profile.name}.`, "SDK");
  }
  const book = openBook(cfg, parsed.decimals);
  const preset = getPreset(profile.presetId);
  const fee = FEE_BY_PRESET[profile.presetId];
  const built = cfg as { creatorTradingFeePercentage: number; partnerPermanentLockedLiquidityPercentage: number };
  const recipe: PolicyRecipe = {
    presetId: profile.presetId,
    quote: parsed.brief.quote,
    initialMarketCap: caps.initial,
    migrationMarketCap: caps.migration,
    totalSupply: parsed.supply,
    creatorTradingFeePercentage: built.creatorTradingFeePercentage,
    lpLockPct: built.partnerPermanentLockedLiquidityPercentage,
  };
  const scenarios = namedScenarios({
    book,
    typicalAtoms: parsed.typicalAtoms,
    participants: parsed.brief.participants,
    feeDurationSec: fee.totalDuration,
  });
  const reference = referenceBuy(book, parsed.typicalAtoms);
  const stress = stressPaths({
    book,
    typicalAtoms: parsed.typicalAtoms,
    feeDurationSec: fee.totalDuration,
    paths: parsed.paths,
  });
  const fit = scoreCandidate(parsed.brief.objective, reference.impactBps, scenarios);
  const miss = gapFraction(book.threshold, parsed.targetAtoms);
  const score = Math.max(0, Math.round((fit - Math.min(30, miss * 100)) * 100) / 100);
  return {
    profileId: profile.id,
    profileName: profile.name,
    recipe,
    thresholdAtoms: book.threshold.toString(10),
    thresholdGap: miss,
    feeLabel: preset.feeLabel,
    priceMultiple: profile.multiple,
    reference,
    scenarios,
    stressGraduationRate: stress.graduationRate,
    stressPaths: stress.paths,
    stressMedianProgress: stress.medianProgress,
    score,
    dynamicFeeModeled: !fee.dynamicFeeEnabled,
  };
}

function whyLines(parsed: ParsedBrief, chosen: CandidateReport, next: CandidateReport | undefined): string[] {
  const quote = parsed.brief.quote;
  const threshold = formatAtomsExact(chosen.thresholdAtoms, parsed.decimals);
  const retail = chosen.scenarios.find((s) => s.id === "retail");
  const whale = chosen.scenarios.find((s) => s.id === "whale");
  const lines = [
    next
      ? `${chosen.profileName} scored ${chosen.score} for ${objectiveLabel(parsed.brief.objective)}. Next was ${next.profileName} at ${next.score}.`
      : `${chosen.profileName} scored ${chosen.score} for ${objectiveLabel(parsed.brief.objective)}.`,
    `A typical buy of ${parsed.brief.typicalTrade} ${quote} moves the opening price by ${chosen.reference.impactBps} bps.`,
    `Graduation threshold is ${threshold} ${quote}. Traders pay more than that: the fee is taken before quote is counted as raised.`,
  ];
  if (retail) {
    lines.push(
      retail.graduated
        ? "The retail sample reaches the graduation threshold."
        : `The retail sample fills ${Math.round(retail.progress * 1000) / 10}% of the threshold.`,
    );
  }
  if (whale) {
    lines.push(`The largest buy in the whale sample moves the price by ${whale.largestBuyImpactBps} bps.`);
  }
  lines.push(
    `${chosen.stressPaths} synthetic paths reached graduation ${Math.round(chosen.stressGraduationRate * 1000) / 10}% of the time. That is a stress test, not a probability of a real launch.`,
  );
  return lines;
}

export function designPolicy(input: LaunchBrief): LaunchPolicy {
  const parsed = parseBrief(input);
  const candidates = PROFILES.map((profile) => evaluateProfile(parsed, profile)).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.thresholdGap - b.thresholdGap;
  });
  const chosen = candidates[0];
  if (!chosen) {
    throw new EquiCurveError("No curve could be designed for this brief.", "SDK");
  }
  const alternatives = candidates.slice(1);
  const limits = [
    "Order flow is synthetic. It is not a prediction of who will trade or what the price will be.",
    OBSERVED_NOTE,
  ];
  if (candidates.some((c) => c.recipe.presetId === "exponential" || c.recipe.presetId === "equity")) {
    const dynamic = candidates.filter((c) => FEE_BY_PRESET[c.recipe.presetId].dynamicFeeEnabled);
    if (dynamic.length > 0) {
      limits.push(
        "Dynamic fee is not replayed. Volatility stays at zero, so only the scheduled base fee is charged.",
      );
    }
  }
  if (chosen.thresholdGap > 0.02) {
    limits.push(
      `The closest threshold for ${chosen.profileName} is ${(chosen.thresholdGap * 100).toFixed(2)}% away from the requested raise.`,
    );
  }
  if (parsed.brief.participants > 64) {
    limits.push("Retail and sell-pressure scenarios run at most 64 typical orders and say so on the report.");
  }
  return {
    brief: parsed.brief,
    targetRaiseAtoms: parsed.targetAtoms.toString(10),
    chosen,
    alternatives,
    why: whyLines(parsed, chosen, alternatives[0]),
    limits,
    observedLaunches: null,
    observedNote: OBSERVED_NOTE,
  };
}

/** Rebuild the config a policy scored, through the same builder Create uses. */
export function materializeRecipe(recipe: PolicyRecipe): ConfigParameters {
  return buildPresetConfig(recipe.presetId, {
    quoteDecimals: quoteDecimals(recipe.quote),
    marketCaps: { initial: recipe.initialMarketCap, migration: recipe.migrationMarketCap },
    totalTokenSupply: recipe.totalSupply,
    creatorTradingFeePercentage: recipe.creatorTradingFeePercentage,
    lpLockPct: recipe.lpLockPct,
  });
}

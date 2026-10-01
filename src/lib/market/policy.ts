import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { formatAtomsExact, parseUiAmount } from "@/lib/amounts";
import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { launchCurveConfig } from "@/lib/dbc/create";
import {
  FEE_BY_PRESET,
  getPreset,
  MIN_LP_LOCK_PCT,
  validateEquiCurveConfig,
} from "@/lib/dbc/presets";
import type { PresetId } from "@/lib/dbc/types";
import { EquiCurveError } from "@/lib/errors";
import { openBook } from "./book";
import { runCohortStress } from "./cohorts";
import { sha256Hex } from "./hash";
import { constraintsFor, multiplesIn, refineMultiples, scenarioAssumptions, type DesignConstraints } from "./constraints";
import { objectivePriorities, paretoFrontier, prefer, type FrontierMetrics } from "./pareto";
import { namedScenarios, referenceBuy } from "./scenarios";
import { objectiveLabel } from "./score";
import type {
  AssetKind,
  CandidateReport,
  DynamicFeeStatus,
  LaunchBrief,
  LaunchPolicy,
  PolicyRecipe,
  SearchCoverage,
} from "./types";

export const MARKET_MODEL_VERSION = "0.3.0";
/** Installed @meteora-ag/dynamic-bonding-curve-sdk. A test locks this to package.json. */
export const DBC_SDK_VERSION = "1.5.12";
const DEFAULT_SEED = 0xec0c;
const DEFAULT_SUPPLY = 1_000_000_000;
const DEFAULT_CREATOR_PCT = 70;
const DEFAULT_LP_LOCK = 100;
const FEE_PRESETS: PresetId[] = ["short", "flat", "exponential", "long", "equity"];

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

function atomsToNumber(atoms: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  const whole = atoms / base;
  const frac = atoms % base;
  return Number(whole) + Number(frac) / 10 ** decimals;
}

type ParsedBrief = {
  brief: LaunchBrief;
  targetAtoms: bigint;
  typicalAtoms: bigint;
  decimals: 6 | 9;
  supply: number;
  paths: number;
  seed: number;
  creatorPct: number;
  lpLockPct: number;
  antiSniper: boolean;
};

export function parseBrief(input: LaunchBrief): ParsedBrief {
  if (!ASSETS.has(input.asset)) throw new EquiCurveError("Unknown asset kind.", "VALIDATION");
  if (!OBJECTIVES.has(input.objective)) throw new EquiCurveError("Unknown market objective.", "VALIDATION");
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
  const paths = input.stressPaths ?? 16;
  if (!Number.isInteger(paths) || paths < 1 || paths > 5_000) {
    throw new EquiCurveError("Stress paths must be a whole number from 1 to 5,000.", "VALIDATION");
  }
  const creatorPct = input.creatorPct ?? DEFAULT_CREATOR_PCT;
  if (!Number.isInteger(creatorPct) || creatorPct < 0 || creatorPct > 100) {
    throw new EquiCurveError("Creator fee share must be a whole number from 0 to 100.", "VALIDATION");
  }
  const lpLockPct = input.lpLockPct ?? DEFAULT_LP_LOCK;
  if (!Number.isInteger(lpLockPct) || lpLockPct < MIN_LP_LOCK_PCT || lpLockPct > 100) {
    throw new EquiCurveError(`LP lock must be a whole number from ${MIN_LP_LOCK_PCT} to 100.`, "VALIDATION");
  }
  const seed = input.seed ?? DEFAULT_SEED;
  if (!Number.isInteger(seed) || seed < 0) {
    throw new EquiCurveError("Seed must be a non-negative integer.", "VALIDATION");
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
  return {
    brief: {
      ...input,
      totalSupply: supply,
      stressPaths: paths,
      creatorPct,
      lpLockPct,
      antiSniper: input.antiSniper ?? true,
      seed,
    },
    targetAtoms,
    typicalAtoms,
    decimals,
    supply,
    paths,
    seed,
    creatorPct,
    lpLockPct,
    antiSniper: input.antiSniper ?? true,
  };
}

function thresholdOf(cfg: ConfigParameters): bigint {
  return BigInt((cfg as { migrationQuoteThreshold: { toString(): string } }).migrationQuoteThreshold.toString());
}

function buildAt(args: {
  presetId: PresetId;
  decimals: 6 | 9;
  supply: number;
  initial: number;
  migration: number;
  creatorPct: number;
  lpLockPct: number;
  antiSniper: boolean;
}): ConfigParameters | null {
  try {
    const cfg = launchCurveConfig({
      presetId: args.presetId,
      totalSupply: args.supply,
      creatorTradingFeePercentage: args.creatorPct,
      lpLockPct: args.lpLockPct,
      mintRenounce: true,
      antiSniper: args.antiSniper,
      quoteDecimals: args.decimals,
      transferProfile: "open-spl",
      marketCaps: { initial: args.initial, migration: args.migration },
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
  creatorPct: number;
  lpLockPct: number;
  antiSniper: boolean;
}): { initial: number; migration: number; threshold: bigint } | null {
  const { presetId, multiple, decimals, supply, targetAtoms, targetUi, creatorPct, lpLockPct, antiSniper } = args;
  let lo = Math.max(targetUi * 0.05, 1e-4);
  let hi = Math.max(targetUi * 40, lo * 4);
  const evalAt = (migration: number) => {
    const mig = roundCap(migration);
    const initial = roundCap(mig / multiple);
    if (!(mig > initial)) return null;
    const cfg = buildAt({ presetId, decimals, supply, initial, migration: mig, creatorPct, lpLockPct, antiSniper });
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
  if (!best) return null;
  for (let i = 0; i < 18; i++) {
    const midPoint = (lo + hi) / 2;
    const mid = evalAt(midPoint);
    if (!mid) {
      lo = midPoint;
      continue;
    }
    if (absGap(mid.threshold, targetAtoms) < absGap(best.threshold, targetAtoms)) best = mid;
    if (mid.threshold < targetAtoms) lo = midPoint;
    else hi = midPoint;
  }
  return best;
}

function absGap(threshold: bigint, target: bigint): bigint {
  return threshold >= target ? threshold - target : target - threshold;
}

function gapFraction(threshold: bigint, target: bigint): number {
  if (target === 0n) return 1;
  return Number((absGap(threshold, target) * 1_000_000n) / target) / 1_000_000;
}

function feeStatus(book: { dynamicFee: unknown; dynamicFeeUnreadable: boolean }): DynamicFeeStatus {
  if (book.dynamicFee) return "simulated";
  if (book.dynamicFeeUnreadable) return "base-only";
  return "not-used";
}

function scenarioOf(c: CandidateReport, id: CandidateReport["scenarios"][number]["id"]) {
  return c.scenarios.find((s) => s.id === id);
}

function metricsOf(c: CandidateReport): FrontierMetrics {
  return {
    referenceImpactBps: c.reference.impactBps,
    whaleImpactBps: scenarioOf(c, "whale")?.largestBuyImpactBps ?? 0,
    drawdownBps: scenarioOf(c, "sell-pressure")?.drawdownBps ?? 0,
    retailProgress: scenarioOf(c, "retail")?.progress ?? 0,
    lateProgress: scenarioOf(c, "late")?.progress ?? 0,
    stressGraduation: c.stressGraduationRate,
  };
}

function violations(c: CandidateReport, limits: DesignConstraints): string[] {
  const m = metricsOf(c);
  const out: string[] = [];
  if (c.thresholdGap > limits.maxThresholdGap) {
    out.push(`threshold is ${(c.thresholdGap * 100).toFixed(2)}% from the raise`);
  }
  if (m.referenceImpactBps > limits.maxReferenceImpactBps) {
    out.push(`typical buy moves price ${m.referenceImpactBps} bps`);
  }
  if (m.whaleImpactBps > limits.maxWhaleImpactBps) {
    out.push(`whale buy moves price ${m.whaleImpactBps} bps`);
  }
  const retail = scenarioOf(c, "retail");
  if (retail && retail.concentration > limits.maxConcentration) {
    out.push(`largest buy is ${Math.round(retail.concentration * 100)}% of filled quote`);
  }
  if (m.retailProgress < limits.minRetailProgress) {
    out.push(`retail sample fills ${Math.round(m.retailProgress * 100)}%`);
  }
  return out;
}

function evaluateOne(parsed: ParsedBrief, presetId: PresetId, multiple: number): CandidateReport | null {
  const targetUi = atomsToNumber(parsed.targetAtoms, parsed.decimals);
  const caps = searchCaps({
    presetId,
    multiple,
    decimals: parsed.decimals,
    supply: parsed.supply,
    targetAtoms: parsed.targetAtoms,
    targetUi,
    creatorPct: parsed.creatorPct,
    lpLockPct: parsed.lpLockPct,
    antiSniper: parsed.antiSniper,
  });
  if (!caps) return null;
  const cfg = buildAt({
    presetId,
    decimals: parsed.decimals,
    supply: parsed.supply,
    initial: caps.initial,
    migration: caps.migration,
    creatorPct: parsed.creatorPct,
    lpLockPct: parsed.lpLockPct,
    antiSniper: parsed.antiSniper,
  });
  if (!cfg) return null;
  const book = openBook(cfg, parsed.decimals);
  const preset = getPreset(presetId);
  const fee = FEE_BY_PRESET[presetId];
  const built = cfg as { creatorTradingFeePercentage: number; partnerPermanentLockedLiquidityPercentage: number };
  const recipe: PolicyRecipe = {
    presetId,
    quote: parsed.brief.quote,
    initialMarketCap: caps.initial,
    migrationMarketCap: caps.migration,
    totalSupply: parsed.supply,
    creatorTradingFeePercentage: built.creatorTradingFeePercentage,
    lpLockPct: built.partnerPermanentLockedLiquidityPercentage,
    antiSniper: parsed.antiSniper,
  };
  const assumptions = scenarioAssumptions(parsed.brief.asset);
  const scenarios = namedScenarios({
    book,
    typicalAtoms: parsed.typicalAtoms,
    participants: parsed.brief.participants,
    feeDurationSec: fee.totalDuration,
    asset: parsed.brief.asset,
  });
  const reference = referenceBuy(book, parsed.typicalAtoms);
  const stress = runCohortStress({
    book,
    typicalAtoms: parsed.typicalAtoms,
    feeDurationSec: fee.totalDuration,
    paths: parsed.paths,
    seed: parsed.seed,
    whaleHundredths: assumptions.cohortWhaleHundredths,
    participants: parsed.brief.participants,
  });
  const row: CandidateReport = {
    profileId: `${presetId}-${multiple}x`,
    profileName: `${preset.name} · ${multiple}×`,
    recipe,
    thresholdAtoms: book.threshold.toString(10),
    thresholdGap: gapFraction(book.threshold, parsed.targetAtoms),
    feeLabel: preset.feeLabel,
    priceMultiple: multiple,
    reference,
    scenarios,
    stressGraduationRate: stress.graduationRate,
    stressPaths: stress.paths,
    stressMedianProgress: stress.medianProgress,
    stressP10Progress: stress.p10Progress,
    stressWorstProgress: stress.worstProgress,
    configFingerprint: marketConfigFingerprint(cfg),
    score: 0,
    dynamicFeeStatus: feeStatus(book),
    feasible: true,
    rejected: [],
  };
  return row;
}

function identity(parsed: ParsedBrief): string {
  const b = parsed.brief;
  return [
    MARKET_MODEL_VERSION,
    DBC_SDK_VERSION,
    String(parsed.seed),
    b.asset,
    b.objective,
    b.quote,
    parsed.targetAtoms.toString(10),
    parsed.typicalAtoms.toString(10),
    String(b.participants),
    String(parsed.supply),
    String(parsed.creatorPct),
    String(parsed.lpLockPct),
    String(parsed.antiSniper),
    String(parsed.paths),
  ].join("|");
}

function sha(text: string): string {
  return sha256Hex(text).slice(0, 12);
}

/** Hash of the recipe that will be deployed. Timestamp is not an input. */
export function recipeConfigHash(recipe: PolicyRecipe): string {
  return sha(JSON.stringify(recipe));
}

function feeWords(status: DynamicFeeStatus): string {
  if (status === "simulated") return "Dynamic fee behavior was simulated.";
  if (status === "base-only") return "Dynamic fee behavior was only partially modeled.";
  return "Dynamic fee behavior was not used.";
}

function pct1(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function compareLine(chosen: CandidateReport, next: CandidateReport): string {
  const whaleA = scenarioOf(chosen, "whale")?.largestBuyImpactBps ?? 0;
  const whaleB = scenarioOf(next, "whale")?.largestBuyImpactBps ?? 0;
  const retailA = scenarioOf(chosen, "retail")?.progress ?? 0;
  const retailB = scenarioOf(next, "retail")?.progress ?? 0;
  const whale =
    whaleA < whaleB ? "lower whale impact" : whaleA > whaleB ? "higher whale impact" : "the same whale impact";
  const retail =
    retailA > retailB ? "faster retail progress" : retailA < retailB ? "slower retail progress" : "the same retail progress";
  return `Compared with ${next.profileName}, it had ${whale} and ${retail}.`;
}

function whyLines(
  parsed: ParsedBrief,
  chosen: CandidateReport,
  next: CandidateReport | undefined,
  priorities: string[],
  coverage: SearchCoverage,
): string[] {
  const quote = parsed.brief.quote;
  const assumptions = scenarioAssumptions(parsed.brief.asset);
  const gapPct = (chosen.thresholdGap * 100).toFixed(2);
  const threshold = formatAtomsExact(chosen.thresholdAtoms, parsed.decimals);
  const whale = scenarioOf(chosen, "whale");
  return [
    chosen.feasible
      ? "This design passed all five constraints."
      : `This design did not pass every constraint${chosen.rejected.length ? `: ${chosen.rejected.join("; ")}` : "."}`,
    `This is the preferred feasible design among ${coverage.candidateCount} candidates evaluated, for ${objectiveLabel(parsed.brief.objective)}. It is not a proof that no better curve exists.`,
    `Search range: presets ${coverage.presets.join(", ")} at price multiples ${coverage.multiples.join(", ")}. ${coverage.note}`,
    next ? compareLine(chosen, next) : "No other frontier point was available to compare.",
    `Preference order: ${priorities.join(", ")}.`,
    `The chosen threshold is ${gapPct}% away from your requested raise (${threshold} ${quote}). Creator fee share ${chosen.recipe.creatorTradingFeePercentage}% and LP lock ${chosen.recipe.lpLockPct}% are the values that will be deployed.`,
    feeWords(chosen.dynamicFeeStatus),
    `Typical impact is the opening buy of ${parsed.brief.typicalTrade} ${quote}: ${chosen.reference.impactBps} bps.`,
    `Whale impact uses a ${assumptions.whaleMultiple}× order, as five buys at launch${whale ? ` (${whale.largestBuyImpactBps} bps on this design)` : ""}.`,
    "Sell drawdown is the price move from the peak to the end of the sell-pressure path, not a reduction in the quote reserve.",
    "Retail fill is how far a capped sample moved toward the migration threshold. It is not a forecast of who will buy.",
    `${chosen.stressPaths} cohort paths, seed ${parsed.seed}: graduation ${pct1(chosen.stressGraduationRate)} is a simulated frequency, not a real-world probability. Median progress ${pct1(chosen.stressMedianProgress)}, 10th percentile ${pct1(chosen.stressP10Progress)}, worst path ${pct1(chosen.stressWorstProgress)}.`,
  ];
}

function promisingMultiples(rows: CandidateReport[], presets: PresetId[]): number[] {
  const feasible = rows.filter((row) => row.feasible);
  if (feasible.length > 0) return [...new Set(feasible.map((row) => row.priceMultiple))];
  const closest: number[] = [];
  for (const presetId of presets) {
    const ofPreset = rows.filter((row) => row.recipe.presetId === presetId);
    if (ofPreset.length === 0) continue;
    const best = ofPreset.reduce((a, b) => (a.thresholdGap <= b.thresholdGap ? a : b));
    closest.push(best.priceMultiple);
  }
  return [...new Set(closest)];
}

export function designPolicy(input: LaunchBrief): LaunchPolicy {
  const parsed = parseBrief(input);
  const limitsSpec = constraintsFor(parsed.brief.asset, parsed.brief.objective);
  const coarse = multiplesIn(limitsSpec);
  const rows: CandidateReport[] = [];
  const collect = (multiples: number[]) => {
    for (const presetId of FEE_PRESETS) {
      for (const multiple of multiples) {
        const row = evaluateOne(parsed, presetId, multiple);
        if (row) rows.push(row);
      }
    }
  };
  collect(coarse);
  if (rows.length === 0) {
    throw new EquiCurveError("No curve could be built for this brief.", "SDK");
  }
  const mark = () => {
    for (const row of rows) {
      row.rejected = violations(row, limitsSpec);
      row.feasible = row.rejected.length === 0;
    }
  };
  mark();
  const finer = refineMultiples(
    limitsSpec.multipleMin,
    limitsSpec.multipleMax,
    coarse,
    promisingMultiples(rows, FEE_PRESETS),
  );
  collect(finer);
  mark();
  const search: SearchCoverage = {
    stage: "coarse-to-fine",
    presets: [...FEE_PRESETS],
    multiples: [...new Set(rows.map((row) => row.priceMultiple))].sort((a, b) => a - b),
    candidateCount: rows.length,
    note: "Coarse anchors are the minimum, midpoint, and maximum of the permitted price-multiple range. One finer midpoint is then scored beside each promising anchor. This sample does not prove a global optimum.",
  };
  let pool = rows.filter((r) => r.feasible);
  const relaxed: string[] = [];
  if (pool.length === 0) {
    pool = rows.filter((r) => r.thresholdGap <= limitsSpec.maxThresholdGap);
    relaxed.push("Impact, concentration, and participation limits were relaxed because none of the curves passed them.");
  }
  if (pool.length === 0) {
    pool = [...rows].sort((a, b) => a.thresholdGap - b.thresholdGap).slice(0, 3);
    relaxed.push("No curve landed within 5% of the requested raise. The closest curves are shown.");
  }
  const frontier = paretoFrontier(pool, metricsOf);
  frontier.sort((a, b) => prefer(parsed.brief.objective, metricsOf(a), metricsOf(b)));
  frontier.forEach((row, i) => {
    row.score = Math.max(0, 100 - i);
  });
  const chosen = frontier[0];
  if (!chosen) throw new EquiCurveError("The frontier was empty.", "SDK");
  const alternatives = frontier.slice(1);
  const priorities = objectivePriorities(parsed.brief.objective);
  const limits = [
    "Order flow is synthetic. It is not a prediction of who will trade or what the price will be.",
    OBSERVED_NOTE,
    `Hard constraints come from the asset profile (${parsed.brief.asset}) and the objective (${parsed.brief.objective}).`,
    ...relaxed,
  ];
  if (rows.some((r) => r.dynamicFeeStatus === "base-only")) {
    limits.push("A dynamic fee was requested but its parameters could not be read, so that curve was scored on the base fee only.");
  }
  limits.push(
    `Cohort retail orders scale with the ${parsed.brief.participants} participants in the brief and are capped at 64. That is a representative sample, not one order per participant.`,
  );
  limits.push(
    "Named retail and sell-pressure scenarios also run at most 64 typical orders and say so on the report.",
  );
  limits.push(
    "The creator seed buy's first-swap minimum-fee exemption is not part of the market scenarios. Anti-sniper is still written on the config that deploys.",
  );
  if (chosen.dynamicFeeStatus === "simulated") {
    limits.push("The dynamic fee is replayed inside the simulator. It is a model of the program, not a quote from a live pool.");
  }
  const configHash = recipeConfigHash(chosen.recipe);
  return {
    version: 1,
    policyId: `EQ-${sha(identity(parsed))}`,
    modelVersion: MARKET_MODEL_VERSION,
    sdkVersion: DBC_SDK_VERSION,
    seed: parsed.seed,
    configHash,
    createdAt: new Date().toISOString(),
    brief: parsed.brief,
    targetRaiseAtoms: parsed.targetAtoms.toString(10),
    priorities,
    chosen,
    alternatives,
    candidates: [...frontier, ...rows.filter((r) => !frontier.includes(r))],
    why: whyLines(parsed, chosen, alternatives[0], priorities, search),
    limits,
    search,
    observedLaunches: null,
    observedNote: OBSERVED_NOTE,
  };
}

/** Rebuild the config a policy scored, through the same builder Create uses. */
export function materializeRecipe(recipe: PolicyRecipe): ConfigParameters {
  return launchCurveConfig({
    presetId: recipe.presetId,
    totalSupply: recipe.totalSupply,
    creatorTradingFeePercentage: recipe.creatorTradingFeePercentage,
    lpLockPct: recipe.lpLockPct,
    mintRenounce: true,
    antiSniper: recipe.antiSniper,
    quoteDecimals: quoteDecimals(recipe.quote),
    transferProfile: "open-spl",
    marketCaps: { initial: recipe.initialMarketCap, migration: recipe.migrationMarketCap },
  });
}

/** Compact record for the candidate the issuer deploys. Defaults to the frontier pick. */
export function toDesignedMarket(policy: LaunchPolicy, picked: CandidateReport = policy.chosen) {
  const retail = picked.scenarios.find((s) => s.id === "retail");
  const whale = picked.scenarios.find((s) => s.id === "whale");
  return {
    policyId: policy.policyId,
    modelVersion: policy.modelVersion,
    sdkVersion: policy.sdkVersion,
    seed: policy.seed,
    configHash: recipeConfigHash(picked.recipe),
    asset: policy.brief.asset,
    objective: policy.brief.objective,
    presetId: picked.recipe.presetId,
    thresholdAtoms: picked.thresholdAtoms,
    referenceImpactBps: picked.reference.impactBps,
    retailProgress: retail?.progress ?? 0,
    whaleImpactBps: whale?.largestBuyImpactBps ?? 0,
    stressGraduationRate: picked.stressGraduationRate,
    stressPaths: picked.stressPaths,
    stressP10Progress: picked.stressP10Progress,
    stressWorstProgress: picked.stressWorstProgress,
    configFingerprint: picked.configFingerprint,
  };
}

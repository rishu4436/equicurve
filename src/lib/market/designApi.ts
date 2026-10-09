import { z } from "zod";
import { assessRobustness, type RobustnessReport } from "./robustness";
import { canonicalMarketConfig, marketConfigFingerprint, migrationAttestation } from "@/lib/dbc/configFingerprint";
import { designPolicy, deploymentAllowed, materializeRecipe } from "./policy";
import type { CandidateReport, ConstraintBudget, LaunchBrief, LaunchPolicy } from "./types";
import { DEVELOPER_API_ENGINE_VERSION, DEVELOPER_API_FINGERPRINT_VERSION, DEVELOPER_API_SCHEMA_VERSION } from "./apiVersion";
import { getUsdcMint, WSOL_MINT } from "@/lib/constants";

export const DESIGN_API_ENGINE_VERSION = DEVELOPER_API_ENGINE_VERSION;
export const DESIGN_API_SCHEMA_VERSION = DEVELOPER_API_SCHEMA_VERSION;
export const DESIGN_API_FINGERPRINT_VERSION = DEVELOPER_API_FINGERPRINT_VERSION;

const decimal = z.union([
  z.string().trim().min(1).refine((value) => /^\d+(?:\.\d+)?$/.test(value), "Must be a decimal amount"),
  z.number().finite().refine((value) => Number.isSafeInteger(value * 1_000_000_000), "Use a decimal string for exact amounts"),
]).transform((value) => String(value));

const constraints = z.object({
  maxThresholdGap: z.number().finite(),
  maxReferenceImpactBps: z.number().finite(),
  maxWhaleImpactBps: z.number().finite(),
  maxConcentration: z.number().finite(),
  minRetailProgress: z.number().finite(),
}).strict().superRefine((value, ctx) => {
  if (value.maxThresholdGap < 0 || value.maxThresholdGap > 1) ctx.addIssue({ code: "custom", path: ["maxThresholdGap"], message: "Must be from 0 to 1" });
  if (value.maxReferenceImpactBps < 0) ctx.addIssue({ code: "custom", path: ["maxReferenceImpactBps"], message: "Must be zero or greater" });
  if (value.maxWhaleImpactBps < 0) ctx.addIssue({ code: "custom", path: ["maxWhaleImpactBps"], message: "Must be zero or greater" });
  if (value.maxConcentration < 0 || value.maxConcentration > 1) ctx.addIssue({ code: "custom", path: ["maxConcentration"], message: "Must be from 0 to 1" });
  if (value.minRetailProgress < 0 || value.minRetailProgress > 1) ctx.addIssue({ code: "custom", path: ["minRetailProgress"], message: "Must be from 0 to 1" });
});

export const designRequestSchema = z.object({
  schemaVersion: z.literal("1"),
  quote: z.enum(["SOL", "USDC"]),
  raiseTarget: decimal,
  typicalTrade: decimal,
  participants: z.number().int().min(1).max(1_000_000),
  objective: z.enum(["stable", "controlled-discovery", "participation", "fast-graduation", "long-runway", "whale-protection"]),
  market: z.object({
    asset: z.enum(["tokenized-equity", "private-company", "commodity", "rwa", "pre-launch", "ai-agent", "community", "speculative"]),
    totalSupply: z.number().int().min(1).optional(),
    creatorPct: z.number().int().min(0).max(100).optional(),
    lpLockPct: z.number().finite().min(0).max(100).optional(),
    antiSniper: z.boolean().optional(),
    stressPaths: z.number().int().min(1).max(5_000).optional(),
    seed: z.number().int().min(0).max(0x7fffffff).optional(),
  }).strict(),
  constraints: constraints,
  acceptedConstraints: constraints.optional(),
}).strict();

export type DesignApiRequest = z.infer<typeof designRequestSchema>;

export const selectedDesignReferenceSchema = z.object({
  schemaVersion: z.literal("1"),
  engineVersion: z.string().min(1),
  fingerprintVersion: z.string().min(1),
  designRequest: designRequestSchema,
  selection: z.object({
    candidateId: z.string().min(1).max(80),
    fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
  }).strict(),
}).strict();

export type SelectedDesignReference = z.infer<typeof selectedDesignReferenceSchema>;

export class DeveloperApiError extends Error {
  constructor(public readonly code: "DESIGN_MISMATCH" | "CANDIDATE_NOT_FOUND" | "FINGERPRINT_MISMATCH" | "ROBUSTNESS_FAILED" | "CONFIG_BUILD_FAILED", message: string, public readonly status = 400) {
    super(message);
    this.name = "DeveloperApiError";
  }
}

function briefFromRequest(input: DesignApiRequest): LaunchBrief {
  return {
    asset: input.market.asset,
    objective: input.objective,
    quote: input.quote,
    targetRaise: input.raiseTarget,
    typicalTrade: input.typicalTrade,
    participants: input.participants,
    totalSupply: input.market.totalSupply,
    creatorPct: input.market.creatorPct,
    lpLockPct: input.market.lpLockPct,
    antiSniper: input.market.antiSniper,
    stressPaths: input.market.stressPaths,
    seed: input.market.seed,
  };
}

function scenarioSummary(row: CandidateReport) {
  return row.scenarios.map((scenario) => ({
    id: scenario.id,
    progress: scenario.progress,
    graduated: scenario.graduated,
    largestBuyImpactBps: scenario.largestBuyImpactBps,
    endMoveBps: scenario.endMoveBps,
    drawdownBps: scenario.drawdownBps,
    concentration: scenario.concentration,
    quoteFilledAtoms: scenario.quoteFilledAtoms,
    quotePaidAtoms: scenario.quotePaidAtoms,
    feesAtoms: scenario.feesAtoms,
    ordersRun: scenario.ordersRun,
    ordersSkipped: scenario.ordersSkipped,
  }));
}

function candidateSummary(row: CandidateReport, frontier: Set<string>) {
  return {
    id: row.profileId,
    profile: row.profileName,
    preset: row.recipe.presetId,
    priceMultiple: row.priceMultiple,
    fingerprint: row.configFingerprint,
    feasible: row.feasible,
    pareto: frontier.has(row.profileId),
    score: row.score,
    rejected: [...row.rejected],
    thresholdAtoms: row.thresholdAtoms,
    referenceImpactBps: row.reference.impactBps,
    syntheticCohortGraduationFraction: row.stressGraduationRate,
    stressPaths: row.stressPaths,
    recipe: { ...row.recipe },
    scenarios: scenarioSummary(row),
  };
}

export function serializeDesign(policy: LaunchPolicy) {
  const frontier = new Set([policy.chosen, ...policy.alternatives].map((row) => row.profileId));
  const feasible = policy.candidates.filter((row) => row.feasible).length;
  return {
    ok: true as const,
    schemaVersion: DESIGN_API_SCHEMA_VERSION,
    engineVersion: DESIGN_API_ENGINE_VERSION,
    fingerprintVersion: DESIGN_API_FINGERPRINT_VERSION,
    result: {
      evaluated: policy.search.candidateCount,
      feasibleUnderRequestedConstraints: feasible,
      deploymentAllowedUnderAppliedConstraints: deploymentAllowed(policy),
      policyId: policy.policyId,
      configHash: policy.configHash,
      requestedConstraints: policy.negotiation.requested,
      acceptedConstraints: policy.negotiation.applied,
      negotiation: policy.negotiation,
      conflicts: [...policy.negotiation.blocking],
      preferred: candidateSummary(policy.chosen, frontier),
      paretoFrontier: policy.candidates.filter((row) => frontier.has(row.profileId)).map((row) => candidateSummary(row, frontier)),
      candidates: policy.candidates.map((row) => candidateSummary(row, frontier)),
      search: policy.search,
      brief: policy.brief,
      targetRaiseAtoms: policy.targetRaiseAtoms,
    },
  };
}

export function designFromApiRequest(input: DesignApiRequest) {
  const acceptedBudget = input.acceptedConstraints;
  return serializeDesign(designPolicy(briefFromRequest(input), {
    requestedBudget: input.constraints as ConstraintBudget,
    ...(acceptedBudget ? { acceptedBudget: acceptedBudget as ConstraintBudget } : {}),
  }));
}

/** Rebuilds the policy from the public request; never trusts a client candidate object. */
export function resolveSelectedDesign(reference: SelectedDesignReference) {
  if (reference.schemaVersion !== DESIGN_API_SCHEMA_VERSION || reference.engineVersion !== DESIGN_API_ENGINE_VERSION || reference.fingerprintVersion !== DESIGN_API_FINGERPRINT_VERSION) {
    throw new DeveloperApiError("DESIGN_MISMATCH", "Selected design reference version metadata does not match this API.", 409);
  }
  const policy = designPolicy(
    briefFromRequest(reference.designRequest),
    {
      requestedBudget: reference.designRequest.constraints as ConstraintBudget,
      ...(reference.designRequest.acceptedConstraints
        ? { acceptedBudget: reference.designRequest.acceptedConstraints as ConstraintBudget }
        : {}),
    },
  );
  const candidate = policy.candidates.find((row) => row.profileId === reference.selection.candidateId);
  if (!candidate) throw new DeveloperApiError("CANDIDATE_NOT_FOUND", "Selected candidate was not found in the server-computed design.");
  if (candidate.configFingerprint !== reference.selection.fingerprint) {
    throw new DeveloperApiError("FINGERPRINT_MISMATCH", "Selected candidate fingerprint does not match the server-computed design.", 409);
  }
  return { policy, candidate };
}

function serializeRobustness(report: RobustnessReport, policy: LaunchPolicy, candidate: CandidateReport) {
  return {
    ok: true as const,
    schemaVersion: DESIGN_API_SCHEMA_VERSION,
    engineVersion: DESIGN_API_ENGINE_VERSION,
    fingerprintVersion: DESIGN_API_FINGERPRINT_VERSION,
    design: {
      policyId: policy.policyId,
      candidateId: candidate.profileId,
      fingerprint: candidate.configFingerprint,
    },
    requestedConstraints: policy.negotiation.requested,
    acceptedConstraints: policy.negotiation.applied,
    robustnessModelVersion: policy.modelVersion,
    shockDefinitions: report.axes.map((axis) => ({ id: axis.id, label: axis.label, levels: ["minus", "base", "plus"], departures: axis.departures })),
    robustness: report,
    summary: {
      baseInside: report.baseInside,
      shockInsideCount: report.shockInsideCount,
      shockCount: report.shockCount,
      mostSensitive: report.mostSensitive,
      leastSensitive: report.leastSensitive,
      note: report.note,
    },
    provenance: "synthetic_assumption_shocks",
  };
}

export function robustnessFromReference(reference: SelectedDesignReference) {
  const { policy, candidate } = resolveSelectedDesign(reference);
  try {
    const report = assessRobustness({ chosen: candidate, brief: policy.brief, budget: policy.negotiation.applied });
    if (report.fingerprint !== candidate.configFingerprint) {
      throw new DeveloperApiError("FINGERPRINT_MISMATCH", "Robustness changed the selected design fingerprint.", 500);
    }
    return serializeRobustness(report, policy, candidate);
  } catch (error) {
    if (error instanceof DeveloperApiError) throw error;
    throw new DeveloperApiError("ROBUSTNESS_FAILED", "Robustness evaluation failed.", 422);
  }
}

function publicConfig(config: ReturnType<typeof materializeRecipe>, quote: LaunchBrief["quote"]) {
  const c = config as unknown as Record<string, unknown>;
  const poolFees = (c.poolFees ?? {}) as Record<string, unknown>;
  const baseFee = (poolFees.baseFee ?? {}) as Record<string, unknown>;
  const dynamicFee = poolFees.dynamicFee as Record<string, unknown> | null | undefined;
  const curve = Array.isArray(c.curve) ? c.curve as Array<Record<string, unknown>> : [];
  const atom = (value: unknown) => typeof value === "bigint" ? value.toString(10) : value == null ? null : String(value);
  const object = (value: Record<string, unknown> | null | undefined) => value ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, atom(item)])) : null;
  return {
    quote: {
      label: quote,
      decimals: quote === "USDC" ? 6 : 9,
      mint: quote === "USDC" ? getUsdcMint()?.toBase58() ?? null : WSOL_MINT.toBase58(),
    },
    sqrtStartPrice: atom(c.sqrtStartPrice),
    migrationQuoteThreshold: atom(c.migrationQuoteThreshold),
    curve: curve.map((point) => ({ sqrtPrice: atom(point.sqrtPrice), liquidity: atom(point.liquidity) })),
    poolFees: { baseFee: object(baseFee), dynamicFee: object(dynamicFee) },
    creatorTradingFeePercentage: atom(c.creatorTradingFeePercentage),
    partnerPermanentLockedLiquidityPercentage: atom(c.partnerPermanentLockedLiquidityPercentage),
    partnerLiquidityPercentage: atom(c.partnerLiquidityPercentage),
    creatorPermanentLockedLiquidityPercentage: atom(c.creatorPermanentLockedLiquidityPercentage),
    creatorLiquidityPercentage: atom(c.creatorLiquidityPercentage),
    enableFirstSwapWithMinFee: Boolean(c.enableFirstSwapWithMinFee),
    collectFeeMode: atom(c.collectFeeMode),
    migrationOption: atom(c.migrationOption),
    tokenQuoteDecimal: atom(c.tokenQuoteDecimal ?? (quote === "USDC" ? 6 : 9)),
    tokenBaseDecimal: atom(c.tokenBaseDecimal ?? 9),
    migration: migrationAttestation(config),
    units: {
      sqrtStartPrice: "raw_sdk_integer",
      migrationQuoteThreshold: "quote_atoms",
      curve: { sqrtPrice: "raw_sdk_integer", liquidity: "raw_sdk_integer" },
      poolFees: "raw_sdk_integer_or_enum_string",
      percentages: "percentage",
      basisPoints: "basis_points",
      tokenQuoteDecimal: "decimal_count",
      tokenBaseDecimal: "decimal_count",
      counts: "count",
      ratios: "ratio_0_to_1",
      migration: "enum_or_decimal_string; dammV2Config is a public_key_base58",
      quoteMint: "public_key_base58_or_null",
      quoteAtoms: "quote_atoms",
      dimensionlessCurveValues: "dimensionless_curve_value",
    },
  };
}

export function configIntegrity(expectedFingerprint: string, actualFingerprint: string) {
  return {
    designFingerprint: expectedFingerprint,
    configFingerprint: actualFingerprint,
    matches: expectedFingerprint === actualFingerprint,
  };
}

export function configFromReference(reference: SelectedDesignReference) {
  const { policy, candidate } = resolveSelectedDesign(reference);
  if (!deploymentAllowed(policy, candidate)) {
    throw new DeveloperApiError("DESIGN_MISMATCH", "Selected candidate is not deployable under its applied constraints.", 409);
  }
  try {
    const config = materializeRecipe(candidate.recipe);
    const configFingerprint = marketConfigFingerprint(config);
    const integrity = configIntegrity(candidate.configFingerprint, configFingerprint);
    if (!integrity.matches) {
      throw new DeveloperApiError("FINGERPRINT_MISMATCH", "Canonical config fingerprint does not match the selected design.", 500);
    }
    return {
      ok: true as const,
      schemaVersion: DESIGN_API_SCHEMA_VERSION,
      engineVersion: DESIGN_API_ENGINE_VERSION,
      fingerprintVersion: DESIGN_API_FINGERPRINT_VERSION,
      design: { policyId: policy.policyId, candidateId: candidate.profileId, fingerprint: candidate.configFingerprint },
      requestedConstraints: policy.negotiation.requested,
      acceptedConstraints: policy.negotiation.applied,
      config: publicConfig(config, policy.brief.quote),
      canonicalConfig: canonicalMarketConfig(config),
      integrity,
      provenance: "canonical_meteora_launch_config",
    };
  } catch (error) {
    if (error instanceof DeveloperApiError) throw error;
    throw new DeveloperApiError("CONFIG_BUILD_FAILED", "Canonical configuration could not be built.", 422);
  }
}

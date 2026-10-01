/**
 * Creator-signed design attached to a registry registration.
 *
 * This is an attestation of the config the creator deployed. It is not a
 * verification flag. Explore and /api/deployments compare it to the chain.
 * The static catalog remains a fallback for registrations that predate this
 * field. A stored `checks: true` is never accepted.
 */
import { z } from "zod";
import {
  recordedFingerprintMatches,
  type ExpectedMarketConfig,
} from "@/lib/dbc/deploymentReadback";
import type { QuoteLabel } from "@/lib/dbc/types";
import type { PublicDeployment } from "./publicDeployments";
import type { RegistryLaunch } from "./types";

const atom = z.string().max(80);
const fee = z
  .object({
    cliffFeeNumerator: atom,
    firstFactor: atom,
    secondFactor: atom,
    thirdFactor: atom,
    baseFeeMode: atom,
  })
  .strict();
const dynamicFee = z
  .object({
    initialized: atom,
    binStep: atom,
    binStepU128: atom,
    variableFeeControl: atom,
    filterPeriod: atom,
    decayPeriod: atom,
    reductionFactor: atom,
    maxVolatilityAccumulator: atom,
  })
  .strict();

export const expectedMarketConfigSchema = z
  .object({
    sqrtStartPrice: atom,
    migrationQuoteThreshold: atom,
    curve: z
      .array(
        z
          .object({
            sqrtPrice: atom,
            liquidity: atom,
          })
          .strict(),
      )
      .max(20),
    baseFee: fee,
    dynamicFee: dynamicFee.nullable(),
    creatorTradingFeePercentage: atom,
    partnerPermanentLockedLiquidityPercentage: atom,
    partnerLiquidityPercentage: atom,
    creatorPermanentLockedLiquidityPercentage: atom,
    creatorLiquidityPercentage: atom,
    enableFirstSwapWithMinFee: atom,
    collectFeeMode: atom,
    migrationOption: atom,
    tokenQuoteDecimal: atom,
    tokenBaseDecimal: atom,
  })
  .strict();

export const registryDesignSchema = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/, "fingerprint must be 16 hex characters"),
    migrationQuoteThresholdAtoms: z
      .string()
      .regex(/^\d{1,40}$/, "migration threshold must be a decimal atom string"),
    canonicalConfig: z.string().min(1).max(6000),
    expected: expectedMarketConfigSchema,
    profileName: z.string().min(1).max(80),
    constraintsPassed: z.boolean(),
    transaction: z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/, "transaction must be a base58 signature")
      .optional(),
  })
  .strict()
  .superRefine((design, ctx) => {
    if (!recordedFingerprintMatches(design.canonicalConfig, design.fingerprint)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fingerprint"],
        message: "fingerprint does not match the canonical config",
      });
    }
    if (design.expected.migrationQuoteThreshold !== design.migrationQuoteThresholdAtoms) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["migrationQuoteThresholdAtoms"],
        message: "migration threshold does not match the canonical config",
      });
    }
  });

export type RegistryDesign = z.infer<typeof registryDesignSchema>;

export function parseStoredDesign(raw: unknown): RegistryDesign | null {
  const parsed = registryDesignSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type DeploymentRecordSource = "registry" | "catalog";

/** Design fields the live comparison needs. Addresses come from chain or the catalog row. */
export type ResolvedDeployment = {
  source: DeploymentRecordSource;
  pool: string;
  config: string;
  mint: string;
  quote: QuoteLabel;
  fingerprint: string;
  migrationQuoteThresholdAtoms: string;
  canonicalConfig: string;
  expected: ExpectedMarketConfig;
  transaction: string | null;
  constraintsPassed: boolean;
  profileName: string;
};

export function designIsConsistent(design: RegistryDesign): boolean {
  return (
    recordedFingerprintMatches(design.canonicalConfig, design.fingerprint) &&
    design.expected.migrationQuoteThreshold === design.migrationQuoteThresholdAtoms
  );
}

/**
 * Prefer an internally consistent registration. Fall back to the static catalog
 * when the registration has no design, or the stored design does not match its
 * own fingerprint and threshold. Never treat a stored checks flag as proof.
 */
export function resolveDeploymentRecord(args: {
  pool: string;
  registry: Pick<RegistryLaunch, "pool" | "config" | "mint" | "quote" | "design"> | null;
  catalog: PublicDeployment | null;
}): ResolvedDeployment | null {
  const reg = args.registry;
  if (reg && reg.pool === args.pool && reg.design && designIsConsistent(reg.design)) {
    return {
      source: "registry",
      pool: reg.pool,
      config: reg.config,
      mint: reg.mint,
      quote: reg.quote,
      fingerprint: reg.design.fingerprint,
      migrationQuoteThresholdAtoms: reg.design.migrationQuoteThresholdAtoms,
      canonicalConfig: reg.design.canonicalConfig,
      expected: reg.design.expected,
      transaction: reg.design.transaction ?? null,
      constraintsPassed: reg.design.constraintsPassed,
      profileName: reg.design.profileName,
    };
  }
  const cat = args.catalog;
  if (
    cat &&
    cat.pool === args.pool &&
    typeof cat.canonicalConfig === "string" &&
    cat.expected &&
    recordedFingerprintMatches(cat.canonicalConfig, cat.fingerprint) &&
    cat.expected.migrationQuoteThreshold === cat.migrationQuoteThresholdAtoms
  ) {
    return {
      source: "catalog",
      pool: cat.pool,
      config: cat.config,
      mint: cat.mint,
      quote: cat.quote,
      fingerprint: cat.fingerprint,
      migrationQuoteThresholdAtoms: cat.migrationQuoteThresholdAtoms,
      canonicalConfig: cat.canonicalConfig,
      expected: cat.expected,
      transaction: cat.transaction,
      constraintsPassed: cat.constraintsPassed === true,
      profileName: cat.profileName,
    };
  }
  return null;
}

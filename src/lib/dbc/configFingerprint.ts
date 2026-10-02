import { DAMM_V2_MIGRATION_FEE_ADDRESS, type ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { sha256Hex } from "@/lib/market/hash";

/**
 * Canonical fingerprint of the market config the simulator scored.
 * Token program and mint authority are launch settings, not curve-search outputs,
 * so they are left out. Quote decimals, curve points, threshold, fees, lock,
 * anti-sniper, the migration fee option, and the DAMM v2 config that option
 * selects are included. The same string must come from simulation, review, and
 * the transaction builder.
 *
 * Stored proofs hash the canonical string they saved. Adding fields changes the
 * hash of a newly built config. It does not rewrite a string that was already stored.
 */
function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return String(value);
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "object" && "toString" in value) return String((value as { toString(): string }).toString());
  return "";
}

/** Migration fields that choose the DAMM v2 destination. Flat names match the on-chain config. */
export function migrationAttestation(cfg: ConfigParameters): {
  migrationFeeOption: string;
  migrationFeePercentage: string;
  creatorMigrationFeePercentage: string;
  migratedCollectFeeMode: string;
  migratedDynamicFee: string;
  migratedPoolFeeBps: string;
  migratedPoolBaseFeeMode: string;
  dammV2Config: string;
} {
  const c = cfg as unknown as {
    migrationFeeOption?: unknown;
    migrationFee?: { feePercentage?: unknown; creatorFeePercentage?: unknown };
    migratedPoolFee?: { collectFeeMode?: unknown; dynamicFee?: unknown; poolFeeBps?: unknown };
    migratedPoolBaseFeeMode?: unknown;
  };
  const option = text(c.migrationFeeOption);
  const index = Number(option);
  const address =
    Number.isInteger(index) && index >= 0 && index < DAMM_V2_MIGRATION_FEE_ADDRESS.length
      ? DAMM_V2_MIGRATION_FEE_ADDRESS[index]?.toBase58() ?? ""
      : "";
  return {
    migrationFeeOption: option,
    migrationFeePercentage: text(c.migrationFee?.feePercentage),
    creatorMigrationFeePercentage: text(c.migrationFee?.creatorFeePercentage),
    migratedCollectFeeMode: text(c.migratedPoolFee?.collectFeeMode),
    migratedDynamicFee: text(c.migratedPoolFee?.dynamicFee),
    migratedPoolFeeBps: text(c.migratedPoolFee?.poolFeeBps),
    migratedPoolBaseFeeMode: text(c.migratedPoolBaseFeeMode),
    dammV2Config: address,
  };
}

export function canonicalMarketConfig(cfg: ConfigParameters): string {
  const c = cfg as unknown as {
    sqrtStartPrice?: unknown;
    migrationQuoteThreshold?: unknown;
    curve?: { sqrtPrice?: unknown; liquidity?: unknown }[];
    poolFees?: {
      baseFee?: {
        cliffFeeNumerator?: unknown;
        firstFactor?: unknown;
        secondFactor?: unknown;
        thirdFactor?: unknown;
        baseFeeMode?: unknown;
      };
      dynamicFee?: Record<string, unknown> | null;
    };
    creatorTradingFeePercentage?: unknown;
    partnerPermanentLockedLiquidityPercentage?: unknown;
    partnerLiquidityPercentage?: unknown;
    creatorPermanentLockedLiquidityPercentage?: unknown;
    creatorLiquidityPercentage?: unknown;
    enableFirstSwapWithMinFee?: unknown;
    collectFeeMode?: unknown;
    migrationOption?: unknown;
    tokenQuoteDecimal?: unknown;
    tokenBaseDecimal?: unknown;
  };
  const base = c.poolFees?.baseFee;
  const dyn = c.poolFees?.dynamicFee;
  const curve = (c.curve ?? [])
    .map((point) => `${text(point.sqrtPrice)}:${text(point.liquidity)}`)
    .join(",");
  const dynamic = dyn
    ? [
        text(dyn.initialized),
        text(dyn.binStep),
        text(dyn.binStepU128),
        text(dyn.variableFeeControl),
        text(dyn.filterPeriod),
        text(dyn.decayPeriod),
        text(dyn.reductionFactor),
        text(dyn.maxVolatilityAccumulator),
      ].join(":")
    : "none";
  const migration = migrationAttestation(cfg);
  return [
    text(c.sqrtStartPrice),
    curve,
    text(c.migrationQuoteThreshold),
    [text(base?.cliffFeeNumerator), text(base?.firstFactor), text(base?.secondFactor), text(base?.thirdFactor), text(base?.baseFeeMode)].join(":"),
    dynamic,
    text(c.creatorTradingFeePercentage),
    text(c.partnerPermanentLockedLiquidityPercentage),
    text(c.partnerLiquidityPercentage),
    text(c.creatorPermanentLockedLiquidityPercentage),
    text(c.creatorLiquidityPercentage),
    text(c.enableFirstSwapWithMinFee),
    text(c.collectFeeMode),
    text(c.migrationOption),
    text(c.tokenQuoteDecimal),
    text(c.tokenBaseDecimal),
    migration.migrationFeeOption,
    migration.migrationFeePercentage,
    migration.creatorMigrationFeePercentage,
    migration.migratedCollectFeeMode,
    migration.migratedDynamicFee,
    migration.migratedPoolFeeBps,
    migration.migratedPoolBaseFeeMode,
    migration.dammV2Config,
  ].join("\n");
}

/** New ids are 32 hex chars. Deployed proofs may still store the first 16. Not a secret. */
export const FINGERPRINT_HEX_LEN = 32;

export function marketConfigFingerprint(cfg: ConfigParameters): string {
  return sha256Hex(canonicalMarketConfig(cfg)).slice(0, FINGERPRINT_HEX_LEN);
}

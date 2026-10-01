import type { ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { sha256Hex } from "@/lib/market/hash";

/**
 * Canonical fingerprint of the market config the simulator scored.
 * Token program and mint authority are launch settings, not curve-search outputs,
 * so they are left out. Quote decimals, curve points, threshold, fees, lock, and
 * anti-sniper are included. The same string must come from simulation, review, and
 * the transaction builder.
 */
function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return String(value);
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "object" && "toString" in value) return String((value as { toString(): string }).toString());
  return "";
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
  ].join("\n");
}

/** 16 hex chars. Stable for the same config. Not a security hash of a secret. */
export function marketConfigFingerprint(cfg: ConfigParameters): string {
  return sha256Hex(canonicalMarketConfig(cfg)).slice(0, 16);
}

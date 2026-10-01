import { DAMM_V2_MIGRATION_FEE_ADDRESS, type ConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { canonicalMarketConfig, marketConfigFingerprint, migrationAttestation } from "@/lib/dbc/configFingerprint";
import { sha256Hex } from "@/lib/market/hash";

/** Plain fields of the config that was fingerprinted and deployed. */
export type ExpectedMarketConfig = {
  sqrtStartPrice: string;
  migrationQuoteThreshold: string;
  curve: { sqrtPrice: string; liquidity: string }[];
  baseFee: {
    cliffFeeNumerator: string;
    firstFactor: string;
    secondFactor: string;
    thirdFactor: string;
    baseFeeMode: string;
  };
  dynamicFee: {
    initialized: string;
    binStep: string;
    binStepU128: string;
    variableFeeControl: string;
    filterPeriod: string;
    decayPeriod: string;
    reductionFactor: string;
    maxVolatilityAccumulator: string;
  } | null;
  creatorTradingFeePercentage: string;
  partnerPermanentLockedLiquidityPercentage: string;
  partnerLiquidityPercentage: string;
  creatorPermanentLockedLiquidityPercentage: string;
  creatorLiquidityPercentage: string;
  enableFirstSwapWithMinFee: string;
  collectFeeMode: string;
  migrationOption: string;
  tokenQuoteDecimal: string;
  tokenBaseDecimal: string;
  /**
   * Present on designs signed after migration-fee attestation.
   * Older stored designs omit them. A missing field is not a pass for a new design,
   * and it is not a failure for an older one.
   */
  migrationFeeOption?: string;
  migrationFeePercentage?: string;
  creatorMigrationFeePercentage?: string;
  migratedCollectFeeMode?: string;
  migratedDynamicFee?: string;
  migratedPoolFeeBps?: string;
  migratedPoolBaseFeeMode?: string;
  /** DAMM v2 config address selected by migrationFeeOption. */
  dammV2Config?: string;
};

export type DeploymentCheckFlags = {
  fingerprint: boolean;
  poolConfiguration: boolean;
  migrationThreshold: boolean;
  readback: boolean;
};

export type ChainSnapshotView = {
  pool: string;
  config: string;
  baseMint: string;
  quoteMint: string | null;
  migrationQuoteThreshold: string | null;
};

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "bigint") return value.toString(10);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return String(value);
  if (typeof value === "object" && "toString" in value) {
    const rendered = (value as { toString(radix?: number): string }).toString(10);
    if (rendered !== "[object Object]") return rendered;
  }
  return String(value);
}

function flag(value: unknown): string {
  const rendered = text(value).toLowerCase();
  if (rendered === "true" || rendered === "1") return "1";
  if (rendered === "false" || rendered === "0") return "0";
  return rendered;
}

function livePoints(curve: unknown): string {
  if (!Array.isArray(curve)) return "";
  const parts: string[] = [];
  for (const point of curve) {
    const sqrt = text((point as { sqrtPrice?: unknown }).sqrtPrice);
    const liquidity = text((point as { liquidity?: unknown }).liquidity);
    if ((sqrt === "" || sqrt === "0") && (liquidity === "" || liquidity === "0")) continue;
    parts.push(`${sqrt}:${liquidity}`);
  }
  return parts.join(",");
}

export function expectedFromConfig(cfg: ConfigParameters): ExpectedMarketConfig {
  const c = cfg as unknown as {
    sqrtStartPrice?: unknown;
    migrationQuoteThreshold?: unknown;
    curve?: { sqrtPrice?: unknown; liquidity?: unknown }[];
    poolFees?: { baseFee?: Record<string, unknown>; dynamicFee?: Record<string, unknown> | null };
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
  const base = c.poolFees?.baseFee ?? {};
  const dyn = c.poolFees?.dynamicFee;
  return {
    sqrtStartPrice: text(c.sqrtStartPrice),
    migrationQuoteThreshold: text(c.migrationQuoteThreshold),
    curve: (c.curve ?? []).map((point) => ({
      sqrtPrice: text(point.sqrtPrice),
      liquidity: text(point.liquidity),
    })),
    baseFee: {
      cliffFeeNumerator: text(base.cliffFeeNumerator),
      firstFactor: text(base.firstFactor),
      secondFactor: text(base.secondFactor),
      thirdFactor: text(base.thirdFactor),
      baseFeeMode: text(base.baseFeeMode),
    },
    dynamicFee: dyn
      ? {
          initialized: text(dyn.initialized),
          binStep: text(dyn.binStep),
          binStepU128: text(dyn.binStepU128),
          variableFeeControl: text(dyn.variableFeeControl),
          filterPeriod: text(dyn.filterPeriod),
          decayPeriod: text(dyn.decayPeriod),
          reductionFactor: text(dyn.reductionFactor),
          maxVolatilityAccumulator: text(dyn.maxVolatilityAccumulator),
        }
      : null,
    creatorTradingFeePercentage: text(c.creatorTradingFeePercentage),
    partnerPermanentLockedLiquidityPercentage: text(c.partnerPermanentLockedLiquidityPercentage),
    partnerLiquidityPercentage: text(c.partnerLiquidityPercentage),
    creatorPermanentLockedLiquidityPercentage: text(c.creatorPermanentLockedLiquidityPercentage),
    creatorLiquidityPercentage: text(c.creatorLiquidityPercentage),
    enableFirstSwapWithMinFee: text(c.enableFirstSwapWithMinFee),
    collectFeeMode: text(c.collectFeeMode),
    migrationOption: text(c.migrationOption),
    tokenQuoteDecimal: text(c.tokenQuoteDecimal),
    tokenBaseDecimal: text(c.tokenBaseDecimal),
    ...migrationAttestation(cfg),
  };
}

export function canonicalConfigText(cfg: ConfigParameters): string {
  return canonicalMarketConfig(cfg);
}

/** The recorded fingerprint has to be the hash of the stored canonical config. */
export function recordedFingerprintMatches(canonicalConfig: string, fingerprint: string): boolean {
  return sha256Hex(canonicalConfig).slice(0, 16) === fingerprint;
}

export function recordedConfigMatchesFingerprint(cfg: ConfigParameters, fingerprint: string): boolean {
  return marketConfigFingerprint(cfg) === fingerprint && recordedFingerprintMatches(canonicalConfigText(cfg), fingerprint);
}

function same(expected: string, actual: unknown): boolean {
  return expected === text(actual);
}

/** Older designs omit the field. A present value has to match the chain. */
function attested(expected: string | undefined, actual: unknown): boolean {
  if (expected === undefined) return true;
  return same(expected, actual);
}

function dammDestinationMatches(expected: string | undefined, chainOption: unknown): boolean {
  if (expected === undefined) return true;
  const index = Number(text(chainOption));
  if (!Number.isInteger(index) || index < 0 || index >= DAMM_V2_MIGRATION_FEE_ADDRESS.length) return false;
  const address = DAMM_V2_MIGRATION_FEE_ADDRESS[index]?.toBase58() ?? "";
  return expected === address && address !== "";
}

/**
 * Compare a recorded design with a chain snapshot and pool config.
 * A missing or unreadable chain value fails the check.
 */
export function compareDeploymentReadback(args: {
  expected: ExpectedMarketConfig;
  canonicalConfig: string;
  fingerprint: string;
  identity: { pool: string; config: string; mint: string; threshold: string; quoteMint: string };
  snapshot: ChainSnapshotView;
  chain: Record<string, unknown>;
}): { verified: boolean; checks: DeploymentCheckFlags } {
  const { expected, identity, snapshot, chain } = args;
  const chainFees = (chain.poolFees ?? {}) as {
    baseFee?: Record<string, unknown>;
    dynamicFee?: Record<string, unknown> | null;
  };
  const addressesOk =
    snapshot.pool === identity.pool &&
    snapshot.config === identity.config &&
    snapshot.baseMint === identity.mint &&
    text(chain.quoteMint) === identity.quoteMint &&
    text(snapshot.quoteMint) === identity.quoteMint;
  const thresholdOk =
    same(identity.threshold, chain.migrationQuoteThreshold) &&
    same(identity.threshold, snapshot.migrationQuoteThreshold) &&
    same(expected.migrationQuoteThreshold, chain.migrationQuoteThreshold);
  const designOk =
    recordedFingerprintMatches(args.canonicalConfig, args.fingerprint) &&
    same(expected.sqrtStartPrice, chain.sqrtStartPrice) &&
    livePoints(expected.curve) === livePoints(chain.curve) &&
    same(expected.creatorTradingFeePercentage, chain.creatorTradingFeePercentage) &&
    same(expected.partnerPermanentLockedLiquidityPercentage, chain.partnerPermanentLockedLiquidityPercentage) &&
    same(expected.partnerLiquidityPercentage, chain.partnerLiquidityPercentage) &&
    same(expected.creatorPermanentLockedLiquidityPercentage, chain.creatorPermanentLockedLiquidityPercentage) &&
    same(expected.creatorLiquidityPercentage, chain.creatorLiquidityPercentage) &&
    flag(expected.enableFirstSwapWithMinFee) === flag(chain.enableFirstSwapWithMinFee) &&
    same(expected.collectFeeMode, chain.collectFeeMode) &&
    same(expected.migrationOption, chain.migrationOption) &&
    same(expected.tokenQuoteDecimal, chain.tokenQuoteDecimal) &&
    same(expected.tokenBaseDecimal, chain.tokenBaseDecimal) &&
    attested(expected.migrationFeeOption, chain.migrationFeeOption) &&
    attested(expected.migrationFeePercentage, chain.migrationFeePercentage) &&
    attested(expected.creatorMigrationFeePercentage, chain.creatorMigrationFeePercentage) &&
    attested(expected.migratedCollectFeeMode, chain.migratedCollectFeeMode) &&
    attested(expected.migratedDynamicFee, chain.migratedDynamicFee) &&
    attested(expected.migratedPoolFeeBps, chain.migratedPoolFeeBps) &&
    attested(expected.migratedPoolBaseFeeMode, chain.migratedPoolBaseFeeMode) &&
    dammDestinationMatches(expected.dammV2Config, chain.migrationFeeOption) &&
    same(expected.baseFee.cliffFeeNumerator, chainFees.baseFee?.cliffFeeNumerator) &&
    same(expected.baseFee.firstFactor, chainFees.baseFee?.firstFactor) &&
    same(expected.baseFee.secondFactor, chainFees.baseFee?.secondFactor) &&
    same(expected.baseFee.thirdFactor, chainFees.baseFee?.thirdFactor) &&
    same(expected.baseFee.baseFeeMode, chainFees.baseFee?.baseFeeMode) &&
    dynamicFeeMatches(expected.dynamicFee, chainFees.dynamicFee ?? null);
  const checks: DeploymentCheckFlags = {
    fingerprint: designOk,
    poolConfiguration: addressesOk,
    migrationThreshold: thresholdOk,
    readback: designOk && addressesOk && thresholdOk,
  };
  return { verified: checks.readback, checks };
}

function dynamicFeeMatches(
  expected: ExpectedMarketConfig["dynamicFee"],
  chain: Record<string, unknown> | null,
): boolean {
  if (!expected && !chain) return true;
  if (!expected || !chain) return false;
  const initialized = flag(chain.initialized);
  const initOk = expected.initialized === "" ? initialized === "1" : flag(expected.initialized) === initialized;
  return (
    initOk &&
    expected.binStep === text(chain.binStep) &&
    expected.binStepU128 === text(chain.binStepU128) &&
    expected.variableFeeControl === text(chain.variableFeeControl) &&
    expected.filterPeriod === text(chain.filterPeriod) &&
    expected.decayPeriod === text(chain.decayPeriod) &&
    expected.reductionFactor === text(chain.reductionFactor) &&
    expected.maxVolatilityAccumulator === text(chain.maxVolatilityAccumulator)
  );
}

/** The badge is shown only when the live comparison itself passed. */
export function verifiedPanelVisible(input: {
  verified?: boolean;
  checks?: DeploymentCheckFlags | null;
}): boolean {
  const checks = input.checks;
  return (
    input.verified === true &&
    !!checks &&
    checks.fingerprint === true &&
    checks.poolConfiguration === true &&
    checks.migrationThreshold === true &&
    checks.readback === true
  );
}

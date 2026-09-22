import {
  ActivationType,
  BaseFeeMode,
  buildCurveWithMarketCap,
  CollectFeeMode,
  DammV2BaseFeeMode,
  DammV2DynamicFeeMode,
  MigratedCollectFeeMode,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { PresetId } from "./types";

export type CurvePreset = {
  id: PresetId;
  name: string;
  tagline: string;
  description: string;
  bestFor: string;
  feeLabel: string;
  initialMarketCap: number;
  migrationMarketCap: number;
  accent: string;
};

export const CURVE_PRESETS: CurvePreset[] = [
  {
    id: "short",
    name: "Short raise",
    tagline: "Fast path to graduate",
    description:
      "Low migration market cap so a funded wallet can buy through the curve and demo DAMM v2 graduation without a long runway. Real SDK config — not a mock.",
    bestFor: "Devnet demos, smoke tests, short raises",
    feeLabel: "Linear 150→50 bps over 30m",
    initialMarketCap: 500,
    migrationMarketCap: 2_500,
    accent: "from-teal-400/25 to-sky-500/10",
  },
  {
    id: "flat",
    name: "Flat",
    tagline: "Steady discovery",
    description:
      "Near-linear price discovery with a mild fee scheduler. Good for transparent equity rounds where early and late buyers see similar slope.",
    bestFor: "Public equity rounds, employee pools",
    feeLabel: "Linear 200→50 bps over 1h",
    initialMarketCap: 5_000,
    migrationMarketCap: 75_000,
    accent: "from-sky-400/20 to-cyan-500/10",
  },
  {
    id: "exponential",
    name: "Exponential",
    tagline: "Steep early, then cruise",
    description:
      "Higher early fees and steeper initial slope to deter sniping, then decays toward a thinner fee before DAMM v2 graduation.",
    bestFor: "Hot listings, high FOMO launches",
    feeLabel: "Exponential 900→100 bps",
    initialMarketCap: 8_000,
    migrationMarketCap: 120_000,
    accent: "from-fuchsia-400/20 to-violet-500/10",
  },
  {
    id: "long",
    name: "Long",
    tagline: "Extended bonding runway",
    description:
      "Lower starting cap and higher migration target so the curve runs longer — suited to patient capital before DAMM v2.",
    bestFor: "RWA fundraising, longer offerings",
    feeLabel: "Linear 150→40 bps over 6h",
    initialMarketCap: 2_500,
    migrationMarketCap: 250_000,
    accent: "from-amber-400/20 to-orange-500/10",
  },
  {
    id: "equity",
    name: "Equity-tuned",
    tagline: "Stock-style discovery",
    description:
      "Smoother fee decay and partner-locked post-migration LP — EquiCurve default for tokenized equity / stock-style pairs.",
    bestFor: "Tokenized equity, stock-style pairs",
    feeLabel: "Linear 120→35 bps + dynamic fee",
    initialMarketCap: 10_000,
    migrationMarketCap: 150_000,
    accent: "from-teal-400/25 to-emerald-500/10",
  },
];

export function getPreset(id: PresetId): CurvePreset {
  const found = CURVE_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown preset: ${id}`);
  return found;
}

type FeeSpec = {
  mode: number;
  startingFeeBps: number;
  endingFeeBps: number;
  numberOfPeriod: number;
  totalDuration: number;
  dynamicFeeEnabled: boolean;
  creatorTradingFeePercentage: number;
  enableFirstSwapWithMinFee: boolean;
};

const FEE_BY_PRESET: Record<PresetId, FeeSpec> = {
  short: {
    mode: BaseFeeMode.FeeSchedulerLinear,
    startingFeeBps: 150,
    endingFeeBps: 50,
    numberOfPeriod: 30,
    totalDuration: 1_800,
    dynamicFeeEnabled: false,
    creatorTradingFeePercentage: 50,
    enableFirstSwapWithMinFee: false,
  },
  flat: {
    mode: BaseFeeMode.FeeSchedulerLinear,
    startingFeeBps: 200,
    endingFeeBps: 50,
    numberOfPeriod: 60,
    totalDuration: 3_600,
    dynamicFeeEnabled: false,
    creatorTradingFeePercentage: 50,
    enableFirstSwapWithMinFee: false,
  },
  exponential: {
    mode: BaseFeeMode.FeeSchedulerExponential,
    startingFeeBps: 900,
    endingFeeBps: 100,
    numberOfPeriod: 80,
    totalDuration: 7_200,
    dynamicFeeEnabled: true,
    creatorTradingFeePercentage: 40,
    enableFirstSwapWithMinFee: true,
  },
  long: {
    mode: BaseFeeMode.FeeSchedulerLinear,
    startingFeeBps: 150,
    endingFeeBps: 40,
    numberOfPeriod: 120,
    totalDuration: 21_600,
    dynamicFeeEnabled: false,
    creatorTradingFeePercentage: 50,
    enableFirstSwapWithMinFee: false,
  },
  equity: {
    mode: BaseFeeMode.FeeSchedulerLinear,
    startingFeeBps: 120,
    endingFeeBps: 35,
    numberOfPeriod: 90,
    totalDuration: 14_400,
    dynamicFeeEnabled: true,
    creatorTradingFeePercentage: 50,
    enableFirstSwapWithMinFee: false,
  },
};

/** On-chain minimum locked LP (MIN_LOCKED_LIQUIDITY_BPS = 1000 → 10%). */
export const MIN_LP_LOCK_PCT = 10;

export type BuildPresetOverrides = {
  totalTokenSupply?: number;
  leftover?: number;
  /** Creator share of trading fees 0–100; partner (feeClaimer) gets remainder. */
  creatorTradingFeePercentage?: number;
  /** Permanent partner-locked LP % after migration; clamped to ≥10. */
  lpLockPct?: number;
  /**
   * Renounce mint (CreatorUpdateAuthority / no mint) vs retain
   * (CreatorUpdateAndMintAuthority).
   */
  mintRenounce?: boolean;
  /** When true, enables first-swap min fee on the fee config. */
  antiSniper?: boolean;
  /** Quote token decimals (9 = SOL/WSOL, 6 = USDC). */
  quoteDecimals?: 6 | 9;
  /** SPL vs Token-2022 base mint. */
  tokenType?: "spl" | "token-2022";
  /**
   * When true, CreatorUpdateAndMintAuthority is allowed (transfer-hook configs only).
   * Standard SPL / Token-2022 configs reject mint-authority options.
   */
  allowMintAuthority?: boolean;
};

/**
 * Real Meteora ConfigParameters via buildCurveWithMarketCap.
 * Wizard fee / lock / mint controls map into these fields.
 */
export function buildPresetConfig(
  presetId: PresetId,
  opts: BuildPresetOverrides = {},
): ConfigParameters {
  const preset = getPreset(presetId);
  const feeSpec = FEE_BY_PRESET[presetId];

  const creatorPct = Math.min(
    100,
    Math.max(0, Math.round(opts.creatorTradingFeePercentage ?? feeSpec.creatorTradingFeePercentage)),
  );
  const lpLock = Math.min(
    100,
    Math.max(MIN_LP_LOCK_PCT, Math.round(opts.lpLockPct ?? 100)),
  );
  const partnerUnlocked = 100 - lpLock;

  const mintRenounce = opts.mintRenounce !== false;
  const allowMintAuthority = opts.allowMintAuthority === true;
  // Mint+update authority is only valid on transfer-hook configs (Meteora docs).
  const tokenAuthorityOption =
    mintRenounce || !allowMintAuthority
      ? TokenAuthorityOption.CreatorUpdateAuthority
      : TokenAuthorityOption.CreatorUpdateAndMintAuthority;

  const enableFirstSwapWithMinFee =
    opts.antiSniper ?? feeSpec.enableFirstSwapWithMinFee;

  const tokenType =
    opts.tokenType === "token-2022" ? TokenType.Token2022 : TokenType.SPLToken;

  return buildCurveWithMarketCap({
    token: {
      tokenType,
      tokenBaseDecimal: TokenDecimal.NINE,
      tokenQuoteDecimal:
        opts.quoteDecimals === 6 ? TokenDecimal.SIX : TokenDecimal.NINE,
      tokenAuthorityOption,
      totalTokenSupply: opts.totalTokenSupply ?? 1_000_000_000,
      leftover: opts.leftover ?? 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: feeSpec.mode,
        feeSchedulerParam: {
          startingFeeBps: feeSpec.startingFeeBps,
          endingFeeBps: feeSpec.endingFeeBps,
          numberOfPeriod: feeSpec.numberOfPeriod,
          totalDuration: feeSpec.totalDuration,
        },
      },
      dynamicFeeEnabled: feeSpec.dynamicFeeEnabled,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: creatorPct,
      poolCreationFee: 1_000_000,
      enableFirstSwapWithMinFee,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
      migratedPoolFee: {
        collectFeeMode: MigratedCollectFeeMode.QuoteToken,
        dynamicFee: DammV2DynamicFeeMode.Enabled,
        poolFeeBps: 100,
        baseFeeMode: DammV2BaseFeeMode.FeeTimeSchedulerLinear,
      },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: lpLock,
      partnerLiquidityPercentage: partnerUnlocked,
      creatorPermanentLockedLiquidityPercentage: 0,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap: preset.initialMarketCap,
    migrationMarketCap: preset.migrationMarketCap,
  });
}

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

/** Real Meteora ConfigParameters via buildCurveWithMarketCap (verified against installed SDK). */
export function buildPresetConfig(
  presetId: PresetId,
  opts: { totalTokenSupply?: number; leftover?: number } = {},
): ConfigParameters {
  const preset = getPreset(presetId);
  const feeSpec = FEE_BY_PRESET[presetId];

  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.NINE,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: TokenAuthorityOption.CreatorUpdateAuthority,
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
      creatorTradingFeePercentage: feeSpec.creatorTradingFeePercentage,
      poolCreationFee: 1_000_000,
      enableFirstSwapWithMinFee: feeSpec.enableFirstSwapWithMinFee,
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
      partnerPermanentLockedLiquidityPercentage: 100,
      partnerLiquidityPercentage: 0,
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

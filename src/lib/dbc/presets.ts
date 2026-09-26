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

/** Quote assets EquiCurve supports on DBC. Preset market caps are denominated in these. */
export type PresetQuote = "SOL" | "USDC";

/**
 * Start / graduation market caps in QUOTE-token units (not USD):
 * market cap = total supply × price, where price is quote per base token.
 * buildCurveWithMarketCap derives the curve and migrationQuoteThreshold
 * (in quote atoms) from these two numbers.
 */
export type QuoteMarketCaps = { initial: number; migration: number };

export type CurvePreset = {
  id: PresetId;
  name: string;
  tagline: string;
  description: string;
  bestFor: string;
  feeLabel: string;
  /** Market caps per quote asset, in that quote's units. */
  marketCap: Record<PresetQuote, QuoteMarketCaps>;
  /** Why an equity-style issuer would pick this preset (in-product answer). */
  equityFit: string;
  /** Plain-language price path. */
  pricePath: string;
  /** What the issuer gives up with this preset. */
  tradeoffs: string;
  accent: string;
};

export const CURVE_PRESETS: CurvePreset[] = [
  {
    id: "short",
    name: "Short raise",
    tagline: "Small raise, fast graduation",
    description:
      "Lowest graduation threshold so the curve can complete and migrate to DAMM v2 without a long runway. Real SDK config, not a mock.",
    bestFor: "Pilot rounds, devnet demos, proving the full lifecycle",
    feeLabel: "Linear 150→50 bps over 30m",
    marketCap: {
      SOL: { initial: 2, migration: 10 },
      USDC: { initial: 500, migration: 2_500 },
    },
    equityFit:
      "A pilot or friends-and-community tranche: the issuer raises a small, known amount and reaches a conventional AMM pool quickly, so holders get continuous liquidity early.",
    pricePath:
      "Price rises 5× from first buy to graduation along one constant-liquidity segment. The threshold is small, so a few buys move the price a lot.",
    tradeoffs:
      "Little capital is raised before graduation, and a single large buyer can complete the curve. Low depth means high price impact per trade.",
    accent: "from-teal-400/25 to-sky-500/10",
  },
  {
    id: "flat",
    name: "Flat",
    tagline: "Steady discovery",
    description:
      "Moderate 15× start-to-graduation price range with a mild fee schedule. Early and late buyers see a similar slope.",
    bestFor: "Community equity rounds, employee / supporter pools",
    feeLabel: "Linear 200→50 bps over 1h",
    marketCap: {
      SOL: { initial: 30, migration: 450 },
      USDC: { initial: 5_000, migration: 75_000 },
    },
    equityFit:
      "A priced community round where fairness between early and late participants matters more than maximizing the raise. The mild fee decay discourages the very first snipes without punishing normal buyers.",
    pricePath:
      "Price rises 15× from first buy to graduation. Liquidity is constant across the single segment, so each unit of quote moves the price by a similar proportion.",
    tradeoffs:
      "Early buyers still get up to a 15× price advantage over the graduation price. A mid-sized raise needs real demand to complete.",
    accent: "from-sky-400/20 to-cyan-500/10",
  },
  {
    id: "exponential",
    name: "Exponential",
    tagline: "Steep early fees, then cruise",
    description:
      "Starts with a 9% trading fee that decays exponentially to 1%, plus dynamic fees and a first-swap min fee, to make sniping expensive in the first minutes.",
    bestFor: "High-demand listings where sniping is the main risk",
    feeLabel: "Exponential 900→100 bps",
    marketCap: {
      SOL: { initial: 50, migration: 750 },
      USDC: { initial: 8_000, migration: 120_000 },
    },
    equityFit:
      "An issuer expecting a rush at open: the high early fee is charged to whoever trades first (and paid to creator / partner), which counters bots racing for the lowest price.",
    pricePath:
      "Price rises 15× to graduation, like Flat. What is 'exponential' is the fee schedule: 900 bps at launch decaying toward 100 bps over 2 hours.",
    tradeoffs:
      "Genuine early supporters also pay the high fee. Dynamic fees make the exact fee harder to predict; always read the quote before signing.",
    accent: "from-fuchsia-400/20 to-violet-500/10",
  },
  {
    id: "long",
    name: "Long",
    tagline: "Extended bonding runway",
    description:
      "Wide 100× price range from a low start cap to a high graduation cap, so price discovery runs over a longer period before DAMM v2.",
    bestFor: "RWA-related raises that expect gradual demand",
    feeLabel: "Linear 150→40 bps over 6h",
    marketCap: {
      SOL: { initial: 15, migration: 1_500 },
      USDC: { initial: 2_500, migration: 250_000 },
    },
    equityFit:
      "Patient capital: the curve is the primary market for longer, and graduation to an AMM only happens after broad participation.",
    pricePath:
      "Price rises 100× from first buy to graduation. Early prices are very low relative to the graduation price.",
    tradeoffs:
      "Largest early-buyer advantage of any preset (up to 100×). It may take a long time to graduate, or never graduate, and liquidity stays on the curve until then.",
    accent: "from-amber-400/20 to-orange-500/10",
  },
  {
    id: "equity",
    name: "Equity-tuned",
    tagline: "Smooth fee decay, dynamic fee",
    description:
      "15× range with a gentle 120→35 bps fee decay over 4h and a dynamic fee that rises with volatility. EquiCurve's default for equity-inspired tokens.",
    bestFor: "Equity-inspired tokens with an established community",
    feeLabel: "Linear 120→35 bps + dynamic fee",
    marketCap: {
      SOL: { initial: 60, migration: 900 },
      USDC: { initial: 10_000, migration: 150_000 },
    },
    equityFit:
      "Keeps trading costs low for ordinary buyers while the dynamic fee charges more during volatile bursts, closer to how issuers expect a listed instrument to trade.",
    pricePath:
      "Price rises 15× to graduation along one constant-liquidity segment, with the largest raise of the 15× presets.",
    tradeoffs:
      "A larger raise must fill before graduation. Low base fees mean less anti-sniper protection than Exponential.",
    accent: "from-teal-400/25 to-emerald-500/10",
  },
];

export function getPreset(id: PresetId): CurvePreset {
  const found = CURVE_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown preset: ${id}`);
  return found;
}

/** Quote asset for a quote-decimals value (EquiCurve supports SOL=9, USDC=6). */
export function presetQuoteForDecimals(quoteDecimals: number | undefined): PresetQuote {
  return quoteDecimals === 6 ? "USDC" : "SOL";
}

/** Market caps (in quote units) a preset uses for the given quote. */
export function presetMarketCaps(id: PresetId, quote: PresetQuote): QuoteMarketCaps {
  return getPreset(id).marketCap[quote];
}

/** Graduation price ÷ starting price (supply is constant, so = migration MC ÷ initial MC). */
export function presetPriceMultiple(id: PresetId, quote: PresetQuote = "USDC"): number {
  const mc = presetMarketCaps(id, quote);
  return mc.migration / mc.initial;
}

export type FeeSpec = {
  mode: number;
  startingFeeBps: number;
  endingFeeBps: number;
  numberOfPeriod: number;
  totalDuration: number;
  dynamicFeeEnabled: boolean;
  creatorTradingFeePercentage: number;
  enableFirstSwapWithMinFee: boolean;
};

export const FEE_BY_PRESET: Record<PresetId, FeeSpec> = {
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

/** Pool creation fee in SOL (= 1,000,000 lamports; SDK min when non-zero). */
export const POOL_CREATION_FEE_SOL = 0.001;

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
  /**
   * Quote token decimals (9 = SOL/WSOL, 6 = USDC). Also selects which
   * quote-denominated market caps the preset uses (SOL vs USDC caps).
   */
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
 * Map launch form choices to buildPresetConfig overrides. Shared by Create
 * (prepareLaunchTransaction) and the pre-sign review so both describe the
 * exact same config.
 */
export function launchPresetOverrides(args: {
  totalSupply?: number;
  creatorTradingFeePercentage: number;
  lpLockPct: number;
  mintRenounce: boolean;
  antiSniper: boolean;
  quoteDecimals: 6 | 9;
  transferProfile: "open-spl" | "token-2022" | "transfer-hook";
}): BuildPresetOverrides {
  const wantsHook = args.transferProfile === "transfer-hook";
  const effectiveRenounce = wantsHook ? args.mintRenounce : true;
  return {
    totalTokenSupply: args.totalSupply || 1_000_000_000,
    creatorTradingFeePercentage: args.creatorTradingFeePercentage,
    lpLockPct: args.lpLockPct,
    mintRenounce: effectiveRenounce,
    antiSniper: args.antiSniper,
    quoteDecimals: args.quoteDecimals,
    tokenType: args.transferProfile === "open-spl" ? "spl" : "token-2022",
    allowMintAuthority: wantsHook && !effectiveRenounce,
  };
}

/**
 * Real Meteora ConfigParameters via buildCurveWithMarketCap.
 * Wizard fee / lock / mint controls map into these fields.
 */
export function buildPresetConfig(
  presetId: PresetId,
  opts: BuildPresetOverrides = {},
): ConfigParameters {
  const caps = presetMarketCaps(presetId, presetQuoteForDecimals(opts.quoteDecimals));
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
      // buildCurveWithMarketCap takes SOL units (converted ×1e9 internally).
      // 1_000_000 here meant 1,000,000 SOL (1e15 lamports) and failed SDK
      // validation (max 100 SOL). Intended value: 1,000,000 lamports.
      poolCreationFee: POOL_CREATION_FEE_SOL,
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
    // Quote-token units (SOL caps for SOL quote, USDC caps for USDC quote).
    initialMarketCap: caps.initial,
    migrationMarketCap: caps.migration,
  });
}

const thresholdCache = new Map<string, string>();

/**
 * migrationQuoteThreshold (quote atoms, exact integer string) that the preset
 * produces for a quote asset. This is the amount of quote the curve must hold
 * before it can migrate to DAMM v2. Computed with the same builder as Create.
 */
export function presetMigrationThresholdAtoms(id: PresetId, quote: PresetQuote): string {
  const key = `${id}:${quote}`;
  const hit = thresholdCache.get(key);
  if (hit) return hit;
  const cfg = buildPresetConfig(id, { quoteDecimals: quote === "USDC" ? 6 : 9 }) as {
    migrationQuoteThreshold: { toString(): string };
  };
  const v = cfg.migrationQuoteThreshold.toString();
  thresholdCache.set(key, v);
  return v;
}

/** Protocol share of every DBC trading fee (SDK PROTOCOL_FEE_PERCENT). */
export const DBC_PROTOCOL_FEE_PCT = 20;
/** Protocol share of the pool creation fee (SDK PROTOCOL_POOL_CREATION_FEE_PERCENT). */
export const DBC_PROTOCOL_POOL_CREATION_FEE_PCT = 10;

/**
 * Split of each trading fee on the curve. DBC takes PROTOCOL_FEE_PERCENT
 * (20%) for Meteora; the remaining 80% is split creator / partner by
 * creatorTradingFeePercentage. Percentages of the total fee, exact to 0.01.
 */
export function tradingFeeSplit(creatorTradingFeePercentage: number): {
  protocolPct: number;
  creatorPct: number;
  partnerPct: number;
} {
  const c = Math.min(100, Math.max(0, Math.round(creatorTradingFeePercentage)));
  const rest = 100 - DBC_PROTOCOL_FEE_PCT;
  const creatorPct = Math.round(rest * c) / 100;
  return {
    protocolPct: DBC_PROTOCOL_FEE_PCT,
    creatorPct,
    partnerPct: Math.round((rest - creatorPct) * 100) / 100,
  };
}

/** Meteora DBC hard limits EquiCurve enforces before building a create tx. */
export const DBC_CONSTRAINTS = {
  /** MAX_CURVE_POINT in the SDK / program. */
  maxCurvePoints: 16,
  /** MIN_LOCKED_LIQUIDITY_BPS = 1000 → 10% permanently locked after migration. */
  minLockedLiquidityPct: MIN_LP_LOCK_PCT,
  /** New configs must migrate to DAMM v2 (DAMM v1 is deprecated for new configs). */
  migrationOption: MigrationOption.MET_DAMM_V2,
} as const;

/**
 * Validate a built ConfigParameters against the DBC constraints above.
 * Returns human-readable violations (empty array = OK).
 */
export function validateEquiCurveConfig(cfg: ConfigParameters): string[] {
  const errs: string[] = [];
  const curve = (cfg as { curve?: unknown[] }).curve;
  if (!Array.isArray(curve) || curve.length === 0) {
    errs.push("Curve has no points.");
  } else if (curve.length > DBC_CONSTRAINTS.maxCurvePoints) {
    errs.push(
      `Curve has ${curve.length} points; Meteora DBC allows at most ${DBC_CONSTRAINTS.maxCurvePoints}.`,
    );
  }
  const partnerLocked = Number(cfg.partnerPermanentLockedLiquidityPercentage ?? 0);
  const creatorLocked = Number(cfg.creatorPermanentLockedLiquidityPercentage ?? 0);
  const partnerLp = Number(cfg.partnerLiquidityPercentage ?? 0);
  const creatorLp = Number(cfg.creatorLiquidityPercentage ?? 0);
  const vesting =
    Number((cfg as { partnerLiquidityVestingInfo?: { vestingPercentage?: number } }).partnerLiquidityVestingInfo?.vestingPercentage ?? 0) +
    Number((cfg as { creatorLiquidityVestingInfo?: { vestingPercentage?: number } }).creatorLiquidityVestingInfo?.vestingPercentage ?? 0);
  if (partnerLocked + creatorLocked < DBC_CONSTRAINTS.minLockedLiquidityPct) {
    errs.push(
      `Permanently locked liquidity is ${partnerLocked + creatorLocked}%; Meteora DBC requires at least ${DBC_CONSTRAINTS.minLockedLiquidityPct}%.`,
    );
  }
  const lpTotal = partnerLocked + creatorLocked + partnerLp + creatorLp + vesting;
  if (lpTotal !== 100) {
    errs.push(`LP percentages must sum to 100 (got ${lpTotal}).`);
  }
  if (Number(cfg.migrationOption) !== DBC_CONSTRAINTS.migrationOption) {
    errs.push("Migration target must be DAMM v2 for new configs.");
  }
  return errs;
}

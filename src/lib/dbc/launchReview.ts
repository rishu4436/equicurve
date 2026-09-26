/**
 * Pre-sign launch review (pure, unit-tested). Builds the exact
 * ConfigParameters Create will send (same builder + overrides) and lists
 * every on-chain setting in plain language before the wallet prompt.
 */
import { DAMM_V2_MIGRATION_FEE_ADDRESS } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { AmountError, formatAtoms, formatAtomsExact, parseUiAmount } from "@/lib/amounts";
import {
  buildPresetConfig,
  DBC_PROTOCOL_POOL_CREATION_FEE_PCT,
  FEE_BY_PRESET,
  getPreset,
  launchPresetOverrides,
  POOL_CREATION_FEE_SOL,
  presetMarketCaps,
  presetPriceMultiple,
  tradingFeeSplit,
} from "./presets";
import type { PresetId } from "./types";

export type LaunchReviewInput = {
  presetId: PresetId;
  quote: "SOL" | "USDC";
  /** Quote mint address for the active cluster (null = unavailable). */
  quoteMint: string | null;
  transferProfile: "open-spl" | "token-2022" | "transfer-hook";
  totalSupply: number;
  creatorPct: number;
  lpLockPct: number;
  mintRenounce: boolean;
  antiSniper: boolean;
  /** Raw form value (blank = connected wallet). */
  feeClaimer: string;
  wallet: string | null;
  seedBuy: string;
  cluster: string;
  /** NEXT_PUBLIC_POOL_CONFIG_KEY when set: pool-only mode on a shared config. */
  sharedConfig: string | null;
};

export type ReviewRow = {
  group: "Token" | "Curve" | "Fees" | "Liquidity" | "Authorities" | "Seed buy" | "Network";
  label: string;
  value: string;
  /** Config / instruction field this maps to. */
  field?: string;
  note?: string;
};

export type LaunchReview = {
  rows: ReviewRow[];
  errors: string[];
  migrationQuoteThresholdAtoms: string | null;
  curvePoints: number;
};

const Q64 = 1n << 64n;

/** sqrtPrice (Q64.64) → price in quote per base token, as a decimal string (bigint math). */
export function sqrtPriceToPriceString(sqrtPrice: bigint, baseDecimals: number, quoteDecimals: number, frac = 18): string {
  // price = (sqrt/2^64)^2 × 10^(base − quote)
  const scale = 10n ** BigInt(frac);
  let num = sqrtPrice * sqrtPrice * scale;
  let den = Q64 * Q64;
  const shift = baseDecimals - quoteDecimals;
  if (shift >= 0) num *= 10n ** BigInt(shift);
  else den *= 10n ** BigInt(-shift);
  return formatAtoms(num / den, frac, frac);
}

export function buildLaunchReview(i: LaunchReviewInput): LaunchReview {
  const errors: string[] = [];
  const rows: ReviewRow[] = [];
  const quoteDecimals = i.quote === "USDC" ? 6 : 9;
  const baseDecimals = 9;
  const preset = getPreset(i.presetId);
  const fee = FEE_BY_PRESET[i.presetId];
  const overrides = launchPresetOverrides({
    totalSupply: i.totalSupply,
    creatorTradingFeePercentage: i.creatorPct,
    lpLockPct: i.lpLockPct,
    mintRenounce: i.mintRenounce,
    antiSniper: i.antiSniper,
    quoteDecimals,
    transferProfile: i.transferProfile,
  });
  const cfg = buildPresetConfig(i.presetId, overrides) as unknown as {
    migrationQuoteThreshold: { toString(): string };
    sqrtStartPrice: { toString(): string };
    curve: { sqrtPrice: { toString(): string }; liquidity: { toString(): string } }[];
    creatorTradingFeePercentage: number;
    partnerPermanentLockedLiquidityPercentage: number;
    partnerLiquidityPercentage: number;
    creatorPermanentLockedLiquidityPercentage: number;
    creatorLiquidityPercentage: number;
    migrationFeeOption: number;
    tokenAuthorityOption: number;
  };
  const threshold = cfg.migrationQuoteThreshold.toString();
  const caps = presetMarketCaps(i.presetId, i.quote);
  const shared = !!i.sharedConfig;

  // Token
  const programId = i.transferProfile === "open-spl" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
  rows.push(
    {
      group: "Token",
      label: "Quote mint",
      value: i.quoteMint ? `${i.quote} · ${i.quoteMint}` : `${i.quote} · unavailable on ${i.cluster}`,
      field: "quoteMint",
    },
    {
      group: "Token",
      label: "Base token program",
      value: `${i.transferProfile === "open-spl" ? "SPL Token" : "Token-2022"} · ${programId.toBase58()}`,
      field: "tokenType",
      note: i.transferProfile === "transfer-hook" ? "Token-2022 with transfer hook (revoked when the curve completes)" : undefined,
    },
    {
      group: "Token",
      label: "Total supply",
      value: `${(i.totalSupply || 1_000_000_000).toLocaleString("en-US")} tokens`,
      field: "totalTokenSupply",
      note: "All minted into the curve at launch; no creator allocation or vesting.",
    },
    { group: "Token", label: "Decimals", value: `base ${baseDecimals} · quote ${quoteDecimals}`, field: "tokenBaseDecimal / tokenQuoteDecimal" },
  );
  if (!i.quoteMint) errors.push(`${i.quote} quote is not available on ${i.cluster}.`);

  // Curve
  const points = cfg.curve.length;
  rows.push(
    {
      group: "Curve",
      label: "Preset",
      value: `${preset.name} · ${presetPriceMultiple(i.presetId, i.quote)}× price range · market cap ${caps.initial.toLocaleString()} → ${caps.migration.toLocaleString()} ${i.quote}`,
      note: "Market caps are in quote-token units, not USD.",
    },
    {
      group: "Curve",
      label: "Start price",
      value: `${sqrtPriceToPriceString(BigInt(cfg.sqrtStartPrice.toString()), baseDecimals, quoteDecimals)} ${i.quote} / token`,
      field: "sqrtStartPrice",
    },
    {
      group: "Curve",
      label: `Curve points (${points})`,
      value: cfg.curve
        .map(
          (p, n) =>
            `#${n + 1}: to ${sqrtPriceToPriceString(BigInt(p.sqrtPrice.toString()), baseDecimals, quoteDecimals)} ${i.quote}/token · liquidity ${p.liquidity.toString()}`,
        )
        .join("\n"),
      field: "curve[]",
    },
    {
      group: "Curve",
      label: "Migration threshold",
      value: `${formatAtomsExact(threshold, quoteDecimals)} ${i.quote} (${threshold} atoms)`,
      field: "migrationQuoteThreshold",
      note: "Quote that must be in the curve before it can migrate to DAMM v2.",
    },
    { group: "Curve", label: "Migration target", value: "Meteora DAMM v2 (fixed)", field: "migrationOption = 1" },
  );
  if (points > 16) errors.push(`Curve has ${points} points; DBC allows 16.`);

  // Fees
  const split = tradingFeeSplit(cfg.creatorTradingFeePercentage);
  const feeClaimer = i.feeClaimer.trim() || i.wallet;
  rows.push(
    {
      group: "Fees",
      label: "Trading fee schedule",
      value: `${preset.feeLabel} (${fee.startingFeeBps}→${fee.endingFeeBps} bps over ${Math.round(fee.totalDuration / 60)} min)${fee.dynamicFeeEnabled ? " + dynamic fee" : ""}`,
      field: "poolFees.baseFee",
    },
    {
      group: "Fees",
      label: "Anti-sniper first swap",
      value: overrides.antiSniper ? "first swap charged the minimum fee (enableFirstSwapWithMinFee)" : "off",
      field: "enableFirstSwapWithMinFee",
    },
    {
      group: "Fees",
      label: "Fee split (of each trading fee)",
      value: `creator ${split.creatorPct}% · partner / fee claimer ${split.partnerPct}% · Meteora protocol ${split.protocolPct}%`,
      field: `creatorTradingFeePercentage = ${cfg.creatorTradingFeePercentage}`,
    },
    {
      group: "Fees",
      label: "Pool creation fee",
      value: `${POOL_CREATION_FEE_SOL} SOL (paid by creator; ${100 - DBC_PROTOCOL_POOL_CREATION_FEE_PCT}% partner / ${DBC_PROTOCOL_POOL_CREATION_FEE_PCT}% Meteora)`,
      field: "poolCreationFee",
    },
    {
      group: "Fees",
      label: "Migration",
      value: "no migration fee (0%) · DAMM v2 pool fee 1% (FixedBps100 config)",
      field: "migrationFee / migrationFeeOption",
    },
  );

  // Liquidity
  rows.push({
    group: "Liquidity",
    label: "LP after graduation",
    value: `partner permanently locked ${cfg.partnerPermanentLockedLiquidityPercentage}% · partner unlocked ${cfg.partnerLiquidityPercentage}% · creator ${cfg.creatorPermanentLockedLiquidityPercentage + cfg.creatorLiquidityPercentage}%`,
    field: "partnerPermanentLockedLiquidityPercentage",
    note: "Locked LP can never be withdrawn; its fees stay claimable by the partner / fee claimer. Meteora minimum is 10%.",
  });
  if (cfg.partnerPermanentLockedLiquidityPercentage < 10) errors.push("LP lock is below the 10% minimum.");

  // Authorities
  rows.push(
    {
      group: "Authorities",
      label: "Mint authority",
      value: overrides.mintRenounce
        ? "none after launch: supply is fixed (CreatorUpdateAuthority, creator keeps metadata update authority)"
        : "retained by creator (CreatorUpdateAndMintAuthority): creator can mint more tokens",
      field: `tokenAuthorityOption = ${cfg.tokenAuthorityOption}`,
    },
    {
      group: "Authorities",
      label: "Fee claimer (partner)",
      value: feeClaimer ?? "connected wallet (not connected yet)",
      field: "feeClaimer",
      note: i.feeClaimer.trim() ? "Custom address; it must sign partner claims." : "Defaults to the connected wallet.",
    },
    { group: "Authorities", label: "Leftover receiver", value: i.wallet ?? "connected wallet", field: "leftoverReceiver" },
  );

  // Seed buy
  const seed = i.seedBuy.trim();
  let seedValue = "none: no buy in the create transaction";
  if (seed && !/^0*(\.0*)?$/.test(seed)) {
    try {
      const atoms = parseUiAmount(seed, quoteDecimals);
      seedValue = `${formatAtomsExact(atoms, quoteDecimals)} ${i.quote} exactly (${atoms.toString()} atoms) · minimumAmountOut 0`;
      if (atoms >= BigInt(threshold)) {
        errors.push("Seed buy is at or above the migration threshold: it would complete the curve at launch.");
      }
    } catch (e) {
      errors.push(`Seed buy: ${e instanceof AmountError ? e.message : "invalid amount"}`);
      seedValue = "invalid";
    }
  }
  rows.push({
    group: "Seed buy",
    label: "Creator first buy",
    value: seedValue,
    field: "firstBuyParam.buyAmount",
    note: "Executed in the same flow as pool creation, before anyone else can trade.",
  });

  // Network
  rows.push({ group: "Network", label: "Cluster", value: i.cluster });
  const dammCfg = DAMM_V2_MIGRATION_FEE_ADDRESS[cfg.migrationFeeOption];
  if (dammCfg) rows.push({ group: "Network", label: "DAMM v2 config at migration", value: dammCfg.toBase58(), field: "migrationFeeOption" });
  if (shared) {
    rows.push({
      group: "Network",
      label: "Shared config",
      value: i.sharedConfig!,
      note: "NEXT_PUBLIC_POOL_CONFIG_KEY is set: only the pool is created, and curve / fee / lock settings come from that existing config, not the values above.",
    });
  }

  return {
    rows,
    errors,
    migrationQuoteThresholdAtoms: shared ? null : threshold,
    curvePoints: points,
  };
}

import type { CurveState } from "./curveState";
import type { DbcPoolKind } from "./poolAccount";

export type PresetId = "flat" | "exponential" | "long" | "equity" | "short";

export type QuoteLabel = "SOL" | "USDC";

export type { TransferProfile } from "./transferHook";

export type LaunchFormInput = {
  name: string;
  symbol: string;
  uri: string;
  presetId: PresetId;
  totalSupply: number;
  creatorTradingFeePercentage: number;
  lpLockPct: number;
  mintRenounce: boolean;
  /** Exact decimal string in quote units (e.g. "0.25"); "" / "0" = none. */
  seedBuyAmount: string;
  antiSniper: boolean;
  quoteLabel?: QuoteLabel;
  feeClaimer?: string;
  /** open-spl | token-2022 | transfer-hook */
  transferProfile?: import("./transferHook").TransferProfile;
};

export type PreparedLaunch = {
  mode: "config-and-pool" | "pool-only";
  presetId: PresetId;
  configPubkey: string;
  baseMintPubkey: string;
  poolPubkey: string;
  quoteMint: string;
  quoteLabel: QuoteLabel;
  lpLockPct: number;
  creatorTradingFeePercentage: number;
  mintRenounce: boolean;
  /** Seed buy in quote atoms (exact integer string); "0" = none. */
  seedBuyAtoms: string;
  /** Seed buy as entered (exact decimal string) for display. */
  seedBuyDisplay: string;
  feeClaimer: string;
  transferProfile: import("./transferHook").TransferProfile;
  transferHookProgram?: string;
  summary: {
    name: string;
    symbol: string;
    uri: string;
    /** Start market cap in QUOTE units (SOL or USDC), not USD. */
    initialMarketCapQuote: number;
    /** Graduation market cap in QUOTE units (SOL or USDC), not USD. */
    migrationMarketCapQuote: number;
    /** migrationQuoteThreshold of the built config (quote atoms). "" when using a shared config. */
    migrationQuoteThresholdAtoms: string;
    quoteDecimals: number;
    feeLabel: string;
    migration: string;
  };
};

/** Authoritative on-chain snapshot of a DBC pool + its config. */
export type PoolSnapshot = {
  pool: string;
  config: string;
  baseMint: string;
  /** null when the config account could not be read. */
  quoteMint: string | null;
  creator: string;
  kind: DbcPoolKind;
  feeClaimer: string | null;
  quoteReserve: string;
  migrationQuoteThreshold: string | null;
  isMigrated: boolean;
  migrationProgress: number;
  migrationOption: number | null;
  migrationFeeOption: number | null;
  baseDecimals: number | null;
  quoteDecimals: number | null;
  lockPct: number | null;
  creatorFeePct: number | null;
  curve: CurveState;
  /** 0..1 or null when unknown (never defaulted to 0). */
  quoteProgress: number | null;
  baseProgress: number | null;
  configRead: boolean;
  /** ISO time of the RPC read. */
  checkedAt: string;
};

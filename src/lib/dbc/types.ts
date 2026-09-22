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
  seedBuySol: number;
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
  seedBuySol: number;
  feeClaimer: string;
  transferProfile: import("./transferHook").TransferProfile;
  transferHookProgram?: string;
  summary: {
    name: string;
    symbol: string;
    uri: string;
    initialMarketCapUsd: number;
    migrationMarketCapUsd: number;
    feeLabel: string;
    migration: string;
  };
};

export type PoolSnapshot = {
  pool: string;
  config: string;
  baseMint: string;
  quoteMint: string;
  creator: string;
  quoteProgress: number;
  baseProgress: number;
  isMigrated: boolean;
  migrationThreshold?: string;
};

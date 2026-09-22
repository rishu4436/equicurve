export type PresetId = "flat" | "exponential" | "long" | "equity" | "short";

export type QuoteLabel = "SOL" | "USDC";

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

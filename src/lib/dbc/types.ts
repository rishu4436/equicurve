export type PresetId = "flat" | "exponential" | "long" | "equity" | "short";

export type LaunchFormInput = {
  name: string;
  symbol: string;
  uri: string;
  presetId: PresetId;
  totalSupply: number;
  /** Creator share of trading fees (0–100). Partner gets the rest. */
  creatorTradingFeePercentage: number;
  /** Permanently locked partner LP % after migration (≥10). */
  lpLockPct: number;
  /** true = no mint authority; false = creator retains mint. */
  mintRenounce: boolean;
  /** Optional initial buy in SOL (quote units). */
  seedBuySol: number;
  /** Maps to enableFirstSwapWithMinFee when true. */
  antiSniper: boolean;
};

export type PreparedLaunch = {
  mode: "config-and-pool" | "pool-only";
  presetId: PresetId;
  configPubkey: string;
  baseMintPubkey: string;
  poolPubkey: string;
  quoteMint: string;
  quoteLabel: "SOL";
  lpLockPct: number;
  creatorTradingFeePercentage: number;
  mintRenounce: boolean;
  seedBuySol: number;
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

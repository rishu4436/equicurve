export type PresetId = "flat" | "exponential" | "long" | "equity";

export type LaunchFormInput = {
  name: string;
  symbol: string;
  uri: string;
  presetId: PresetId;
  totalSupply: number;
};

export type PreparedLaunch = {
  mode: "config-and-pool" | "pool-only";
  presetId: PresetId;
  configPubkey: string;
  baseMintPubkey: string;
  poolPubkey: string;
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

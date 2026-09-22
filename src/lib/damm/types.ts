export type DammPoolSnapshot = {
  address: string;
  exists: boolean;
  /** How the address was obtained */
  source: "launch" | "derived" | "unknown";
  tokenAMint: string;
  tokenBMint: string;
  quoteMint: string;
  baseMint: string;
  /** Raw poolStatus from DAMM v2 (0 = enable). */
  poolStatus: number;
  activationType: number;
  sqrtPrice: string;
  tokenADecimals: number;
  tokenBDecimals: number;
};

export type DammPositionView = {
  position: string;
  positionNftAccount: string;
  unlockedLiquidity: string;
  feeAPending: string;
  feeBPending: string;
};

export type DammSwapDirection = "base_to_quote" | "quote_to_base";

export type DammQuoteResult = {
  amountIn: string;
  /** Expected out (excluded transfer fee when available). */
  amountOut: string;
  minimumAmountOut: string;
  priceImpactPct: string | null;
  inputMint: string;
  outputMint: string;
  inputDecimals: number;
  outputDecimals: number;
};

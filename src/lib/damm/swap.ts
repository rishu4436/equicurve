import {
  ActivationType,
  SwapMode,
  getCurrentPoint,
  getTokenProgram,
} from "@meteora-ag/cp-amm-sdk";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { AmountError, parseUiAmountToBN } from "@/lib/amounts";
import { EquiCurveError } from "@/lib/errors";
import { withRpcRetry } from "@/lib/rpc";
import { setFreshBlockhash } from "@/lib/send";
import { getCpAmm } from "./client";
import type {
  DammPoolSnapshot,
  DammQuoteResult,
  DammSwapDirection,
} from "./types";

/** Exact decimal string → atoms (no float). */
function uiToAmount(ui: string, decimals: number): BN {
  try {
    return parseUiAmountToBN(ui, decimals);
  } catch (e) {
    throw new EquiCurveError(
      e instanceof AmountError ? e.message : "Enter a positive amount.",
      "VALIDATION",
      e,
    );
  }
}

function pickMints(
  snap: DammPoolSnapshot,
  direction: DammSwapDirection,
): {
  inputMint: PublicKey;
  outputMint: PublicKey;
  inputDecimals: number;
  outputDecimals: number;
} {
  const tokenA = new PublicKey(snap.tokenAMint);
  const tokenB = new PublicKey(snap.tokenBMint);
  const base = new PublicKey(snap.baseMint);
  const quote = new PublicKey(snap.quoteMint);
  const baseIsA = base.equals(tokenA);

  if (direction === "quote_to_base") {
    if (quote.equals(tokenA) || !baseIsA) {
      return {
        inputMint: tokenA,
        outputMint: tokenB,
        inputDecimals: snap.tokenADecimals,
        outputDecimals: snap.tokenBDecimals,
      };
    }
    return {
      inputMint: tokenB,
      outputMint: tokenA,
      inputDecimals: snap.tokenBDecimals,
      outputDecimals: snap.tokenADecimals,
    };
  }

  if (baseIsA) {
    return {
      inputMint: tokenA,
      outputMint: tokenB,
      inputDecimals: snap.tokenADecimals,
      outputDecimals: snap.tokenBDecimals,
    };
  }
  return {
    inputMint: tokenB,
    outputMint: tokenA,
    inputDecimals: snap.tokenBDecimals,
    outputDecimals: snap.tokenADecimals,
  };
}

export async function quoteDammSwap(args: {
  connection: Connection;
  pool: PublicKey;
  snap: DammPoolSnapshot;
  direction: DammSwapDirection;
  /** Exact decimal string in input-token units. */
  amountUi: string;
  /** Slippage percent (1 = 1%). */
  slippagePct?: number;
}): Promise<DammQuoteResult> {
  const { connection, pool, snap, direction, amountUi, slippagePct = 1 } = args;
  if (!snap.exists) {
    throw new EquiCurveError(
      "DAMM v2 pool account not verified on this cluster — refusing to quote.",
      "SDK",
    );
  }

  const cp = getCpAmm(connection);
  const poolState = await withRpcRetry(() => cp.fetchPoolState(pool));
  const { inputMint, outputMint, inputDecimals, outputDecimals } = pickMints(
    snap,
    direction,
  );
  const amountIn = uiToAmount(amountUi, inputDecimals);
  const currentPoint = await getCurrentPoint(
    connection,
    Number(poolState.activationType) as ActivationType,
  );

  const quote = cp.getQuote2({
    inputTokenMint: inputMint,
    slippage: slippagePct,
    currentPoint,
    poolState,
    tokenADecimal: snap.tokenADecimals,
    tokenBDecimal: snap.tokenBDecimals,
    hasReferral: false,
    swapMode: SwapMode.ExactIn,
    amountIn,
  });

  const q = quote as {
    excludedTransferFeeAmountOut?: BN;
    includedTransferFeeAmountOut?: BN;
    minimumAmountOut?: BN;
    priceImpact?: { toFixed: (n: number) => string } | string | number;
  };

  const amountOutBn =
    q.excludedTransferFeeAmountOut ??
    q.includedTransferFeeAmountOut ??
    q.minimumAmountOut ??
    new BN(0);
  const minOut = q.minimumAmountOut ?? amountOutBn;

  let priceImpactPct: string | null = null;
  if (q.priceImpact != null) {
    const impact = q.priceImpact;
    priceImpactPct =
      typeof impact === "object" && impact && "toFixed" in impact
        ? impact.toFixed(4)
        : String(impact);
  }

  return {
    amountIn: amountIn.toString(),
    amountOut: amountOutBn.toString(),
    minimumAmountOut: minOut.toString(),
    priceImpactPct,
    inputMint: inputMint.toBase58(),
    outputMint: outputMint.toBase58(),
    inputDecimals,
    outputDecimals,
  };
}

export async function buildDammSwapTx(args: {
  connection: Connection;
  payer: PublicKey;
  pool: PublicKey;
  snap: DammPoolSnapshot;
  direction: DammSwapDirection;
  /** Exact decimal string in input-token units. */
  amountUi: string;
  slippagePct?: number;
}): Promise<{ tx: Transaction; quote: DammQuoteResult }> {
  const { connection, payer, pool, snap, direction, amountUi, slippagePct = 1 } =
    args;
  if (!payer) {
    throw new EquiCurveError(
      "Connect a wallet to swap on DAMM v2.",
      "MISSING_WALLET",
    );
  }

  const quote = await quoteDammSwap({
    connection,
    pool,
    snap,
    direction,
    amountUi,
    slippagePct,
  });

  const cp = getCpAmm(connection);
  const poolState = await withRpcRetry(() => cp.fetchPoolState(pool));

  const tx = await cp.swap2({
    payer,
    pool,
    inputTokenMint: new PublicKey(quote.inputMint),
    outputTokenMint: new PublicKey(quote.outputMint),
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: getTokenProgram(Number(poolState.tokenAFlag)),
    tokenBProgram: getTokenProgram(Number(poolState.tokenBFlag)),
    referralTokenAccount: null,
    poolState,
    swapMode: SwapMode.ExactIn,
    amountIn: new BN(quote.amountIn),
    minimumAmountOut: new BN(quote.minimumAmountOut),
  });

  await setFreshBlockhash(connection, tx, payer);
  return { tx, quote };
}

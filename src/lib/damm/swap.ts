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

/** UI slippage percent (1 = 1%) → basis points for the cp-amm SDK. */
export function slippagePctToBps(pct: number): number {
  if (!Number.isFinite(pct) || pct <= 0 || pct > 50) {
    throw new EquiCurveError("Slippage must be between 0.01% and 50%.", "VALIDATION");
  }
  return Math.max(1, Math.round(pct * 100));
}

/**
 * Map a cp-amm `getQuote2` ExactIn result to (expected out, min out).
 * SDK semantics: `outputAmount` = expected output after trading fees;
 * `minimumAmountOut` = outputAmount reduced by slippage. Never label the
 * minimum as the expected amount.
 */
export function dammQuoteAmounts(quote: { outputAmount?: BN; minimumAmountOut?: BN }): {
  amountOut: BN;
  minimumAmountOut: BN;
} {
  const out = quote.outputAmount;
  const min = quote.minimumAmountOut;
  if (!out || !min) {
    throw new EquiCurveError("DAMM v2 quote is missing output amounts.", "SDK");
  }
  if (out.isZero() || min.isZero()) {
    throw new EquiCurveError("Quote returned zero output — amount too small.", "VALIDATION");
  }
  return { amountOut: out, minimumAmountOut: min };
}

/** Input/output mint + decimals for a direction, for either token order. Exported for tests. */
export function pickMints(
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

/** Deterministic key of the DAMM v2 pool state a quote depends on. */
export function dammPoolStateKey(state: { sqrtPrice?: unknown; liquidity?: unknown }): string {
  const s = (v: unknown) => (v == null ? "?" : String((v as { toString(): string }).toString()));
  return `${s(state.sqrtPrice)}:${s(state.liquidity)}`;
}

/** Re-read the pool and return its state key (null when the read fails). */
export async function fetchDammPoolStateKey(connection: Connection, pool: PublicKey): Promise<string | null> {
  try {
    const st = await withRpcRetry(() => getCpAmm(connection).fetchPoolState(pool));
    return dammPoolStateKey(st as never);
  } catch {
    return null;
  }
}

type CpPoolState = Awaited<ReturnType<ReturnType<typeof getCpAmm>["fetchPoolState"]>>;

export async function quoteDammSwap(args: {
  connection: Connection;
  pool: PublicKey;
  /** Optional pre-fetched pool state so quote and tx use the same state. */
  poolState?: CpPoolState;
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
  const poolState = args.poolState ?? (await withRpcRetry(() => cp.fetchPoolState(pool)));
  const { inputMint, outputMint, inputDecimals, outputDecimals } = pickMints(
    snap,
    direction,
  );
  const amountIn = uiToAmount(amountUi, inputDecimals);
  const slippageBps = slippagePctToBps(slippagePct);
  const currentPoint = await getCurrentPoint(
    connection,
    Number(poolState.activationType) as ActivationType,
  );

  const quote = cp.getQuote2({
    inputTokenMint: inputMint,
    // cp-amm getQuote2 takes slippage in BASIS POINTS (getAmountWithSlippage);
    // passing the UI percent directly made 1% act as 0.01%.
    slippage: slippageBps,
    currentPoint,
    poolState,
    tokenADecimal: snap.tokenADecimals,
    tokenBDecimal: snap.tokenBDecimals,
    hasReferral: false,
    swapMode: SwapMode.ExactIn,
    amountIn,
  });

  const { amountOut: amountOutBn, minimumAmountOut: minOut } = dammQuoteAmounts(quote);

  let priceImpactPct: string | null = null;
  const q = quote as { priceImpact?: { toFixed: (n: number) => string } | string | number };
  if (q.priceImpact != null) {
    const impact = q.priceImpact;
    priceImpactPct =
      typeof impact === "object" && impact && "toFixed" in impact
        ? impact.toFixed(4)
        : String(impact);
  }

  const fq = quote as unknown as Record<string, BN | undefined>;
  const feeTotal = ["claimingFee", "protocolFee", "compoundingFee", "referralFee"].reduce(
    (acc, k) => acc + BigInt(fq[k] ? fq[k]!.toString(10) : "0"),
    0n,
  );
  // DAMM v2 collectFeeMode: 1 = OnlyB (fee always in token B); otherwise the fee is taken from the output token.
  const onlyB = Number((poolState as { collectFeeMode?: number }).collectFeeMode) === 1;
  const feeMint = onlyB ? new PublicKey(snap.tokenBMint) : outputMint;
  const feeDecimals = onlyB ? snap.tokenBDecimals : outputDecimals;

  return {
    feeAtoms: feeTotal.toString(10),
    feeMint: feeMint.toBase58(),
    feeDecimals,
    slippageBps,
    quotedAt: Date.now(),
    poolStateKey: dammPoolStateKey(poolState as never),
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

  const cp = getCpAmm(connection);
  const poolState = await withRpcRetry(() => cp.fetchPoolState(pool));
  // Quote and tx are built from the same pool state; the minimum output the
  // user reviews is exactly the one enforced on-chain.
  const quote = await quoteDammSwap({
    connection,
    pool,
    poolState,
    snap,
    direction,
    amountUi,
    slippagePct,
  });

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

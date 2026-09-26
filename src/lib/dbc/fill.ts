/**
 * Buy sizing against the end of the bonding curve (pure, unit-tested).
 *
 * DBC ExactIn buys that would push the pool past its migration price fail
 * on-chain with 6033 InsufficientLiquidity (the SDK ExactIn quote throws
 * "Insufficient Liquidity"). EquiCurve detects this before sending and
 * switches to DBC's PartialFill swap mode: the program fills only up to the
 * migration threshold and consumes just the quote needed; the unused part of
 * the input stays in the wallet.
 */
import type BN from "bn.js";

export type DbcQuoteLike = {
  outputAmount: BN;
  minimumAmountOut: BN;
  /** Input incl. fee actually consumed (atoms). */
  includedFeeInputAmount?: BN;
  /** Input left unfilled (partial fill only). */
  amountLeft?: BN;
  tradingFee?: BN;
  protocolFee?: BN;
  referralFee?: BN;
};

export type BuyPlan = {
  mode: "exact_in" | "partial_fill";
  quote: DbcQuoteLike;
  /** Exact input the user asked for (atoms). */
  requestedIn: bigint;
  /** Input the curve will actually consume (atoms, incl. fee). */
  fillableIn: bigint;
  /** requestedIn − fillableIn (atoms) — never taken from the wallet. */
  unusedIn: bigint;
  /** True when the quote says this buy reaches the migration threshold. */
  completesCurve: boolean;
};

export function isInsufficientLiquidityError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /insufficient liquidity|InsufficientLiquidity|\b6033\b|0x1791/i.test(msg);
}

const big = (v: BN | undefined | null): bigint => (v ? BigInt(v.toString(10)) : 0n);

/**
 * Decide ExactIn vs PartialFill for a buy.
 * @param remainingToThreshold quote atoms still needed to reach the threshold (null = unknown)
 * @param nearEndBps buys whose curve-side input reaches ≥ (1 − nearEndBps) of the
 *   remaining amount also use PartialFill (fee schedules decay over time, so an
 *   ExactIn quote at the very end can still overshoot when it lands).
 */
export function planBuy(args: {
  requestedIn: bigint;
  remainingToThreshold: bigint | null;
  quoteExactIn: () => DbcQuoteLike;
  quotePartialFill: () => DbcQuoteLike;
  nearEndBps?: number;
}): BuyPlan {
  const { requestedIn, remainingToThreshold } = args;
  const nearEndBps = BigInt(args.nearEndBps ?? 200);
  let exact: DbcQuoteLike | null = null;
  try {
    exact = args.quoteExactIn();
  } catch (e) {
    if (!isInsufficientLiquidityError(e)) throw e;
  }
  if (exact) {
    const fee = big(exact.tradingFee) + big(exact.protocolFee) + big(exact.referralFee);
    const toCurve = requestedIn - fee;
    const nearEnd =
      remainingToThreshold != null &&
      remainingToThreshold > 0n &&
      toCurve * 10_000n >= remainingToThreshold * (10_000n - nearEndBps);
    if (!nearEnd) {
      return { mode: "exact_in", quote: exact, requestedIn, fillableIn: requestedIn, unusedIn: 0n, completesCurve: false };
    }
  }
  const partial = args.quotePartialFill();
  const consumed = partial.includedFeeInputAmount ? big(partial.includedFeeInputAmount) : requestedIn;
  const left = big(partial.amountLeft);
  const fillableIn = consumed > requestedIn ? requestedIn : consumed;
  return {
    mode: "partial_fill",
    quote: partial,
    requestedIn,
    fillableIn,
    unusedIn: requestedIn - fillableIn,
    completesCurve: left > 0n || exact == null,
  };
}

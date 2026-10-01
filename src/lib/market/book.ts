import BN from "bn.js";
import {
  getMigrationThresholdPrice,
  swapQuotePartialFill,
  type ConfigParameters,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { sqrtPriceToPriceString } from "@/lib/dbc/launchReview";

/**
 * In-memory DBC pool.
 *
 * Quotes come from Meteora's `swapQuotePartialFill` (the same math as the program).
 * Reserves follow `PoolState::apply_swap_result` in the DBC program:
 * - A buy adds the post-fee quote (the amount that entered the curve) to quoteReserve.
 * - A sell subtracts the gross quote that left the curve (output plus the fee taken from it).
 * Graduation is quoteReserve >= migrationQuoteThreshold. Fees never count as raised capital.
 */

const BASE_DECIMALS = 9;

type CurvePoint = { sqrtPrice: BN; liquidity: BN };

export type BuiltConfig = ConfigParameters & {
  migrationQuoteThreshold: BN;
  sqrtStartPrice: BN;
  collectFeeMode: number;
  curve: CurvePoint[];
  poolFees: {
    baseFee: {
      cliffFeeNumerator: BN;
      firstFactor: number;
      secondFactor: BN;
      thirdFactor: BN;
      baseFeeMode: number;
    };
    dynamicFee: { initialized?: number; binStep?: number; variableFeeControl?: number } | null;
  };
  enableFirstSwapWithMinFee?: boolean;
  creatorTradingFeePercentage: number;
  partnerPermanentLockedLiquidityPercentage: number;
};

export type CurveBook = {
  config: BuiltConfig;
  threshold: bigint;
  sqrtStart: bigint;
  quoteDecimals: number;
  dynamicFeeEnabled: boolean;
};

export type BookState = {
  sqrtPrice: bigint;
  quoteReserve: bigint;
  /** Base tokens currently held by simulated buyers. Sells cannot exceed this. */
  heldBase: bigint;
  feesAtoms: bigint;
  trades: number;
};

export type FillSide = "buy" | "sell";

export type Fill = {
  side: FillSide;
  skipped: boolean;
  /** Quote atoms paid (buy) or base atoms sold (sell), after a partial fill. */
  filledInputAtoms: bigint;
  /** The other side: base out for a buy, quote out for a sell (net of fees on a sell). */
  outputAtoms: bigint;
  /** Quote atoms added to the curve on a buy. Zero on a sell. */
  reserveAddedAtoms: bigint;
  feeAtoms: bigint;
  unusedAtoms: bigint;
  impactBps: number;
  completed: boolean;
};

function bn(n: bigint): BN {
  return new BN(n.toString(10));
}

function bi(n: BN | { toString(): string }): bigint {
  return BigInt(n.toString());
}

export function openBook(cfg: ConfigParameters, quoteDecimals: number): CurveBook {
  const built = cfg as BuiltConfig;
  if (!built.curve?.length) {
    throw new Error("Config has no curve points.");
  }
  const dynamic = built.poolFees.dynamicFee;
  const dynamicFee = dynamic
    ? { ...dynamic, initialized: dynamic.initialized ?? 1 }
    : { initialized: 0, binStep: 0, variableFeeControl: 0 };
  const migrationSqrtPrice = getMigrationThresholdPrice(
    built.migrationQuoteThreshold,
    built.sqrtStartPrice,
    built.curve,
  );
  const config = {
    ...built,
    migrationSqrtPrice,
    poolFees: { ...built.poolFees, dynamicFee },
  } as BuiltConfig;
  return {
    config,
    threshold: bi(built.migrationQuoteThreshold),
    sqrtStart: bi(built.sqrtStartPrice),
    quoteDecimals,
    dynamicFeeEnabled: Boolean(dynamic && (dynamic.initialized ?? 1) !== 0),
  };
}

export function initialState(book: CurveBook): BookState {
  return {
    sqrtPrice: book.sqrtStart,
    quoteReserve: 0n,
    heldBase: 0n,
    feesAtoms: 0n,
    trades: 0,
  };
}

export function priceString(sqrtPrice: bigint, quoteDecimals: number): string {
  return sqrtPriceToPriceString(sqrtPrice, BASE_DECIMALS, quoteDecimals);
}

/** Signed price move in basis points. Uses sqrtPrice², so decimals cancel. */
export function moveBps(beforeSqrt: bigint, afterSqrt: bigint): number {
  if (beforeSqrt === 0n) return 0;
  const before = beforeSqrt * beforeSqrt;
  const after = afterSqrt * afterSqrt;
  const delta = after >= before ? after - before : before - after;
  const bps = (delta * 10_000n) / before;
  const n = bps > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(bps);
  return after >= before ? n : -n;
}

function emptyFill(side: FillSide, unused: bigint, completed: boolean): Fill {
  return {
    side,
    skipped: true,
    filledInputAtoms: 0n,
    outputAtoms: 0n,
    reserveAddedAtoms: 0n,
    feeAtoms: 0n,
    unusedAtoms: unused,
    impactBps: 0,
    completed,
  };
}

type QuoteResult = {
  outputAmount: BN;
  includedFeeInputAmount: BN;
  excludedFeeInputAmount: BN;
  amountLeft: BN;
  tradingFee: BN;
  protocolFee: BN;
  referralFee: BN;
  nextSqrtPrice: BN;
};

function quote(
  book: CurveBook,
  state: BookState,
  swapBaseForQuote: boolean,
  amountIn: bigint,
  atSec: number,
): QuoteResult {
  const virtualPool = {
    poolState: {
      sqrtPrice: bn(state.sqrtPrice),
      baseReserve: bn(0n),
      quoteReserve: bn(state.quoteReserve),
      activationPoint: bn(0n),
      volatilityTracker: {
        lastUpdateTimestamp: bn(0n),
        sqrtPriceReference: bn(0n),
        volatilityAccumulator: bn(0n),
        volatilityReference: bn(0n),
        padding: [0, 0, 0],
      },
    },
  };
  return swapQuotePartialFill(
    virtualPool as never,
    book.config as never,
    swapBaseForQuote,
    bn(amountIn),
    0,
    false,
    bn(BigInt(Math.max(0, Math.floor(atSec)))),
    false,
  ) as QuoteResult;
}

export function applyBuy(book: CurveBook, state: BookState, quoteAtoms: bigint, atSec: number): { state: BookState; fill: Fill } {
  const completed = state.quoteReserve >= book.threshold;
  if (completed || quoteAtoms <= 0n) {
    return { state, fill: emptyFill("buy", quoteAtoms > 0n ? quoteAtoms : 0n, completed) };
  }
  const q = quote(book, state, false, quoteAtoms, atSec);
  const fee = bi(q.tradingFee) + bi(q.protocolFee) + bi(q.referralFee);
  const added = bi(q.excludedFeeInputAmount);
  const nextSqrt = bi(q.nextSqrtPrice);
  const next: BookState = {
    sqrtPrice: nextSqrt,
    quoteReserve: state.quoteReserve + added,
    heldBase: state.heldBase + bi(q.outputAmount),
    feesAtoms: state.feesAtoms + fee,
    trades: state.trades + 1,
  };
  return {
    state: next,
    fill: {
      side: "buy",
      skipped: false,
      filledInputAtoms: bi(q.includedFeeInputAmount),
      outputAtoms: bi(q.outputAmount),
      reserveAddedAtoms: added,
      feeAtoms: fee,
      unusedAtoms: bi(q.amountLeft),
      impactBps: moveBps(state.sqrtPrice, nextSqrt),
      completed: next.quoteReserve >= book.threshold,
    },
  };
}

export function applySell(book: CurveBook, state: BookState, baseAtoms: bigint, atSec: number): { state: BookState; fill: Fill } {
  // The program rejects every swap once the curve is complete, including sells.
  const completed = state.quoteReserve >= book.threshold;
  const capped = baseAtoms > state.heldBase ? state.heldBase : baseAtoms;
  if (completed || capped <= 0n || state.sqrtPrice <= book.sqrtStart) {
    return { state, fill: emptyFill("sell", baseAtoms > 0n ? baseAtoms : 0n, completed) };
  }
  const q = quote(book, state, true, capped, atSec);
  const fee = bi(q.tradingFee) + bi(q.protocolFee) + bi(q.referralFee);
  // Fees are taken from the quote output, and the reserve loses the gross amount.
  const grossQuoteOut = bi(q.outputAmount) + fee;
  if (grossQuoteOut > state.quoteReserve) {
    throw new Error("Sell withdrew more quote than the curve reserve. The simulator and the program disagree.");
  }
  const soldBase = bi(q.excludedFeeInputAmount);
  const nextSqrt = bi(q.nextSqrtPrice);
  const next: BookState = {
    sqrtPrice: nextSqrt,
    quoteReserve: state.quoteReserve - grossQuoteOut,
    heldBase: state.heldBase - soldBase,
    feesAtoms: state.feesAtoms + fee,
    trades: state.trades + 1,
  };
  return {
    state: next,
    fill: {
      side: "sell",
      skipped: false,
      filledInputAtoms: soldBase,
      outputAtoms: bi(q.outputAmount),
      reserveAddedAtoms: 0n,
      feeAtoms: fee,
      unusedAtoms: bi(q.amountLeft) + (baseAtoms > capped ? baseAtoms - capped : 0n),
      impactBps: moveBps(state.sqrtPrice, nextSqrt),
      completed: next.quoteReserve >= book.threshold,
    },
  };
}

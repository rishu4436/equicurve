/**
 * Seed-buy quote for the swap appended to pool creation.
 *
 * The builder calls Meteora `swap` (or `swap2` for a transfer-hook pool) with
 * `SwapParameters { amount_in: u64, minimum_amount_out: u64 }`. The program
 * returns ExceededSlippage (6002) when the base tokens received are below
 * `minimum_amount_out`. A zero minimum disables that check.
 *
 * `swapQuoteExactIn` applies slippage as:
 * - 0 bps: minimumAmountOut = outputAmount
 * - n bps: minimumAmountOut = floor(outputAmount * (10_000 - n) / 10_000)
 *
 * The seed buy sits in the same transaction as initialize_pool. The program
 * treats it as the first swap only when the config enables the minimum fee,
 * the pool has not traded, and that initialize instruction is in the
 * transaction (it checks the instructions sysvar, which this SDK builder
 * always includes). No other swap can change the price first. The pre-pool
 * quote uses activation point 0 and current point 0, which is elapsed fee
 * time 0, the same moment the pool is created.
 *
 * The tolerance is therefore 0 bps: the encoded minimum is the quoted output.
 * It is nonzero whenever that output is nonzero. A trade-style percentage is
 * the wrong parameter. Trades can move between quote and landing; this swap
 * cannot. A positive bps also uses floor division, so a 1-atom output at 1 bps
 * becomes a minimum of 0 and the check disappears.
 *
 * If a devnet send fails with 6002, the atom gap between this quote and the
 * program is the evidence for a later tolerance. Do not guess a percent first.
 */
import { SwapMode, type DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { DBC_PROGRAM_ID } from "@/lib/constants";
import { EquiCurveError } from "@/lib/errors";

/** Documented seed-buy tolerance. See the file comment. Not the trade default. */
export const SEED_BUY_SLIPPAGE_BPS = 0;

const SLIPPAGE_DENOMINATOR = 10_000;
const U64_MAX = new BN("18446744073709551615");

/** v1 `swap` discriminator, then amount_in u64 LE, minimum_amount_out u64 LE. */
export const DBC_SWAP_DISCRIMINATOR = Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]);

/** `swap2` discriminator, then amount_0 u64 LE, amount_1 u64 LE, swap_mode u8. */
export const DBC_SWAP2_DISCRIMINATOR = Buffer.from([65, 75, 63, 76, 235, 91, 91, 136]);

export type SeedBuyQuote = {
  amountIn: BN;
  /** Base atoms the quote expects the buyer to receive. */
  outputAmount: BN;
  /** Value encoded as minimum_amount_out. Equal to outputAmount at 0 bps. */
  minimumAmountOut: BN;
  /** Quote atoms that enter the curve after an input fee. */
  excludedFeeInputAmount: BN;
  slippageBps: number;
  /** Copied from the config that the create transaction will write or reuse. */
  eligibleForFirstSwapWithMinFee: boolean;
};

export type EncodedDbcSwap = {
  kind: "swap" | "swap2";
  amountIn: bigint;
  minimumAmountOut: bigint;
};

type QuoteConfig = {
  enableFirstSwapWithMinFee?: unknown;
};

function asU64(value: unknown, label: string): BN {
  if (!BN.isBN(value) || value.isNeg() || value.gt(U64_MAX)) {
    throw new EquiCurveError(
      `Seed-buy quote rejected: ${label} is missing or not a u64.`,
      "VALIDATION",
    );
  }
  return value;
}

/**
 * The config flag, not the SDK builder argument. createPoolWithFirstBuy always
 * passes true into the builder, and that only attaches the instructions sysvar.
 * The program applies the minimum fee when this flag is set and the swap is
 * the first swap in the initialize transaction.
 */
export function configEnablesFirstSwapMinFee(config: QuoteConfig): boolean {
  const raw = config.enableFirstSwapWithMinFee;
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  throw new EquiCurveError(
    "Seed-buy quote rejected: the curve config does not say whether the first swap uses the minimum fee.",
    "VALIDATION",
  );
}

/** Same integer formula as SDK `swapQuoteExactIn`. */
export function applySeedBuySlippage(outputAmount: BN, slippageBps: number): BN {
  if (!BN.isBN(outputAmount) || outputAmount.isNeg()) {
    throw new EquiCurveError("Seed-buy quote rejected: expected output is missing or not a u64.", "VALIDATION");
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > SLIPPAGE_DENOMINATOR) {
    throw new EquiCurveError("Seed-buy slippage must be an integer from 0 to 10000 bps.", "VALIDATION");
  }
  if (slippageBps === 0) return outputAmount.clone();
  return outputAmount.mul(new BN(SLIPPAGE_DENOMINATOR - slippageBps)).div(new BN(SLIPPAGE_DENOMINATOR));
}

export function assertSeedBuyQuote(
  quote: {
    outputAmount?: BN;
    minimumAmountOut?: BN;
    includedFeeInputAmount?: BN;
    excludedFeeInputAmount?: BN;
    amountLeft?: BN;
    referralFee?: BN;
  } | null | undefined,
  amountIn: BN,
  eligibleForFirstSwapWithMinFee: boolean,
): SeedBuyQuote {
  if (!quote) {
    throw new EquiCurveError("Seed-buy quote rejected: the quote is missing.", "VALIDATION");
  }
  const input = asU64(amountIn, "seed buy amount");
  if (input.isZero()) {
    throw new EquiCurveError("Seed-buy quote rejected: the buy amount is zero.", "VALIDATION");
  }
  const outputAmount = asU64(quote.outputAmount, "expected output");
  if (outputAmount.isZero()) {
    throw new EquiCurveError("Seed-buy quote rejected: expected output is zero.", "VALIDATION");
  }
  const amountLeft = asU64(quote.amountLeft, "unfilled input");
  if (!amountLeft.isZero()) {
    throw new EquiCurveError(
      "Seed-buy quote rejected: the quote did not consume the full seed buy.",
      "VALIDATION",
    );
  }
  const included = asU64(quote.includedFeeInputAmount, "quoted input");
  if (!included.eq(input)) {
    throw new EquiCurveError(
      "Seed-buy quote rejected: the quote input does not match the seed buy.",
      "VALIDATION",
    );
  }
  const excludedFeeInputAmount = asU64(quote.excludedFeeInputAmount, "curve input");
  if (excludedFeeInputAmount.gt(included)) {
    throw new EquiCurveError(
      "Seed-buy quote rejected: the curve input is larger than the seed buy.",
      "VALIDATION",
    );
  }
  const referralFee = asU64(quote.referralFee, "referral fee");
  if (!referralFee.isZero()) {
    throw new EquiCurveError(
      "Seed-buy quote rejected: the quote includes a referral fee, and the seed buy has no referral account.",
      "VALIDATION",
    );
  }
  const expectedMin = applySeedBuySlippage(outputAmount, SEED_BUY_SLIPPAGE_BPS);
  if (expectedMin.isZero()) {
    throw new EquiCurveError(
      `Seed-buy quote rejected: the ${SEED_BUY_SLIPPAGE_BPS} bps tolerance rounded the minimum output to zero.`,
      "VALIDATION",
    );
  }
  const minimumAmountOut = asU64(quote.minimumAmountOut, "minimum output");
  if (minimumAmountOut.isZero()) {
    throw new EquiCurveError("Seed-buy quote rejected: minimum output is zero.", "VALIDATION");
  }
  if (minimumAmountOut.gt(outputAmount)) {
    throw new EquiCurveError(
      "Seed-buy quote rejected: minimum output is above the quoted output.",
      "VALIDATION",
    );
  }
  if (!minimumAmountOut.eq(expectedMin)) {
    throw new EquiCurveError(
      `Seed-buy quote rejected: minimum output does not match the documented ${SEED_BUY_SLIPPAGE_BPS} bps tolerance.`,
      "VALIDATION",
    );
  }
  return {
    amountIn: input,
    outputAmount,
    minimumAmountOut,
    excludedFeeInputAmount,
    slippageBps: SEED_BUY_SLIPPAGE_BPS,
    eligibleForFirstSwapWithMinFee,
  };
}

/**
 * Quote the seed buy from the config object the transaction will use.
 * Rejects a missing, invalid, zero, or inconsistent result before signing.
 */
export function quoteSeedBuy(
  client: DynamicBondingCurveClient,
  config: QuoteConfig,
  amountIn: BN,
): SeedBuyQuote {
  const input = asU64(amountIn, "seed buy amount");
  if (input.isZero()) {
    throw new EquiCurveError("Seed-buy quote rejected: the buy amount is zero.", "VALIDATION");
  }
  const eligibleForFirstSwapWithMinFee = configEnablesFirstSwapMinFee(config);
  let raw: Parameters<typeof assertSeedBuyQuote>[0];
  try {
    raw = client.pool.getQuoteFromInputAmount({
      config: config as never,
      swapBaseForQuote: false,
      amountIn: input,
      swapMode: SwapMode.ExactIn,
      slippageBps: SEED_BUY_SLIPPAGE_BPS,
      hasReferral: false,
      currentPoint: new BN(0),
      eligibleForFirstSwapWithMinFee,
    });
  } catch (e) {
    if (e instanceof EquiCurveError) throw e;
    const detail = e instanceof Error ? e.message : "the quote failed";
    throw new EquiCurveError(`Seed-buy quote rejected: ${detail}.`, "VALIDATION", e);
  }
  return assertSeedBuyQuote(raw, input, eligibleForFirstSwapWithMinFee);
}

export function decodeSwapInstructionData(data: Uint8Array): EncodedDbcSwap | null {
  const buf = Buffer.from(data);
  if (buf.length >= 24 && buf.subarray(0, 8).equals(DBC_SWAP_DISCRIMINATOR)) {
    return {
      kind: "swap",
      amountIn: buf.readBigUInt64LE(8),
      minimumAmountOut: buf.readBigUInt64LE(16),
    };
  }
  if (
    buf.length >= 25 &&
    buf.subarray(0, 8).equals(DBC_SWAP2_DISCRIMINATOR) &&
    buf[24] === SwapMode.ExactIn
  ) {
    return {
      kind: "swap2",
      amountIn: buf.readBigUInt64LE(8),
      minimumAmountOut: buf.readBigUInt64LE(16),
    };
  }
  return null;
}

export function decodeTransactionSwaps(tx: Transaction, programId: PublicKey = DBC_PROGRAM_ID): EncodedDbcSwap[] {
  const found: EncodedDbcSwap[] = [];
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(programId)) continue;
    const decoded = decodeSwapInstructionData(ix.data);
    if (decoded) found.push(decoded);
  }
  return found;
}

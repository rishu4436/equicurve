import BN from "bn.js";
import { swapQuotePartialFill } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { describe, expect, it } from "vitest";
import { buildPresetConfig } from "@/lib/dbc/presets";
import { applyBuy, initialState, openBook } from "@/lib/market/book";
import {
  deltaBin,
  updateAccumulator,
  updateReferences,
  zeroVol,
  type DynamicFeeParams,
  type VolState,
} from "@/lib/market/volatility";

/**
 * Independent copy of VolatilityTracker in Meteora state/fee.rs:
 * get_delta_bin_id, update_references, and update_volatility_accumulator.
 * None of these call EquiCurve helpers.
 *
 * get_delta_bin_id is floor((upper << 64) / lower) via shl_div rounding down,
 * then floor((price_ratio - 2^64) / bin_step) * 2.
 * update_references uses saturating subtraction and does not write
 * last_update_timestamp. EquiCurve writes lastUpdate only when the price
 * moves a bin, and its elapsed time treats lastUpdate 0 as already past the
 * decay window. At the unix timestamps below, both take that same branch.
 * Rust always mins the accumulator. This preset's max is non-zero, so the
 * production clamp agrees.
 * This fixture does not execute a live program transaction.
 */
const ONE_Q64 = 1n << 64n;
const MAX_U128 = (1n << 128n) - 1n;
/** BIN_STEP_BPS_U128_DEFAULT. 2^64 = step * 10000 + 1616. */
const DEFAULT_BIN_STEP_U128 = 1844674407370955n;

function referenceDeltaBin(binStepU128: bigint, sqrtPriceA: bigint, sqrtPriceB: bigint): bigint {
  if (binStepU128 <= 0n || sqrtPriceA <= 0n || sqrtPriceB <= 0n) {
    throw new Error("get_delta_bin_id rejects a zero price or bin step");
  }
  const upper = sqrtPriceA > sqrtPriceB ? sqrtPriceA : sqrtPriceB;
  const lower = sqrtPriceA > sqrtPriceB ? sqrtPriceB : sqrtPriceA;
  const priceRatio = (upper << 64n) / lower;
  if (priceRatio > MAX_U128 || priceRatio < ONE_Q64) {
    throw new Error("get_delta_bin_id price ratio is outside u128 or below 1");
  }
  const delta = ((priceRatio - ONE_Q64) / binStepU128) * 2n;
  if (delta > MAX_U128) throw new Error("get_delta_bin_id overflow");
  return delta;
}

function referenceReferences(vol: VolState, fee: DynamicFeeParams, sqrtPrice: bigint, atSec: number): VolState {
  const now = BigInt(Math.max(0, Math.floor(atSec)));
  const elapsed = now > vol.lastUpdate ? now - vol.lastUpdate : 0n;
  if (elapsed < BigInt(fee.filterPeriod)) return vol;
  const next: VolState = { ...vol, sqrtRef: sqrtPrice };
  next.volRef =
    elapsed < BigInt(fee.decayPeriod) ? (vol.volAcc * BigInt(fee.reductionFactor)) / 10_000n : 0n;
  return next;
}

function referenceAccumulator(vol: VolState, fee: DynamicFeeParams, sqrtPrice: bigint): VolState {
  const moved = referenceDeltaBin(fee.binStepU128, sqrtPrice, vol.sqrtRef);
  let acc = vol.volRef + moved * 10_000n;
  if (acc > fee.maxVolatilityAccumulator) acc = fee.maxVolatilityAccumulator;
  return { ...vol, volAcc: acc };
}

describe("dynamic fee tracker fidelity", () => {
  it("matches the Rust reference formulas at unix time and shows the SDK only consumes the tracker", () => {
    const book = openBook(buildPresetConfig("exponential"), 9);
    const fee = book.dynamicFee;
    expect(fee).not.toBeNull();
    if (!fee) return;
    expect(fee.variableFeeControl).toBeGreaterThan(0);

    expect((DEFAULT_BIN_STEP_U128 * 10_000n) + 1616n).toBe(ONE_Q64);
    const doubled = 2n * ONE_Q64;
    expect(referenceDeltaBin(DEFAULT_BIN_STEP_U128, doubled, ONE_Q64)).toBe(20_000n);
    expect(deltaBin(DEFAULT_BIN_STEP_U128, doubled, ONE_Q64)).toBe(20_000n);
    expect(referenceDeltaBin(DEFAULT_BIN_STEP_U128, ONE_Q64, ONE_Q64)).toBe(0n);
    expect(deltaBin(DEFAULT_BIN_STEP_U128, ONE_Q64, ONE_Q64)).toBe(0n);

    const opened = 1_700_000_000;
    const firstSqrt = book.sqrtStart * 2n;
    const oursRef = updateReferences(zeroVol(), fee, book.sqrtStart, opened);
    const rustRef = referenceReferences(zeroVol(), fee, book.sqrtStart, opened);
    expect(oursRef).toEqual(rustRef);

    expect(referenceDeltaBin(fee.binStepU128, firstSqrt, rustRef.sqrtRef)).toBe(
      deltaBin(fee.binStepU128, firstSqrt, oursRef.sqrtRef),
    );
    const oursAcc = updateAccumulator(oursRef, fee, firstSqrt, opened);
    const rustAcc = referenceAccumulator(rustRef, fee, firstSqrt);
    expect(oursAcc.sqrtRef).toBe(rustAcc.sqrtRef);
    expect(oursAcc.volRef).toBe(rustAcc.volRef);
    expect(oursAcc.volAcc).toBe(rustAcc.volAcc);
    expect(oursAcc.volAcc).toBeGreaterThan(0n);
    expect(oursAcc.lastUpdate).toBe(BigInt(opened));

    const inside = opened + 5;
    const oursInside = updateReferences(oursAcc, fee, firstSqrt, inside);
    const rustInside = referenceReferences({ ...rustAcc, lastUpdate: oursAcc.lastUpdate }, fee, firstSqrt, inside);
    expect(oursInside).toEqual(rustInside);

    const decayedAt = opened + fee.decayPeriod + 1;
    const oursDecay = updateReferences(oursAcc, fee, firstSqrt, decayedAt);
    const rustDecay = referenceReferences({ ...rustAcc, lastUpdate: oursAcc.lastUpdate }, fee, firstSqrt, decayedAt);
    expect(oursDecay.volRef).toBe(0n);
    expect(oursDecay).toEqual(rustDecay);

    const replay = applyBuy(book, initialState(book), 100_000_000n, opened);
    expect(replay.state.vol.volAcc).toBeGreaterThan(0n);

    const quoteAt = (vol: VolState) => {
      const tracker = {
        lastUpdateTimestamp: new BN(vol.lastUpdate.toString(10)),
        sqrtPriceReference: new BN(vol.sqrtRef.toString(10)),
        volatilityAccumulator: new BN(vol.volAcc.toString(10)),
        volatilityReference: new BN(vol.volRef.toString(10)),
        padding: [0, 0, 0],
      };
      const before = tracker.volatilityAccumulator.toString(10);
      const quoted = swapQuotePartialFill(
        {
          poolState: {
            sqrtPrice: new BN(book.sqrtStart.toString(10)),
            baseReserve: new BN(0),
            quoteReserve: new BN(0),
            activationPoint: new BN(0),
            volatilityTracker: tracker,
          },
        } as never,
        book.config as never,
        false,
        new BN("100000000"),
        0,
        false,
        new BN(String(opened + 1)),
        false,
      ) as { tradingFee: BN };
      expect(tracker.volatilityAccumulator.toString(10)).toBe(before);
      return BigInt(quoted.tradingFee.toString(10));
    };

    expect(quoteAt(replay.state.vol)).toBeGreaterThan(quoteAt(zeroVol()));
  });
});

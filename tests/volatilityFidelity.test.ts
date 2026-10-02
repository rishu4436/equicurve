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
 * Independent copy of VolatilityTracker::update_references and
 * update_volatility_accumulator in Meteora state/fee.rs.
 * Elapsed time is saturating subtraction. fee.rs does not write
 * last_update_timestamp; EquiCurve writes it only when the price moves a bin.
 * This fixture does not execute a live program transaction.
 */
function rustReferences(vol: VolState, fee: DynamicFeeParams, sqrtPrice: bigint, atSec: number): VolState {
  const now = BigInt(Math.max(0, Math.floor(atSec)));
  const elapsed = now > vol.lastUpdate ? now - vol.lastUpdate : 0n;
  if (elapsed < BigInt(fee.filterPeriod)) return vol;
  const next: VolState = { ...vol, sqrtRef: sqrtPrice };
  next.volRef =
    elapsed < BigInt(fee.decayPeriod) ? (vol.volAcc * BigInt(fee.reductionFactor)) / 10_000n : 0n;
  return next;
}

function rustAccumulator(vol: VolState, fee: DynamicFeeParams, sqrtPrice: bigint): VolState {
  const moved = deltaBin(fee.binStepU128, sqrtPrice, vol.sqrtRef);
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

    const opened = 1_700_000_000;
    const firstSqrt = book.sqrtStart * 2n;
    const oursRef = updateReferences(zeroVol(), fee, book.sqrtStart, opened);
    const rustRef = rustReferences(zeroVol(), fee, book.sqrtStart, opened);
    expect(oursRef).toEqual(rustRef);

    const oursAcc = updateAccumulator(oursRef, fee, firstSqrt, opened);
    const rustAcc = rustAccumulator(rustRef, fee, firstSqrt);
    expect(oursAcc.sqrtRef).toBe(rustAcc.sqrtRef);
    expect(oursAcc.volRef).toBe(rustAcc.volRef);
    expect(oursAcc.volAcc).toBe(rustAcc.volAcc);
    expect(oursAcc.volAcc).toBeGreaterThan(0n);
    expect(oursAcc.lastUpdate).toBe(BigInt(opened));

    const inside = opened + 5;
    const oursInside = updateReferences(oursAcc, fee, firstSqrt, inside);
    const rustInside = rustReferences({ ...rustAcc, lastUpdate: oursAcc.lastUpdate }, fee, firstSqrt, inside);
    expect(oursInside).toEqual(rustInside);

    const decayedAt = opened + fee.decayPeriod + 1;
    const oursDecay = updateReferences(oursAcc, fee, firstSqrt, decayedAt);
    const rustDecay = rustReferences({ ...rustAcc, lastUpdate: oursAcc.lastUpdate }, fee, firstSqrt, decayedAt);
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

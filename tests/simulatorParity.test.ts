import BN from "bn.js";
import { swapQuotePartialFill } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { describe, expect, it } from "vitest";
import { launchCurveConfig } from "@/lib/dbc/create";
import { applyBuy, applySell, initialState, openBook, type BookState, type CurveBook } from "@/lib/market/book";
import { updateReferences } from "@/lib/market/volatility";

/**
 * The simulator's fill has to match a direct Meteora swapQuotePartialFill call.
 * The book builds its own pool view. This test builds that view again and checks
 * output, fee, next price, and the reserve delta at every step.
 * The first-swap minimum-fee flag stays off, matching the market scenarios.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bi(value: BN | { toString(): string }): bigint {
  return BigInt(value.toString());
}

function rawQuote(book: CurveBook, state: BookState, swapBaseForQuote: boolean, amountIn: bigint, atSec: number) {
  const vol = book.dynamicFee
    ? updateReferences(state.vol, book.dynamicFee, state.sqrtPrice, atSec)
    : state.vol;
  return swapQuotePartialFill(
    {
      poolState: {
        sqrtPrice: new BN(state.sqrtPrice.toString(10)),
        baseReserve: new BN(0),
        quoteReserve: new BN(state.quoteReserve.toString(10)),
        activationPoint: new BN(0),
        volatilityTracker: {
          lastUpdateTimestamp: new BN(vol.lastUpdate.toString(10)),
          sqrtPriceReference: new BN(vol.sqrtRef.toString(10)),
          volatilityAccumulator: new BN(vol.volAcc.toString(10)),
          volatilityReference: new BN(vol.volRef.toString(10)),
          padding: [0, 0, 0],
        },
      },
    } as never,
    book.config as never,
    swapBaseForQuote,
    new BN(amountIn.toString(10)),
    0,
    false,
    new BN(Math.max(0, Math.floor(atSec))),
    false,
  );
}

function replay(book: CurveBook, seed: number) {
  const rand = mulberry32(seed);
  let state = initialState(book);
  let atSec = 0;
  let compared = 0;
  for (let step = 0; step < 200 && compared < 80; step++) {
    atSec += Math.floor(rand() * 40);
    const buy = rand() > 0.28 || state.heldBase === 0n;
    const atoms = BigInt(Math.floor(20_000_000 + rand() * 80_000_000));
    if (buy) {
      if (state.quoteReserve >= book.threshold || atoms <= 0n) continue;
      const before = state.quoteReserve;
      const raw = rawQuote(book, state, false, atoms, atSec);
      const next = applyBuy(book, state, atoms, atSec);
      const fee = bi(raw.tradingFee) + bi(raw.protocolFee) + bi(raw.referralFee);
      expect(next.fill.skipped).toBe(false);
      expect(next.fill.outputAtoms).toBe(bi(raw.outputAmount));
      expect(next.fill.feeAtoms).toBe(fee);
      expect(next.state.sqrtPrice).toBe(bi(raw.nextSqrtPrice));
      expect(next.state.quoteReserve - before).toBe(bi(raw.excludedFeeInputAmount));
      state = next.state;
      compared += 1;
      continue;
    }
    const capped = atoms > state.heldBase ? state.heldBase : atoms;
    if (state.quoteReserve >= book.threshold || capped <= 0n || state.sqrtPrice <= book.sqrtStart) continue;
    const before = state.quoteReserve;
    const raw = rawQuote(book, state, true, capped, atSec);
    const next = applySell(book, state, atoms, atSec);
    const fee = bi(raw.tradingFee) + bi(raw.protocolFee) + bi(raw.referralFee);
    expect(next.fill.skipped).toBe(false);
    expect(next.fill.outputAtoms).toBe(bi(raw.outputAmount));
    expect(next.fill.feeAtoms).toBe(fee);
    expect(next.state.sqrtPrice).toBe(bi(raw.nextSqrtPrice));
    expect(before - next.state.quoteReserve).toBe(bi(raw.outputAmount) + fee);
    state = next.state;
    compared += 1;
  }
  expect(compared).toBeGreaterThanOrEqual(50);
}

describe("simulator matches Meteora quote math", () => {
  it("keeps output, fee, next price, and reserve delta aligned across dynamic-fee sequences", () => {
    const cfg = launchCurveConfig({
      presetId: "exponential",
      totalSupply: 1_000_000_000,
      creatorTradingFeePercentage: 70,
      lpLockPct: 100,
      mintRenounce: true,
      antiSniper: true,
      quoteDecimals: 9,
      transferProfile: "open-spl",
      marketCaps: { initial: 30, migration: 90 },
    });
    const book = openBook(cfg, 9);
    expect(book.dynamicFee).not.toBeNull();
    replay(book, 0xec0c);
  });

  it("keeps the same alignment when the curve has no dynamic fee", () => {
    const cfg = launchCurveConfig({
      presetId: "flat",
      totalSupply: 1_000_000_000,
      creatorTradingFeePercentage: 40,
      lpLockPct: 100,
      mintRenounce: true,
      antiSniper: false,
      quoteDecimals: 9,
      transferProfile: "open-spl",
      marketCaps: { initial: 20, migration: 80 },
    });
    const book = openBook(cfg, 9);
    expect(book.dynamicFee).toBeNull();
    replay(book, 44107);
  });
});

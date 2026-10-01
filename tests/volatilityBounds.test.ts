import { describe, expect, it } from "vitest";
import { buildPresetConfig } from "@/lib/dbc/presets";
import { applyBuy, applySell, initialState, openBook } from "@/lib/market/book";
import { updateAccumulator, updateReferences } from "@/lib/market/volatility";

function expBook() {
  return openBook(buildPresetConfig("exponential"), 9);
}

describe("dynamic fee boundaries", () => {
  it("reads the exponential tracker's filter, decay, and max accumulator", () => {
    const fee = expBook().dynamicFee;
    expect(fee).not.toBeNull();
    expect(fee!.filterPeriod).toBe(10);
    expect(fee!.decayPeriod).toBe(120);
    expect(fee!.reductionFactor).toBe(5_000);
    expect(fee!.maxVolatilityAccumulator).toBeGreaterThan(0n);
  });

  it("updates references exactly at the filter period and not one second before", () => {
    const book = expBook();
    const first = applyBuy(book, initialState(book), 1_000_000_000n, 100);
    expect(first.state.vol.lastUpdate).toBe(100n);
    expect(first.fill.feeAtoms).toBeGreaterThan(0n);
    const openingRef = first.state.vol.sqrtRef;
    const inside = applyBuy(book, first.state, 1_000_000_000n, 109);
    expect(inside.state.vol.sqrtRef).toBe(openingRef);
    const boundary = applyBuy(book, first.state, 1_000_000_000n, 110);
    expect(boundary.state.vol.sqrtRef).toBe(first.state.sqrtPrice);
    expect(boundary.state.vol.volRef).toBe((first.state.vol.volAcc * 5_000n) / 10_000n);
    expect(boundary.state.vol.sqrtRef).not.toBe(openingRef);
  });

  it("zeros the volatility reference exactly at the decay period", () => {
    const book = expBook();
    const first = applyBuy(book, initialState(book), 1_000_000_000n, 100);
    const before = applyBuy(book, first.state, 1_000_000_000n, 219);
    expect(before.state.vol.volRef).toBe((first.state.vol.volAcc * 5_000n) / 10_000n);
    const atDecay = applyBuy(book, first.state, 1_000_000_000n, 220);
    expect(atDecay.state.vol.volRef).toBe(0n);
  });

  it("leaves the timestamp unchanged when the price does not move a bin", () => {
    const book = expBook();
    const fee = book.dynamicFee!;
    const vol = { lastUpdate: 50n, sqrtRef: book.sqrtStart, volAcc: 8_000n, volRef: 4_000n };
    const next = updateAccumulator(vol, fee, book.sqrtStart, 80);
    expect(next.lastUpdate).toBe(50n);
    expect(next.volAcc).toBe(4_000n);
  });

  it("clamps a large price move at the maximum accumulator", () => {
    const book = expBook();
    const fee = book.dynamicFee!;
    const next = updateAccumulator(
      { lastUpdate: 1n, sqrtRef: book.sqrtStart, volAcc: 0n, volRef: 0n },
      fee,
      book.sqrtStart * 1_000_000n,
      2,
    );
    expect(next.volAcc).toBe(fee.maxVolatilityAccumulator);
  });

  it("does not refresh references when time stays equal or moves backward", () => {
    const book = expBook();
    const fee = book.dynamicFee!;
    const vol = { lastUpdate: 100n, sqrtRef: book.sqrtStart, volAcc: 12_000n, volRef: 1n };
    expect(updateReferences(vol, fee, book.sqrtStart * 2n, 100)).toEqual(vol);
    expect(updateReferences(vol, fee, book.sqrtStart * 2n, 50)).toEqual(vol);
  });

  it("charges a fee on a buy followed by a sell, then a sell followed by a buy", () => {
    const book = expBook();
    const buy = applyBuy(book, initialState(book), 1_000_000_000n, 1);
    expect(buy.fill.skipped).toBe(false);
    expect(buy.fill.feeAtoms).toBeGreaterThan(0n);
    const sell = applySell(book, buy.state, buy.state.heldBase / 2n, 2);
    expect(sell.fill.skipped).toBe(false);
    expect(sell.fill.feeAtoms).toBeGreaterThan(0n);
    expect(sell.fill.impactBps).toBeLessThan(0);
    const buyAgain = applyBuy(book, sell.state, 1_000_000_000n, 3);
    expect(buyAgain.fill.skipped).toBe(false);
    expect(buyAgain.fill.feeAtoms).toBeGreaterThan(0n);
  });

  it("partial-fills at the graduation threshold while a dynamic fee is active", () => {
    const book = expBook();
    const first = applyBuy(book, initialState(book), book.threshold * 3n, 1);
    expect(first.fill.completed).toBe(true);
    expect(first.fill.unusedAtoms).toBeGreaterThan(0n);
    expect(first.fill.feeAtoms).toBeGreaterThan(0n);
    const second = applyBuy(book, first.state, 1_000_000_000n, 2);
    expect(second.fill.skipped).toBe(true);
    expect(second.state.quoteReserve).toBe(first.state.quoteReserve);
  });
});

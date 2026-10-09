import { describe, expect, it } from "vitest";
import {
  BALANCE_MAX_AGE_MS,
  SOL_SWAP_FEE_RENT_BUFFER_ATOMS,
  tradeAmountError,
  tradeBalanceError,
} from "@/lib/trade/validation";
import { swapQuoteFailureMessage } from "@/lib/dbc/swap";

describe("pre-sign trade validation", () => {
  it.each(["", "0", "-1", "wat", "1e3"])("rejects invalid amount %j synchronously", (value) => {
    expect(tradeAmountError(value, 9)).toBeTruthy();
  });

  it("accepts a positive amount representable by the mint", () => {
    expect(tradeAmountError("0.000000001", 9)).toBeNull();
    expect(tradeAmountError("0.0000000001", 9)).toBeTruthy();
  });

  it("requires buy funds plus the SOL fee/rent buffer", () => {
    expect(tradeBalanceError({ direction: "buy", requestedAtoms: 50_000_000_000n, availableAtoms: 1_000_000_000n, feeRentBufferAtoms: SOL_SWAP_FEE_RENT_BUFFER_ATOMS, readAt: 100, now: 100 })).toMatch(/quote balance/);
  });

  it("distinguishes an over-position sell from liquidity", () => {
    expect(tradeBalanceError({ direction: "sell", requestedAtoms: 11n, availableAtoms: 10n, readAt: 100, now: 100 })).toMatch(/wallet token balance/);
  });

  it("distinguishes a curve quote limit from wallet token insufficiency", () => {
    expect(swapQuoteFailureMessage("sell", "insufficient liquidity")).toMatch(/curve cannot quote/);
    expect(swapQuoteFailureMessage("sell", "RPC 503")).toBe("Quote failed: RPC 503");
  });

  it("fails closed for missing and stale balance reads", () => {
    expect(tradeBalanceError({ direction: "buy", requestedAtoms: 1n, availableAtoms: null, readAt: null })).toMatch(/unavailable/);
    expect(tradeBalanceError({ direction: "sell", requestedAtoms: 1n, availableAtoms: 2n, readAt: 100, now: 100 + BALANCE_MAX_AGE_MS + 1 })).toMatch(/stale/);
  });
});

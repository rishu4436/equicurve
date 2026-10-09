import { describe, expect, it } from "vitest";
import {
  BALANCE_MAX_AGE_MS,
  SOL_SWAP_FEE_RENT_BUFFER_ATOMS,
  tradeAmountError,
  tradeBalanceError,
  tradeFundingError,
  type TradeFundingEvidence,
} from "@/lib/trade/validation";
import { swapQuoteFailureMessage } from "@/lib/dbc/swap";

describe("pre-sign trade validation", () => {
  const funding = (overrides: Partial<TradeFundingEvidence> = {}): TradeFundingEvidence => ({
    inputAtoms: 1_000_000_000n,
    inputReadAt: 1_000,
    nativeSolAtoms: 100_000_000n,
    nativeSolReadAt: 1_000,
    inputIsNativeSol: false,
    ...overrides,
  });
  it.each(["", "0", "-1", "wat", "1e3"])("rejects invalid amount %j synchronously", (value) => {
    expect(tradeAmountError(value, 9)).toBeTruthy();
  });

  it.each([
    ["empty", ""],
    ["zero", "0"],
    ["malformed", "not-an-amount"],
  ])("keeps DAMM Review disabled for a %s amount", (_case, value) => {
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

  it("allows a native SOL buy only when input and conservative reserve are funded", () => {
    expect(tradeFundingError({ direction: "buy", requestedAtoms: 900_000_000n, evidence: funding({ inputIsNativeSol: true }), now: 1_000 })).toBeNull();
    expect(tradeFundingError({ direction: "buy", requestedAtoms: 995_000_000n, evidence: funding({ inputIsNativeSol: true }), now: 1_000 })).toMatch(/quote balance/);
  });

  it("checks SPL quote input and native SOL reserve as separate assets", () => {
    expect(tradeFundingError({ direction: "buy", requestedAtoms: 900_000_000n, evidence: funding({ nativeSolAtoms: 0n }), now: 1_000 })).toMatch(/native SOL reserve/);
    expect(tradeFundingError({ direction: "buy", requestedAtoms: 900_000_000n, evidence: funding(), now: 1_000 })).toBeNull();
    expect(tradeFundingError({ direction: "buy", requestedAtoms: 1_000_000_001n, evidence: funding(), now: 1_000 })).toMatch(/quote balance/);
  });

  it("checks sell token balance and the independent native SOL reserve", () => {
    expect(tradeFundingError({ direction: "sell", requestedAtoms: 1_000_000_001n, evidence: funding(), now: 1_000 })).toMatch(/wallet token balance/);
    expect(tradeFundingError({ direction: "sell", requestedAtoms: 1n, evidence: funding({ nativeSolAtoms: 0n }), now: 1_000 })).toMatch(/native SOL reserve/);
  });

  it("marks stale funding evidence for a mandatory re-read before signing", () => {
    expect(tradeFundingError({ direction: "sell", requestedAtoms: 1n, evidence: funding(), now: 1_000 + BALANCE_MAX_AGE_MS + 1 })).toMatch(/stale/);
  });
});

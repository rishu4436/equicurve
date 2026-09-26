import BN from "bn.js";
import { describe, expect, it, vi } from "vitest";
import { isInsufficientLiquidityError, planBuy } from "@/lib/dbc/fill";
import { mapError, toUserMessage } from "@/lib/errors";
import { freshnessMessage, quoteFreshness, QUOTE_MAX_AGE_MS } from "@/lib/trade/quoteFreshness";

const q = (out: number, fee = 0, extra: Record<string, BN> = {}) => ({
  outputAmount: new BN(out),
  minimumAmountOut: new BN(Math.floor(out * 0.99)),
  tradingFee: new BN(fee),
  protocolFee: new BN(0),
  referralFee: new BN(0),
  ...extra,
});

describe("planBuy (buy larger than remaining curve)", () => {
  it("small buys stay ExactIn and never compute a partial fill", () => {
    const partial = vi.fn();
    const plan = planBuy({
      requestedIn: 1_000n,
      remainingToThreshold: 1_000_000n,
      quoteExactIn: () => q(500, 10),
      quotePartialFill: partial,
    });
    expect(plan.mode).toBe("exact_in");
    expect(plan.unusedIn).toBe(0n);
    expect(plan.completesCurve).toBe(false);
    expect(partial).not.toHaveBeenCalled();
  });

  it("ExactIn 'Insufficient Liquidity' (would be DBC 6033 on-chain) is capped via PartialFill", () => {
    const plan = planBuy({
      requestedIn: 10_000n,
      remainingToThreshold: 3_000n,
      quoteExactIn: () => {
        throw new Error("Insufficient Liquidity");
      },
      quotePartialFill: () =>
        q(700, 30, { includedFeeInputAmount: new BN(3_030), amountLeft: new BN(6_970) }),
    });
    expect(plan.mode).toBe("partial_fill");
    expect(plan.fillableIn).toBe(3_030n);
    expect(plan.unusedIn).toBe(6_970n);
    expect(plan.completesCurve).toBe(true);
  });

  it("buys that land within 2% of the threshold also use PartialFill (fee decay safety)", () => {
    const plan = planBuy({
      requestedIn: 2_990n,
      remainingToThreshold: 3_000n,
      quoteExactIn: () => q(700, 10),
      quotePartialFill: () => q(700, 10, { includedFeeInputAmount: new BN(2_990), amountLeft: new BN(0) }),
    });
    expect(plan.mode).toBe("partial_fill");
    expect(plan.unusedIn).toBe(0n);
    expect(plan.fillableIn).toBe(2_990n);
  });

  it("unrelated quote errors propagate", () => {
    expect(() =>
      planBuy({
        requestedIn: 1n,
        remainingToThreshold: 10n,
        quoteExactIn: () => {
          throw new Error("boom");
        },
        quotePartialFill: () => q(1),
      }),
    ).toThrow("boom");
  });

  it("recognises 6033 in all its shapes", () => {
    expect(isInsufficientLiquidityError(new Error("custom program error: 0x1791"))).toBe(true);
    expect(isInsufficientLiquidityError(new Error('{"Custom":6033}'))).toBe(true);
    expect(isInsufficientLiquidityError(new Error("Insufficient Liquidity"))).toBe(true);
    expect(isInsufficientLiquidityError(new Error("slippage"))).toBe(false);
  });

  it("maps on-chain 6033 to an actionable message", () => {
    const m = mapError(new Error("Simulation failed: custom program error: 0x1791"));
    expect(m.programErrorCode).toBe(6033);
    expect(m.programErrorName).toBe("InsufficientLiquidity");
    expect(toUserMessage(new Error('{"InstructionError":[3,{"Custom":6033}]}'))).toMatch(
      /larger than what is left on the bonding curve.*Reduce the amount/,
    );
  });
});

describe("quoteFreshness", () => {
  const stamp = { quotedAt: 1_000_000, poolStateKey: "a:b:c" };
  it("fresh within 15s and unchanged pool", () => {
    expect(quoteFreshness(stamp, "a:b:c", 1_000_000 + QUOTE_MAX_AGE_MS)).toEqual({ fresh: true });
  });
  it("stale when older than 15s", () => {
    const f = quoteFreshness(stamp, "a:b:c", 1_000_000 + QUOTE_MAX_AGE_MS + 1);
    expect(f).toEqual({ fresh: false, reason: "expired" });
    expect(freshnessMessage(f)).toMatch(/15s/);
  });
  it("stale when pool state changed or unreadable", () => {
    expect(quoteFreshness(stamp, "x:b:c", 1_000_001)).toEqual({ fresh: false, reason: "pool_changed" });
    expect(quoteFreshness(stamp, null, 1_000_001)).toEqual({ fresh: false, reason: "unknown_state" });
  });
});

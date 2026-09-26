import { getPriceFromSqrtPrice, TokenDecimal } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { atomsRatioToDecimalString, atomsRatioToPrice, sqrtPriceX64ToDecimalString } from "@/lib/amounts";
import { priceFromSwapEvent } from "@/lib/dbc/priceHistory";

describe("bigint price math", () => {
  it("atom ratio is exact for u64 amounts above 2^53", () => {
    // 18446744073709551615 quote atoms (9 dp) for 1e18 base atoms (9 dp) → 18.446744073709551615
    const s = atomsRatioToDecimalString(18446744073709551615n, 1_000_000_000_000_000_000n, 9, 9);
    expect(s).toBe("18.446744073709551615");
    // 1 lamport per 1 token atom at 9/9 → 1
    expect(atomsRatioToDecimalString(1n, 1n, 9, 9)).toBe("1");
    // USDC (6) in, base (9) out: 1_000_000 atoms (1 USDC) for 1e9 atoms (1 token) → 1
    expect(atomsRatioToPrice(1_000_000n, 1_000_000_000n, 6, 9)).toBe(1);
    expect(atomsRatioToDecimalString(1n, 0n, 9, 9)).toBeNull();
  });

  it("sqrtPrice → price matches the SDK within display precision", () => {
    const sqrt = new BN("58333726687135158"); // arbitrary on-curve value
    const sdk = Number(String(getPriceFromSqrtPrice(sqrt, TokenDecimal.NINE, TokenDecimal.NINE)));
    const ours = Number(sqrtPriceX64ToDecimalString(sqrt.toString(), 9, 9));
    expect(Math.abs(ours - sdk) / sdk).toBeLessThan(1e-9);
    const sdk6 = Number(String(getPriceFromSqrtPrice(sqrt, TokenDecimal.NINE, TokenDecimal.SIX)));
    const ours6 = Number(sqrtPriceX64ToDecimalString(sqrt.toString(), 9, 6));
    expect(Math.abs(ours6 - sdk6) / sdk6).toBeLessThan(1e-9);
  });

  it("swap event price uses exact atoms (buy and sell)", () => {
    const buy = priceFromSwapEvent(
      {
        name: "EvtSwap2",
        data: {
          tradeDirection: 1,
          currentTimestamp: new BN(1_790_000_000),
          swapResult: { includedFeeInputAmount: new BN("2000000000"), outputAmount: new BN("400000000000000000") },
        },
      },
      9,
      9,
    );
    expect(buy?.price).toBeCloseTo(0.000000005, 15);
    expect(buy?.tsSec).toBe(1_790_000_000);
    const sell = priceFromSwapEvent(
      {
        name: "EvtSwap2",
        data: { tradeDirection: 0, swapResult: { actualInputAmount: "1000000000", outputAmount: "2500000" } },
      },
      9,
      6,
    );
    expect(sell?.price).toBe(2.5);
  });
});

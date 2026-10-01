import { Connection } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { EquiCurveError } from "@/lib/errors";
import { launchCurveConfig } from "@/lib/dbc/create";
import { getDbcClient } from "@/lib/dbc/client";
import {
  applySeedBuySlippage,
  assertSeedBuyQuote,
  configEnablesFirstSwapMinFee,
  quoteSeedBuy,
  SEED_BUY_SLIPPAGE_BPS,
} from "@/lib/dbc/seedQuote";
import { DEFAULT_SLIPPAGE_BPS } from "@/lib/dbc/swap";

function client() {
  const conn = new Connection("http://127.0.0.1:9");
  (conn as unknown as { getAccountInfo: () => Promise<unknown> }).getAccountInfo = async () => ({
    owner: TOKEN_PROGRAM_ID,
    data: Buffer.alloc(82),
    executable: false,
    lamports: 1,
  });
  return getDbcClient(conn);
}

const curveArgs = {
  presetId: "flat" as const,
  totalSupply: 1_000_000_000,
  creatorTradingFeePercentage: 50,
  lpLockPct: 100,
  mintRenounce: true,
  antiSniper: false,
  quoteDecimals: 9 as const,
  transferProfile: "open-spl" as const,
};

describe("seed-buy quote", () => {
  it("uses 0 bps, so the minimum is the quoted output and stays above a 1% floor", () => {
    expect(SEED_BUY_SLIPPAGE_BPS).toBe(0);
    const quoted = quoteSeedBuy(client(), launchCurveConfig(curveArgs), new BN("100000000"));
    expect(quoted.eligibleForFirstSwapWithMinFee).toBe(false);
    expect(quoted.outputAmount.gt(new BN(0))).toBe(true);
    expect(quoted.minimumAmountOut.eq(quoted.outputAmount)).toBe(true);
    expect(quoted.amountIn.eq(new BN("100000000"))).toBe(true);
    const tradeFloor = applySeedBuySlippage(quoted.outputAmount, DEFAULT_SLIPPAGE_BPS);
    expect(tradeFloor.lt(quoted.minimumAmountOut)).toBe(true);
    expect(tradeFloor.gt(new BN(0))).toBe(true);
  });

  it("charges the minimum fee only when the config that will be deployed says so", () => {
    const amount = new BN("100000000");
    const ordinary = quoteSeedBuy(
      client(),
      launchCurveConfig({ ...curveArgs, presetId: "exponential", antiSniper: false }),
      amount,
    );
    const firstSwap = quoteSeedBuy(
      client(),
      launchCurveConfig({ ...curveArgs, presetId: "exponential", antiSniper: true }),
      amount,
    );
    expect(ordinary.eligibleForFirstSwapWithMinFee).toBe(false);
    expect(firstSwap.eligibleForFirstSwapWithMinFee).toBe(true);
    expect(firstSwap.outputAmount.gt(ordinary.outputAmount)).toBe(true);
  });

  it("shows why a positive bps is not the seed-buy tolerance", () => {
    expect(applySeedBuySlippage(new BN(1), 0).toString()).toBe("1");
    expect(applySeedBuySlippage(new BN(1), 1).toString()).toBe("0");
    expect(applySeedBuySlippage(new BN(1), DEFAULT_SLIPPAGE_BPS).toString()).toBe("0");
  });

  it("rejects a missing, zero, or inconsistent quote before it can be signed", () => {
    const amount = new BN(100);
    const output = new BN(50);
    const valid = {
      outputAmount: output,
      minimumAmountOut: output,
      includedFeeInputAmount: amount,
      excludedFeeInputAmount: new BN(49),
      amountLeft: new BN(0),
      referralFee: new BN(0),
    };
    expect(assertSeedBuyQuote(valid, amount, false).minimumAmountOut.eq(output)).toBe(true);
    expect(() => assertSeedBuyQuote(null, amount, false)).toThrow(/quote is missing/);
    expect(() => assertSeedBuyQuote(valid, new BN(0), false)).toThrow(/buy amount is zero/);
    expect(() => assertSeedBuyQuote({ ...valid, outputAmount: new BN(0) }, amount, false)).toThrow(/expected output is zero/);
    expect(() => assertSeedBuyQuote({ ...valid, minimumAmountOut: new BN(0) }, amount, false)).toThrow(/minimum output is zero/);
    expect(() => assertSeedBuyQuote({ ...valid, minimumAmountOut: new BN(40) }, amount, false)).toThrow(/does not match the documented 0 bps/);
    expect(() => assertSeedBuyQuote({ ...valid, includedFeeInputAmount: new BN(99) }, amount, false)).toThrow(/does not match the seed buy/);
    expect(() => assertSeedBuyQuote({ ...valid, amountLeft: new BN(1) }, amount, false)).toThrow(/did not consume the full seed buy/);
    expect(() => assertSeedBuyQuote({ ...valid, referralFee: new BN(1) }, amount, false)).toThrow(/referral/);
    expect(() => quoteSeedBuy(client(), { enableFirstSwapWithMinFee: "yes" }, amount)).toThrow(EquiCurveError);
    expect(configEnablesFirstSwapMinFee({ enableFirstSwapWithMinFee: 1 })).toBe(true);
    expect(configEnablesFirstSwapMinFee({ enableFirstSwapWithMinFee: 0 })).toBe(false);
  });
});

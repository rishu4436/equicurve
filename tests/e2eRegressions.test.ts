/**
 * Deterministic regressions for bugs found by the devnet/localnet e2e run
 * (review pass 2, scripts/e2e-devnet.ts).
 */
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { afterEach, describe, expect, it } from "vitest";
import { dammQuoteAmounts, pickMints, slippagePctToBps } from "@/lib/damm/swap";
import { toDammPositionView } from "@/lib/damm/positions";
import type { DammPoolSnapshot } from "@/lib/damm/types";
import { mapError } from "@/lib/errors";
import { getUsdcMint, isUsdcMint, quoteDecimalsForMint } from "@/lib/constants";
import { displayStatus } from "@/lib/explore/verification";

const SYSTEM = "11111111111111111111111111111111";
const DAMM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

describe("mapError: system-program insufficient lamports (seen on-chain)", () => {
  it("maps System error 1 to insufficient_funds, not a generic program error", () => {
    // Exact log shape from the e2e run: a buy larger than the wallet's SOL.
    const err = Object.assign(new Error("Simulation failed. Message: Transaction simulation failed: Error processing Instruction 3: custom program error: 0x1."), {
      logs: [
        `Program ${SYSTEM} invoke [1]`,
        "Transfer: insufficient lamports 2386080, need 2000000000",
        `Program ${SYSTEM} failed: custom program error: 0x1`,
      ],
    });
    const m = mapError(err);
    expect(m.kind).toBe("insufficient_funds");
    expect(m.message).toMatch(/Insufficient funds/);
  });

  it("DAMM code 1 is not mistaken for system insufficient funds", () => {
    const err = Object.assign(new Error("custom program error: 0x1"), { logs: [`Program ${DAMM} failed: custom program error: 0x1`] });
    expect(mapError(err).kind).toBe("program_error");
  });
});

describe("DAMM v2 quote semantics (cp-amm getQuote2)", () => {
  it("slippage percent → basis points (SDK takes bps)", () => {
    expect(slippagePctToBps(1)).toBe(100);
    expect(slippagePctToBps(0.5)).toBe(50);
    expect(slippagePctToBps(0.01)).toBe(1);
    expect(() => slippagePctToBps(0)).toThrow();
    expect(() => slippagePctToBps(60)).toThrow();
  });

  it("amountOut is the SDK outputAmount, not minimumAmountOut", () => {
    const r = dammQuoteAmounts({ outputAmount: new BN(1_000_000), minimumAmountOut: new BN(990_000) });
    expect(r.amountOut.toString()).toBe("1000000");
    expect(r.minimumAmountOut.toString()).toBe("990000");
  });

  it("missing / zero output throws instead of labelling min as expected", () => {
    expect(() => dammQuoteAmounts({ minimumAmountOut: new BN(5) })).toThrow();
    expect(() => dammQuoteAmounts({ outputAmount: new BN(0), minimumAmountOut: new BN(0) })).toThrow();
  });
});

describe("pickMints handles both token orders", () => {
  const base = new PublicKey("C9JWWSkkiRE5i6A7TzYW7azG9gtrcyhjubgTafCX9R5G").toBase58();
  const quote = new PublicKey("Entdo3TrjdeCCVAMXHeNKBEfyuSnLVdeCKqeo7fdpUfh").toBase58();
  const snap = (a: string, b: string, da: number, db: number): DammPoolSnapshot => ({
    address: base, exists: true, source: "derived", tokenAMint: a, tokenBMint: b, baseMint: base, quoteMint: quote,
    poolStatus: 0, activationType: 1, sqrtPrice: "1", tokenADecimals: da, tokenBDecimals: db,
  });
  it("tokenA = base (DBC migration layout)", () => {
    const s = snap(base, quote, 9, 6);
    expect(pickMints(s, "quote_to_base")).toMatchObject({ inputDecimals: 6, outputDecimals: 9 });
    expect(pickMints(s, "quote_to_base").inputMint.toBase58()).toBe(quote);
    expect(pickMints(s, "base_to_quote").inputMint.toBase58()).toBe(base);
  });
  it("tokenA = quote (custom pool layout)", () => {
    const s = snap(quote, base, 6, 9);
    expect(pickMints(s, "quote_to_base")).toMatchObject({ inputDecimals: 6, outputDecimals: 9 });
    expect(pickMints(s, "quote_to_base").inputMint.toBase58()).toBe(quote);
    expect(pickMints(s, "base_to_quote").inputMint.toBase58()).toBe(base);
    expect(pickMints(s, "base_to_quote").outputMint.toBase58()).toBe(quote);
  });
});

describe("DAMM position view shows claimable fees", () => {
  const le32 = (v: BN) => Array.from(v.toArrayLike(Buffer, "le", 32));
  it("uses fee-per-liquidity growth, not the stale feeBPending checkpoint", () => {
    const liquidity = new BN(1).shln(64); // 2^64
    const growthB = new BN(5_000).shln(128 - 64); // → fee = 5000 atoms for 2^64 liquidity
    const poolState = { feeAPerLiquidity: le32(new BN(0)), feeBPerLiquidity: le32(growthB) } as never;
    const row = {
      position: new PublicKey(SYSTEM),
      positionNftAccount: new PublicKey(SYSTEM),
      positionState: {
        unlockedLiquidity: new BN(0),
        vestedLiquidity: new BN(0),
        permanentLockedLiquidity: liquidity,
        feeAPerTokenCheckpoint: le32(new BN(0)),
        feeBPerTokenCheckpoint: le32(new BN(0)),
        feeAPending: new BN(0),
        feeBPending: new BN(0),
        rewardInfos: [],
      },
    } as never;
    const v = toDammPositionView(poolState, row);
    expect(v.feeAPending).toBe("0");
    expect(v.feeBPending).toBe("5000");
  });
});

describe("devnet USDC stand-in override", () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
  });
  const standIn = "Entdo3TrjdeCCVAMXHeNKBEfyuSnLVdeCKqeo7fdpUfh";
  it("honoured on devnet", () => {
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    process.env.NEXT_PUBLIC_USDC_MINT_OVERRIDE = standIn;
    expect(getUsdcMint()?.toBase58()).toBe(standIn);
    expect(isUsdcMint(standIn)).toBe(true);
    expect(quoteDecimalsForMint(standIn)).toBe(6);
  });
  it("ignored on mainnet", () => {
    process.env.NEXT_PUBLIC_CLUSTER = "mainnet-beta";
    process.env.NEXT_PUBLIC_USDC_MINT_OVERRIDE = standIn;
    expect(getUsdcMint()?.toBase58()).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    expect(isUsdcMint(standIn)).toBe(false);
  });
});

describe("degraded RPC never shows a stored 'complete' as current (e2e S10)", () => {
  it("rpc_unavailable → unknown; verified keeps chain status", () => {
    const base = { status: "complete" as const };
    expect(displayStatus({ ...base, verification: { state: "rpc_unavailable", checkedAt: null, cluster: "devnet" } } as never)).toBe("unknown");
    expect(displayStatus({ ...base, verification: { state: "verified", checkedAt: null, cluster: "devnet" } } as never)).toBe("complete");
  });
});

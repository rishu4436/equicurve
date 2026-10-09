import { describe, expect, it } from "vitest";
import { aggregatePositions } from "@/lib/portfolio";
import { activityForWallet } from "@/lib/local/launches";

describe("aggregatePositions", () => {
  it("sums exact atoms per known mint, drops unknown / zero", () => {
    const out = aggregatePositions(
      [
        { pubkey: "a1", mint: "M1", amount: "9007199254740993", decimals: 9, program: "spl-token" },
        { pubkey: "a2", mint: "M1", amount: "7", decimals: 9, program: "spl-token" },
        { pubkey: "a3", mint: "M2", amount: "0", decimals: 6, program: "spl-token-2022" },
        { pubkey: "a4", mint: "OTHER", amount: "5", decimals: 9, program: "spl-token" },
      ],
      new Set(["M1", "M2"]),
    );
    expect(out).toEqual([{ mint: "M1", atoms: 9007199254741000n, decimals: 9, accounts: 2, program: "spl-token" }]);
  });
});

describe("wallet activity scope", () => {
  const rows = [
    { id: "a", pool: "p", kind: "buy" as const, sig: "s1", wallet: "WalletA", at: "2026-01-01" },
    { id: "b", pool: "p", kind: "sell" as const, sig: "s2", wallet: "WalletB", at: "2026-01-01" },
  ];
  it("shows only the connected wallet and none while disconnected", () => {
    expect(activityForWallet(rows, "walleta").map((row) => row.id)).toEqual(["a"]);
    expect(activityForWallet(rows, null)).toEqual([]);
  });
});

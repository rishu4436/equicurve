import { describe, expect, it } from "vitest";
import { formatTokenSupply, tokenAccountDistribution } from "@/lib/holders";

describe("holder token-account distribution", () => {
  it("formats supply and calculates deterministic token-account percentages", () => {
    expect(formatTokenSupply("1000000000000000000", 9, "EQFULL")).toBe("1B EQFULL");
    expect(tokenAccountDistribution({
      supplyAtoms: "1000",
      decimals: 0,
      creatorAta: "creator",
      accounts: [
        { address: "small", amountAtoms: "250" },
        { address: "creator", amountAtoms: "500" },
        { address: "zero", amountAtoms: "0" },
      ],
    })).toEqual([
      { address: "creator", balance: "500", supplyPct: "50.00%", role: "Creator token account" },
      { address: "small", balance: "250", supplyPct: "25.00%", role: "Token account" },
    ]);
  });
});

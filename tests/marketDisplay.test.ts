import { describe, expect, it } from "vitest";
import { formatMarketTimestamp, formatPermanentLock, formatPriceAxis, formatProgressRatio, formatQuoteReserveLabel, formatTokenPrice, marketLifecycle } from "@/lib/marketDisplay";

describe("market terminal display", () => {
  it("centralizes progress clamp and rounding", () => {
    expect(formatProgressRatio(0.123456)).toBe("12.35%");
    expect(formatProgressRatio(2)).toBe("100.00%");
    expect(formatProgressRatio(null)).toBe("unknown");
  });

  it("renders tiny SOL prices in lamports without losing the precise value", () => {
    expect(formatTokenPrice(1.37e-8, "SOL", "EQFULL")).toEqual({
      primary: "13.70 lamports / EQFULL",
      secondary: "0.0000000137 SOL / EQFULL",
    });
    expect(formatPriceAxis(6.8e-9, "SOL")).toBe("6.8 lamports");
  });

  it("maps lifecycle to one active execution venue", () => {
    expect(marketLifecycle("raising", "unchecked")).toMatchObject({ activeVenue: "DBC", tradeEnabled: true });
    expect(marketLifecycle("complete", "unchecked")).toMatchObject({ activeVenue: "Pending", tradeEnabled: false });
    expect(marketLifecycle("migrated", "exists")).toMatchObject({ activeVenue: "DAMM v2", tradeEnabled: true });
  });

  it("formats market timestamps deterministically in UTC for hydration", () => {
    expect(formatMarketTimestamp("2026-01-02T03:04:00.000Z")).toContain("Jan 02, 2026");
    expect(formatMarketTimestamp("2026-01-02T03:04:00.000Z")).toContain("03:04 UTC");
  });

  it("uses the actual quote asset in the DAMM reserve label", () => {
    expect(formatQuoteReserveLabel("SOL")).toBe("Quote reserve (SOL)");
    expect(formatQuoteReserveLabel("USDC")).toBe("Quote reserve (USDC)");
  });

  it("uses canonical configured LP lock wording", () => {
    expect(formatPermanentLock(100)).toBe("100% permanently locked");
    expect(formatPermanentLock(50)).toBe("50% configured permanent lock");
  });
});

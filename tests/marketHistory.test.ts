import { describe, expect, it } from "vitest";
import {
  addDecimalStrings,
  aggregateCandles,
  canClaim24hCoverage,
  candleIntervalSeconds,
  compareDecimalStrings,
  dedupeHistoricalTrades,
  inferDammSwapFromVaultDeltas,
  percentChangeString,
  parseHistoryMode,
  parseHistoryTimeframe,
  resolveMigrationBoundary,
  type HistoricalTrade,
} from "@/lib/market/history";

const base = "BaseMint111111111111111111111111111111111111";
const quote = "QuoteMint11111111111111111111111111111111111";

function trade(overrides: Partial<HistoricalTrade> = {}): HistoricalTrade {
  return {
    signature: "sig-1",
    slot: 1,
    blockTime: 1_700_000_000_000,
    venue: "dbc",
    baseMint: base,
    quoteMint: quote,
    side: "buy",
    baseAmountAtoms: "1000000000",
    quoteAmountAtoms: "200000000",
    baseAmount: "1",
    quoteAmount: "0.2",
    priceQuotePerToken: "0.2",
    source: "dbc-confirmed-swap",
    verified: true,
    ...overrides,
  };
}

describe("Market Terminal V2 normalized history", () => {
  it("normalizes DAMM buy and sell vault directions with exact atoms", () => {
    expect(inferDammSwapFromVaultDeltas({ baseDeltaAtoms: -1000000000n, quoteDeltaAtoms: 200000000n, baseDecimals: 9, quoteDecimals: 9 })).toEqual({ side: "buy", baseAmountAtoms: 1000000000n, quoteAmountAtoms: 200000000n, priceQuotePerToken: "0.2" });
    expect(inferDammSwapFromVaultDeltas({ baseDeltaAtoms: 1000000000n, quoteDeltaAtoms: -210000000n, baseDecimals: 9, quoteDecimals: 9 })).toEqual({ side: "sell", baseAmountAtoms: 1000000000n, quoteAmountAtoms: 210000000n, priceQuotePerToken: "0.21" });
  });

  it("fails closed for LP-like and ambiguous balance changes", () => {
    expect(inferDammSwapFromVaultDeltas({ baseDeltaAtoms: 1n, quoteDeltaAtoms: 1n, baseDecimals: 9, quoteDecimals: 6 })).toBeNull();
    expect(inferDammSwapFromVaultDeltas({ baseDeltaAtoms: 0n, quoteDeltaAtoms: -1n, baseDecimals: 9, quoteDecimals: 6 })).toBeNull();
  });

  it("deduplicates signatures deterministically and prefers verified DAMM observations", () => {
    const same = trade({ signature: "same", venue: "dbc" });
    const damm = trade({ signature: "same", venue: "damm-v2", source: "damm-v2-confirmed-swap" });
    expect(dedupeHistoricalTrades([damm, same])).toEqual([damm]);
  });

  it("aggregates sparse mixed-venue OHLCV without empty buckets", () => {
    const candles = aggregateCandles([
      trade({ signature: "a", blockTime: 1_700_000_000_100, priceQuotePerToken: "0.2", quoteAmount: "0.2", baseAmount: "1" }),
      trade({ signature: "b", blockTime: 1_700_000_000_500, venue: "damm-v2", source: "damm-v2-confirmed-swap", priceQuotePerToken: "0.3", quoteAmount: "0.3", baseAmount: "1" }),
      trade({ signature: "c", blockTime: 1_700_060_000_000, priceQuotePerToken: "0.1", quoteAmount: "0.1", baseAmount: "2" }),
    ], 60);
    expect(candles).toHaveLength(2);
    expect(candles[0]).toMatchObject({ open: "0.2", high: "0.3", low: "0.2", close: "0.3", baseVolume: "2", quoteVolume: "0.5", tradeCount: 2, venues: ["dbc", "damm-v2"] });
    expect(candles[1]).toMatchObject({ open: "0.1", high: "0.1", low: "0.1", close: "0.1", baseVolume: "2", quoteVolume: "0.1", tradeCount: 1 });
  });

  it("keeps exact decimal arithmetic for quote and base volume", () => {
    expect(addDecimalStrings("0.000000001", "1.2")).toBe("1.200000001");
    expect(compareDecimalStrings("1.20", "1.2")).toBe(0);
    expect(percentChangeString("0.3", "0.2")).toBe("50");
  });

  it("maps every requested timeframe and uses adaptive ALL buckets", () => {
    expect(parseHistoryTimeframe("1d")).toBe("1D");
    expect(parseHistoryTimeframe("ALL")).toBe("ALL");
    expect(parseHistoryTimeframe("2h")).toBeNull();
    expect(parseHistoryMode("trades")).toBe("trades");
    expect(parseHistoryMode("ticks")).toBeNull();
    expect(candleIntervalSeconds("5m")).toBe(30);
    expect(candleIntervalSeconds("1D")).toBe(3600);
    expect(candleIntervalSeconds("ALL", 2 * 24 * 60 * 60 * 1000)).toBe(3600);
    expect(candleIntervalSeconds("ALL", 40 * 24 * 60 * 60 * 1000)).toBe(86400);
  });

  it("exposes exact migration evidence or an explicitly unknown transition", () => {
    const exact = resolveMigrationBoundary({ migrated: true, migrationTransaction: { blockTime: 10, signature: "migration" }, dbcTrades: [], dammTrades: [] });
    expect(exact).toMatchObject({ known: true, blockTime: 10, signature: "migration", source: "migration-transaction" });
    const unknown = resolveMigrationBoundary({ migrated: true, dbcTrades: [trade({ blockTime: 20 })], dammTrades: [trade({ signature: "damm", venue: "damm-v2", source: "damm-v2-confirmed-swap", blockTime: 30 })] });
    expect(unknown).toMatchObject({ known: false, blockTime: null, signature: null, transitionStartTime: 20, transitionEndTime: 30 });
    expect(resolveMigrationBoundary({ migrated: false, dbcTrades: [], dammTrades: [] })).toMatchObject({ known: false, blockTime: null });
  });

  it("only claims 24h coverage when every required venue is complete", () => {
    const complete = { complete: true, oldestObservedAt: new Date(1_699_900_000_000).toISOString(), newestObservedAt: new Date(1_700_000_000_000).toISOString(), signaturesScanned: 2, swapsParsed: 0 };
    const partial = { ...complete, complete: false };
    expect(canClaim24hCoverage({ dbc: complete, dammV2: complete, migrated: false, requestedBoundaryMs: 1_699_900_000_000, observedFromMs: 1_699_900_000_000 })).toBe(true);
    expect(canClaim24hCoverage({ dbc: partial, dammV2: complete, migrated: false, requestedBoundaryMs: 1_699_900_000_000, observedFromMs: 1_699_900_000_000 })).toBe(false);
    expect(canClaim24hCoverage({ dbc: complete, dammV2: partial, migrated: true, requestedBoundaryMs: 1_699_900_000_000, observedFromMs: 1_699_900_000_000 })).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: {},
  getServerConnection: vi.fn(() => ({})),
  withReadConnection: vi.fn(async (_primary: unknown, read: (connection: unknown) => Promise<unknown>) => read({})),
  buildMarketHistory: vi.fn(),
  limitRequest: vi.fn(async () => ({ ok: true, retryAfterSec: 0 })),
  clientKey: vi.fn(() => "history-test"),
}));

vi.mock("@/lib/connection", () => ({ getServerConnection: mocks.getServerConnection, withReadConnection: mocks.withReadConnection }));
vi.mock("@/lib/market/history", async () => {
  const actual = await vi.importActual<typeof import("@/lib/market/history")>("@/lib/market/history");
  return { ...actual, buildMarketHistory: mocks.buildMarketHistory };
});
vi.mock("@/lib/server/http", () => ({ clientKey: mocks.clientKey }));
vi.mock("@/lib/server/rateLimit", () => ({ limitRequest: mocks.limitRequest }));

import { GET } from "@/app/api/markets/[id]/history/route";

const POOL = "D2fzZHDfHHNWybyXLBHdvgJR6vmfH2rMj6rKXQF1WmGY";

function params(value: string) {
  return { params: Promise.resolve({ id: value }) };
}

describe("market history API", () => {
  it("validates pool, mode, and timeframe before RPC reads", async () => {
    expect((await GET(new Request("https://equicurve.test/api/markets/nope/history"), params("nope"))).status).toBe(400);
    expect((await GET(new Request(`https://equicurve.test/api/markets/${POOL}/history?mode=ticks`), params(POOL))).status).toBe(400);
    expect((await GET(new Request(`https://equicurve.test/api/markets/${POOL}/history?timeframe=2h`), params(POOL))).status).toBe(400);
    expect(mocks.buildMarketHistory).not.toHaveBeenCalled();
  });

  it("passes canonical pool identity and normalized query values to the server builder", async () => {
    mocks.buildMarketHistory.mockResolvedValueOnce({
      ok: true,
      market: { pool: POOL, baseMint: "base", quoteMint: "quote", activeVenue: "DAMM v2", currentPriceQuotePerToken: "0.2" },
      timeframe: "1D",
      mode: "candles",
      candleIntervalSeconds: 3600,
      coverage: { from: null, to: null, reaches24hBoundary: true, dbc: {}, dammV2: {} },
      migrationBoundary: { known: false, blockTime: null, signature: null },
      trades: [], candles: [], volume24h: "0", change24hPct: null, referencePrice24h: null, partial: false, unavailableReasons: [],
    });
    const response = await GET(new Request(`https://equicurve.test/api/markets/${POOL}/history?mode=candles&timeframe=1d`), params(POOL));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, timeframe: "1D", mode: "candles", volume24h: "0" });
    expect(mocks.buildMarketHistory).toHaveBeenCalledWith(expect.objectContaining({ timeframe: "1D", mode: "candles" }));
    expect(JSON.stringify(body)).not.toMatch(/helius|api[_-]?key|RPC_URL/i);
  });

  it("returns a bounded degraded response without leaking upstream errors", async () => {
    mocks.buildMarketHistory.mockRejectedValueOnce(new Error("private RPC key should not escape"));
    const response = await GET(new Request(`https://equicurve.test/api/markets/${POOL}/history`), params(POOL));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, code: "history_unavailable", partial: true });
    expect(JSON.stringify(body)).not.toContain("private RPC key");
  });
});

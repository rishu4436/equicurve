import { describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";

const spotPriceMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/dbc/spotPrice", () => ({ fetchSpotPrice: spotPriceMock }));

import { reconstructPoolPriceHistory } from "@/lib/dbc/priceHistory";
import { withVerifiedRpcFallback } from "@/lib/rpc";

const pool = new PublicKey("11111111111111111111111111111111");

function source(endpoint: string): Connection {
  return {
    rpcEndpoint: endpoint,
    getGenesisHash: async () => "devnet",
    getSignaturesForAddress: async () => [],
  } as unknown as Connection;
}

describe("live spot price-history RPC fallback", () => {
  it("bubbles transient live-spot failure and reconstructs from the verified fallback", async () => {
    const primary = source("https://spot-primary.example");
    const fallback = source("https://spot-fallback.example");
    spotPriceMock.mockImplementation(async (connection: Connection) => {
      if (connection.rpcEndpoint.includes("primary")) throw new Error("503 Service Unavailable");
      return {
        price: 2.5,
        baseDecimals: 9,
        quoteDecimals: 6,
        quoteMint: "quote",
        baseMint: "base",
        sqrtPrice: "1",
        priceExact: "2.5",
      };
    });

    const result = await withVerifiedRpcFallback(
      [primary, fallback],
      "devnet",
      (connection) => reconstructPoolPriceHistory(connection as Connection, pool),
      { retries: 0 },
    );

    expect(result.spot).toBe(2.5);
    expect(result.points.some((point) => point.source === "spot" && point.price === 2.5)).toBe(true);
    expect(spotPriceMock).toHaveBeenCalledTimes(2);
  });

  it("keeps non-transient spot failure optional without trying fallback", async () => {
    const primary = source("https://spot-malformed-primary.example");
    const fallback = source("https://spot-malformed-fallback.example");
    let fallbackCalls = 0;
    spotPriceMock.mockImplementation(async (connection: Connection) => {
      if (connection.rpcEndpoint.includes("primary")) throw new Error("malformed mint account");
      fallbackCalls += 1;
      return null;
    });

    const result = await withVerifiedRpcFallback(
      [primary, fallback],
      "devnet",
      (connection) => reconstructPoolPriceHistory(connection as Connection, pool),
      { retries: 0 },
    );

    expect(result.spot).toBeNull();
    expect(result.error).toMatch(/decimals/);
    expect(fallbackCalls).toBe(0);
  });
});

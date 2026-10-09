import { describe, expect, it, vi } from "vitest";
import BN from "bn.js";
import { PublicKey, type Connection } from "@solana/web3.js";

const mocks = vi.hoisted(() => ({
  getDbcClient: vi.fn(),
  fetchDbcPool: vi.fn(),
}));

vi.mock("@/lib/dbc/client", () => ({ getDbcClient: mocks.getDbcClient }));
vi.mock("@/lib/dbc/poolAccount", () => ({ fetchDbcPool: mocks.fetchDbcPool }));

import { fetchSpotPrice } from "@/lib/dbc/spotPrice";
import { withVerifiedRpcFallback } from "@/lib/rpc";

const baseMint = new PublicKey("So11111111111111111111111111111111111111112");
const quoteMint = new PublicKey("SysvarRent111111111111111111111111111111111");
const config = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const pool = new PublicKey("Stake11111111111111111111111111111111111111");

function source(endpoint: string, getParsedAccountInfo: Connection["getParsedAccountInfo"]): Connection {
  return { rpcEndpoint: endpoint, getGenesisHash: async () => "devnet", getParsedAccountInfo } as unknown as Connection;
}

describe("live spot mint-decimal RPC fallback", () => {
  it("rethrows transient mint-decimal failure so verified fallback can return spot", async () => {
    mocks.fetchDbcPool.mockResolvedValue({ state: { baseMint, config, sqrtPrice: new BN("18446744073709551616") } });
    mocks.getDbcClient.mockReturnValue({ state: { getPoolConfig: async () => ({ quoteMint }) } });
    const calls: string[] = [];
    const primary = source("https://decimals-primary.example", async () => {
      calls.push("primary");
      throw new Error("429 Too Many Requests");
    });
    const fallback = source("https://decimals-fallback.example", async () => {
      calls.push("fallback");
      return { value: { data: { parsed: { info: { decimals: 9 } } } } } as never;
    });

    const result = await withVerifiedRpcFallback(
      [primary, fallback],
      "devnet",
      (connection) => fetchSpotPrice(connection as Connection, pool),
      { retries: 0 },
    );

    expect(result?.price).toBeGreaterThan(0);
    expect(calls).toContain("primary");
    expect(calls).toContain("fallback");
  });

  it("keeps malformed decimal data optional without invoking fallback", async () => {
    mocks.fetchDbcPool.mockResolvedValue({ state: { baseMint, config, sqrtPrice: new BN("18446744073709551616") } });
    mocks.getDbcClient.mockReturnValue({ state: { getPoolConfig: async () => ({ quoteMint }) } });
    let fallbackCalls = 0;
    const primary = source("https://decimals-malformed-primary.example", async () => {
      throw new Error("malformed mint account");
    });
    const fallback = source("https://decimals-malformed-fallback.example", async () => {
      fallbackCalls += 1;
      return { value: { data: { parsed: { info: { decimals: 9 } } } } } as never;
    });

    const result = await withVerifiedRpcFallback(
      [primary, fallback],
      "devnet",
      (connection) => fetchSpotPrice(connection as Connection, pool),
      { retries: 0 },
    );

    expect(result).toBeNull();
    expect(fallbackCalls).toBe(0);
  });
});

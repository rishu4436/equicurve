import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";

const clients = new Map<string, { isPoolExist: () => Promise<boolean>; fetchPoolState: () => Promise<unknown> }>();

vi.mock("@/lib/damm/client", () => ({
  getCpAmm: (connection: Connection) => clients.get(connection.rpcEndpoint),
}));

import { verifyDammV2Pool } from "@/lib/dbc/migrate";
import { withVerifiedRpcFallback } from "@/lib/rpc";

function connection(endpoint: string): Connection {
  return {
    rpcEndpoint: endpoint,
    getGenesisHash: async () => "devnet",
  } as unknown as Connection;
}

describe("DAMM verification RPC propagation", () => {
  beforeEach(() => clients.clear());

  it("bubbles a transient verification failure so a verified fallback can succeed", async () => {
    const primary = connection("https://damm-primary.example");
    const fallback = connection("https://damm-fallback.example");
    clients.set(primary.rpcEndpoint, {
      isPoolExist: async () => { throw new Error("503 Service Unavailable"); },
      fetchPoolState: async () => ({}),
    });
    clients.set(fallback.rpcEndpoint, {
      isPoolExist: async () => true,
      fetchPoolState: async () => ({}),
    });
    const result = await withVerifiedRpcFallback(
      [primary, fallback],
      "devnet",
      (readConnection) => verifyDammV2Pool(readConnection as Connection, new PublicKey("11111111111111111111111111111111")),
      { retries: 0 },
    );
    expect(result).toBe("exists");
  });

  it("keeps non-transient validation failures fail-closed without fallback", async () => {
    const primary = connection("https://damm-validation-primary.example");
    const fallback = connection("https://damm-validation-fallback.example");
    let fallbackCalls = 0;
    clients.set(primary.rpcEndpoint, {
      isPoolExist: async () => { throw new Error("invalid pool mint layout"); },
      fetchPoolState: async () => ({}),
    });
    clients.set(fallback.rpcEndpoint, {
      isPoolExist: async () => { fallbackCalls += 1; return true; },
      fetchPoolState: async () => ({}),
    });
    const result = await withVerifiedRpcFallback(
      [primary, fallback],
      "devnet",
      (readConnection) => verifyDammV2Pool(readConnection as Connection, new PublicKey("11111111111111111111111111111111")),
      { retries: 0 },
    );
    expect(result).toBe("rpc_unavailable");
    expect(fallbackCalls).toBe(0);
  });
});

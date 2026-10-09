import { describe, expect, it } from "vitest";
import { EXPECTED_CLUSTER_GENESIS_HASH } from "@/lib/connection";
import { checkRpcIdentity, summarizeRpcHealth, type RpcIdentityCheck } from "@/lib/rpcHealth";
import { withVerifiedRpcFallback } from "@/lib/rpc";

const FULL_DEVNET = EXPECTED_CLUSTER_GENESIS_HASH.devnet;
const FULL_MAINNET = EXPECTED_CLUSTER_GENESIS_HASH["mainnet-beta"];

function probe(genesis: string, slot = 123): { getGenesisHash: () => Promise<string>; getSlot: () => Promise<number> } {
  return {
    getGenesisHash: async () => genesis,
    getSlot: async () => slot,
  };
}

function unavailable(error = new Error("transport unavailable")): { getGenesisHash: () => Promise<string>; getSlot: () => Promise<number> } {
  return {
    getGenesisHash: async () => { throw error; },
    getSlot: async () => { throw error; },
  };
}

describe("full Solana cluster identity", () => {
  it("keeps every public cluster constant as a full genesis hash", () => {
    for (const hash of Object.values(EXPECTED_CLUSTER_GENESIS_HASH)) {
      expect(hash.length).toBeGreaterThan(32);
    }
  });

  it("accepts the current full devnet genesis hash", async () => {
    await expect(checkRpcIdentity(probe(FULL_DEVNET), FULL_DEVNET)).resolves.toMatchObject({
      rpcStatus: "ok",
      rpcClusterStatus: "verified",
      genesisHash: FULL_DEVNET,
      slot: 123,
      error: null,
    });
  });

  it("rejects the shortened devnet network identifier", async () => {
    const shortened = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
    await expect(checkRpcIdentity(probe(shortened), FULL_DEVNET)).resolves.toMatchObject({
      rpcStatus: "ok",
      rpcClusterStatus: "mismatch",
      genesisHash: shortened,
      error: "RPC cluster mismatch",
    });
  });

  it("uses the full mainnet genesis rather than its shortened identifier", async () => {
    const shortened = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
    await expect(checkRpcIdentity(probe(FULL_MAINNET), FULL_MAINNET)).resolves.toMatchObject({
      rpcClusterStatus: "verified",
      genesisHash: FULL_MAINNET,
    });
    await expect(checkRpcIdentity(probe(shortened), FULL_MAINNET)).resolves.toMatchObject({
      rpcClusterStatus: "mismatch",
      genesisHash: shortened,
    });
  });

  it("fails closed for a reachable wrong-cluster endpoint", async () => {
    const result = await checkRpcIdentity(probe("mainnet-genesis"), FULL_DEVNET);
    expect(result).toMatchObject({ rpcStatus: "ok", rpcClusterStatus: "mismatch" });
  });

  it("uses a same-cluster fallback after a transient primary failure", async () => {
    const sources = [
      { rpcEndpoint: "https://primary.example", getGenesisHash: async () => FULL_DEVNET },
      { rpcEndpoint: "https://fallback.example", getGenesisHash: async () => FULL_DEVNET },
    ];
    const read = await withVerifiedRpcFallback(
      sources,
      FULL_DEVNET,
      async (source) => {
        if (source === sources[0]) throw new Error("503 Service Unavailable");
        return "fallback-read";
      },
      { retries: 0 },
    );
    expect(read).toBe("fallback-read");
  });

  it("reports unavailable identity separately from transport failure", async () => {
    const result = await checkRpcIdentity(unavailable(), FULL_DEVNET);
    expect(result).toMatchObject({
      rpcStatus: "unavailable",
      rpcClusterStatus: "unavailable",
      genesisHash: null,
      slot: null,
      error: "RPC unavailable",
    });
  });

  it("makes /api/health unhealthy when a reachable server endpoint is mismatched", () => {
    const verified: RpcIdentityCheck = {
      rpcStatus: "ok", rpcClusterStatus: "verified", genesisHash: FULL_DEVNET, slot: 1, error: null,
    };
    const mismatch: RpcIdentityCheck = {
      rpcStatus: "ok", rpcClusterStatus: "mismatch", genesisHash: "wrong", slot: 2, error: "RPC cluster mismatch",
    };
    expect(summarizeRpcHealth(verified, mismatch)).toEqual({
      ok: false,
      rpcStatus: "ok",
      rpcClusterStatus: "mismatch",
      error: "RPC cluster mismatch",
    });
  });

  it("makes /api/health healthy only when public and server identity are verified", () => {
    const verified: RpcIdentityCheck = {
      rpcStatus: "ok", rpcClusterStatus: "verified", genesisHash: FULL_DEVNET, slot: 1, error: null,
    };
    expect(summarizeRpcHealth(verified, verified)).toEqual({
      ok: true,
      rpcStatus: "ok",
      rpcClusterStatus: "verified",
      error: null,
    });
  });

  it("does not call a transaction path while probing identity", async () => {
    const result = await checkRpcIdentity(probe(FULL_DEVNET), FULL_DEVNET);
    expect(result.rpcClusterStatus).toBe("verified");
  });
});

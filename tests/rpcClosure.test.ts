import { describe, expect, it } from "vitest";
import { withVerifiedRpcFallback } from "@/lib/rpc";

type ReadSource = {
  rpcEndpoint: string;
  getGenesisHash: () => Promise<string>;
};

const sources = (suffix: string, fallbackGenesis = "devnet") => [
  { rpcEndpoint: `https://primary-${suffix}.example`, getGenesisHash: async () => "devnet" },
  { rpcEndpoint: `https://fallback-${suffix}.example`, getGenesisHash: async () => fallbackGenesis },
] satisfies ReadSource[];

describe("verified RPC closure paths", () => {
  it("uses verified fallback for Portfolio token-account reads", async () => {
    const calls: string[] = [];
    const result = await withVerifiedRpcFallback(sources("portfolio"), "devnet", async (source) => {
      calls.push(source.rpcEndpoint);
      if (source.rpcEndpoint.includes("primary")) throw new Error("503 Service Unavailable");
      return { value: [{ pubkey: "fallback-token-account" }] };
    }, { retries: 0 });
    expect(result.value[0]?.pubkey).toBe("fallback-token-account");
    expect(calls).toHaveLength(2);
  });

  it("rejects a wrong-cluster Portfolio fallback before it contributes data", async () => {
    const calls: string[] = [];
    await expect(withVerifiedRpcFallback(sources("portfolio-mismatch", "mainnet"), "devnet", async (source) => {
      calls.push(source.rpcEndpoint);
      if (source.rpcEndpoint.includes("primary")) throw new Error("429 Too Many Requests");
      return { value: [{ pubkey: "wrong-cluster-data" }] };
    }, { retries: 0 })).rejects.toThrow(/cluster mismatch/);
    expect(calls).toEqual(["https://primary-portfolio-mismatch.example"]);
  });

  it("keeps Portfolio DAMM pool and position reads on one verified fallback", async () => {
    const result = await withVerifiedRpcFallback(sources("portfolio-damm"), "devnet", async (source) => {
      if (source.rpcEndpoint.includes("primary")) throw new Error("fetch failed");
      return { pool: "verified-fallback-pool", positions: ["position-from-same-endpoint"] };
    }, { retries: 0 });
    expect(result).toEqual({ pool: "verified-fallback-pool", positions: ["position-from-same-endpoint"] });
  });

  it("lets transient DAMM verification reach the verified fallback", async () => {
    const result = await withVerifiedRpcFallback(sources("damm-verification"), "devnet", async (source) => {
      if (source.rpcEndpoint.includes("primary")) throw new Error("503 Service Unavailable");
      return "exists";
    }, { retries: 0 });
    expect(result).toBe("exists");
  });

  it("does not fallback after a genuine DAMM validation failure", async () => {
    const calls: string[] = [];
    await expect(withVerifiedRpcFallback(sources("damm-validation"), "devnet", async (source) => {
      calls.push(source.rpcEndpoint);
      throw new Error("invalid pool mint layout");
    }, { retries: 0 })).rejects.toThrow(/invalid pool mint layout/);
    expect(calls).toEqual(["https://primary-damm-validation.example"]);
  });

  it("lets transient price-history signature reads reach fallback", async () => {
    const result = await withVerifiedRpcFallback(sources("price-history"), "devnet", async (source) => {
      if (source.rpcEndpoint.includes("primary")) throw new Error("429 Too Many Requests");
      return { signatures: ["same-cluster-signature"] };
    }, { retries: 0 });
    expect(result.signatures).toEqual(["same-cluster-signature"]);
  });

  it("lets transient snapshot config reads reach fallback", async () => {
    const result = await withVerifiedRpcFallback(sources("snapshot-config"), "devnet", async (source) => {
      if (source.rpcEndpoint.includes("primary")) throw new Error("ETIMEDOUT");
      return { configRead: true, quoteDecimals: 6 };
    }, { retries: 0 });
    expect(result).toEqual({ configRead: true, quoteDecimals: 6 });
  });

  it("keeps non-transient snapshot account/layout failures fail-closed", async () => {
    const calls: string[] = [];
    await expect(withVerifiedRpcFallback(sources("snapshot-layout"), "devnet", async (source) => {
      calls.push(source.rpcEndpoint);
      throw new Error("Unexpected DBC pool account layout");
    }, { retries: 0 })).rejects.toThrow(/Unexpected DBC pool account layout/);
    expect(calls).toEqual(["https://primary-snapshot-layout.example"]);
  });

  it("uses verified fallback while building a creator claim", async () => {
    const result = await withVerifiedRpcFallback(sources("creator-claim"), "devnet", async (source) => {
      if (source.rpcEndpoint.includes("primary")) throw new Error("503 Service Unavailable");
      return { builder: "creator", readEndpoint: source.rpcEndpoint };
    }, { retries: 0 });
    expect(result.builder).toBe("creator");
    expect(result.readEndpoint).toContain("fallback");
  });

  it("uses verified fallback while building a partner claim", async () => {
    const result = await withVerifiedRpcFallback(sources("partner-claim"), "devnet", async (source) => {
      if (source.rpcEndpoint.includes("primary")) throw new Error("fetch failed");
      return { builder: "partner", readEndpoint: source.rpcEndpoint };
    }, { retries: 0 });
    expect(result.builder).toBe("partner");
    expect(result.readEndpoint).toContain("fallback");
  });
});

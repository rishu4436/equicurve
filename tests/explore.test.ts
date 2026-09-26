import { describe, expect, it } from "vitest";
import {
  applyChainLookup,
  countVerification,
  markNotChecked,
  rpcStatusFromCounts,
} from "@/lib/explore/verification";
import { enrichOfferings } from "@/lib/explore/discover";
import type { ExploreOffering } from "@/lib/explore/types";
import type { ChainLookupResult } from "@/lib/registry/authorize";
import { snapshot } from "./helpers";

function offering(pool: string, over: Partial<ExploreOffering> = {}): ExploreOffering {
  return {
    id: pool,
    pool,
    mint: "m",
    config: "c",
    name: "X",
    ticker: "X",
    thesis: "",
    sector: "Equity",
    quote: "SOL",
    raiseTarget: 0,
    quoteProgress: null,
    presetId: "short",
    lockPct: null,
    status: "graduated", // registry claims graduated
    statusSource: "registry",
    verification: { state: "not_checked", checkedAt: null, cluster: "devnet" },
    verified: false,
    profileSigned: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    creator: "c",
    cluster: "devnet",
    illustrative: false,
    source: "registry",
    ...over,
  };
}

describe("verification mapping", () => {
  it("verified lookup overrides registry status with chain status", () => {
    const o = applyChainLookup(offering("p1"), { status: "verified", snapshot: snapshot() }, "t", "devnet", []);
    expect(o.status).toBe("raising");
    expect(o.statusSource).toBe("chain");
    expect(o.verified).toBe(true);
    expect(o.verification.state).toBe("verified");
    expect(o.quoteProgress).toBeCloseTo(10 / 85, 5);
  });

  it("failed lookups keep registry status but mark it unverified with unknown progress", () => {
    for (const status of ["not_found", "rpc_unavailable"] as const) {
      const o = applyChainLookup(offering("p1", { quoteProgress: 0.5 }), { status, error: "e" }, "t", "devnet", []);
      expect(o.statusSource).toBe("registry");
      expect(o.verification).toMatchObject({ state: status, checkedAt: "t", cluster: "devnet" });
      expect(o.quoteProgress).toBeNull();
    }
    const n = markNotChecked(offering("p2"), "devnet");
    expect(n.verification.state).toBe("not_checked");
    expect(n.quoteProgress).toBeNull();
  });

  it("counts + rpc status", () => {
    const list = [
      applyChainLookup(offering("a"), { status: "verified", snapshot: snapshot() }, "t", "devnet", []),
      applyChainLookup(offering("b"), { status: "rpc_unavailable", error: "x" }, "t", "devnet", []),
      markNotChecked(offering("c"), "devnet"),
    ];
    const c = countVerification(list);
    expect(c).toEqual({ verified: 1, notFound: 0, rpcUnavailable: 1, notChecked: 1 });
    expect(rpcStatusFromCounts(c)).toBe("degraded");
    expect(rpcStatusFromCounts({ verified: 0, notFound: 0, rpcUnavailable: 0 })).toBe("idle");
    expect(rpcStatusFromCounts({ verified: 2, notFound: 1, rpcUnavailable: 0 })).toBe("ok");
    expect(rpcStatusFromCounts({ verified: 0, notFound: 0, rpcUnavailable: 3 })).toBe("unavailable");
  });
});

describe("enrichOfferings", () => {
  it("bounds concurrency, times out slow pools, caps checks", async () => {
    let inFlight = 0;
    let peak = 0;
    const lookup = async (pool: string): Promise<ChainLookupResult> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        if (pool === "slow") await new Promise((r) => setTimeout(r, 200));
        else await new Promise((r) => setTimeout(r, 5));
        if (pool === "throws") throw new Error("429 Too Many Requests");
        return { status: "verified", snapshot: snapshot() };
      } finally {
        inFlight--;
      }
    };
    const pools = ["slow", "throws", ...Array.from({ length: 10 }, (_, i) => `p${i}`)];
    const r = await enrichOfferings(pools.map((p) => offering(p)), {
      lookup,
      cluster: "devnet",
      timeoutMs: 50,
      concurrency: 3,
      maxEnrich: 8,
    });
    expect(peak).toBeLessThanOrEqual(3);
    const byPool = Object.fromEntries(r.offerings.map((o) => [o.pool, o]));
    expect(byPool.slow.verification.state).toBe("rpc_unavailable");
    expect(byPool.throws.verification.state).toBe("rpc_unavailable");
    expect(r.rateLimited).toBe(true);
    expect(r.offerings.filter((o) => o.verification.state === "not_checked")).toHaveLength(4);
    expect(r.enriched).toBe(6);
    expect(r.offerings).toHaveLength(pools.length);
  });
});

describe("explicit verified flag", () => {
  it("is false for not-checked, not-found and RPC-unavailable lookups", () => {
    expect(markNotChecked(offering("p"), "devnet").verified).toBe(false);
    expect(applyChainLookup(offering("p", { verified: true }), { status: "not_found" } as ChainLookupResult, "t", "devnet", []).verified).toBe(false);
    expect(
      applyChainLookup(offering("p", { verified: true }), { status: "rpc_unavailable", error: "down" } as ChainLookupResult, "t", "devnet", []).verified,
    ).toBe(false);
  });
});

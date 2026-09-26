/**
 * Pure discovery-state mapping (unit-tested). Converts a chain lookup into a
 * per-offering verification state; registry-provided status is never
 * presented as chain-verified.
 */
import { chainStatusFromCurve } from "@/lib/dbc/curveState";
import type { ChainLookupResult } from "@/lib/registry/authorize";
import type { ExploreCounts, ExploreOffering } from "./types";

export function applyChainLookup(
  o: ExploreOffering,
  lookup: ChainLookupResult,
  checkedAt: string,
  cluster: string,
  usdcMints: readonly string[],
): ExploreOffering {
  if (lookup.status === "verified") {
    const s = lookup.snapshot;
    return {
      ...o,
      mint: s.baseMint,
      config: s.config,
      creator: s.creator,
      quote: s.quoteMint && usdcMints.includes(s.quoteMint) ? "USDC" : "SOL",
      lockPct: s.lockPct ?? o.lockPct,
      quoteProgress: s.curve.progress,
      status: chainStatusFromCurve(s.curve, s.quoteReserve),
      statusSource: "chain",
      verification: { state: "verified", checkedAt: s.checkedAt, cluster },
      verified: true,
    };
  }
  return {
    ...o,
    quoteProgress: null,
    statusSource: "registry",
    verified: false,
    verification: {
      state: lookup.status,
      checkedAt,
      cluster,
      error: lookup.error,
    },
  };
}

/**
 * Status to render for a live offering. When the on-chain read failed because
 * the RPC is unavailable we must not echo a stored "complete"/"graduated" as if
 * it were current (same rule as the offering detail page): show "unknown".
 */
export function displayStatus(o: { status: string; verification?: ExploreOffering["verification"] }): string {
  return o.verification?.state === "rpc_unavailable" ? "unknown" : o.status;
}

export function markNotChecked(o: ExploreOffering, cluster: string): ExploreOffering {
  return {
    ...o,
    quoteProgress: null,
    statusSource: "registry",
    verified: false,
    verification: { state: "not_checked", checkedAt: null, cluster },
  };
}

export function countVerification(
  offerings: ExploreOffering[],
): Pick<ExploreCounts, "verified" | "notFound" | "rpcUnavailable" | "notChecked"> {
  const c = { verified: 0, notFound: 0, rpcUnavailable: 0, notChecked: 0 };
  for (const o of offerings) {
    if (o.verification.state === "verified") c.verified++;
    else if (o.verification.state === "not_found") c.notFound++;
    else if (o.verification.state === "rpc_unavailable") c.rpcUnavailable++;
    else c.notChecked++;
  }
  return c;
}

export function rpcStatusFromCounts(c: {
  verified: number;
  notFound: number;
  rpcUnavailable: number;
}): "ok" | "degraded" | "unavailable" | "idle" {
  const attempted = c.verified + c.notFound + c.rpcUnavailable;
  if (attempted === 0) return "idle";
  if (c.rpcUnavailable === 0) return "ok";
  if (c.rpcUnavailable === attempted) return "unavailable";
  return "degraded";
}

/** Short UI label for a verification state. */
export function verificationLabel(state: ExploreOffering["verification"]["state"]): string {
  switch (state) {
    case "verified":
      return "Verified on-chain";
    case "not_found":
      return "Not found on-chain";
    case "rpc_unavailable":
      return "RPC unavailable";
    default:
      return "Not checked";
  }
}

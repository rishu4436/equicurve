import { NextResponse } from "next/server";
import { getCluster } from "@/lib/constants";
import { buildExploreResponse } from "@/lib/explore/discover";
import { getRegistryMeta } from "@/lib/registry/store";
import { isRateLimitError } from "@/lib/rpc";
import { checkRateLimit, clientKey } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Cache bypass is rate-limited so ?refresh=1 can't be used to hammer the RPC.
  const wantsBypass = url.searchParams.get("refresh") === "1";
  const bypass = wantsBypass && checkRateLimit(clientKey(req, "explore:refresh"), 6, 60_000).ok;
  try {
    const payload = await buildExploreResponse({ bypassCache: bypass });
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Explore discovery failed";
    const rateLimited = isRateLimitError(e);
    return NextResponse.json(
      {
        ok: false,
        source: "equicurve-registry",
        label: "EquiCurve registry (not a full chain indexer)",
        cached: false,
        cacheAgeMs: 0,
        cacheTtlSec: 45,
        cluster: getCluster(),
        rpcStatus: "unavailable",
        offerings: [],
        counts: { registry: 0, configGpa: 0, enriched: 0, verified: 0, notFound: 0, rpcUnavailable: 0, notChecked: 0 },
        limits: [],
        warning: rateLimited ? "RPC rate-limited — try again shortly." : null,
        error: msg,
        registry: getRegistryMeta(),
      },
      { status: rateLimited ? 503 : 500 },
    );
  }
}

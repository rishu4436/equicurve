import { NextResponse } from "next/server";
import { buildExploreResponse } from "@/lib/explore/discover";
import { getRegistryMeta } from "@/lib/registry/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const bypass = url.searchParams.get("refresh") === "1";
  try {
    const payload = await buildExploreResponse({ bypassCache: bypass });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=30",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Explore discovery failed";
    const rateLimited = /429|rate|too many|limit/i.test(msg);
    return NextResponse.json(
      {
        ok: false,
        source: "equicurve-registry",
        label: "EquiCurve registry (not a full chain indexer)",
        cached: false,
        cacheAgeMs: 0,
        cacheTtlSec: 45,
        offerings: [],
        counts: { registry: 0, configGpa: 0, enriched: 0 },
        limits: [],
        warning: rateLimited
          ? "RPC rate-limited — try again shortly."
          : null,
        error: msg,
        registry: getRegistryMeta(),
      },
      { status: rateLimited ? 503 : 500 },
    );
  }
}

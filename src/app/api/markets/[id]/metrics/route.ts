import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { getServerConnection, withReadConnection } from "@/lib/connection";
import { buildMarketMetrics } from "@/lib/market/metrics";
import { clientKey } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";
import { PoolNotFoundError } from "@/lib/dbc/poolAccount";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_LIMIT = 20;
const READ_WINDOW_MS = 60_000;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: rawPool } = await ctx.params;
  let pool: PublicKey;
  try {
    pool = new PublicKey(rawPool);
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_pool", error: "Invalid pool address" },
      { status: 400 },
    );
  }

  const rl = await limitRequest(clientKey(req, "markets:metrics"), READ_LIMIT, READ_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Market metrics reads are temporarily rate-limited." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  try {
    const metrics = await withReadConnection(
      getServerConnection(),
      (connection) => buildMarketMetrics(connection, pool),
      { server: true },
    );
    return NextResponse.json(
      { ok: true, ...metrics },
      { headers: { "Cache-Control": "private, max-age=5" } },
    );
  } catch (error) {
    if (error instanceof PoolNotFoundError) {
      return NextResponse.json(
        { ok: false, code: "pool_not_found", error: "Pool not found on this cluster." },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { ok: false, code: "rpc_unavailable", error: "Market metrics are temporarily unavailable." },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
}

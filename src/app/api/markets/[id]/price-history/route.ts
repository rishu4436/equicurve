import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { getServerConnection, withReadConnection } from "@/lib/connection";
import { reconstructPoolPriceHistory } from "@/lib/dbc/priceHistory";
import { clientKey } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_LIMIT = 20;
const READ_WINDOW_MS = 60_000;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
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

  const rl = await limitRequest(clientKey(req, "markets:price-history"), READ_LIMIT, READ_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Price history reads are temporarily rate-limited." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  try {
    const result = await withReadConnection(
      getServerConnection(),
      (connection) => reconstructPoolPriceHistory(connection, pool, { limit: 100 }),
      { server: true },
    );
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "private, max-age=5" } },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "rpc_unavailable",
        error: "Price history is temporarily unavailable.",
        points: [],
        spot: null,
        scanned: 0,
        parsedSwaps: 0,
      },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
}

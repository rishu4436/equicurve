import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { getServerConnection, withReadConnection } from "@/lib/connection";
import {
  buildMarketHistory,
  parseHistoryMode,
  parseHistoryTimeframe,
} from "@/lib/market/history";
import { clientKey } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_LIMIT = 8;
const READ_WINDOW_MS = 60_000;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: rawPool } = await ctx.params;
  let pool: PublicKey;
  try {
    pool = new PublicKey(rawPool);
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_pool", error: "Invalid pool address" }, { status: 400 });
  }
  const url = new URL(req.url);
  const timeframe = parseHistoryTimeframe(url.searchParams.get("timeframe") ?? "1D");
  const mode = parseHistoryMode(url.searchParams.get("mode") ?? "trades");
  if (!timeframe) {
    return NextResponse.json({ ok: false, code: "invalid_timeframe", error: "Unsupported history timeframe" }, { status: 400 });
  }
  if (!mode) {
    return NextResponse.json({ ok: false, code: "invalid_mode", error: "Unsupported history mode" }, { status: 400 });
  }
  const rl = await limitRequest(clientKey(req, "markets:history"), READ_LIMIT, READ_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "History reads are temporarily rate-limited." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }
  try {
    const result = await withReadConnection(
      getServerConnection(),
      (connection) => buildMarketHistory({ connection, pool, timeframe, mode }),
      { server: true },
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=20" },
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "history_unavailable",
        error: "Confirmed market history is temporarily unavailable.",
        trades: [],
        candles: [],
        partial: true,
        unavailableReasons: ["Verified market history could not be read."],
      },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
}

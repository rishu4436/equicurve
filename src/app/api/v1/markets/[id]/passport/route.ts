import { NextResponse } from "next/server";
import { getPassport, PassportNotFoundError, PassportQueryError, PassportStorageError } from "@/lib/passport/query";
import { clientKey } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const READ_LIMIT = 30;
const READ_WINDOW_MS = 60_000;

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const rl = await limitRequest(clientKey(req, "passport:get"), READ_LIMIT, READ_WINDOW_MS);
    if (!rl.ok) return NextResponse.json({ ok: false, error: "Passport reads are temporarily rate-limited.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
    const { id } = await ctx.params;
    const passport = await getPassport(id);
    return NextResponse.json(passport, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PassportQueryError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    if (error instanceof PassportNotFoundError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    if (error instanceof PassportStorageError) return NextResponse.json({ ok: false, error: error.message, code: error.code }, { status: error.status });
    return NextResponse.json({ ok: false, error: "Passport is temporarily unavailable.", code: "passport_unavailable" }, { status: 503 });
  }
}

import { NextResponse } from "next/server";
import { getPassport, PassportNotFoundError, PassportQueryError, PassportStorageError } from "@/lib/passport/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
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

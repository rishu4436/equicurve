import { NextResponse } from "next/server";
import { assertCommunityAuthStorage, getWalletSession } from "@/lib/community/auth";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    assertCommunityAuthStorage();
    const session = await getWalletSession(req);
    return NextResponse.json({ ok: true, authenticated: !!session, ...(session ?? {}) });
  } catch (error) {
    return NextResponse.json({ ok: false, authenticated: false, error: error instanceof Error ? error.message : "Wallet authentication unavailable", code: "storage_unavailable" }, { status: 503 });
  }
}

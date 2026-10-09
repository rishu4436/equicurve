import { NextResponse } from "next/server";
import { expiredWalletSessionCookie } from "@/lib/community/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.headers.append("Set-Cookie", expiredWalletSessionCookie());
  return response;
}

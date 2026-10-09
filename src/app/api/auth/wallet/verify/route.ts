import bs58 from "bs58";
import { NextResponse } from "next/server";
import { getCluster } from "@/lib/constants";
import { assertCommunityAuthStorage, verifyWalletChallenge, walletSessionCookie } from "@/lib/community/auth";
import { clientKey, readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rl = await limitRequest(clientKey(req, "community:auth-verify"), 20, 10 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many wallet verifications — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const body = await readJsonBody(req, 8 * 1024);
  if (!body.ok) return NextResponse.json({ ok: false, error: body.error, code: "invalid_body" }, { status: body.status });
  try {
    assertCommunityAuthStorage();
    const value = body.value as { wallet?: unknown; nonce?: unknown; signature?: unknown };
    const result = await verifyWalletChallenge({ wallet: String(value.wallet ?? ""), nonce: String(value.nonce ?? ""), signature: String(value.signature ?? ""), cluster: getCluster() });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    // Force a base58 decode here as a final boundary check before setting a session cookie.
    bs58.decode(String(value.signature));
    const response = NextResponse.json({ ok: true, wallet: result.wallet, expiresAt: result.expiresAt });
    response.headers.append("Set-Cookie", walletSessionCookie(result.token, result.expiresAt));
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Wallet authentication unavailable", code: "storage_unavailable" }, { status: 503 });
  }
}

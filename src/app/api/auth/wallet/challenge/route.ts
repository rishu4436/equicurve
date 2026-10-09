import { NextResponse } from "next/server";
import { getCluster } from "@/lib/constants";
import { issueWalletChallenge, walletChallengeRequestSchema } from "@/lib/community/auth";
import { assertCommunityAuthStorage } from "@/lib/community/auth";
import { clientKey, readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const rl = await limitRequest(clientKey(req, "community:auth-challenge"), 20, 10 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many wallet challenges — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const body = await readJsonBody(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ ok: false, error: body.error, code: "invalid_body" }, { status: body.status });
  const parsed = walletChallengeRequestSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid wallet", code: "invalid_body" }, { status: 400 });
  try {
    assertCommunityAuthStorage();
    const issued = await issueWalletChallenge({ wallet: parsed.data.wallet, cluster: getCluster() });
    return NextResponse.json({ ok: true, ...issued.challenge, message: issued.message });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Wallet authentication storage unavailable", code: "storage_unavailable" }, { status: 503 });
  }
}

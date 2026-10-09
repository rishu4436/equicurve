import { NextResponse } from "next/server";
import { getCluster } from "@/lib/constants";
import { getWalletSession } from "@/lib/community/auth";
import { pinIssuerPost, toPublicPost } from "@/lib/community/authorize";
import { resolveCommunityMarket } from "@/lib/community/market";
import { CommunityStorageConfigError, getCommunityStore } from "@/lib/community/store";
import { readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ postId: string }> };
const pinSchema = z.object({ pinned: z.boolean() }).strict();

export async function POST(req: Request, ctx: Ctx) {
  const { postId } = await ctx.params;
  const session = await getWalletSession(req).catch(() => null);
  if (!session || session.cluster !== getCluster()) return NextResponse.json({ ok: false, error: "Authenticate the creator wallet first.", code: "unauthenticated" }, { status: 401 });
  const rl = await limitRequest(`community:post-pin:${session.wallet}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many pin changes — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const body = await readJsonBody(req, 2 * 1024);
  if (!body.ok) return NextResponse.json({ ok: false, error: body.error, code: "invalid_body" }, { status: body.status });
  const parsed = pinSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Use { pinned: boolean }", code: "invalid_body" }, { status: 400 });
  try {
    const store = getCommunityStore();
    const post = await store.getPost(postId);
    if (!post) return NextResponse.json({ ok: false, error: "Update not found.", code: "post_not_found" }, { status: 404 });
    const market = await resolveCommunityMarket(post.marketId);
    if (!market.ok) return NextResponse.json({ ok: false, error: market.error, code: market.code }, { status: market.status });
    const result = await pinIssuerPost({ post, market: market.market, signer: session.wallet, pinned: parsed.data.pinned, store });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, post: toPublicPost(result.post, (await store.listComments(result.post.id)).length) });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

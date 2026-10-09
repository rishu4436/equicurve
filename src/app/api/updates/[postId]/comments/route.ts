import { NextResponse } from "next/server";
import { getCluster } from "@/lib/constants";
import { getWalletSession } from "@/lib/community/auth";
import { commentContentSchema, createComment, toPublicComment } from "@/lib/community/authorize";
import { resolveCommunityMarket } from "@/lib/community/market";
import { CommunityStorageConfigError, getCommunityStore } from "@/lib/community/store";
import { readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ postId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { postId } = await ctx.params;
  try {
    const store = getCommunityStore();
    const post = await store.getPost(postId);
    if (!post || post.deletedAt) return NextResponse.json({ ok: false, error: "Update not found.", code: "post_not_found" }, { status: 404 });
    const market = await resolveCommunityMarket(post.marketId);
    if (!market.ok) return NextResponse.json({ ok: false, error: market.error, code: market.code }, { status: market.status });
    const comments = (await store.listComments(post.id)).map((comment) => toPublicComment(comment, market.market.creatorWallet));
    return NextResponse.json({ ok: true, comments, count: comments.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { postId } = await ctx.params;
  const session = await getWalletSession(req).catch(() => null);
  if (!session || session.cluster !== getCluster()) return NextResponse.json({ ok: false, error: "Authenticate a wallet before commenting.", code: "unauthenticated" }, { status: 401 });
  const rl = await limitRequest(`community:comment:${session.wallet}`, 30, 10 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many comments — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const body = await readJsonBody(req, 8 * 1024);
  if (!body.ok) return NextResponse.json({ ok: false, error: body.error, code: "invalid_body" }, { status: body.status });
  const parsed = commentContentSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment", code: "invalid_body" }, { status: 400 });
  try {
    const store = getCommunityStore();
    const post = await store.getPost(postId);
    if (!post) return NextResponse.json({ ok: false, error: "Update not found.", code: "post_not_found" }, { status: 404 });
    const market = await resolveCommunityMarket(post.marketId);
    if (!market.ok) return NextResponse.json({ ok: false, error: market.error, code: market.code }, { status: market.status });
    const result = await createComment({ post, signer: session.wallet, body: parsed.data, store });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ ok: true, comment: toPublicComment(result.comment, market.market.creatorWallet) }, { status: 201 });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

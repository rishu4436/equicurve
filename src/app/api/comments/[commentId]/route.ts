import { NextResponse } from "next/server";
import { getCluster } from "@/lib/constants";
import { getWalletSession } from "@/lib/community/auth";
import { commentContentSchema, deleteComment, editComment, toPublicComment } from "@/lib/community/authorize";
import { resolveCommunityMarket } from "@/lib/community/market";
import { CommunityStorageConfigError, getCommunityStore } from "@/lib/community/store";
import { readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ commentId: string }> };

function failure(result: { status: number; code: string; error: string }) {
  return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
}

async function load(commentId: string) {
  const store = getCommunityStore();
  const comment = await store.getComment(commentId);
  if (!comment) return { error: failure({ status: 404, code: "comment_not_found", error: "Comment not found." }) } as const;
  const post = await store.getPost(comment.postId);
  if (!post) return { error: failure({ status: 404, code: "post_not_found", error: "Update not found." }) } as const;
  const market = await resolveCommunityMarket(post.marketId);
  if (!market.ok) return { error: failure(market) } as const;
  return { store, comment, post, market } as const;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { commentId } = await ctx.params;
  const session = await getWalletSession(req).catch(() => null);
  if (!session || session.cluster !== getCluster()) return NextResponse.json({ ok: false, error: "Authenticate the comment wallet first.", code: "unauthenticated" }, { status: 401 });
  const rl = await limitRequest(`community:comment-edit:${session.wallet}`, 60, 10 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many comment edits — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const body = await readJsonBody(req, 4 * 1024);
  if (!body.ok) return NextResponse.json({ ok: false, error: body.error, code: "invalid_body" }, { status: body.status });
  const parsed = commentContentSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid comment", code: "invalid_body" }, { status: 400 });
  try {
    const loaded = await load(commentId);
    if ("error" in loaded) return loaded.error;
    const result = await editComment({ comment: loaded.comment, post: loaded.post, signer: session.wallet, body: parsed.data, store: loaded.store });
    if (!result.ok) return failure(result);
    return NextResponse.json({ ok: true, comment: toPublicComment(result.comment, loaded.market.market.creatorWallet) });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { commentId } = await ctx.params;
  const session = await getWalletSession(req).catch(() => null);
  if (!session || session.cluster !== getCluster()) return NextResponse.json({ ok: false, error: "Authenticate the comment wallet first.", code: "unauthenticated" }, { status: 401 });
  const rl = await limitRequest(`community:comment-delete:${session.wallet}`, 60, 10 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many comment changes — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  try {
    const loaded = await load(commentId);
    if ("error" in loaded) return loaded.error;
    const result = await deleteComment({ comment: loaded.comment, post: loaded.post, signer: session.wallet, store: loaded.store });
    if (!result.ok) return failure(result);
    return NextResponse.json({ ok: true, comment: toPublicComment(result.comment, loaded.market.market.creatorWallet) });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

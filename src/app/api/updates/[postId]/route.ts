import { NextResponse } from "next/server";
import { getCluster } from "@/lib/constants";
import { getWalletSession } from "@/lib/community/auth";
import { deleteIssuerPost, editIssuerPost, postContentSchema, toPublicPost } from "@/lib/community/authorize";
import { resolveCommunityMarket } from "@/lib/community/market";
import { CommunityStorageConfigError, getCommunityStore } from "@/lib/community/store";
import { readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";
import { isLocalTokenImageUrl } from "@/lib/validation";
import { serverCheckImage } from "@/lib/server/imageCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ postId: string }> };

function failure(result: { status: number; code: string; error: string }) {
  return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
}

async function load(postId: string) {
  const store = getCommunityStore();
  const post = await store.getPost(postId);
  if (!post) return { error: failure({ status: 404, code: "post_not_found", error: "Update not found." }) } as const;
  const market = await resolveCommunityMarket(post.marketId);
  if (!market.ok) return { error: failure(market) } as const;
  return { store, post, market } as const;
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { postId } = await ctx.params;
  const session = await getWalletSession(req).catch(() => null);
  if (!session || session.cluster !== getCluster()) return NextResponse.json({ ok: false, error: "Authenticate the creator wallet first.", code: "unauthenticated" }, { status: 401 });
  const rl = await limitRequest(`community:post-edit:${session.wallet}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many update edits — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const body = await readJsonBody(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ ok: false, error: body.error, code: "invalid_body" }, { status: body.status });
  const parsed = postContentSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid update", code: "invalid_body" }, { status: 400 });
  if (parsed.data.imageUrl && !isLocalTokenImageUrl(parsed.data.imageUrl)) {
    const checked = await serverCheckImage(parsed.data.imageUrl);
    if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error, code: "invalid_image" }, { status: 400 });
  }
  try {
    const loaded = await load(postId);
    if ("error" in loaded) return loaded.error;
    const result = await editIssuerPost({ post: loaded.post, market: loaded.market.market, signer: session.wallet, body: parsed.data, store: loaded.store });
    if (!result.ok) return failure(result);
    return NextResponse.json({ ok: true, post: toPublicPost(result.post, (await loaded.store.listComments(result.post.id)).length) });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { postId } = await ctx.params;
  const session = await getWalletSession(req).catch(() => null);
  if (!session || session.cluster !== getCluster()) return NextResponse.json({ ok: false, error: "Authenticate the creator wallet first.", code: "unauthenticated" }, { status: 401 });
  const rl = await limitRequest(`community:post-delete:${session.wallet}`, 30, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many update changes — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  try {
    const loaded = await load(postId);
    if ("error" in loaded) return loaded.error;
    const result = await deleteIssuerPost({ post: loaded.post, market: loaded.market.market, signer: session.wallet, store: loaded.store });
    if (!result.ok) return failure(result);
    return NextResponse.json({ ok: true, post: toPublicPost(result.post, 0) });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

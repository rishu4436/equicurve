import { NextResponse } from "next/server";
import { getCluster } from "@/lib/constants";
import { createIssuerPost, postContentSchema, toPublicPost } from "@/lib/community/authorize";
import { getWalletSession } from "@/lib/community/auth";
import { resolveCommunityMarket } from "@/lib/community/market";
import { CommunityStorageConfigError, getCommunityStore } from "@/lib/community/store";
import { readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";
import { isLocalTokenImageUrl } from "@/lib/validation";
import { serverCheckImage } from "@/lib/server/imageCheck";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

function failure(result: { status: number; code: string; error: string }) {
  return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status: result.status });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const resolved = await resolveCommunityMarket(id);
  if (!resolved.ok) return failure(resolved);
  try {
    const store = getCommunityStore();
    const posts = await store.listPosts(resolved.market.id);
    const publicPosts = await Promise.all(posts.map(async (post) => toPublicPost(post, (await store.listComments(post.id)).length)));
    return NextResponse.json({ ok: true, market: resolved.market, posts: publicPosts, count: publicPosts.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const session = await getWalletSession(req).catch(() => null);
  if (!session || session.cluster !== getCluster()) return NextResponse.json({ ok: false, error: "Authenticate a wallet before publishing an update.", code: "unauthenticated" }, { status: 401 });
  const rl = await limitRequest(`community:post:${session.wallet}`, 10, 60 * 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many creator updates — slow down.", code: "rate_limited" }, { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } });
  const body = await readJsonBody(req, 16 * 1024);
  if (!body.ok) return NextResponse.json({ ok: false, error: body.error, code: "invalid_body" }, { status: body.status });
  const parsed = postContentSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid update", code: "invalid_body" }, { status: 400 });
  if (parsed.data.imageUrl && !isLocalTokenImageUrl(parsed.data.imageUrl)) {
    const checked = await serverCheckImage(parsed.data.imageUrl);
    if (!checked.ok) return NextResponse.json({ ok: false, error: checked.error, code: "invalid_image" }, { status: 400 });
  }
  const resolved = await resolveCommunityMarket(id);
  if (!resolved.ok) return failure(resolved);
  try {
    const result = await createIssuerPost({ market: resolved.market, signer: session.wallet, body: parsed.data, store: getCommunityStore() });
    if (!result.ok) return failure(result);
    return NextResponse.json({ ok: true, post: toPublicPost(result.post, 0) }, { status: 201 });
  } catch (error) {
    const status = error instanceof CommunityStorageConfigError ? 503 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Community storage unavailable", code: "storage_unavailable" }, { status });
  }
}

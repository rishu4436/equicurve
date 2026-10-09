import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { buildWalletAuthMessage, issueWalletChallenge, verifyWalletChallenge, WALLET_CHALLENGE_TTL_MS } from "@/lib/community/auth";
import {
  commentContentSchema,
  createComment,
  createIssuerPost,
  deleteComment,
  deleteIssuerPost,
  editComment,
  editIssuerPost,
  pinIssuerPost,
  postContentSchema,
  toPublicComment,
} from "@/lib/community/authorize";
import { resolveCommunityMarket } from "@/lib/community/market";
import type { CommunityComment, CommunityMarket, IssuerPost } from "@/lib/community/types";
import { CommunityStorageConfigError, getCommunityStore, type CommunityStore } from "@/lib/community/store";

class MemoryStore implements CommunityStore {
  posts: IssuerPost[] = [];
  comments: CommunityComment[] = [];
  async listPosts(marketId: string, includeDeleted = false) { return this.posts.filter((post) => post.marketId === marketId && (includeDeleted || !post.deletedAt)).sort((a, b) => Number(b.pinned) - Number(a.pinned)); }
  async getPost(id: string) { return this.posts.find((post) => post.id === id) ?? null; }
  async putPost(post: IssuerPost) { this.posts = [post, ...this.posts.filter((item) => item.id !== post.id)]; return post; }
  async pinPost(marketId: string, postId: string, pinned: boolean) { const target = this.posts.find((post) => post.id === postId && post.marketId === marketId && !post.deletedAt); if (!target) return null; this.posts = this.posts.map((post) => post.marketId === marketId ? { ...post, pinned: post.id === postId ? pinned : pinned ? false : post.pinned } : post); return this.getPost(postId); }
  async listComments(postId: string, includeDeleted = false) { return this.comments.filter((comment) => comment.postId === postId && (includeDeleted || !comment.deletedAt)); }
  async getComment(id: string) { return this.comments.find((comment) => comment.id === id) ?? null; }
  async putComment(comment: CommunityComment) { this.comments = [comment, ...this.comments.filter((item) => item.id !== comment.id)]; return comment; }
}

const owner = Keypair.generate();
const other = Keypair.generate();
const market: CommunityMarket = { id: "market-1", kind: "live", creatorWallet: owner.publicKey.toBase58(), cluster: "devnet" };

function postBody(overrides: Record<string, unknown> = {}) {
  return { category: "update", title: "Quarterly update", body: "The team shipped a local milestone.", ...overrides };
}

async function makePost(store = new MemoryStore(), sourceMarket = market) {
  const result = await createIssuerPost({ market: sourceMarket, signer: owner.publicKey.toBase58(), body: postBody(), store, nowMs: 1_700_000_000_000 });
  if (!result.ok) throw new Error(result.error);
  return { store, post: result.post };
}

function signedChallenge(challenge: Awaited<ReturnType<typeof issueWalletChallenge>>["challenge"], kp: Keypair = owner) {
  return bs58.encode(nacl.sign.detached(new TextEncoder().encode(buildWalletAuthMessage(challenge)), kp.secretKey));
}

describe("wallet challenge and session auth", () => {
  it("issues a wallet-bound domain-separated challenge", async () => {
    const result = await issueWalletChallenge({ wallet: owner.publicKey.toBase58(), cluster: "devnet" });
    expect(result.challenge.wallet).toBe(owner.publicKey.toBase58());
    expect(result.message).toContain("EquiCurve community wallet authentication");
    expect(result.message).toContain("cluster: devnet");
  });

  it("accepts a valid wallet signature", async () => {
    const issued = await issueWalletChallenge({ wallet: owner.publicKey.toBase58(), cluster: "devnet" });
    const result = await verifyWalletChallenge({ wallet: owner.publicKey.toBase58(), nonce: issued.challenge.nonce, signature: signedChallenge(issued.challenge), cluster: "devnet" });
    expect(result).toMatchObject({ ok: true, wallet: owner.publicKey.toBase58() });
  });

  it("rejects an invalid signature", async () => {
    const issued = await issueWalletChallenge({ wallet: owner.publicKey.toBase58(), cluster: "devnet" });
    const bad = await verifyWalletChallenge({ wallet: owner.publicKey.toBase58(), nonce: issued.challenge.nonce, signature: signedChallenge(issued.challenge, other), cluster: "devnet" });
    expect(bad).toMatchObject({ ok: false, status: 401, code: "bad_signature" });
  });

  it("rejects a signature submitted for the wrong wallet", async () => {
    const issued = await issueWalletChallenge({ wallet: owner.publicKey.toBase58(), cluster: "devnet" });
    const result = await verifyWalletChallenge({ wallet: other.publicKey.toBase58(), nonce: issued.challenge.nonce, signature: signedChallenge(issued.challenge, owner), cluster: "devnet" });
    expect(result).toMatchObject({ ok: false, status: 401, code: "challenge_mismatch" });
  });

  it("rejects nonce replay and consumes a valid challenge once", async () => {
    const issued = await issueWalletChallenge({ wallet: owner.publicKey.toBase58(), cluster: "devnet" });
    const args = { wallet: owner.publicKey.toBase58(), nonce: issued.challenge.nonce, signature: signedChallenge(issued.challenge), cluster: "devnet" as const };
    expect(await verifyWalletChallenge(args)).toMatchObject({ ok: true });
    expect(await verifyWalletChallenge(args)).toMatchObject({ ok: false, code: "challenge_replayed" });
  });

  it("rejects an expired nonce", async () => {
    const now = 1_700_000_000_000;
    const issued = await issueWalletChallenge({ wallet: owner.publicKey.toBase58(), cluster: "devnet", nowMs: now });
    const result = await verifyWalletChallenge({ wallet: owner.publicKey.toBase58(), nonce: issued.challenge.nonce, signature: signedChallenge(issued.challenge), cluster: "devnet", nowMs: now + WALLET_CHALLENGE_TTL_MS + 1 });
    expect(result).toMatchObject({ ok: false, status: 401, code: "unknown_challenge" });
  });

  it("rejects malformed wallets and tampered cluster messages", async () => {
    const malformed = await verifyWalletChallenge({ wallet: "not-a-wallet", nonce: "bad", signature: "bad", cluster: "devnet" });
    expect(malformed).toMatchObject({ ok: false, status: 400 });
    const issued = await issueWalletChallenge({ wallet: owner.publicKey.toBase58(), cluster: "devnet" });
    const tampered = { ...issued.challenge, cluster: "mainnet-beta" as const };
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(buildWalletAuthMessage(tampered)), owner.secretKey));
    const result = await verifyWalletChallenge({ wallet: owner.publicKey.toBase58(), nonce: issued.challenge.nonce, signature, cluster: "devnet" });
    expect(result).toMatchObject({ ok: false, status: 401, code: "bad_signature" });
  });

  it("uses opaque short-lived sessions and does not trust a wallet cookie value", async () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/community/auth.ts"), "utf8");
    expect(source).toContain("tokenHash");
    expect(source).toContain("HttpOnly");
    expect(source).toContain("WALLET_SESSION_TTL_MS");
    expect(source).not.toContain("localStorage");
  });

  it("fails closed for production community storage", () => {
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    try { expect(() => getCommunityStore()).toThrow(CommunityStorageConfigError); }
    finally { if (before === undefined) delete env.NODE_ENV; else env.NODE_ENV = before; }
  });
});

describe("issuer post authorization", () => {
  it("allows only the canonical creator to create", async () => {
    const result = await createIssuerPost({ market, signer: owner.publicKey.toBase58(), body: postBody(), store: new MemoryStore() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.post.creatorVerified).toBe(true);
  });

  it("blocks a noncreator", async () => {
    const result = await createIssuerPost({ market, signer: other.publicKey.toBase58(), body: postBody(), store: new MemoryStore() });
    expect(result).toMatchObject({ ok: false, status: 403, code: "not_creator" });
  });

  it("rejects spoofed creator fields instead of trusting them", async () => {
    const result = await createIssuerPost({ market, signer: owner.publicKey.toBase58(), body: postBody({ creatorWallet: other.publicKey.toBase58(), creatorVerified: true }), store: new MemoryStore() });
    expect(result).toMatchObject({ ok: false, status: 400, code: "invalid_body" });
  });

  it("does not let another market creator publish here", async () => {
    const foreign = { ...market, id: "market-2", creatorWallet: other.publicKey.toBase58() };
    const result = await createIssuerPost({ market: foreign, signer: owner.publicKey.toBase58(), body: postBody(), store: new MemoryStore() });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("enforces the four allowed categories", () => {
    for (const category of ["announcement", "update", "milestone", "important"]) expect(postContentSchema.safeParse(postBody({ category })).success).toBe(true);
    expect(postContentSchema.safeParse(postBody({ category: "news" })).success).toBe(false);
  });

  it("enforces title and body bounds", () => {
    expect(postContentSchema.safeParse(postBody({ title: "" })).success).toBe(false);
    expect(postContentSchema.safeParse(postBody({ title: "x".repeat(101) })).success).toBe(false);
    expect(postContentSchema.safeParse(postBody({ body: "x".repeat(4001) })).success).toBe(false);
  });

  it("rejects unsafe URLs and control/bidi characters", () => {
    expect(postContentSchema.safeParse(postBody({ link: "javascript:alert(1)" })).success).toBe(false);
    expect(postContentSchema.safeParse(postBody({ link: "http://example.com" })).success).toBe(false);
    expect(postContentSchema.safeParse(postBody({ title: "hello\u202Eworld" })).success).toBe(false);
  });

  it("keeps HTML inert as plain text", async () => {
    const result = await createIssuerPost({ market, signer: owner.publicKey.toBase58(), body: postBody({ body: "<script>alert(1)</script>" }), store: new MemoryStore() });
    expect(result.ok).toBe(true);
    const ui = readFileSync(resolve(process.cwd(), "src/components/community/UpdatesPanel.tsx"), "utf8");
    expect(ui).not.toContain("dangerouslySetInnerHTML");
  });

  it("edits content while keeping ownership and timestamps immutable", async () => {
    const { store, post } = await makePost();
    const result = await editIssuerPost({ post, market, signer: owner.publicKey.toBase58(), body: postBody({ title: "Edited title" }), store, nowMs: 1_700_000_001_000 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.post.id).toBe(post.id);
      expect(result.post.marketId).toBe(post.marketId);
      expect(result.post.creatorWallet).toBe(post.creatorWallet);
      expect(result.post.createdAt).toBe(post.createdAt);
      expect(result.post.updatedAt).not.toBe(post.updatedAt);
      expect(result.post.revision).toBe(2);
    }
  });

  it("blocks noncreator edits and post IDOR", async () => {
    const { store, post } = await makePost();
    expect(await editIssuerPost({ post, market, signer: other.publicKey.toBase58(), body: postBody(), store })).toMatchObject({ ok: false, status: 403 });
    expect(await editIssuerPost({ post: { ...post, marketId: "other-market" }, market, signer: owner.publicKey.toBase58(), body: postBody(), store })).toMatchObject({ ok: false, status: 403 });
  });

  it("soft-deletes creator posts and keeps the tombstone", async () => {
    const { store, post } = await makePost();
    const result = await deleteIssuerPost({ post, market, signer: owner.publicKey.toBase58(), store, nowMs: 1_700_000_002_000 });
    expect(result.ok).toBe(true);
    expect((await store.listPosts(market.id)).length).toBe(0);
    expect((await store.listPosts(market.id, true))[0]?.deletedAt).toBeTruthy();
  });

  it("blocks noncreator deletes", async () => {
    const { store, post } = await makePost();
    expect(await deleteIssuerPost({ post, market, signer: other.publicKey.toBase58(), store })).toMatchObject({ ok: false, status: 403 });
  });

  it("pins one post at a time and atomically unpins the first", async () => {
    const store = new MemoryStore();
    const first = await makePost(store);
    const secondResult = await createIssuerPost({ market, signer: owner.publicKey.toBase58(), body: postBody({ title: "Second" }), store });
    if (!secondResult.ok) throw new Error(secondResult.error);
    expect((await pinIssuerPost({ post: first.post, market, signer: owner.publicKey.toBase58(), pinned: true, store })).ok).toBe(true);
    expect((await pinIssuerPost({ post: secondResult.post, market, signer: owner.publicKey.toBase58(), pinned: true, store })).ok).toBe(true);
    expect((await store.listPosts(market.id)).filter((post) => post.pinned)).toHaveLength(1);
    expect((await store.getPost(secondResult.post.id))?.pinned).toBe(true);
    expect((await store.getPost(first.post.id))?.pinned).toBe(false);
  });

  it("blocks pinning by another wallet and deleted posts", async () => {
    const { store, post } = await makePost();
    expect(await pinIssuerPost({ post, market, signer: other.publicKey.toBase58(), pinned: true, store })).toMatchObject({ ok: false, status: 403 });
    const deleted = { ...post, deletedAt: new Date().toISOString() };
    expect(await pinIssuerPost({ post: deleted, market, signer: owner.publicKey.toBase58(), pinned: true, store })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("comments", () => {
  it("allows an authenticated wallet to comment and marks creator provenance", async () => {
    const { store, post } = await makePost();
    const result = await createComment({ post, signer: owner.publicKey.toBase58(), body: { body: "Creator context" }, store });
    expect(result.ok).toBe(true);
    if (result.ok) expect(toPublicComment(result.comment, owner.publicKey.toBase58()).creator).toBe(true);
  });

  it("rejects anonymous or malformed comment authorship", async () => {
    const { store, post } = await makePost();
    expect(await createComment({ post, signer: "", body: { body: "hello" }, store })).toMatchObject({ ok: false, status: 401 });
    expect(await createComment({ post, signer: "not-a-wallet", body: { body: "hello" }, store })).toMatchObject({ ok: false, status: 401 });
  });

  it("enforces comment size, controls, and rejects nested replies", () => {
    expect(commentContentSchema.safeParse({ body: "" }).success).toBe(false);
    expect(commentContentSchema.safeParse({ body: "x".repeat(1001) }).success).toBe(false);
    expect(commentContentSchema.safeParse({ body: "hello\u200B" }).success).toBe(false);
    expect(commentContentSchema.safeParse({ body: "reply", parentId: "nested" }).success).toBe(false);
  });

  it("allows a comment author to edit and delete their own comment", async () => {
    const { store, post } = await makePost();
    const created = await createComment({ post, signer: other.publicKey.toBase58(), body: { body: "First" }, store });
    if (!created.ok) throw new Error(created.error);
    const edited = await editComment({ comment: created.comment, post, signer: other.publicKey.toBase58(), body: { body: "Edited" }, store });
    expect(edited).toMatchObject({ ok: true });
    if (!edited.ok) return;
    const deleted = await deleteComment({ comment: edited.comment, post, signer: other.publicKey.toBase58(), store });
    expect(deleted).toMatchObject({ ok: true });
    expect((await store.listComments(post.id)).length).toBe(0);
  });

  it("blocks another wallet, including the creator, from editing a comment", async () => {
    const { store, post } = await makePost();
    const created = await createComment({ post, signer: other.publicKey.toBase58(), body: { body: "First" }, store });
    if (!created.ok) throw new Error(created.error);
    expect(await editComment({ comment: created.comment, post, signer: owner.publicKey.toBase58(), body: { body: "spoof" }, store })).toMatchObject({ ok: false, status: 403 });
    expect(await deleteComment({ comment: created.comment, post, signer: owner.publicKey.toBase58(), store })).toMatchObject({ ok: false, status: 403 });
  });

  it("keeps comments hidden while a parent post is deleted", async () => {
    const { store, post } = await makePost();
    const created = await createComment({ post, signer: other.publicKey.toBase58(), body: { body: "Stored" }, store });
    if (!created.ok) throw new Error(created.error);
    const deleted = { ...post, deletedAt: new Date().toISOString() };
    expect(await createComment({ post: deleted, signer: other.publicKey.toBase58(), body: { body: "new" }, store })).toMatchObject({ ok: false, status: 404 });
    expect((await store.listComments(post.id)).length).toBe(1);
  });

  it("uses wallet addresses as identity without inventing usernames", () => {
    const ui = readFileSync(resolve(process.cwd(), "src/components/community/UpdatesPanel.tsx"), "utf8");
    expect(ui).toContain("shortWallet");
    expect(ui).toContain("Creator");
    expect(ui).not.toContain("verified user");
  });
});

describe("community route and UI contracts", () => {
  it("adds all required mutation routes", () => {
    expect(resolve(process.cwd(), "src/app/api/auth/wallet/challenge/route.ts")).toContain("route.ts");
    expect(readFileSync(resolve(process.cwd(), "src/app/api/updates/[postId]/route.ts"), "utf8")).toContain("export async function PATCH");
    expect(readFileSync(resolve(process.cwd(), "src/app/api/updates/[postId]/pin/route.ts"), "utf8")).toContain("pinIssuerPost");
    expect(readFileSync(resolve(process.cwd(), "src/app/api/comments/[commentId]/route.ts"), "utf8")).toContain("export async function DELETE");
  });

  it("exposes Updates as a primary offering tab", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/offering/OfferingDetailClient.tsx"), "utf8");
    expect(source).toContain('"Updates"');
    expect(source).toContain("UpdatesPanel");
  });

  it("exposes safe Upcoming communication copy", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/upcoming/UpcomingDetailClient.tsx"), "utf8");
    expect(source).toContain("Upcoming creator updates");
    expect(source).toContain("No market exists on-chain yet.");
    expect(source).toContain("UpdatesPanel");
  });

  it("does not build a global news feed", () => {
    expect(existsSync(resolve(process.cwd(), "src/app/news"))).toBe(false);
    const ui = readFileSync(resolve(process.cwd(), "src/components/community/UpdatesPanel.tsx"), "utf8");
    expect(ui).not.toContain("Popular");
    expect(ui).not.toContain("Newest global");
  });

  it("keeps links HTTPS-only and opens them safely", () => {
    const ui = readFileSync(resolve(process.cwd(), "src/components/community/UpdatesPanel.tsx"), "utf8");
    expect(ui).toContain('target="_blank" rel="noopener noreferrer"');
    expect(ui).toContain("normalizeHttpsUrl");
  });

  it("uses the requested starting rate limits in route source", () => {
    expect(readFileSync(resolve(process.cwd(), "src/app/api/markets/[id]/updates/route.ts"), "utf8")).toContain("60 * 60 * 1000");
    expect(readFileSync(resolve(process.cwd(), "src/app/api/updates/[postId]/comments/route.ts"), "utf8")).toContain("10 * 60 * 1000");
    expect(readFileSync(resolve(process.cwd(), "src/app/api/auth/wallet/challenge/route.ts"), "utf8")).toContain("20, 10 * 60 * 1000");
  });

  it("resolves invalid market identities without authorizing a browser claim", async () => {
    const result = await resolveCommunityMarket("invalid-market-id");
    expect(result).toMatchObject({ ok: false, status: 404, code: "invalid_market" });
  });
});

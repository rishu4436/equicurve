import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { createUpstashScheduledLaunchStore, ScheduleConflictError, scheduleRedisKey, type ScheduleRedis } from "@/lib/schedule/upstashStore";
import { scheduledLaunchDraftSchema, type ScheduledLaunch } from "@/lib/schedule/types";
import { createUpstashCommunityStore, communityKeyHelpers, type CommunityRedis } from "@/lib/community/upstashStore";
import type { CommunityComment, IssuerPost } from "@/lib/community/types";
import { createUpstashAuthStore, authKeyHelpers, type AuthRedis } from "@/lib/community/authStore";
import type { WalletChallenge, WalletSession } from "@/lib/community/auth";
import { getAuthBackend } from "@/lib/community/auth";
import { CommunityStorageConfigError, getCommunityBackend, getCommunityStore } from "@/lib/community/store";
import { ScheduleStorageConfigError, getScheduleBackend, getScheduledLaunchStore } from "@/lib/schedule/store";
import { createVercelBlobStore, getTokenImageBackend, getTokenImageStore, TokenImageStorageConfigError } from "@/lib/uploads/tokenImageStore";
import { assertCommunityAuthStorage } from "@/lib/community/auth";
import { AuthStorageConfigError } from "@/lib/community/authStore";
import { launchCurveConfig } from "@/lib/dbc/create";
import { expectedFromConfig, canonicalConfigText } from "@/lib/dbc/deploymentReadback";
import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";

class FakeRedis {
  values = new Map<string, string>();
  lists = new Map<string, string[]>();
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: unknown) { this.values.set(key, typeof value === "string" ? value : JSON.stringify(value)); return "OK"; }
  async lrange(key: string, start: number, end: number) { return (this.lists.get(key) ?? []).slice(start, end + 1); }
  async eval(script: string, keys: string[], args: string[]) {
    if (script.includes("decoded.consumedAt")) {
      const raw = this.values.get(keys[0]); if (!raw) return 0;
      const item = JSON.parse(raw) as Record<string, unknown>;
      if (item.consumedAt != null || item.wallet !== args[0] || item.cluster !== args[1] || String(item.expiresAt) <= args[2]) return 0;
      item.consumedAt = args[3]; this.values.set(keys[0], JSON.stringify(item)); return 1;
    }
    if (script.includes("decoded.pinned")) {
      const raw = this.values.get(keys[0]); if (!raw) return 0;
      const item = JSON.parse(raw) as Record<string, unknown>; if (item.deletedAt) return 0;
      const old = this.values.get(keys[2]);
      if (args[1] === "1" && old && old !== args[0]) {
        const oldRaw = this.values.get(`equicurve:post:${old}`); if (oldRaw) { const oldItem = JSON.parse(oldRaw) as Record<string, unknown>; oldItem.pinned = false; oldItem.revision = (typeof oldItem.revision === "number" ? oldItem.revision : 0) + 1; this.values.set(`equicurve:post:${old}`, JSON.stringify(oldItem)); }
      }
      item.pinned = args[1] === "1"; item.revision = (typeof item.revision === "number" ? item.revision : 0) + 1; item.updatedAt = args[2]; this.values.set(keys[0], JSON.stringify(item));
      if (args[1] === "1") this.values.set(keys[2], args[0]); else if (old === args[0]) this.values.delete(keys[2]);
      return 1;
    }
    const raw = this.values.get(keys[0]); const current = raw ? (JSON.parse(raw).revision ?? 0) : 0;
    if (current !== Number(args[0])) return 0;
    this.values.set(keys[0], args[1]);
    for (const index of keys.slice(1)) { const list = this.lists.get(index) ?? []; list.unshift(args[2]); this.lists.set(index, list.slice(0, Number(args[3] ?? "499") + 1)); }
    return 1;
  }
}

function post(over: Partial<IssuerPost> = {}): IssuerPost {
  const now = new Date(1_700_000_000_000).toISOString();
  return { id: randomUUID(), marketId: "market-1", marketKind: "live", creatorWallet: Keypair.generate().publicKey.toBase58(), category: "update", title: "Update", body: "A durable update", pinned: false, createdAt: now, updatedAt: now, revision: 1, creatorVerified: true, ...over };
}

function comment(postId: string, over: Partial<CommunityComment> = {}): CommunityComment {
  const now = new Date(1_700_000_000_000).toISOString();
  return { id: randomUUID(), postId, authorWallet: Keypair.generate().publicKey.toBase58(), body: "hello", createdAt: now, updatedAt: now, revision: 1, ...over };
}

function schedule(): ScheduledLaunch {
  const cfg = launchCurveConfig({ presetId: "flat", totalSupply: 1_000_000_000, creatorTradingFeePercentage: 70, lpLockPct: 100, mintRenounce: true, antiSniper: true, quoteDecimals: 9, transferProfile: "open-spl", marketCaps: { initial: 100, migration: 200 } });
  const expected = expectedFromConfig(cfg); const fingerprint = marketConfigFingerprint(cfg); const now = new Date(1_700_000_000_000).toISOString();
  return { id: randomUUID(), creatorWallet: Keypair.generate().publicKey.toBase58(), cluster: "devnet", status: "scheduled", createdAt: now, updatedAt: now, authIssuedAt: now, authSignature: "sig", revision: 1, name: "Acme", ticker: "ACME", thesis: "A durable market", sector: "Equity", website: "https://example.com", xProfile: "https://x.com/acme", image: "", presetId: "flat", raiseTarget: 100, quote: "SOL", totalSupply: 1_000_000_000, seedBuy: "", feeIssuerPct: 70, lpLockPct: 100, antiSniper: true, mintRenounce: true, feeClaimer: "", transferProfile: "open-spl", designFingerprint: fingerprint, design: { fingerprint, migrationQuoteThresholdAtoms: expected.migrationQuoteThreshold, canonicalConfig: canonicalConfigText(cfg), expected, profileName: "flat", constraintsPassed: true }, scheduledForUtc: new Date(1_700_000_600_000).toISOString(), marketCaps: { initial: 100, migration: 200 }, designed: { configFingerprint: fingerprint } } as ScheduledLaunch;
}

describe("production persistence adapters", () => {
  it("builds bounded schedule keys and round-trips schedules", async () => {
    const redis = new FakeRedis(); const store = createUpstashScheduledLaunchStore(redis as unknown as ScheduleRedis); const entry = schedule();
    const { id: _id, creatorWallet: _creatorWallet, cluster: _cluster, status: _status, createdAt: _createdAt, updatedAt: _updatedAt, authIssuedAt: _authIssuedAt, authSignature: _authSignature, revision: _revision, ...draft } = entry;
    const parsed = scheduledLaunchDraftSchema.safeParse(draft);
    expect(parsed.success).toBe(true);
    await expect(store.put(entry)).resolves.toMatchObject({ id: entry.id, revision: 1 });
    await expect(store.get(entry.id)).resolves.toMatchObject({ id: entry.id });
    await expect(store.list()).resolves.toHaveLength(1);
    expect(scheduleRedisKey(entry.id)).toBe(`equicurve:schedule:${entry.id}`);
  });

  it("rejects stale schedule revisions", async () => {
    const redis = new FakeRedis(); const store = createUpstashScheduledLaunchStore(redis as unknown as ScheduleRedis); const entry = schedule(); await store.put(entry);
    await expect(store.put(entry)).rejects.toBeInstanceOf(ScheduleConflictError);
  });

  it("stores community posts globally and by market", async () => {
    const redis = new FakeRedis(); const store = createUpstashCommunityStore(redis as unknown as CommunityRedis); const item = post(); await store.putPost(item);
    await expect(store.getPost(item.id)).resolves.toMatchObject({ id: item.id });
    await expect(store.listPosts(item.marketId)).resolves.toHaveLength(1);
    await expect(store.listAllPosts!()).resolves.toHaveLength(1);
    expect(communityKeyHelpers.marketPostsKey(item.marketId)).toContain("equicurve:market:");
  });

  it("keeps comments canonical and excludes soft deletes from stats", async () => {
    const redis = new FakeRedis(); const store = createUpstashCommunityStore(redis as unknown as CommunityRedis); const item = post(); await store.putPost(item);
    const active = comment(item.id); const deleted = comment(item.id, { deletedAt: new Date().toISOString() }); await store.putComment(active); await store.putComment(deleted);
    await expect(store.listComments(item.id)).resolves.toHaveLength(1);
    await expect(store.commentStatsForPosts!([item.id])).resolves.toEqual(new Map([[item.id, { commentCount: 1, uniqueCommenters: 1 }]]));
  });

  it("pins one post per market atomically", async () => {
    const redis = new FakeRedis(); const store = createUpstashCommunityStore(redis as unknown as CommunityRedis); const a = post(); const b = post(); await store.putPost(a); await store.putPost({ ...b, marketId: a.marketId });
    await store.pinPost(a.marketId, a.id, true); await store.pinPost(a.marketId, b.id, true);
    await expect(store.getPost(a.id)).resolves.toMatchObject({ pinned: false }); await expect(store.getPost(b.id)).resolves.toMatchObject({ pinned: true });
  });

  it("atomically consumes a nonce and hashes sessions by key", async () => {
    const redis = new FakeRedis(); const store = createUpstashAuthStore(redis as unknown as AuthRedis); const now = new Date().toISOString();
    const challenge: WalletChallenge = { nonce: "a".repeat(48), wallet: Keypair.generate().publicKey.toBase58(), cluster: "devnet", issuedAt: now, expiresAt: new Date(Date.now() + 300000).toISOString() };
    await store.putChallenge(challenge); await expect(store.getChallenge(challenge.nonce)).resolves.toMatchObject({ wallet: challenge.wallet });
    await expect(store.consumeChallenge(challenge, now, now)).resolves.toBe(true); await expect(store.consumeChallenge(challenge, now, now)).resolves.toBe(false);
    const session: WalletSession = { tokenHash: "b".repeat(64), wallet: challenge.wallet, cluster: "devnet", createdAt: now, expiresAt: new Date(Date.now() + 1800000).toISOString() }; await store.putSession(session, 1800);
    await expect(store.getSession(session.tokenHash)).resolves.toMatchObject({ tokenHash: session.tokenHash }); expect(authKeyHelpers.sessionKey(session.tokenHash)).toContain("equicurve:auth:session:");
  });

  it("fails closed in production when durable backends are absent", () => {
    const env = process.env as Record<string, string | undefined>; const before = { node: env.NODE_ENV, upstash: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN, blob: env.BLOB_READ_WRITE_TOKEN };
    env.NODE_ENV = "production"; delete env.UPSTASH_REDIS_REST_URL; delete env.UPSTASH_REDIS_REST_TOKEN; delete env.BLOB_READ_WRITE_TOKEN;
    try {
      expect(getScheduleBackend()).toBe("unconfigured"); expect(getCommunityBackend()).toBe("unconfigured"); expect(getAuthBackend()).toBe("unconfigured"); expect(getTokenImageBackend()).toBe("unconfigured");
      expect(() => getScheduledLaunchStore()).toThrow(ScheduleStorageConfigError); expect(() => getCommunityStore()).toThrow(CommunityStorageConfigError); expect(() => assertCommunityAuthStorage()).toThrow(AuthStorageConfigError); expect(() => getTokenImageStore()).toThrow(TokenImageStorageConfigError);
    }
    finally { if (before.node === undefined) delete env.NODE_ENV; else env.NODE_ENV = before.node; if (before.upstash === undefined) delete env.UPSTASH_REDIS_REST_URL; else env.UPSTASH_REDIS_REST_URL = before.upstash; if (before.token === undefined) delete env.UPSTASH_REDIS_REST_TOKEN; else env.UPSTASH_REDIS_REST_TOKEN = before.token; if (before.blob === undefined) delete env.BLOB_READ_WRITE_TOKEN; else env.BLOB_READ_WRITE_TOKEN = before.blob; }
  });

  it("selects durable production backends only when each required credential exists", () => {
    const env = process.env as Record<string, string | undefined>; const before = { node: env.NODE_ENV, url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN, blob: env.BLOB_READ_WRITE_TOKEN };
    env.NODE_ENV = "production"; env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"; env.UPSTASH_REDIS_REST_TOKEN = "test-token"; env.BLOB_READ_WRITE_TOKEN = "blob-token";
    try { expect(getScheduleBackend()).toBe("upstash"); expect(getCommunityBackend()).toBe("upstash"); expect(getAuthBackend()).toBe("upstash"); expect(getTokenImageBackend()).toBe("vercel-blob"); }
    finally { if (before.node === undefined) delete env.NODE_ENV; else env.NODE_ENV = before.node; if (before.url === undefined) delete env.UPSTASH_REDIS_REST_URL; else env.UPSTASH_REDIS_REST_URL = before.url; if (before.token === undefined) delete env.UPSTASH_REDIS_REST_TOKEN; else env.UPSTASH_REDIS_REST_TOKEN = before.token; if (before.blob === undefined) delete env.BLOB_READ_WRITE_TOKEN; else env.BLOB_READ_WRITE_TOKEN = before.blob; }
  });

  it("rejects unsafe Redis namespace identifiers", () => {
    expect(() => communityKeyHelpers.marketPostsKey("market/../../secret")).toThrow();
    expect(() => communityKeyHelpers.postKey("not-a-uuid")).toThrow();
    expect(() => authKeyHelpers.sessionKey("raw-token")).toThrow();
  });

  it("uses a server-generated Blob pathname and returns its durable URL", async () => {
    let uploadedPath = "";
    type BlobDeps = NonNullable<Parameters<typeof createVercelBlobStore>[0]>;
    const fakePut: BlobDeps["put"] = async (pathname, _body, _options) => {
      uploadedPath = pathname;
      return { url: `https://blob.example/${pathname}`, pathname, contentType: "image/png", contentDisposition: "inline" } as Awaited<ReturnType<BlobDeps["put"]>>;
    };
    const store = createVercelBlobStore({ put: fakePut, del: async () => undefined });
    const result = await store.put({ bytes: Buffer.from("png"), contentType: "image/png", width: 256, height: 256 });
    expect(uploadedPath).toMatch(/^equicurve\/token-images\/[a-f0-9-]{36}\.png$/);
    expect(result.url).toBe(`https://blob.example/${uploadedPath}`);
    expect(result.url).toMatch(/^https:\/\//);
  });
});

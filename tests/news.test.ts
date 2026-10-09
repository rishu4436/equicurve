import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { CommunityComment, IssuerPost } from "@/lib/community/types";
import type { CommunityStore } from "@/lib/community/store";
import { NewsStatsUnavailable, NewsQueryError, parseNewsParams, queryNews } from "@/lib/news/query";
import type { NewsMarketContext } from "@/lib/news/types";

class MemoryNewsStore implements CommunityStore {
  posts: IssuerPost[] = [];
  comments: CommunityComment[] = [];
  async listPosts(marketId: string, includeDeleted = false) { return this.posts.filter((post) => post.marketId === marketId && (includeDeleted || !post.deletedAt)); }
  async listAllPosts(includeDeleted = false) { return this.posts.filter((post) => includeDeleted || !post.deletedAt); }
  async getPost(id: string) { return this.posts.find((post) => post.id === id) ?? null; }
  async putPost(post: IssuerPost) { this.posts = [post, ...this.posts.filter((item) => item.id !== post.id)]; return post; }
  async pinPost() { return null; }
  async listComments(postId: string, includeDeleted = false) { return this.comments.filter((comment) => comment.postId === postId && (includeDeleted || !comment.deletedAt)); }
  async commentStatsForPosts(postIds: string[]) {
    const result = new Map<string, { commentCount: number; uniqueCommenters: number }>();
    for (const id of postIds) {
      const active = this.comments.filter((comment) => comment.postId === id && !comment.deletedAt);
      result.set(id, { commentCount: active.length, uniqueCommenters: new Set(active.map((comment) => comment.authorWallet)).size });
    }
    return result;
  }
  async getComment(id: string) { return this.comments.find((comment) => comment.id === id) ?? null; }
  async putComment(comment: CommunityComment) { this.comments.push(comment); return comment; }
}

const LIVE_ID = "live-market";
const UPCOMING_ID = "upcoming-schedule";
const contexts = new Map<string, NewsMarketContext>([
  [LIVE_ID, { id: LIVE_ID, kind: "live", name: "Alpha Labs", ticker: "ALP", contextLabel: "Live · Raising", status: "raising", creatorWallet: "creator-live", creatorVerified: true }],
  [UPCOMING_ID, { id: UPCOMING_ID, kind: "scheduled", name: "Beta Launch", ticker: "BETA", contextLabel: "Upcoming", status: "scheduled", scheduledForUtc: "2026-10-10T12:00:00.000Z", creatorWallet: "creator-upcoming", creatorVerified: true }],
]);

function post(args: Partial<IssuerPost> = {}): IssuerPost {
  const now = args.createdAt ?? "2026-10-09T12:00:00.000Z";
  return {
    id: args.id ?? randomUUID(), marketId: args.marketId ?? LIVE_ID, marketKind: args.marketKind ?? "live", creatorWallet: args.creatorWallet ?? "creator-live", category: args.category ?? "update", title: args.title ?? "Shipping update", body: args.body ?? "The market team shipped a new milestone.", pinned: args.pinned ?? false, createdAt: now, updatedAt: args.updatedAt ?? now, revision: 1, creatorVerified: true, ...(args.deletedAt ? { deletedAt: args.deletedAt } : {}), ...(args.link ? { link: args.link } : {}), ...(args.imageUrl ? { imageUrl: args.imageUrl } : {}),
  };
}

function query(store: MemoryNewsStore, args: Partial<Parameters<typeof queryNews>[0]> = {}) {
  return queryNews({ sort: "newest", category: "all", query: null, cursor: null, limit: 20, nowMs: Date.parse("2026-10-09T12:00:00.000Z"), ...args }, store, contexts);
}

function comment(postId: string, wallet: string, createdAt = "2026-10-09T11:00:00.000Z", deletedAt?: string): CommunityComment {
  return { id: randomUUID(), postId, authorWallet: wallet, body: "Useful context", createdAt, updatedAt: createdAt, revision: 1, ...(deletedAt ? { deletedAt } : {}) };
}

describe("News newest feed", () => {
  it("sorts newest by createdAt descending", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post({ createdAt: "2026-10-08T12:00:00.000Z" }), post({ createdAt: "2026-10-09T11:00:00.000Z" })];
    const result = await query(store);
    expect(result.items.map((item) => item.createdAt)).toEqual(["2026-10-09T11:00:00.000Z", "2026-10-08T12:00:00.000Z"]);
  });

  it("uses postId as a stable tie-breaker and ignores pinning globally", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post({ id: "00000000-0000-4000-8000-000000000001", pinned: true }), post({ id: "00000000-0000-4000-8000-000000000002" })];
    const result = await query(store);
    expect(result.items.map((item) => item.postId)).toEqual(["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000001"]);
  });

  it("excludes deleted posts and never turns comments into feed items", async () => {
    const store = new MemoryNewsStore();
    const deleted = post({ deletedAt: "2026-10-09T11:30:00.000Z" });
    store.posts = [deleted, post()];
    store.comments = [comment(store.posts[1]!.id, "commenter")];
    const result = await query(store);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.postId).toBe(store.posts[1]!.id);
  });

  it("includes canonical live and active Upcoming contexts", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post({ marketId: LIVE_ID }), post({ marketId: UPCOMING_ID, marketKind: "scheduled", creatorWallet: "creator-upcoming" })];
    const result = await query(store);
    expect(result.items.map((item) => item.marketKind).sort()).toEqual(["live", "scheduled"]);
    expect(result.items.find((item) => item.marketKind === "scheduled")?.marketContext).toBe("Upcoming");
  });
});

describe("News popular ranking", () => {
  it("weights unique commenters more than repeated comments", async () => {
    const store = new MemoryNewsStore();
    const repeated = post({ id: randomUUID(), createdAt: "2026-10-09T11:00:00.000Z" });
    const unique = post({ id: randomUUID(), createdAt: "2026-10-09T11:00:00.000Z" });
    store.posts = [repeated, unique];
    store.comments = [comment(repeated.id, "same"), comment(repeated.id, "same"), comment(repeated.id, "same"), comment(unique.id, "one"), comment(unique.id, "two")];
    const result = await query(store, { sort: "popular" });
    expect(result.items[0]!.postId).toBe(unique.id);
    expect(result.items.find((item) => item.postId === repeated.id)?.uniqueCommenters).toBe(1);
  });

  it("caps the raw comment contribution at fifty", async () => {
    const store = new MemoryNewsStore();
    const target = post();
    store.posts = [target];
    store.comments = Array.from({ length: 55 }, (_, index) => comment(target.id, `wallet-${index}`));
    const result = await query(store, { sort: "popular" });
    expect(result.items[0]!.commentCount).toBe(55);
    expect(result.items[0]!.uniqueCommenters).toBe(55);
    expect(result.items[0]!.popularScore).toBeCloseTo(270);
  });

  it("applies recency decay and excludes posts outside seven days", async () => {
    const store = new MemoryNewsStore();
    const recent = post({ createdAt: "2026-10-09T11:00:00.000Z" });
    const old = post({ createdAt: "2026-10-01T11:00:00.000Z" });
    store.posts = [recent, old];
    store.comments = [comment(recent.id, "wallet"), comment(old.id, "wallet")];
    const result = await query(store, { sort: "popular" });
    expect(result.items.map((item) => item.postId)).toEqual([recent.id]);
  });

  it("does not count deleted comments", async () => {
    const store = new MemoryNewsStore();
    const target = post();
    store.posts = [target];
    store.comments = [comment(target.id, "active"), comment(target.id, "deleted", undefined, "2026-10-09T11:30:00.000Z")];
    const result = await query(store, { sort: "popular" });
    expect(result.items[0]).toMatchObject({ commentCount: 1, uniqueCommenters: 1 });
  });

  it("uses a deterministic tie-break for equal popular scores", async () => {
    const store = new MemoryNewsStore();
    const first = post({ id: "00000000-0000-4000-8000-000000000001" });
    const second = post({ id: "00000000-0000-4000-8000-000000000002" });
    store.posts = [first, second];
    const result = await query(store, { sort: "popular" });
    expect(result.items.map((item) => item.postId)).toEqual([second.id, first.id]);
  });

  it("fails Popular when canonical engagement cannot be read", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post()];
    store.commentStatsForPosts = async () => { throw new Error("offline"); };
    await expect(query(store, { sort: "popular" })).rejects.toBeInstanceOf(NewsStatsUnavailable);
  });

  it("keeps Newest truthful when engagement stats are unavailable", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post()];
    store.commentStatsForPosts = async () => { throw new Error("offline"); };
    const result = await query(store);
    expect(result.statsAvailable).toBe(false);
    expect(result.items[0]).toMatchObject({ commentCount: null, uniqueCommenters: null });
  });

  it("represents a successful zero-comment stats read as zero engagement", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post()];
    const result = await query(store, { sort: "popular" });
    expect(result.items[0]).toMatchObject({ commentCount: 0, uniqueCommenters: 0, popularScore: 0 });
  });
});

describe("News filters and search", () => {
  it("filters by every supported category", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post({ category: "announcement" }), post({ category: "update" }), post({ category: "milestone" }), post({ category: "important" })];
    for (const category of ["announcement", "update", "milestone", "important"] as const) expect((await query(store, { category })).items).toHaveLength(1);
  });

  it("rejects invalid categories and sorts", () => {
    expect(() => parseNewsParams(new URLSearchParams("category=wrong"))).toThrow(NewsQueryError);
    expect(() => parseNewsParams(new URLSearchParams("sort=old"))).toThrow(NewsQueryError);
  });

  it("searches market name and ticker case-insensitively", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post({ title: "No match" }), post({ marketId: UPCOMING_ID, marketKind: "scheduled", creatorWallet: "creator-upcoming", title: "Another" })];
    expect((await query(store, { query: "alpha" })).items).toHaveLength(1);
    expect((await query(store, { query: "beta" })).items).toHaveLength(1);
  });

  it("searches title and body but not comments", async () => {
    const store = new MemoryNewsStore();
    const match = post({ title: "Treasury milestone", body: "The reserve is now documented." });
    const other = post({ title: "Unrelated", body: "No matching field." });
    store.posts = [match, other];
    store.comments = [comment(other.id, "commenter")];
    expect((await query(store, { query: "treasury" })).items.map((item) => item.postId)).toEqual([match.id]);
    expect((await query(store, { query: "commenter" })).items).toHaveLength(0);
  });

  it("rejects search shorter than two or longer than eighty characters", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post()];
    await expect(query(store, { query: "a" })).rejects.toBeInstanceOf(NewsQueryError);
    await expect(query(store, { query: "x".repeat(81) })).rejects.toBeInstanceOf(NewsQueryError);
  });

  it("excludes deleted posts from search", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post({ title: "Hidden update", deletedAt: "2026-10-09T11:00:00.000Z" })];
    expect((await query(store, { query: "hidden" })).items).toHaveLength(0);
  });

  it("normalizes excerpts and exposes server-derived provenance", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post({ body: "  A   long\nupdate  " })];
    const result = await query(store);
    expect(result.items[0]).toMatchObject({ bodyExcerpt: "A long update", creatorVerified: true, creatorWallet: "creator-live" });
  });
});

describe("News pagination", () => {
  it("returns bounded pages with an opaque cursor and no duplicates", async () => {
    const store = new MemoryNewsStore();
    store.posts = Array.from({ length: 5 }, (_, index) => post({ createdAt: `2026-10-09T12:0${index}:00.000Z` }));
    const first = await query(store, { limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const second = await query(store, { limit: 2, cursor: first.nextCursor });
    expect(second.items).toHaveLength(2);
    expect(new Set([...first.items, ...second.items].map((item) => item.postId)).size).toBe(4);
  });

  it("rejects malformed and mismatched cursors", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post(), post({ createdAt: "2026-10-08T12:00:00.000Z" })];
    const first = await query(store, { limit: 1 });
    await expect(query(store, { cursor: "not-a-cursor" })).rejects.toBeInstanceOf(NewsQueryError);
    await expect(query(store, { sort: "popular", cursor: first.nextCursor })).rejects.toBeInstanceOf(NewsQueryError);
  });

  it("bounds the requested limit and uses twenty by default", () => {
    expect(parseNewsParams(new URLSearchParams()).limit).toBe(20);
    expect(() => parseNewsParams(new URLSearchParams("limit=51"))).toThrow(NewsQueryError);
    expect(() => parseNewsParams(new URLSearchParams("limit=0"))).toThrow(NewsQueryError);
  });
});

describe("News provenance and contracts", () => {
  it("labels live and Upcoming provenance correctly", async () => {
    const store = new MemoryNewsStore();
    store.posts = [post({ marketId: LIVE_ID }), post({ marketId: UPCOMING_ID, marketKind: "scheduled", creatorWallet: "creator-upcoming" })];
    const result = await query(store);
    expect(result.items.find((item) => item.marketKind === "live")?.marketContext).toBe("Live · Raising");
    expect(result.items.find((item) => item.marketKind === "scheduled")?.marketContext).toBe("Upcoming");
  });

  it("keeps comments out of the item model and does not use verified news language", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/api/news/route.ts"), "utf8");
    const ui = readFileSync(resolve(process.cwd(), "src/components/news/NewsFeed.tsx"), "utf8");
    expect(route).toContain("export async function GET");
    expect(route).not.toContain("export async function POST");
    expect(ui).not.toContain("Verified news");
    expect(ui).toContain("Published by market creator");
    expect(ui).toContain("Published by scheduled launch creator");
  });

  it("documents formula, seven-day window, and non-goals", () => {
    const docs = readFileSync(resolve(process.cwd(), "docs/NEWS.md"), "utf8");
    expect(docs).toContain("uniqueCommenters * 4");
    expect(docs).toContain("seven-day window");
    expect(docs).toContain("Popular measures engagement, not investment quality.");
    expect(docs).toContain("likes");
  });

  it("supports safe card routing to live and Upcoming Updates", () => {
    const ui = readFileSync(resolve(process.cwd(), "src/components/news/NewsFeed.tsx"), "utf8");
    expect(ui).toContain("/o/${encodeURIComponent(item.marketId)}?tab=updates");
    expect(ui).toContain("/upcoming/${encodeURIComponent(item.marketId)}?tab=updates");
  });

  it("adds News to global navigation", () => {
    expect(readFileSync(resolve(process.cwd(), "src/components/AppHeader.tsx"), "utf8")).toContain('{ href: "/news", label: "News" }');
  });
});

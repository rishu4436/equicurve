import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CommunityComment,
  CommunityCommentsPayload,
  CommunityPostsPayload,
  IssuerPost,
} from "./types";

export const COMMUNITY_DIR = path.join(process.cwd(), "data", "community");
export const COMMUNITY_POSTS_FILE = path.join(COMMUNITY_DIR, "posts", "registry.json");
export const COMMUNITY_COMMENTS_FILE = path.join(COMMUNITY_DIR, "comments", "registry.json");

export class CommunityStorageConfigError extends Error {
  constructor() {
    super("Community storage is not configured for this production environment.");
    this.name = "CommunityStorageConfigError";
  }
}

export interface CommunityStore {
  listPosts(marketId: string, includeDeleted?: boolean): Promise<IssuerPost[]>;
  /** Global-query hook; optional keeps test adapters and future backends small. */
  listAllPosts?(includeDeleted?: boolean): Promise<IssuerPost[]>;
  getPost(id: string): Promise<IssuerPost | null>;
  putPost(post: IssuerPost): Promise<IssuerPost>;
  pinPost(marketId: string, postId: string, pinned: boolean): Promise<IssuerPost | null>;
  listComments(postId: string, includeDeleted?: boolean): Promise<CommunityComment[]>;
  /** Batch stats hook for News; deleted comments are excluded by default. */
  commentStatsForPosts?(postIds: string[]): Promise<Map<string, { commentCount: number; uniqueCommenters: number }>>;
  getComment(id: string): Promise<CommunityComment | null>;
  putComment(comment: CommunityComment): Promise<CommunityComment>;
}

function emptyPosts(): CommunityPostsPayload {
  return { version: 1, updatedAt: new Date().toISOString(), posts: [] };
}

function emptyComments(): CommunityCommentsPayload {
  return { version: 1, updatedAt: new Date().toISOString(), comments: [] };
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parsePosts(raw: unknown): CommunityPostsPayload {
  if (!raw || typeof raw !== "object") return emptyPosts();
  const value = raw as { posts?: unknown };
  const posts = Array.isArray(value.posts)
    ? value.posts.filter((post): post is IssuerPost => !!post && typeof post === "object" && typeof (post as IssuerPost).id === "string")
    : [];
  return { version: 1, updatedAt: new Date().toISOString(), posts };
}

function parseComments(raw: unknown): CommunityCommentsPayload {
  if (!raw || typeof raw !== "object") return emptyComments();
  const value = raw as { comments?: unknown };
  const comments = Array.isArray(value.comments)
    ? value.comments.filter((comment): comment is CommunityComment => !!comment && typeof comment === "object" && typeof (comment as CommunityComment).id === "string")
    : [];
  return { version: 1, updatedAt: new Date().toISOString(), comments };
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

let postChain: Promise<unknown> = Promise.resolve();
let commentChain: Promise<unknown> = Promise.resolve();

function serialized<T>(chain: "posts" | "comments", fn: () => Promise<T>): Promise<T> {
  const current = chain === "posts" ? postChain : commentChain;
  const next = current.then(fn, fn);
  if (chain === "posts") postChain = next.catch(() => undefined);
  else commentChain = next.catch(() => undefined);
  return next;
}

function localStore(): CommunityStore {
  return {
    async listPosts(marketId, includeDeleted = false) {
      const payload = await readJson(COMMUNITY_POSTS_FILE, emptyPosts());
      return payload.posts
        .filter((post) => post.marketId === marketId && (includeDeleted || !post.deletedAt))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
    async listAllPosts(includeDeleted = false) {
      const payload = await readJson(COMMUNITY_POSTS_FILE, emptyPosts());
      return payload.posts.filter((post) => includeDeleted || !post.deletedAt);
    },
    async getPost(id) {
      if (!validUuid(id)) return null;
      const payload = await readJson(COMMUNITY_POSTS_FILE, emptyPosts());
      return payload.posts.find((post) => post.id === id) ?? null;
    },
    putPost(post) {
      return serialized("posts", async () => {
        const payload = parsePosts(await readJson(COMMUNITY_POSTS_FILE, emptyPosts()));
        const posts = [post, ...payload.posts.filter((item) => item.id !== post.id)].slice(0, 2000);
        await atomicWrite(COMMUNITY_POSTS_FILE, { version: 1, updatedAt: new Date().toISOString(), posts });
        return post;
      });
    },
    pinPost(marketId, postId, pinned) {
      return serialized("posts", async () => {
        const payload = parsePosts(await readJson(COMMUNITY_POSTS_FILE, emptyPosts()));
        const target = payload.posts.find((post) => post.id === postId && post.marketId === marketId && !post.deletedAt);
        if (!target) return null;
        const now = new Date().toISOString();
        const posts = payload.posts.map((post) => {
          if (post.marketId !== marketId) return post;
          if (post.id === postId) return { ...post, pinned, updatedAt: now, revision: post.revision + 1 };
          return pinned && post.pinned ? { ...post, pinned: false, updatedAt: now, revision: post.revision + 1 } : post;
        });
        await atomicWrite(COMMUNITY_POSTS_FILE, { version: 1, updatedAt: now, posts });
        return posts.find((post) => post.id === postId) ?? null;
      });
    },
    async listComments(postId, includeDeleted = false) {
      const payload = await readJson(COMMUNITY_COMMENTS_FILE, emptyComments());
      return payload.comments
        .filter((comment) => comment.postId === postId && (includeDeleted || !comment.deletedAt))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    },
    async commentStatsForPosts(postIds) {
      const wanted = new Set(postIds);
      const payload = await readJson(COMMUNITY_COMMENTS_FILE, emptyComments());
      const grouped = new Map<string, { commentCount: number; uniqueCommenters: number }>();
      const wallets = new Map<string, Set<string>>();
      for (const postId of postIds) grouped.set(postId, { commentCount: 0, uniqueCommenters: 0 });
      for (const comment of payload.comments) {
        if (comment.deletedAt || !wanted.has(comment.postId)) continue;
        const current = grouped.get(comment.postId) ?? { commentCount: 0, uniqueCommenters: 0 };
        current.commentCount += 1;
        grouped.set(comment.postId, current);
        const set = wallets.get(comment.postId) ?? new Set<string>();
        set.add(comment.authorWallet);
        wallets.set(comment.postId, set);
      }
      for (const [postId, stats] of grouped) stats.uniqueCommenters = wallets.get(postId)?.size ?? 0;
      return grouped;
    },
    async getComment(id) {
      if (!validUuid(id)) return null;
      const payload = await readJson(COMMUNITY_COMMENTS_FILE, emptyComments());
      return payload.comments.find((comment) => comment.id === id) ?? null;
    },
    putComment(comment) {
      return serialized("comments", async () => {
        const payload = parseComments(await readJson(COMMUNITY_COMMENTS_FILE, emptyComments()));
        const comments = [comment, ...payload.comments.filter((item) => item.id !== comment.id)].slice(0, 10000);
        await atomicWrite(COMMUNITY_COMMENTS_FILE, { version: 1, updatedAt: new Date().toISOString(), comments });
        return comment;
      });
    },
  };
}

/** Local files are explicit development storage. Production needs a durable adapter. */
export function getCommunityStore(): CommunityStore {
  if (process.env.NODE_ENV === "production") throw new CommunityStorageConfigError();
  return localStore();
}

export function newCommunityId(): string {
  return randomUUID();
}

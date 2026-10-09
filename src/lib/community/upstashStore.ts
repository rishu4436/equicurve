import type { Redis } from "@upstash/redis";
import type { CommunityComment, IssuerPost } from "./types";
import type { CommunityStore } from "./store";

export type CommunityRedis = Pick<Redis, "get" | "lrange" | "eval">;
const MAX_POST_INDEX = 2000;
const MAX_COMMENT_INDEX = 10000;

function validId(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function postKey(id: string): string { if (!validId(id)) throw new Error("Invalid post id"); return `equicurve:post:${id}`; }
function commentKey(id: string): string { if (!validId(id)) throw new Error("Invalid comment id"); return `equicurve:comment:${id}`; }
function marketPostsKey(id: string): string { if (!id || id.length > 128 || /[^a-zA-Z0-9:_-]/.test(id)) throw new Error("Invalid market id"); return `equicurve:market:${id}:posts`; }
function newestKey(): string { return "equicurve:posts:newest"; }
function commentsNewestKey(): string { return "equicurve:comments:newest"; }
function postCommentsKey(id: string): string { if (!validId(id)) throw new Error("Invalid post id"); return `equicurve:post:${id}:comments`; }
function pinnedKey(id: string): string { if (!id || id.length > 128 || /[^a-zA-Z0-9:_-]/.test(id)) throw new Error("Invalid market id"); return `equicurve:market:${id}:pinned`; }

function accepted(value: unknown): boolean { return value === 1 || value === "1" || (Array.isArray(value) && (value[0] === 1 || value[0] === "1")); }
function decode<T>(value: unknown): T | null {
  if (typeof value === "string") { try { return JSON.parse(value) as T; } catch { return null; } }
  return value && typeof value === "object" ? value as T : null;
}
function listIds(redis: CommunityRedis, index: string, max: number): Promise<string[]> { return redis.lrange<string>(index, 0, max - 1); }

const PUT_LUA = `
local raw = redis.call('GET', KEYS[1])
local expected = tonumber(ARGV[1])
local current = 0
if raw then local ok, decoded = pcall(cjson.decode, raw); if ok and type(decoded) == 'table' then current = tonumber(decoded.revision) or 0 end end
if current ~= expected then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[4]))
redis.call('LPUSH', KEYS[3], ARGV[3])
redis.call('LTRIM', KEYS[3], 0, tonumber(ARGV[5]))
return 1
`;

const PIN_LUA = `
local target = redis.call('GET', KEYS[1])
if not target then return 0 end
local ok, decoded = pcall(cjson.decode, target)
if not ok or type(decoded) ~= 'table' or decoded.deletedAt ~= nil then return 0 end
local old = redis.call('GET', KEYS[3])
if ARGV[2] == '1' then
  if old and old ~= ARGV[1] then
    local oldRaw = redis.call('GET', 'equicurve:post:' .. old)
    if oldRaw then local oldOk, oldPost = pcall(cjson.decode, oldRaw); if oldOk and type(oldPost) == 'table' then oldPost.pinned = false; oldPost.revision = (tonumber(oldPost.revision) or 0) + 1; oldPost.updatedAt = ARGV[3]; redis.call('SET', 'equicurve:post:' .. old, cjson.encode(oldPost)) end end
  end
  decoded.pinned = true
  decoded.revision = (tonumber(decoded.revision) or 0) + 1
  decoded.updatedAt = ARGV[3]
  redis.call('SET', KEYS[1], cjson.encode(decoded))
  redis.call('SET', KEYS[3], ARGV[1])
else
  decoded.pinned = false
  decoded.revision = (tonumber(decoded.revision) or 0) + 1
  decoded.updatedAt = ARGV[3]
  redis.call('SET', KEYS[1], cjson.encode(decoded))
  if old == ARGV[1] then redis.call('DEL', KEYS[3]) end
end
return 1
`;

export class CommunityConflictError extends Error {
  constructor() { super("Community record changed concurrently; reload and retry."); this.name = "CommunityConflictError"; }
}

export function createUpstashCommunityStore(redis: CommunityRedis): CommunityStore {
  const readPost = async (id: string) => validId(id) ? decode<IssuerPost>(await redis.get(postKey(id))) : null;
  const readComment = async (id: string) => validId(id) ? decode<CommunityComment>(await redis.get(commentKey(id))) : null;
  const readPostsFrom = async (ids: string[]) => (await Promise.all([...new Set(ids)].map(readPost))).filter((x): x is IssuerPost => !!x);
  const readCommentsFrom = async (ids: string[]) => (await Promise.all([...new Set(ids)].map(readComment))).filter((x): x is CommunityComment => !!x);
  return {
    async listPosts(marketId, includeDeleted = false) {
      const rows = await readPostsFrom(await listIds(redis, marketPostsKey(marketId), MAX_POST_INDEX));
      return rows.filter((post) => includeDeleted || !post.deletedAt).sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
    async listAllPosts(includeDeleted = false) {
      const rows = await readPostsFrom(await listIds(redis, newestKey(), MAX_POST_INDEX));
      return rows.filter((post) => includeDeleted || !post.deletedAt).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    },
    async getPost(id) { return readPost(id); },
    async putPost(post) {
      if (!validId(post.id)) throw new Error("Invalid post id");
      const current = await readPost(post.id);
      const expected = current?.revision ?? 0;
      const next = { ...post, revision: post.revision ?? expected + 1 };
      if (next.revision !== expected + 1) throw new CommunityConflictError();
      const won = await redis.eval(PUT_LUA, [postKey(post.id), marketPostsKey(post.marketId), newestKey()], [String(expected), JSON.stringify(next), post.id, String(MAX_POST_INDEX - 1), String(MAX_POST_INDEX - 1)]);
      if (!accepted(won)) throw new CommunityConflictError();
      return next;
    },
    async pinPost(marketId, postId, pinned) {
      if (!validId(postId)) return null;
      const target = await readPost(postId);
      if (!target || target.marketId !== marketId || target.deletedAt) return null;
      const won = await redis.eval(PIN_LUA, [postKey(postId), marketPostsKey(marketId), pinnedKey(marketId)], [postId, pinned ? "1" : "0", new Date().toISOString()]);
      return accepted(won) ? readPost(postId) : null;
    },
    async listComments(postId, includeDeleted = false) {
      const rows = await readCommentsFrom(await listIds(redis, postCommentsKey(postId), MAX_COMMENT_INDEX));
      return rows.filter((comment) => includeDeleted || !comment.deletedAt).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    },
    async commentStatsForPosts(postIds) {
      const result = new Map<string, { commentCount: number; uniqueCommenters: number }>();
      await Promise.all(postIds.map(async (postId) => {
        const comments = await readCommentsFrom(await listIds(redis, postCommentsKey(postId), MAX_COMMENT_INDEX));
        const active = comments.filter((comment) => !comment.deletedAt);
        result.set(postId, { commentCount: active.length, uniqueCommenters: new Set(active.map((comment) => comment.authorWallet)).size });
      }));
      return result;
    },
    async getComment(id) { return readComment(id); },
    async putComment(comment) {
      if (!validId(comment.id) || !validId(comment.postId)) throw new Error("Invalid comment id");
      const current = await readComment(comment.id);
      const expected = current?.revision ?? 0;
      const next = { ...comment, revision: comment.revision ?? expected + 1 };
      if (next.revision !== expected + 1) throw new CommunityConflictError();
      const won = await redis.eval(PUT_LUA, [commentKey(comment.id), postCommentsKey(comment.postId), commentsNewestKey()], [String(expected), JSON.stringify(next), comment.id, String(MAX_COMMENT_INDEX - 1), String(MAX_COMMENT_INDEX - 1)]);
      if (!accepted(won)) throw new CommunityConflictError();
      return next;
    },
  };
}

export const communityKeyHelpers = { postKey, commentKey, marketPostsKey, newestKey, commentsNewestKey, postCommentsKey, pinnedKey };

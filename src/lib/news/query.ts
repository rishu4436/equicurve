import { z } from "zod";
import { getCluster } from "@/lib/constants";
import { getCommunityStore, type CommunityStore } from "@/lib/community/store";
import type { IssuerPost } from "@/lib/community/types";
import { effectiveScheduleStatus } from "@/lib/schedule/types";
import { getScheduledLaunchStore } from "@/lib/schedule/store";
import { isRegistryVerified } from "@/lib/registry/normalize";
import { listRegistryLaunches } from "@/lib/registry/store";
import type { NewsCategory, NewsFeedItem, NewsMarketContext, NewsQuery, NewsResponse, NewsSort } from "./types";

export const NEWS_DEFAULT_LIMIT = 20;
export const NEWS_MAX_LIMIT = 50;
export const NEWS_POPULAR_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const NEWS_MAX_QUERY_LENGTH = 80;

export class NewsQueryError extends Error {
  readonly status = 400;
  readonly code = "invalid_news_query";
}

export class NewsStatsUnavailable extends Error {
  readonly status = 503;
  readonly code = "engagement_unavailable";
  constructor() {
    super("Engagement data is temporarily unavailable; Popular cannot be ranked safely.");
  }
}

const sortSchema = z.enum(["newest", "popular"]);
const categorySchema = z.enum(["all", "announcement", "update", "milestone", "important"]);
const cursorSchema = z.object({
  v: z.literal(1),
  sort: sortSchema,
  category: categorySchema,
  query: z.string().nullable(),
  asOf: z.number().int().positive(),
  createdAt: z.string().datetime(),
  postId: z.string().uuid(),
  score: z.number().finite().optional(),
}).strict();

type Cursor = z.infer<typeof cursorSchema>;
type Context = NewsMarketContext;
type Stats = { commentCount: number; uniqueCommenters: number };

function invalid(message: string): never {
  throw new NewsQueryError(message);
}

function decodeCursor(value: string | null, query: Pick<NewsQuery, "sort" | "category" | "query">): Cursor | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    invalid("Cursor is malformed.");
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success || result.data.sort !== query.sort || result.data.category !== query.category || result.data.query !== query.query) invalid("Cursor does not match this News query.");
  if (query.sort === "popular" && result.data.score == null) invalid("Popular cursor is missing its score.");
  if (query.sort === "newest" && result.data.score != null) invalid("Newest cursor contains an invalid score.");
  return result.data;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function compareDescending(a: { createdAt: string; postId: string }, b: { createdAt: string; postId: string }): number {
  const date = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return date || (b.postId < a.postId ? -1 : b.postId > a.postId ? 1 : 0);
}

function excerpt(body: string): string {
  const compact = body.replace(/\s+/g, " ").trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}…` : compact;
}

function statusLabel(status: string): string {
  if (status === "graduated") return "Graduated · DAMM v2";
  if (status === "raising") return "Live · Raising";
  if (status === "complete") return "Live · Curve complete";
  return `Live · ${status[0]?.toUpperCase() ?? "U"}${status.slice(1)}`;
}

async function loadContexts(posts: IssuerPost[], nowMs: number): Promise<Map<string, Context>> {
  const liveIds = [...new Set(posts.filter((post) => post.marketKind === "live").map((post) => post.marketId))];
  const scheduledIds = [...new Set(posts.filter((post) => post.marketKind === "scheduled").map((post) => post.marketId))];
  const [registry, schedules] = await Promise.all([
    liveIds.length ? listRegistryLaunches() : Promise.resolve([]),
    scheduledIds.length ? getScheduledLaunchStore().list() : Promise.resolve([]),
  ]);
  const cluster = getCluster();
  const contexts = new Map<string, Context>();
  for (const row of registry) {
    if (!liveIds.includes(row.pool) || row.cluster !== cluster || !isRegistryVerified(row)) continue;
    contexts.set(row.pool, {
      id: row.pool,
      kind: "live",
      name: row.name,
      ticker: row.ticker,
      contextLabel: statusLabel(row.status),
      status: row.status,
      creatorWallet: row.creator,
      creatorVerified: true,
    });
  }
  for (const schedule of schedules) {
    if (!scheduledIds.includes(schedule.id) || schedule.cluster !== cluster) continue;
    const status = effectiveScheduleStatus(schedule, nowMs);
    if (status !== "scheduled" && status !== "ready") continue;
    contexts.set(schedule.id, {
      id: schedule.id,
      kind: "scheduled",
      name: schedule.name,
      ticker: schedule.ticker,
      imageUrl: schedule.image || undefined,
      contextLabel: "Upcoming",
      status,
      creatorWallet: schedule.creatorWallet,
      creatorVerified: true,
      scheduledForUtc: schedule.scheduledForUtc,
    });
  }
  return contexts;
}

async function loadStats(store: CommunityStore, posts: IssuerPost[]): Promise<Map<string, Stats>> {
  const ids = posts.map((post) => post.id);
  if (store.commentStatsForPosts) {
    const result = await store.commentStatsForPosts(ids);
    for (const id of ids) if (!result.has(id)) result.set(id, { commentCount: 0, uniqueCommenters: 0 });
    return result;
  }
  const entries = await Promise.all(posts.map(async (post) => [post.id, await store.listComments(post.id)] as const));
  const result = new Map<string, Stats>();
  for (const [postId, comments] of entries) {
    const active = comments.filter((comment) => !comment.deletedAt);
    result.set(postId, { commentCount: active.length, uniqueCommenters: new Set(active.map((comment) => comment.authorWallet)).size });
  }
  return result;
}

function searchMatches(post: IssuerPost, context: Context, query: string | null): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return [context.name, context.ticker, post.title, post.body].some((value) => value.toLowerCase().includes(q));
}

export async function queryNews(args: NewsQuery, store: CommunityStore = getCommunityStore(), contextOverride?: Map<string, NewsMarketContext>): Promise<NewsResponse> {
  if (args.limit < 1 || args.limit > NEWS_MAX_LIMIT || !Number.isInteger(args.limit)) invalid("limit must be between 1 and 50.");
  if (!sortSchema.safeParse(args.sort).success) invalid("sort must be newest or popular.");
  if (!categorySchema.safeParse(args.category).success) invalid("category is invalid.");
  if (args.query != null && (args.query.length < 2 || args.query.length > NEWS_MAX_QUERY_LENGTH)) invalid("Search must be 2–80 characters.");
  const query = args.query?.trim() || null;
  if (query && (query.length < 2 || query.length > NEWS_MAX_QUERY_LENGTH)) invalid("Search must be 2–80 characters.");
  const cursor = decodeCursor(args.cursor, { sort: args.sort, category: args.category, query });
  const asOf = cursor?.asOf ?? args.nowMs ?? Date.now();
  const posts = store.listAllPosts ? await store.listAllPosts() : [];
  const contexts = contextOverride ?? await loadContexts(posts, asOf);
  const visible = posts.filter((post) => !post.deletedAt && contexts.has(post.marketId) && (args.category === "all" || post.category === args.category) && searchMatches(post, contexts.get(post.marketId)!, query));
  let stats = new Map<string, Stats>();
  let statsAvailable = true;
  try {
    stats = await loadStats(store, visible);
  } catch {
    if (args.sort === "popular") throw new NewsStatsUnavailable();
    statsAvailable = false;
  }
  const scored = visible.map((post) => {
    const context = contexts.get(post.marketId)!;
    const stat = stats.get(post.id);
    const ageHours = Math.max(0, (asOf - Date.parse(post.createdAt)) / 3_600_000);
    const popularScore = stat ? (stat.uniqueCommenters * 4 + Math.min(stat.commentCount, 50)) / (1 + ageHours / 24) : undefined;
    const item: NewsFeedItem = {
      postId: post.id,
      marketId: post.marketId,
      marketKind: post.marketKind,
      marketName: context.name,
      ticker: context.ticker,
      ...(context.imageUrl ? { marketImageUrl: context.imageUrl } : {}),
      marketContext: context.contextLabel,
      ...(context.scheduledForUtc ? { scheduledForUtc: context.scheduledForUtc } : {}),
      category: post.category,
      title: post.title,
      bodyExcerpt: excerpt(post.body),
      ...(post.imageUrl ? { imageUrl: post.imageUrl } : {}),
      ...(post.link ? { link: post.link } : {}),
      pinned: post.pinned,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      commentCount: stat?.commentCount ?? null,
      uniqueCommenters: stat?.uniqueCommenters ?? null,
      creatorWallet: context.creatorWallet,
      creatorVerified: true,
      ...(popularScore != null ? { popularScore } : {}),
    };
    return item;
  });
  let ordered: NewsFeedItem[];
  if (args.sort === "popular") {
    ordered = scored
      .filter((item) => Date.parse(item.createdAt) >= asOf - NEWS_POPULAR_WINDOW_MS)
      .sort((a, b) => (b.popularScore! - a.popularScore!) || compareDescending(a, b));
  } else {
    ordered = scored.sort(compareDescending);
  }
  const pageStart = cursor ? ordered.findIndex((item) => {
    if (args.sort === "newest") return item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.postId < cursor.postId);
    const score = item.popularScore ?? 0;
    return score < (cursor.score ?? 0) || (score === cursor.score && (item.createdAt < cursor.createdAt || (item.createdAt === cursor.createdAt && item.postId < cursor.postId)));
  }) : 0;
  const start = cursor && pageStart >= 0 ? pageStart : cursor ? ordered.length : 0;
  const items = ordered.slice(start, start + args.limit);
  const last = items.at(-1);
  const nextCursor = last && start + args.limit < ordered.length ? encodeCursor({
    v: 1,
    sort: args.sort,
    category: args.category,
    query,
    asOf,
    createdAt: last.createdAt,
    postId: last.postId,
    ...(args.sort === "popular" ? { score: last.popularScore ?? 0 } : {}),
  }) : null;
  return { ok: true, items, nextCursor, sort: args.sort, category: args.category === "all" ? null : args.category, query, statsAvailable };
}

export function parseNewsParams(params: URLSearchParams): NewsQuery {
  const sortRaw = params.get("sort") ?? "newest";
  if (!sortSchema.safeParse(sortRaw).success) invalid("sort must be newest or popular.");
  const categoryRaw = params.get("category") ?? "all";
  if (!categorySchema.safeParse(categoryRaw).success) invalid("category is invalid.");
  const queryRaw = params.get("q");
  const query = queryRaw?.trim() || null;
  const limitRaw = params.get("limit");
  const limit = limitRaw == null ? NEWS_DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > NEWS_MAX_LIMIT) invalid("limit must be between 1 and 50.");
  return { sort: sortRaw as NewsSort, category: categoryRaw as NewsCategory, query, cursor: params.get("cursor"), limit };
}

import { z } from "zod";
import { normalizeHttpsUrl, optionalImageUrlSchema, walletSchema } from "@/lib/validation";
import { newCommunityId, type CommunityStore } from "./store";
import type { CommunityComment, CommunityMarket, IssuerPost, PostCategory, PublicCommunityComment, PublicIssuerPost } from "./types";
import { POST_CATEGORIES } from "./types";

const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
const safeText = (value: string): boolean => !FORBIDDEN_CHARS.test(value);
const titleSchema = z.string().trim().min(1).max(100).refine(safeText, "Title contains invalid characters");
const bodySchema = z.string().trim().min(1).max(4000).refine(safeText, "Body contains invalid characters");
const commentSchema = z.string().trim().min(1).max(1000).refine(safeText, "Comment contains invalid characters");
const httpsOrEmpty = z.string().trim().max(200).refine((value) => value === "" || normalizeHttpsUrl(value) !== null, "Link must be an https:// URL");
const imageOrEmpty = optionalImageUrlSchema;

export const postContentSchema = z.object({
  category: z.enum(POST_CATEGORIES),
  title: titleSchema,
  body: bodySchema,
  link: httpsOrEmpty.optional(),
  imageUrl: imageOrEmpty.optional(),
}).strict();

export const commentContentSchema = z.object({ body: commentSchema }).strict();
export type PostContent = z.infer<typeof postContentSchema>;

function nowIso(nowMs: number): string {
  return new Date(nowMs).toISOString();
}

export function postError(status: 400 | 401 | 403 | 404 | 409, code: string, error: string) {
  return { ok: false as const, status, code, error };
}

export async function createIssuerPost(args: {
  market: CommunityMarket;
  signer: string;
  body: unknown;
  store: CommunityStore;
  nowMs?: number;
}): Promise<{ ok: true; post: IssuerPost } | ReturnType<typeof postError>> {
  const parsed = postContentSchema.safeParse(args.body);
  if (!parsed.success) return postError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid update");
  const signer = walletSchema.safeParse(args.signer);
  if (!signer.success || args.signer !== args.market.creatorWallet) return postError(403, "not_creator", "Only the canonical market creator may publish issuer updates.");
  const now = nowIso(args.nowMs ?? Date.now());
  const post: IssuerPost = {
    id: newCommunityId(), marketId: args.market.id, marketKind: args.market.kind,
    creatorWallet: args.market.creatorWallet, category: parsed.data.category as PostCategory,
    title: parsed.data.title, body: parsed.data.body,
    ...(parsed.data.link ? { link: normalizeHttpsUrl(parsed.data.link) ?? undefined } : {}),
    ...(parsed.data.imageUrl ? { imageUrl: parsed.data.imageUrl } : {}),
    pinned: false, createdAt: now, updatedAt: now, revision: 1, creatorVerified: true,
  };
  return { ok: true, post: await args.store.putPost(post) };
}

export async function editIssuerPost(args: {
  post: IssuerPost;
  market: CommunityMarket;
  signer: string;
  body: unknown;
  store: CommunityStore;
  nowMs?: number;
}): Promise<{ ok: true; post: IssuerPost } | ReturnType<typeof postError>> {
  const parsed = postContentSchema.safeParse(args.body);
  if (!parsed.success) return postError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid update");
  if (args.post.marketId !== args.market.id || args.post.marketKind !== args.market.kind || args.post.creatorWallet !== args.market.creatorWallet || args.signer !== args.market.creatorWallet) return postError(403, "not_creator", "Only the canonical market creator may edit this update.");
  if (args.post.deletedAt) return postError(409, "deleted_post", "Deleted updates cannot be edited.");
  const now = nowIso(args.nowMs ?? Date.now());
  const next: IssuerPost = {
    ...args.post, category: parsed.data.category as PostCategory, title: parsed.data.title, body: parsed.data.body,
    ...(parsed.data.link ? { link: normalizeHttpsUrl(parsed.data.link) ?? undefined } : { link: undefined }),
    ...(parsed.data.imageUrl ? { imageUrl: parsed.data.imageUrl } : { imageUrl: undefined }),
    updatedAt: now, revision: args.post.revision + 1,
  };
  return { ok: true, post: await args.store.putPost(next) };
}

export async function deleteIssuerPost(args: { post: IssuerPost; market: CommunityMarket; signer: string; store: CommunityStore; nowMs?: number }): Promise<{ ok: true; post: IssuerPost } | ReturnType<typeof postError>> {
  if (args.post.marketId !== args.market.id || args.post.marketKind !== args.market.kind || args.post.creatorWallet !== args.market.creatorWallet || args.signer !== args.market.creatorWallet) return postError(403, "not_creator", "Only the canonical market creator may delete this update.");
  if (args.post.deletedAt) return postError(409, "deleted_post", "Update is already deleted.");
  const next = { ...args.post, deletedAt: nowIso(args.nowMs ?? Date.now()), updatedAt: nowIso(args.nowMs ?? Date.now()), revision: args.post.revision + 1 };
  return { ok: true, post: await args.store.putPost(next) };
}

export async function pinIssuerPost(args: { post: IssuerPost; market: CommunityMarket; signer: string; pinned: boolean; store: CommunityStore }): Promise<{ ok: true; post: IssuerPost } | ReturnType<typeof postError>> {
  if (args.post.marketId !== args.market.id || args.post.marketKind !== args.market.kind || args.post.creatorWallet !== args.market.creatorWallet || args.signer !== args.market.creatorWallet) return postError(403, "not_creator", "Only the canonical market creator may pin updates.");
  if (args.post.deletedAt) return postError(409, "deleted_post", "Deleted updates cannot be pinned.");
  const post = await args.store.pinPost(args.market.id, args.post.id, args.pinned);
  return post ? { ok: true, post } : postError(404, "post_not_found", "Update not found.");
}

export async function createComment(args: { post: IssuerPost; signer: string; body: unknown; store: CommunityStore; nowMs?: number }): Promise<{ ok: true; comment: CommunityComment } | ReturnType<typeof postError>> {
  const parsed = commentContentSchema.safeParse(args.body);
  if (!parsed.success) return postError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid comment");
  if (args.post.deletedAt) return postError(404, "post_not_found", "Comments are unavailable for a deleted update.");
  if (!walletSchema.safeParse(args.signer).success) return postError(401, "unauthenticated", "Connect and authenticate a wallet first.");
  const now = nowIso(args.nowMs ?? Date.now());
  const comment: CommunityComment = { id: newCommunityId(), postId: args.post.id, authorWallet: args.signer, body: parsed.data.body, createdAt: now, updatedAt: now, revision: 1 };
  return { ok: true, comment: await args.store.putComment(comment) };
}

export async function editComment(args: { comment: CommunityComment; post: IssuerPost; signer: string; body: unknown; store: CommunityStore; nowMs?: number }): Promise<{ ok: true; comment: CommunityComment } | ReturnType<typeof postError>> {
  const parsed = commentContentSchema.safeParse(args.body);
  if (!parsed.success) return postError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid comment");
  if (args.post.deletedAt) return postError(404, "post_not_found", "Comments are unavailable for a deleted update.");
  if (args.comment.postId !== args.post.id || args.comment.authorWallet !== args.signer) return postError(403, "not_author", "Only the comment author may edit this comment.");
  if (args.comment.deletedAt) return postError(409, "deleted_comment", "Deleted comments cannot be edited.");
  const now = nowIso(args.nowMs ?? Date.now());
  const next = { ...args.comment, body: parsed.data.body, updatedAt: now, revision: args.comment.revision + 1 };
  return { ok: true, comment: await args.store.putComment(next) };
}

export async function deleteComment(args: { comment: CommunityComment; post: IssuerPost; signer: string; store: CommunityStore; nowMs?: number }): Promise<{ ok: true; comment: CommunityComment } | ReturnType<typeof postError>> {
  if (args.post.deletedAt) return postError(404, "post_not_found", "Comments are unavailable for a deleted update.");
  if (args.comment.postId !== args.post.id || args.comment.authorWallet !== args.signer) return postError(403, "not_author", "Only the comment author may delete this comment.");
  if (args.comment.deletedAt) return postError(409, "deleted_comment", "Comment is already deleted.");
  const now = nowIso(args.nowMs ?? Date.now());
  const next = { ...args.comment, deletedAt: now, updatedAt: now, revision: args.comment.revision + 1 };
  return { ok: true, comment: await args.store.putComment(next) };
}

export function toPublicPost(post: IssuerPost, commentCount: number): PublicIssuerPost {
  return { ...post, creatorVerified: true, edited: Date.parse(post.updatedAt) > Date.parse(post.createdAt), commentCount };
}

export function toPublicComment(comment: CommunityComment, creatorWallet: string): PublicCommunityComment {
  const { deletedAt: _deletedAt, ...publicComment } = comment;
  return { ...publicComment, edited: Date.parse(comment.updatedAt) > Date.parse(comment.createdAt), creator: comment.authorWallet === creatorWallet };
}

import type { PublicRegistryLaunch } from "@/lib/registry/types";

export const POST_CATEGORIES = ["announcement", "update", "milestone", "important"] as const;
export type PostCategory = (typeof POST_CATEGORIES)[number];
export type CommunityMarketKind = "live" | "scheduled";

export type CommunityMarket = {
  id: string;
  kind: CommunityMarketKind;
  creatorWallet: string;
  cluster: string;
};

export type IssuerPost = {
  id: string;
  marketId: string;
  marketKind: CommunityMarketKind;
  creatorWallet: string;
  category: PostCategory;
  title: string;
  body: string;
  link?: string;
  imageUrl?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision: number;
  /** Server-derived and retained for audit; never accepted from the browser. */
  creatorVerified: true;
};

export type PublicIssuerPost = Omit<IssuerPost, "creatorVerified"> & {
  creatorVerified: true;
  edited: boolean;
  commentCount: number;
};

export type CommunityComment = {
  id: string;
  postId: string;
  authorWallet: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  revision: number;
};

export type PublicCommunityComment = Omit<CommunityComment, "deletedAt"> & {
  edited: boolean;
  creator: boolean;
};

export type CommunityPostsPayload = {
  version: 1;
  updatedAt: string;
  posts: IssuerPost[];
};

export type CommunityCommentsPayload = {
  version: 1;
  updatedAt: string;
  comments: CommunityComment[];
};

/** Keep the import type available to server resolvers without making clients depend on registry internals. */
export type VerifiedLiveMarket = Pick<PublicRegistryLaunch, "pool" | "creator" | "cluster">;

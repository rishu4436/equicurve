import type { CommunityMarketKind, PostCategory } from "@/lib/community/types";

export type NewsSort = "newest" | "popular";
export type NewsCategory = "all" | PostCategory;

export type NewsMarketContext = {
  id: string;
  kind: CommunityMarketKind;
  name: string;
  ticker: string;
  imageUrl?: string;
  contextLabel: string;
  status: string;
  creatorWallet: string;
  creatorVerified: true;
  scheduledForUtc?: string;
};

export type NewsFeedItem = {
  postId: string;
  marketId: string;
  marketKind: CommunityMarketKind;
  marketName: string;
  ticker: string;
  marketImageUrl?: string;
  marketContext: string;
  scheduledForUtc?: string;
  category: PostCategory;
  title: string;
  bodyExcerpt: string;
  imageUrl?: string;
  link?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  commentCount: number | null;
  uniqueCommenters: number | null;
  creatorWallet: string;
  creatorVerified: true;
  popularScore?: number;
};

export type NewsQuery = {
  sort: NewsSort;
  category: NewsCategory;
  query: string | null;
  cursor: string | null;
  limit: number;
  nowMs?: number;
};

export type NewsResponse = {
  ok: true;
  items: NewsFeedItem[];
  nextCursor: string | null;
  sort: NewsSort;
  category: NewsCategory | null;
  query: string | null;
  statsAvailable: boolean;
};

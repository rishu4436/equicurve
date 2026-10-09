"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { clsx } from "clsx";
import { isLocalTokenImageUrl, normalizeHttpsUrl } from "@/lib/validation";
import type { NewsCategory, NewsFeedItem, NewsResponse, NewsSort } from "@/lib/news/types";

const FILTERS: { value: NewsCategory; label: string }[] = [
  { value: "all", label: "All" },
  { value: "announcement", label: "Announcements" },
  { value: "update", label: "Updates" },
  { value: "milestone", label: "Milestones" },
  { value: "important", label: "Important" },
];

function shortWallet(wallet: string): string {
  return wallet.length > 10 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Unknown time";
}

function context(item: NewsFeedItem): string {
  if (item.marketKind === "scheduled") return `Launch scheduled ${formatTime(item.scheduledForUtc ?? item.createdAt)} · No market exists on-chain yet.`;
  return item.marketContext;
}

export function NewsFeed() {
  const [sort, setSort] = useState<NewsSort>("newest");
  const [category, setCategory] = useState<NewsCategory>("all");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState<string | null>(null);
  const [items, setItems] = useState<NewsFeedItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statsAvailable, setStatsAvailable] = useState(true);

  const load = useCallback(async (append = false) => {
    if (append && !nextCursor) return;
    if (append) setLoadingMore(true); else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ sort, category, limit: "20" });
      if (query) params.set("q", query);
      if (append && nextCursor) params.set("cursor", nextCursor);
      const response = await fetch(`/api/news?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json()) as NewsResponse & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "News is unavailable.");
      setItems((current) => append ? [...current, ...body.items] : body.items);
      setNextCursor(body.nextCursor);
      setStatsAvailable(body.statsAvailable);
    } catch (loadError) {
      if (!append) setItems([]);
      setNextCursor(null);
      setError(loadError instanceof Error ? loadError.message : "News is unavailable.");
    } finally {
      if (append) setLoadingMore(false); else setLoading(false);
    }
  }, [category, nextCursor, query, sort]);

  useEffect(() => { void load(false); }, [sort, category, query]); // eslint-disable-line react-hooks/exhaustive-deps

  function changeSort(value: NewsSort) {
    setSort(value);
    setNextCursor(null);
  }

  function changeCategory(value: NewsCategory) {
    setCategory(value);
    setNextCursor(null);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = queryInput.trim();
    if (value && (value.length < 2 || value.length > 80)) {
      setError("Search must be 2–80 characters.");
      return;
    }
    setNextCursor(null);
    setQuery(value || null);
  }

  return (
    <div className="space-y-8">
      <header className="max-w-2xl">
        <p className="ec-eyebrow">Creator communication</p>
        <h1 className="ec-page-title mt-3">News &amp; Updates</h1>
        <p className="mt-4 text-base leading-relaxed text-fg-secondary">Creator-authored updates across EquiCurve markets.</p>
        <p className="mt-3 text-xs leading-relaxed text-fg-muted">Creator posts are authored by market creators. EquiCurve verifies authorship where supported; it does not independently verify the claims in these posts.</p>
      </header>

      <section className="space-y-4" aria-label="News filters">
        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
          {(["newest", "popular"] as NewsSort[]).map((value) => <button key={value} type="button" onClick={() => changeSort(value)} className={clsx("min-h-11 rounded-input px-4 text-sm", sort === value ? "bg-accent/15 text-accent" : "text-fg-secondary hover:bg-subtle hover:text-fg-primary")}>{value === "newest" ? "Newest" : "Popular"}</button>)}
          <span className="ml-auto text-xs text-fg-muted">{sort === "popular" ? "Recent engagement-ranked creator updates" : "Latest creator updates"}</span>
        </div>
        {sort === "popular" && <p className="text-xs text-fg-muted">Popular ranks recent creator updates using unique wallet engagement, comment activity and age.</p>}
        <div className="flex flex-wrap gap-2">{FILTERS.map((filter) => <button key={filter.value} type="button" onClick={() => changeCategory(filter.value)} className={clsx("rounded-pill border px-3 py-1.5 text-xs", category === filter.value ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-fg-muted hover:text-fg-primary")}>{filter.label}</button>)}</div>
        <form className="flex gap-2" onSubmit={submitSearch}><label htmlFor="news-search" className="sr-only">Search News</label><input id="news-search" className="ec-input min-w-0 flex-1" maxLength={80} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Search markets, tickers, titles or updates" /><button type="submit" className="ec-btn-secondary shrink-0">Search</button>{query && <button type="button" className="ec-btn-secondary shrink-0" onClick={() => { setQueryInput(""); setQuery(null); setNextCursor(null); }}>Clear</button>}</form>
      </section>

      {error && <div className="rounded-input border border-signal-danger/30 bg-signal-danger/5 p-4 text-sm text-signal-danger">{error}</div>}
      {sort === "popular" && !statsAvailable && !error && <div className="rounded-input border border-signal-warn/30 bg-signal-warn/5 p-4 text-sm text-signal-warn">Engagement data is unavailable, so Popular cannot be ranked safely right now.</div>}
      {loading ? <div className="rounded-input border border-line bg-subtle p-8 text-sm text-fg-muted">Loading creator updates…</div> : items.length === 0 ? <div className="rounded-input border border-line bg-subtle p-10 text-center"><p className="text-base font-medium text-fg-primary">No updates found</p><p className="mt-2 text-sm text-fg-muted">Try a different category or search.</p></div> : <div className="grid gap-4">{items.map((item) => <NewsCard key={item.postId} item={item} />)}</div>}
      {nextCursor && !loading && <div className="flex justify-center"><button type="button" className="ec-btn-secondary" disabled={loadingMore} onClick={() => void load(true)}>{loadingMore ? "Loading…" : "Load more"}</button></div>}
    </div>
  );
}

function NewsCard({ item }: { item: NewsFeedItem }) {
  const href = item.marketKind === "scheduled" ? `/upcoming/${encodeURIComponent(item.marketId)}?tab=updates&post=${encodeURIComponent(item.postId)}` : `/o/${encodeURIComponent(item.marketId)}?tab=updates&post=${encodeURIComponent(item.postId)}`;
  const projectImage = item.marketImageUrl && (isLocalTokenImageUrl(item.marketImageUrl) || normalizeHttpsUrl(item.marketImageUrl)) ? item.marketImageUrl : null;
  const updateImage = item.imageUrl && (isLocalTokenImageUrl(item.imageUrl) || normalizeHttpsUrl(item.imageUrl)) ? item.imageUrl : null;
  const link = item.link ? normalizeHttpsUrl(item.link) : null;
  return <article id={`news-post-${item.postId}`} className="ec-card overflow-hidden transition-colors hover:border-accent/30"><Link href={href} className="block p-5 sm:p-6"><div className="flex gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-subtle font-semibold text-accent">{projectImage ? <><img src={projectImage} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /></> : item.ticker.slice(0, 2)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-medium text-fg-primary">{item.marketName}</h2><span className="font-mono text-xs text-fg-muted">${item.ticker}</span><span className="ec-chip">{item.marketKind === "scheduled" ? "Upcoming" : "Live"}</span></div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted"><span>{item.category[0].toUpperCase() + item.category.slice(1)}</span><span>·</span><span>{formatTime(item.createdAt)}</span><span>·</span><span>{context(item)}</span></div></div></div><h3 className="mt-4 text-lg font-semibold tracking-tight text-fg-primary">{item.title}</h3><p className="mt-2 line-clamp-3 text-sm leading-relaxed text-fg-secondary">{item.bodyExcerpt}</p>{updateImage && <img src={updateImage} alt="" className="mt-4 max-h-52 w-full rounded-input border border-line object-cover" referrerPolicy="no-referrer" />}<div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-fg-muted"><span>Creator update</span><span>{item.marketKind === "scheduled" ? "Published by scheduled launch creator" : "Published by market creator"}</span><span>{shortWallet(item.creatorWallet)}</span><span>{item.commentCount == null ? "Comments unavailable" : `${item.commentCount} comment${item.commentCount === 1 ? "" : "s"}`}</span>{item.popularScore != null && <span>Engagement-ranked</span>}</div>{link && <span className="mt-3 inline-flex text-xs text-accent">Source link available ↗</span>}</Link></article>;
}

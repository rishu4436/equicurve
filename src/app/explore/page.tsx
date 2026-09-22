"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { OfferingCard } from "@/components/ui/OfferingCard";
import {
  filterOfferings,
  type DemoOffering,
} from "@/lib/demo/offerings";
import { listLaunches, type StoredLaunch } from "@/lib/local/launches";
import { clsx } from "clsx";

const TABS = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "raising", label: "Raising" },
  { id: "graduated", label: "Graduated" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(v: string | null): v is TabId {
  return !!v && TABS.some((t) => t.id === v);
}

function launchToOffering(l: StoredLaunch): DemoOffering {
  return {
    id: l.pool,
    name: l.name,
    ticker: l.ticker,
    sector: l.sector,
    thesis: l.thesis,
    quote: l.quote,
    raiseTarget: l.raiseTarget,
    raised: 0,
    presetId: l.presetId,
    feeBps: l.feeBps,
    verified: false,
    lockPct: l.lockPct,
    status: l.status,
    volume24h: 1_000_000, // surface local launches at top of trending
    createdAt: l.createdAt,
    pool: l.pool,
    mint: l.mint,
  };
}

function ExploreInner() {
  const search = useSearchParams();
  const router = useRouter();
  const initial = search.get("tab");
  const [tab, setTab] = useState<TabId>(isTabId(initial) ? initial : "trending");
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("all");
  const [local, setLocal] = useState<DemoOffering[]>([]);

  useEffect(() => {
    const t = search.get("tab");
    if (isTabId(t)) setTab(t);
  }, [search]);

  useEffect(() => {
    setLocal(listLaunches().map(launchToOffering));
  }, []);

  function selectTab(id: TabId) {
    setTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    router.replace(url.pathname + url.search, { scroll: false });
  }

  const items = useMemo(() => {
    const demo = filterOfferings(tab);
    let merged: DemoOffering[] = [...local, ...demo];
    // de-dupe by id/pool
    const seen = new Set<string>();
    merged = merged.filter((o) => {
      const key = o.pool ?? o.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (tab === "raising") {
      merged = merged.filter((o) => o.status === "raising" || o.status === "new");
    } else if (tab === "graduated") {
      merged = merged.filter((o) => o.status === "graduated");
    } else if (tab === "new") {
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      merged = merged.filter(
        (o) =>
          new Date(o.createdAt).getTime() > cutoff ||
          local.some((l) => l.id === o.id),
      );
    } else {
      merged = [...merged].sort((a, b) => b.volume24h - a.volume24h);
    }

    if (sector !== "all") {
      merged = merged.filter((o) => o.sector === sector);
    }
    if (q.trim()) {
      const s = q.toLowerCase();
      merged = merged.filter(
        (o) =>
          o.name.toLowerCase().includes(s) ||
          o.ticker.toLowerCase().includes(s),
      );
    }
    return merged;
  }, [tab, q, sector, local]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-fg-primary">
            Explore offerings
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Equity / RWA discovery without casino chrome. Local Create launches
            appear here for the demo path (no indexer).
            {local.length > 0 && (
              <span className="text-accent">
                {" "}
                · {local.length} from this browser
              </span>
            )}
          </p>
        </div>
        <input
          className="ec-input max-w-xs"
          placeholder="Search name or ticker"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-line pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => selectTab(t.id)}
            className={clsx(
              "rounded-pill px-4 py-1.5 text-sm transition",
              tab === t.id
                ? "bg-accent/15 text-accent"
                : "text-fg-secondary hover:text-fg-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {["all", "Equity", "RWA", "Fund", "Private Co"].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSector(s)}
            className={clsx(
              "ec-chip transition",
              sector === s && "border-accent/50 text-accent",
            )}
          >
            {s === "all" ? "All sectors" : s}
          </button>
        ))}
      </div>

      {items.length === 0 ? (
        <div className="ec-card flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-fg-secondary">No offerings in this view.</p>
          <Link href="/create" className="ec-btn-primary">
            Create the first equity offering
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((o) => (
            <OfferingCard key={o.id} offering={o} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense
      fallback={
        <div className="text-sm text-fg-muted">Loading explore…</div>
      }
    >
      <ExploreInner />
    </Suspense>
  );
}

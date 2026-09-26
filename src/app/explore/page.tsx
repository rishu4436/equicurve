"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { OfferingCard } from "@/components/ui/OfferingCard";
import {
  filterOfferings,
  type DemoOffering,
  type Sector,
} from "@/lib/demo/offerings";
import type { ExploreOffering, ExploreResponse } from "@/lib/explore/types";
import { listLaunches, type StoredLaunch } from "@/lib/local/launches";
import { fetchExploreOfferings } from "@/lib/registry/client";
import type { PresetId } from "@/lib/dbc/types";
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

function isSector(v: string): v is Sector {
  return (
    v === "Equity" ||
    v === "RWA" ||
    v === "Fund" ||
    v === "Private Co" ||
    v === "Other"
  );
}

function isPresetId(v: string): v is PresetId {
  return (
    v === "flat" ||
    v === "exponential" ||
    v === "long" ||
    v === "equity" ||
    v === "short"
  );
}

function launchToOffering(l: StoredLaunch): DemoOffering {
  return {
    id: l.pool,
    name: l.name,
    ticker: l.ticker,
    sector: l.sector,
    thesis: l.thesis,
    quote: l.quote === "USDC" ? "USDC" : "SOL",
    raiseTarget: l.raiseTarget,
    raised: 0,
    presetId: l.presetId,
    feeBps: l.feeBps,
    verified: false,
    lockPct: l.lockPct,
    status: l.status,
    volume24h: 0,
    createdAt: l.createdAt,
    pool: l.pool,
    mint: l.mint,
    illustrative: false,
    quoteProgress: null,
    statusSource: "local",
    verification: { state: "not_checked", checkedAt: null, cluster: l.cluster },
  };
}

function remoteToOffering(o: ExploreOffering): DemoOffering {
  return {
    id: o.pool,
    name: o.name,
    ticker: o.ticker,
    sector: isSector(String(o.sector)) ? (o.sector as Sector) : "Other",
    thesis: o.thesis,
    quote: o.quote === "USDC" ? "USDC" : "SOL",
    raiseTarget: o.raiseTarget,
    raised: 0,
    presetId: isPresetId(String(o.presetId)) ? (o.presetId as PresetId) : "flat",
    feeBps: 0,
    // Explicit server flag: true only when the pool was verified on-chain in this response.
    verified: o.verified === true,
    lockPct: o.lockPct ?? 0,
    status: o.status,
    volume24h: 0,
    createdAt: o.createdAt,
    pool: o.pool,
    mint: o.mint,
    illustrative: false,
    quoteProgress: o.quoteProgress,
    statusSource: o.statusSource,
    verification: o.verification,
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
  const [remote, setRemote] = useState<DemoOffering[]>([]);
  const [showExamples, setShowExamples] = useState(false);
  const [loading, setLoading] = useState(true);
  const [exploreMeta, setExploreMeta] = useState<Pick<
    ExploreResponse,
    "label" | "warning" | "error" | "counts" | "cached" | "cacheTtlSec" | "cluster" | "rpcStatus" | "cacheAgeMs"
  > | null>(null);

  const loadRemote = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const res = await fetchExploreOfferings({ refresh });
      setExploreMeta({
        label: res.label,
        warning: res.warning,
        error: res.error,
        counts: res.counts,
        cached: res.cached,
        cacheTtlSec: res.cacheTtlSec,
        cacheAgeMs: res.cacheAgeMs,
        cluster: res.cluster,
        rpcStatus: res.rpcStatus,
      });
      setRemote((res.offerings ?? []).map(remoteToOffering));
    } catch (e) {
      setExploreMeta({
        label: "EquiCurve registry (not a full chain indexer)",
        warning: null,
        error: e instanceof Error ? e.message : "Failed to load discovery",
        counts: { registry: 0, configGpa: 0, enriched: 0, verified: 0, notFound: 0, rpcUnavailable: 0, notChecked: 0 },
        cached: false,
        cacheTtlSec: 45,
        cacheAgeMs: 0,
        cluster: "unknown",
        rpcStatus: "unavailable",
      });
      setRemote([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = search.get("tab");
    if (isTabId(t)) setTab(t);
    const demo = search.get("demo");
    if (demo === "1" || demo === "true") setShowExamples(true);
  }, [search]);

  useEffect(() => {
    setLocal(listLaunches().map(launchToOffering));
    void loadRemote();
  }, [loadRemote]);

  function selectTab(id: TabId) {
    setTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    router.replace(url.pathname + url.search, { scroll: false });
  }

  function toggleExamples(next: boolean) {
    setShowExamples(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("demo", "1");
    else url.searchParams.delete("demo");
    router.replace(url.pathname + url.search, { scroll: false });
  }

  const items = useMemo(() => {
    const demo = showExamples ? filterOfferings(tab) : [];
    // Prefer remote (shared) over local when same pool; local fills gaps.
    let merged: DemoOffering[] = [...remote, ...local, ...demo];
    const seen = new Set<string>();
    merged = merged.filter((o) => {
      const key = o.pool ?? o.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (tab === "raising") {
      merged = merged.filter(
        (o) => o.status === "raising" || o.status === "new" || o.status === "complete",
      );
    } else if (tab === "graduated") {
      merged = merged.filter((o) => o.status === "graduated");
    } else if (tab === "new") {
      const cutoff = Date.now() - 48 * 60 * 60 * 1000;
      merged = merged.filter(
        (o) =>
          new Date(o.createdAt).getTime() > cutoff ||
          local.some((l) => l.id === o.id) ||
          remote.some((r) => r.id === o.id),
      );
    } else {
      merged = [...merged].sort((a, b) => {
        const ap = a.quoteProgress ?? (a.raiseTarget > 0 ? a.raised / a.raiseTarget : 0);
        const bp = b.quoteProgress ?? (b.raiseTarget > 0 ? b.raised / b.raiseTarget : 0);
        if (bp !== ap) return bp - ap;
        return (
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
      });
    }

    if (sector !== "all") {
      merged = merged.filter((o) => o.sector === sector);
    }
    if (q.trim()) {
      const s = q.toLowerCase();
      merged = merged.filter(
        (o) =>
          o.name.toLowerCase().includes(s) ||
          o.ticker.toLowerCase().includes(s) ||
          (o.pool ?? "").toLowerCase().includes(s),
      );
    }
    return merged;
  }, [tab, q, sector, local, remote, showExamples]);

  const liveCount = useMemo(() => {
    const keys = new Set<string>();
    for (const o of [...remote, ...local]) {
      if (o.pool) keys.add(o.pool);
    }
    return keys.size;
  }, [remote, local]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-fg-primary">
            Explore offerings
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {exploreMeta?.label ??
              "EquiCurve registry (not a full chain indexer)"}
            {" · "}
            shared discovery + this browser’s localStorage
            {liveCount > 0 && (
              <span className="text-accent"> · {liveCount} live</span>
            )}
            {exploreMeta?.counts != null && (
              <span className="text-fg-muted">
                {" "}
                · registry {exploreMeta.counts.registry}
                {exploreMeta.counts.configGpa > 0 &&
                  ` · config GPA ${exploreMeta.counts.configGpa}`}
              </span>
            )}
          </p>
          {exploreMeta && (
            <p className="mt-1 text-xs text-fg-muted">
              Cluster <span className="font-mono">{exploreMeta.cluster}</span> · RPC{" "}
              <span
                className={clsx(
                  exploreMeta.rpcStatus === "ok" && "text-accent",
                  exploreMeta.rpcStatus === "degraded" && "text-signal-warn",
                  exploreMeta.rpcStatus === "unavailable" && "text-signal-danger",
                )}
              >
                {exploreMeta.rpcStatus === "idle" ? "not queried" : exploreMeta.rpcStatus}
              </span>{" "}
              · verified {exploreMeta.counts.verified} · not found {exploreMeta.counts.notFound} · RPC
              unavailable {exploreMeta.counts.rpcUnavailable} · not checked{" "}
              {exploreMeta.counts.notChecked}
              {exploreMeta.cached &&
                ` · cached ${Math.round(exploreMeta.cacheAgeMs / 1000)}s (TTL ${exploreMeta.cacheTtlSec}s)`}
              . Status is shown as verified only when the pool was read on-chain.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="ec-btn-secondary text-xs"
            disabled={loading}
            onClick={() => void loadRemote(true)}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <input
            className="ec-input max-w-xs"
            placeholder="Search name, ticker, or pool"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {loading && (
        <p className="text-sm text-fg-muted">Loading shared discovery…</p>
      )}
      {exploreMeta?.warning && (
        <p className="rounded-input border border-signal-warn/30 bg-signal-warn/5 px-3 py-2 text-xs text-signal-warn">
          {exploreMeta.warning}
        </p>
      )}
      {exploreMeta?.error && (
        <p className="rounded-input border border-signal-danger/30 bg-signal-danger/5 px-3 py-2 text-xs text-signal-danger">
          Discovery error: {exploreMeta.error}. Local launches still shown.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <label className="flex cursor-pointer items-center gap-2 text-xs text-fg-secondary">
          <input
            type="checkbox"
            checked={showExamples}
            onChange={(e) => toggleExamples(e.target.checked)}
          />
          Show examples (illustrative · not live pools)
        </label>
      </div>

      {showExamples && (
        <p className="rounded-input border border-signal-warn/30 bg-signal-warn/5 px-3 py-2 text-xs text-signal-warn">
          Example cards are static fiction for UI layout. They have no pool or
          mint — trade is disabled. Real markets come from Create launches
          (registry + local).
        </p>
      )}

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

      {!loading && items.length === 0 ? (
        <div className="ec-card flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-fg-secondary">
            {showExamples
              ? "No offerings in this view."
              : "No shared or local launches yet."}
          </p>
          <Link href="/create" className="ec-btn-primary">
            Create an equity offering
          </Link>
          {!showExamples && (
            <button
              type="button"
              className="text-sm text-accent hover:underline"
              onClick={() => toggleExamples(true)}
            >
              Or show illustrative examples
            </button>
          )}
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

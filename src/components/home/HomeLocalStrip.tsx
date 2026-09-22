"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OfferingCard } from "@/components/ui/OfferingCard";
import type { DemoOffering } from "@/lib/demo/offerings";
import { listLaunches, type StoredLaunch } from "@/lib/local/launches";

function toCard(l: StoredLaunch): DemoOffering {
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
  };
}

export function HomeLocalStrip() {
  const [launches, setLaunches] = useState<StoredLaunch[]>([]);

  useEffect(() => {
    setLaunches(listLaunches());
  }, []);

  const graduated = launches.filter((l) => l.status === "graduated").length;
  const raising = launches.filter((l) => l.status !== "graduated").length;
  const featured = launches.slice(0, 3).map(toCard);

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Launches in this browser",
            value: String(launches.length),
          },
          { label: "Raising", value: String(raising) },
          { label: "Graduated", value: String(graduated) },
          { label: "Official presets", value: "4" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-pill border border-line bg-elevated px-5 py-3 text-center sm:text-left"
          >
            <p className="font-mono text-lg text-fg-primary">{s.value}</p>
            <p className="text-xs text-fg-muted">{s.label}</p>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-fg-primary">
              Your launches
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Your browser launches — Explore also merges the shared EquiCurve registry.
            </p>
          </div>
          <Link href="/explore" className="text-sm text-accent hover:underline">
            Explore
          </Link>
        </div>
        {featured.length === 0 ? (
          <div className="ec-card flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-fg-secondary">
              No local launches yet. Create a Short raise to populate Explore and
              demo graduation.
            </p>
            <Link href="/create?preset=short" className="ec-btn-primary shrink-0">
              Create offering
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {featured.map((o) => (
              <OfferingCard key={o.id} offering={o} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

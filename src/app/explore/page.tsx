"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { OfferingCard } from "@/components/ui/OfferingCard";
import { filterOfferings } from "@/lib/demo/offerings";
import { clsx } from "clsx";

const TABS = [
  { id: "trending", label: "Trending" },
  { id: "new", label: "New" },
  { id: "raising", label: "Raising" },
  { id: "graduated", label: "Graduated" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function ExplorePage() {
  const [tab, setTab] = useState<TabId>("trending");
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string>("all");

  const items = useMemo(() => {
    let list = filterOfferings(tab);
    if (sector !== "all") {
      list = list.filter((o) => o.sector === sector);
    }
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(s) ||
          o.ticker.toLowerCase().includes(s),
      );
    }
    return list;
  }, [tab, q, sector]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-fg-primary">
            Explore offerings
          </h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Equity / RWA discovery without casino chrome. Progress from real
            raise %, not HOT PnL tickers.
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
            onClick={() => setTab(t.id)}
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

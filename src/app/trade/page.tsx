"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { listLaunches } from "@/lib/local/launches";
import { useEffect } from "react";

export default function TradeIndexPage() {
  const [pool, setPool] = useState("");
  const [locals, setLocals] = useState<{ pool: string; ticker: string }[]>([]);
  const router = useRouter();

  useEffect(() => {
    setLocals(
      listLaunches().map((l) => ({ pool: l.pool, ticker: l.ticker })),
    );
  }, []);

  return (
    <div className="mx-auto max-w-xl space-y-8 py-6 sm:py-12">
      <div>
        <p className="ec-eyebrow mb-3">Your next position</p>
        <h1 className="ec-page-title">Open a market.</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Enter a DBC pool address to view the market and review a swap quote.
        </p>
      </div>
      <form
        className="ec-card space-y-4 p-6 sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (pool.trim()) router.push(`/trade/${pool.trim()}`);
        }}
      >
        <label htmlFor="trade-pool" className="ec-label block">Pool address</label>
        <input
          id="trade-pool"
          value={pool}
          onChange={(e) => setPool(e.target.value)}
          placeholder="Paste a Solana pool address"
          className="ec-input font-mono"
        />
        <button type="submit" className="ec-btn-primary w-full">
          Open market
        </button>
        <p className="text-center text-xs text-fg-muted">Looking for a market? <Link href="/explore" className="text-accent hover:underline">Explore offerings →</Link></p>
      </form>
      {locals.length > 0 && (
        <div className="ec-card space-y-2 p-4">
          <p className="text-xs text-fg-muted">Local launches</p>
          {locals.map((l) => (
            <Link
              key={l.pool}
              href={`/trade/${l.pool}`}
              className="block rounded-input border border-line bg-subtle px-3 py-2 text-sm hover:border-accent/40"
            >
              <span className="text-fg-primary">${l.ticker}</span>
              <span className="ml-2 font-mono text-xs text-fg-muted">
                {l.pool.slice(0, 12)}…
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

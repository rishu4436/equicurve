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
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-fg-primary">Trade</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Enter a DBC virtual pool address to quote and swap on the bonding
          curve — teal ticket, not casino chrome.
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (pool.trim()) router.push(`/trade/${pool.trim()}`);
        }}
      >
        <input
          value={pool}
          onChange={(e) => setPool(e.target.value)}
          placeholder="Pool pubkey"
          className="ec-input font-mono"
        />
        <button type="submit" className="ec-btn-primary w-full">
          Open market
        </button>
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
              <span className="ml-2 font-mono text-[10px] text-fg-muted">
                {l.pool.slice(0, 12)}…
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

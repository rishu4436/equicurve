"use client";

import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { QUOTE_MAX_AGE_MS } from "@/lib/trade/quoteFreshness";

export type SwapReviewRow = { label: string; value: string; strong?: boolean; hint?: string };

/**
 * Pre-sign swap summary shared by the DBC curve ticket and the DAMM v2
 * ticket. Every number is formatted from exact atoms; the tx being signed was
 * built from exactly this quote. The age counter tells the user when a
 * re-quote will be forced before signing.
 */
export function SwapReview({
  title,
  rows,
  notices,
  quotedAt,
  busy,
  onConfirm,
  onCancel,
  confirmLabel,
}: {
  title: string;
  rows: SwapReviewRow[];
  notices?: { tone: "info" | "warn"; text: string }[];
  quotedAt: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const age = Math.max(0, Math.floor((now - quotedAt) / 1000));
  const willRequote = now - quotedAt > QUOTE_MAX_AGE_MS;

  return (
    <div className="mt-3 rounded-input border border-accent/30 bg-accent/5 p-3 text-xs" data-testid="swap-review">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold text-fg-primary">{title}</p>
        <span className={clsx("font-mono text-[10px]", willRequote ? "text-signal-warn" : "text-fg-muted")}>
          quoted {age}s ago{willRequote ? " · will re-quote before signing" : ""}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-fg-muted">{r.label}</dt>
            <dd className={clsx("text-right font-mono", r.strong ? "text-sm text-accent-soft" : "text-fg-primary")}>
              {r.value}
              {r.hint && <span className="block text-[10px] font-sans text-fg-muted">{r.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {notices?.map((n) => (
        <p
          key={n.text}
          className={clsx(
            "mt-2 rounded-input px-2 py-1.5",
            n.tone === "warn" ? "border border-signal-warn/30 bg-signal-warn/10 text-signal-warn" : "bg-subtle text-fg-secondary",
          )}
        >
          {n.text}
        </p>
      ))}
      <p className="mt-2 text-[10px] text-fg-muted">
        Estimated output is not a guarantee; the minimum output is enforced on-chain and the swap reverts below it.
        Quotes older than {QUOTE_MAX_AGE_MS / 1000}s, or made against a pool that has since changed, are refreshed and
        must be confirmed again.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="ec-btn-secondary flex-1" onClick={onCancel} disabled={busy}>
          Edit
        </button>
        <button type="button" className="ec-btn-primary flex-1" onClick={onConfirm} disabled={busy}>
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}

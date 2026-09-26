"use client";

import { clsx } from "clsx";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/constants";
import { RECEIPT_STATE_LABEL, type LaunchReceipt, type ReceiptState } from "@/lib/dbc/receipt";

const TONE: Record<ReceiptState, string> = {
  confirmed: "border-signal-grad/40 bg-signal-grad/10 text-signal-grad",
  pending: "border-accent/40 bg-accent/10 text-accent-soft",
  estimate: "border-signal-warn/40 bg-signal-warn/10 text-signal-warn",
  failed: "border-signal-danger/40 bg-signal-danger/10 text-signal-danger",
  local: "border-line bg-subtle text-fg-muted",
};

export function ReceiptBadge({ state }: { state: ReceiptState }) {
  return (
    <span className={clsx("shrink-0 rounded-pill border px-2 py-0.5 text-[10px] font-medium", TONE[state])}>
      {RECEIPT_STATE_LABEL[state]}
    </span>
  );
}

/**
 * Launch receipt: every address / signature with an explorer link for the
 * active cluster and an explicit state. "confirmed" = read back from chain
 * (or tx confirmed); "pending" = submitted / not read yet; "estimate" =
 * derived or computed, not proven on-chain; "local only" = this browser.
 */
export function LaunchReceiptCard({ receipt }: { receipt: LaunchReceipt }) {
  return (
    <div className="ec-card space-y-2 border-accent/40 p-4 text-xs" data-testid="launch-receipt">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-fg-primary">Launch receipt</p>
        <span className="font-mono text-[10px] text-fg-muted">{receipt.cluster}</span>
      </div>
      <ul className="divide-y divide-line">
        {receipt.items.map((it) => (
          <li key={it.key} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className="text-fg-muted">{it.label}</p>
              {it.kind === "text" ? (
                <p className="break-all font-mono text-fg-primary">{it.value}</p>
              ) : (
                <a
                  className="break-all font-mono text-accent hover:underline"
                  href={it.kind === "tx" ? explorerTxUrl(it.value) : explorerAddressUrl(it.value)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {it.value}
                </a>
              )}
              {it.note && <p className="mt-0.5 text-[10px] text-fg-muted">{it.note}</p>}
            </div>
            <ReceiptBadge state={it.state} />
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-fg-muted">
        confirmed = transaction confirmed or account read back from chain · pending = submitted, not yet read · estimate
        = derived or computed, not proven on-chain · local only = stored in this browser.
      </p>
    </div>
  );
}

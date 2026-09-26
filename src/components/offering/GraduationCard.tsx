"use client";

import { clsx } from "clsx";
import { formatAtomsExact, tryFormatAtoms } from "@/lib/amounts";
import { explorerAddressUrl } from "@/lib/constants";
import { graduationNumbers, type DestinationCheck } from "@/lib/dbc/curveState";
import { expectedDammDestination } from "@/lib/dbc/migrate";
import type { PoolSnapshot } from "@/lib/dbc/types";

/**
 * Graduation-central summary for a live DBC pool: exact threshold, reserve,
 * remaining (bigint, quote units), progress, and the DAMM v2 destination —
 * "expected" (derived) until the account is fetched, "verified" after.
 * Unknown reads render as unknown, never 0.
 */
export function GraduationCard({
  snapshot,
  readFailed,
  destination,
  quoteLabel,
}: {
  snapshot: PoolSnapshot | null;
  readFailed: boolean;
  destination: DestinationCheck;
  quoteLabel: string;
}) {
  const nums = snapshot
    ? graduationNumbers({
        quoteReserve: snapshot.quoteReserve,
        migrationQuoteThreshold: snapshot.migrationQuoteThreshold,
        isMigrated: snapshot.isMigrated,
      })
    : { known: false as const, reason: readFailed ? "RPC read failed." : "Reading pool…" };
  const dec = snapshot?.quoteDecimals ?? null;
  const fmt = (v: bigint) => (dec == null ? "unknown" : `${formatAtomsExact(v, dec)} ${quoteLabel}`);
  const dest = snapshot ? expectedDammDestination(snapshot) : null;
  const migrated = snapshot?.curve.phase === "migrated";

  return (
    <div className="rounded-card border border-line bg-subtle/40 p-4" data-testid="graduation-card">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg-primary">Graduation</h3>
        <span className="text-[10px] text-fg-muted">
          {snapshot ? `read ${new Date(snapshot.checkedAt).toLocaleTimeString()}` : "not read"}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div>
          <dt className="text-fg-muted">Threshold</dt>
          <dd className="font-mono text-fg-primary">{nums.known ? fmt(nums.threshold) : "unknown"}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Raised on curve</dt>
          <dd className="font-mono text-fg-primary">{nums.known ? fmt(nums.reserve) : "unknown"}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Remaining (exact)</dt>
          <dd className={clsx("font-mono", nums.known && nums.complete ? "text-signal-grad" : "text-accent-soft")}>
            {nums.known ? (nums.complete ? `0 ${quoteLabel} · complete` : fmt(nums.remaining)) : "unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Progress</dt>
          <dd className="font-mono text-fg-primary">
            {nums.known ? `${(nums.progressBps / 100).toFixed(2)}%` : "unknown"}
          </dd>
        </div>
      </dl>
      {!nums.known && <p className="mt-2 text-[11px] text-signal-warn">Unknown: {nums.reason}</p>}
      {nums.known && !nums.complete && dec != null && (
        <p className="mt-2 text-[11px] text-fg-muted">
          A buy needs roughly {tryFormatAtoms(nums.remaining.toString(), dec, dec)} {quoteLabel} plus the trading fee to
          complete the curve. Larger buys are capped to what the curve can fill (partial fill); the rest stays in your
          wallet.
        </p>
      )}
      <div className="mt-3 border-t border-line pt-2 text-[11px]">
        <span className="text-fg-muted">DAMM v2 pool after graduation: </span>
        {dest ? (
          <>
            <a
              className="break-all font-mono text-accent hover:underline"
              href={explorerAddressUrl(dest.dammPool.toBase58())}
              target="_blank"
              rel="noreferrer"
            >
              {dest.dammPool.toBase58()}
            </a>{" "}
            <span
              className={clsx(
                "ml-1 rounded-pill border px-1.5 py-0.5 text-[10px]",
                migrated && destination === "exists"
                  ? "border-signal-grad/40 text-signal-grad"
                  : "border-line text-fg-muted",
              )}
            >
              {migrated && destination === "exists"
                ? "verified on-chain"
                : migrated
                  ? destination === "checking"
                    ? "checking…"
                    : "migrated · account not verified yet"
                  : "expected (derived) · not created yet"}
            </span>
          </>
        ) : (
          <span className="text-fg-muted">unknown (config not read)</span>
        )}
      </div>
      <p className="mt-2 text-[10px] text-fg-muted">
        Threshold, reserve and remaining are read from the DBC pool and config accounts. The DAMM v2 address is derived
        from the pool&apos;s migration fee option and mints; it only counts as live once the account is fetched. Price
        and output figures elsewhere are estimates, not guarantees.
      </p>
    </div>
  );
}

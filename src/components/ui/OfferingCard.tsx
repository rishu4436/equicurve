import Link from "next/link";
import type { DemoOffering } from "@/lib/demo/offerings";
import { formatLastChecked, VerificationBadge } from "./VerificationBadge";
import { ProgressRing } from "./ProgressRing";
import { StatusPill } from "./StatusPill";
import { displayStatus } from "@/lib/explore/verification";

export function OfferingCard({ offering }: { offering: DemoOffering }) {
  const illustrative = offering.illustrative || !offering.pool;
  // Live pools: progress only from on-chain reads; null = unknown (never 0%).
  const livePct =
    offering.quoteProgress == null ? null : offering.quoteProgress * 100;
  const examplePct =
    offering.raiseTarget > 0 ? (offering.raised / offering.raiseTarget) * 100 : 0;
  const pct = illustrative ? examplePct : livePct;
  const graduated = offering.status === "graduated";
  // Respect the explicit server flag; a verification label alone is not enough.
  const verified = offering.verified === true && offering.verification?.state === "verified";
  const statusUnverified = !illustrative && !verified;

  return (
    <Link
      href={`/o/${offering.pool ?? offering.id}`}
      className="ec-card group flex flex-col gap-4 p-4 transition hover:border-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-card border border-line bg-subtle font-semibold text-accent">
            {offering.ticker.slice(0, 2)}
          </div>
          <div>
            <p className="font-medium text-fg-primary">{offering.name}</p>
            <p className="font-mono text-xs text-fg-muted">${offering.ticker}</p>
          </div>
        </div>
        {graduated && verified ? (
          <div className="text-right text-xs text-signal-grad">
            Migrated
            <div className="font-mono text-fg-secondary">DBC → DAMM v2</div>
          </div>
        ) : pct == null ? (
          <div className="text-right text-[10px] text-fg-muted">
            progress
            <div className="font-mono text-sm text-fg-secondary">—</div>
          </div>
        ) : (
          <ProgressRing value={pct} size={48} stroke={4} />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="ec-chip">{offering.sector}</span>
        <span className="ec-chip">{offering.quote}</span>
        <StatusPill
          status={illustrative ? offering.status : displayStatus(offering)}
          unverified={statusUnverified}
        />
        {illustrative && (
          <span className="rounded-pill border border-signal-warn/40 bg-signal-warn/10 px-2 py-0.5 text-[10px] text-signal-warn">
            Illustrative · not live
          </span>
        )}
      </div>

      <div className="space-y-1 text-xs text-fg-secondary">
        {!graduated && illustrative && (
          <p>
            Example raised{" "}
            <span className="font-mono text-fg-primary">
              ${offering.raised.toLocaleString()}
            </span>{" "}
            / ${offering.raiseTarget.toLocaleString()}
          </p>
        )}
        {!illustrative && (
          <p>
            Curve progress{" "}
            <span className="font-mono text-fg-primary">
              {pct == null ? "unknown" : `${pct.toFixed(1)}%`}
            </span>
            {offering.raiseTarget > 0 && (
              <> · soft target ${offering.raiseTarget.toLocaleString()} (display only)</>
            )}
          </p>
        )}
        <p>
          Curve:{" "}
          <span className="capitalize text-fg-primary">{offering.presetId}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {offering.lockPct != null && offering.lockPct > 0 && (
            <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-[10px] text-fg-secondary">
              Lock ≥{offering.lockPct}%
            </span>
          )}
          {!illustrative && offering.verification && (
            <VerificationBadge verification={offering.verification} compact />
          )}
        </div>
        {!illustrative && offering.verification && (
          <p className="text-[10px] text-fg-muted">
            {offering.verification.cluster} · last checked{" "}
            {formatLastChecked(offering.verification.checkedAt)}
            {offering.statusSource === "local" && " · status from this browser"}
          </p>
        )}
      </div>
    </Link>
  );
}

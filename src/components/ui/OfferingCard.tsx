import Link from "next/link";
import type { DemoOffering } from "@/lib/demo/offerings";
import { formatLastChecked, VerificationBadge } from "./VerificationBadge";
import { StatusPill } from "./StatusPill";
import { displayStatus } from "@/lib/explore/verification";

export function OfferingCard({ offering }: { offering: DemoOffering }) {
  const illustrative = offering.illustrative || !offering.pool;
  // Unknown chain progress must remain unknown.
  const livePct = offering.quoteProgress == null ? null : offering.quoteProgress * 100;
  const examplePct = offering.raiseTarget > 0 ? (offering.raised / offering.raiseTarget) * 100 : 0;
  const pct = illustrative ? examplePct : livePct;
  const graduated = offering.status === "graduated";
  const verified = offering.verified === true && offering.verification?.state === "verified";
  const statusUnverified = !illustrative && !verified;

  return (
    <Link href={`/o/${offering.pool ?? offering.id}`} className="ec-surface-link group flex min-w-0 flex-col p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 text-lg font-medium text-accent">{offering.ticker.slice(0, 2)}</div>
          <div className="min-w-0"><h2 className="truncate text-lg font-medium tracking-tight">{offering.name}</h2><p className="mt-0.5 font-mono text-xs text-fg-muted">${offering.ticker}</p></div>
        </div>
        <span aria-hidden="true" className="text-fg-muted transition-colors group-hover:text-accent">↗</span>
      </div>
      <p className="mb-5 mt-4 line-clamp-2 min-h-10 text-sm leading-relaxed text-fg-secondary">{offering.thesis}</p>
      <div className="mb-5 flex flex-wrap gap-2">
        <StatusPill status={illustrative ? offering.status : displayStatus(offering)} unverified={statusUnverified} />
        <span className="ec-chip">{offering.sector}</span>
        {illustrative && <span className="ec-chip !border-signal-warn/30 !text-signal-warn">Illustrative · not live</span>}
        {offering.deploymentVerified && <span className="ec-chip !border-accent/30 !text-accent">Deployment verified</span>}
      </div>
      <div className="mt-auto rounded-xl border border-line bg-base/40 p-4">
        <div className="flex justify-between gap-3 text-xs"><span className="text-fg-muted">{graduated && verified ? "Migrated to DAMM v2" : "Curve progress"}</span><span className="tabular-nums text-fg-primary">{pct == null ? "Unknown" : `${pct.toFixed(1)}%`}</span></div>
        <div className="my-3 h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden="true">{pct != null && <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />}</div>
        <div className="flex justify-between text-xs"><span className="capitalize text-fg-secondary">{offering.presetId} curve</span><span className="text-fg-muted">{offering.quote}{offering.lockPct != null && offering.lockPct > 0 && ` · Lock ≥${offering.lockPct}%`}</span></div>
        {!graduated && illustrative && <p className="mt-2 text-xs text-fg-muted">Example raised ${offering.raised.toLocaleString()} / ${offering.raiseTarget.toLocaleString()}</p>}
        {!illustrative && offering.raiseTarget > 0 && <p className="mt-2 text-xs text-fg-muted">Soft target ${offering.raiseTarget.toLocaleString()} · display only</p>}
      </div>
      {!illustrative && offering.verification && <div className="mt-4 space-y-2"><VerificationBadge verification={offering.verification} compact /><p className="text-xs text-fg-muted">{offering.verification.cluster} · checked {formatLastChecked(offering.verification.checkedAt)}{offering.statusSource === "local" && " · status from this browser"}</p></div>}
    </Link>
  );
}

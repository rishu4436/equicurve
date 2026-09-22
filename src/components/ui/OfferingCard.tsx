import Link from "next/link";
import type { DemoOffering } from "@/lib/demo/offerings";
import { ProgressRing } from "./ProgressRing";
import { StatusPill } from "./StatusPill";

export function OfferingCard({ offering }: { offering: DemoOffering }) {
  const pct =
    offering.raiseTarget > 0
      ? (offering.raised / offering.raiseTarget) * 100
      : 0;
  const graduated = offering.status === "graduated";

  return (
    <Link
      href={`/o/${offering.id}`}
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
        {graduated ? (
          <div className="text-right text-xs text-signal-grad">
            DAMM v2
            <div className="font-mono text-fg-secondary">
              depth ${(offering.raised / 1000).toFixed(0)}k
            </div>
          </div>
        ) : (
          <ProgressRing value={pct} size={48} stroke={4} />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span className="ec-chip">{offering.sector}</span>
        <span className="ec-chip">{offering.quote}</span>
        <StatusPill status={offering.status} />
      </div>

      <div className="space-y-1 text-xs text-fg-secondary">
        {!graduated && (
          <p>
            Raised{" "}
            <span className="font-mono text-fg-primary">
              ${offering.raised.toLocaleString()}
            </span>{" "}
            / ${offering.raiseTarget.toLocaleString()}
          </p>
        )}
        <p>
          Curve: <span className="capitalize text-fg-primary">{offering.presetId}</span>
          {" · "}Fees {(offering.feeBps / 100).toFixed(2)}%
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          {offering.verified && (
            <span className="rounded-pill border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
              Verified
            </span>
          )}
          <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-[10px] text-fg-secondary">
            Lock ≥{offering.lockPct}%
          </span>
        </div>
      </div>
    </Link>
  );
}

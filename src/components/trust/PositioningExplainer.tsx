import { EXPLAINER, NOT_A_SECURITIES_PLATFORM, POSITIONING } from "@/lib/positioning";

/** Three-part explainer: what is on-chain vs issuer-legal vs off-chain verification. */
export function PositioningExplainer({ compact = false, showPositioning = true }: { compact?: boolean; showPositioning?: boolean }) {
  return (
    <section className="space-y-4" data-testid="positioning-explainer" id="what-equicurve-is">
      {showPositioning && (
        <div>
          <h2 className="text-2xl font-semibold text-fg-primary">What EquiCurve is (and isn&apos;t)</h2>
          <p className="mt-1 max-w-3xl text-sm text-fg-secondary">{POSITIONING}</p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {EXPLAINER.map((e, i) => (
          <div key={e.id} className="ec-card p-5">
            <p className="font-mono text-xs text-accent">{i + 1}</p>
            <h3 className="mt-1 font-semibold text-fg-primary">{e.title}</h3>
            <p className="text-xs uppercase tracking-wider text-fg-muted">{e.who}</p>
            <p className="mt-2 text-sm text-fg-secondary">{e.body}</p>
            {!compact && (
              <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-fg-muted">
                {e.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="max-w-3xl text-xs text-fg-muted">{NOT_A_SECURITIES_PLATFORM}</p>
    </section>
  );
}

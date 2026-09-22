import Link from "next/link";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { CURVE_PRESETS } from "@/lib/dbc/presets";

export default function PresetsPage() {
  const official = CURVE_PRESETS.filter((p) =>
    ["short", "flat", "exponential", "long"].includes(p.id),
  );
  const extra = CURVE_PRESETS.filter((p) => p.id === "equity");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-fg-primary">
          Curve &amp; fee presets
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-fg-secondary">
          Official templates built with Meteora{" "}
          <code className="text-accent-soft">buildCurveWithMarketCap</code>.
          Use <strong className="text-fg-primary">Short raise</strong> when you
          need a low migration market cap to demo graduation. Community
          marketplace publishing is v1.1.
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <span className="ec-chip border-accent/40 text-accent">Official</span>
        <span className="ec-chip opacity-50">Community (soon)</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {official.map((p) => (
          <div key={p.id} className="ec-card flex flex-col p-5">
            <CurveMiniViz preset={p.id} className="mb-3 h-14 w-full" />
            <h2 className="text-lg font-semibold text-fg-primary">{p.name}</h2>
            <p className="text-sm text-accent-soft">{p.tagline}</p>
            <p className="mt-3 flex-1 text-sm text-fg-secondary">
              {p.description}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-fg-muted">
              <div>
                <dt>Initial MC</dt>
                <dd className="font-mono text-fg-primary">
                  ${p.initialMarketCap.toLocaleString()}
                </dd>
              </div>
              <div>
                <dt>Migration MC</dt>
                <dd className="font-mono text-fg-primary">
                  ${p.migrationMarketCap.toLocaleString()}
                </dd>
              </div>
              <div className="col-span-2">
                <dt>Fees</dt>
                <dd className="text-fg-primary">{p.feeLabel}</dd>
              </div>
            </dl>
            <Link
              href={`/create?step=curve&preset=${p.id}`}
              className="ec-btn-primary mt-5 w-full"
            >
              Use in Create
            </Link>
          </div>
        ))}
      </div>

      {extra.map((p) => (
        <div
          key={p.id}
          className="ec-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="text-xs uppercase tracking-wider text-gold">
              EquiCurve equity
            </p>
            <h2 className="text-lg font-semibold text-fg-primary">{p.name}</h2>
            <p className="text-sm text-fg-secondary">{p.description}</p>
          </div>
          <Link
            href={`/create?step=curve&preset=${p.id}`}
            className="ec-btn-secondary shrink-0"
          >
            Use Equity-tuned
          </Link>
        </div>
      ))}
    </div>
  );
}

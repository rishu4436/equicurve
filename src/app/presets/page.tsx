import Link from "next/link";
import {
  IssuerFaq,
  PresetFacts,
  PresetShapeNote,
  presetThresholdLabel,
} from "@/components/issuer/IssuerAnswers";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { CURVE_PRESETS, FEE_BY_PRESET, presetPriceMultiple } from "@/lib/dbc/presets";

export default function PresetsPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-fg-primary">Curve &amp; fee presets</h1>
        <p className="mt-2 max-w-3xl text-sm text-fg-secondary">
          Templates built with Meteora <code className="text-accent-soft">buildCurveWithMarketCap</code>, the same builder
          Create uses. Market caps are in <strong className="text-fg-primary">quote-token units</strong> (SOL or USDC),
          not dollars, and each quote has its own caps so a SOL raise has a sensible SOL threshold. Thresholds below
          are the exact <code>migrationQuoteThreshold</code> each preset produces.
        </p>
        <div className="mt-3 max-w-3xl">
          <PresetShapeNote />
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-xs" data-testid="preset-table">
          <thead className="text-fg-muted">
            <tr className="border-b border-line">
              <th className="py-2 pr-3">Preset</th>
              <th className="py-2 pr-3">Price range</th>
              <th className="py-2 pr-3">Raise before graduation · SOL quote</th>
              <th className="py-2 pr-3">Raise before graduation · USDC quote</th>
              <th className="py-2 pr-3">Fee schedule</th>
              <th className="py-2">Creator share of fee*</th>
            </tr>
          </thead>
          <tbody className="text-fg-secondary">
            {CURVE_PRESETS.map((p) => (
              <tr key={p.id} className="border-b border-line/60">
                <td className="py-2 pr-3 font-semibold text-fg-primary">{p.name}</td>
                <td className="py-2 pr-3 font-mono">{presetPriceMultiple(p.id)}×</td>
                <td className="py-2 pr-3 font-mono">{presetThresholdLabel(p.id, "SOL")}</td>
                <td className="py-2 pr-3 font-mono">{presetThresholdLabel(p.id, "USDC")}</td>
                <td className="py-2 pr-3">{p.feeLabel}</td>
                <td className="py-2 font-mono">{FEE_BY_PRESET[p.id].creatorTradingFeePercentage}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[10px] text-fg-muted">
          *Of the 80% left after Meteora&apos;s 20% protocol fee; partner / fee claimer gets the rest. Editable in Create.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {CURVE_PRESETS.map((p) => (
          <div key={p.id} className="ec-card flex flex-col p-5" id={p.id}>
            <CurveMiniViz preset={p.id} className="mb-3 h-14 w-full" />
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-fg-primary">{p.name}</h2>
              {p.id === "equity" && <span className="text-[10px] uppercase tracking-wider text-gold">EquiCurve default</span>}
            </div>
            <p className="text-sm text-accent-soft">{p.tagline}</p>
            <p className="mt-2 text-sm text-fg-secondary">{p.description}</p>
            <div className="mt-4 flex-1">
              <PresetFacts id={p.id} quote="SOL" />
            </div>
            <p className="mt-2 text-[10px] text-fg-muted">
              Shown for SOL quote. USDC quote: {presetThresholdLabel(p.id, "USDC")} before graduation.
            </p>
            <Link href={`/create?step=curve&preset=${p.id}`} className="ec-btn-primary mt-5 w-full">
              Use in Create
            </Link>
          </div>
        ))}
      </div>

      <section className="ec-card space-y-3 p-5">
        <h2 className="font-semibold text-fg-primary">Issuer questions</h2>
        <IssuerFaq lockPct={null} creatorPct={null} />
      </section>
    </div>
  );
}

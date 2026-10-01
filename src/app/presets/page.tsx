import Link from "next/link";
import {
  IssuerFaq,
  PresetFacts,
  PresetShapeNote,
  presetThresholdLabel,
} from "@/components/issuer/IssuerAnswers";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { formatAtomsExact } from "@/lib/amounts";
import { CURVE_PRESETS, FEE_BY_PRESET, presetPriceMultiple } from "@/lib/dbc/presets";
import { designPolicy } from "@/lib/market/policy";

function illustrativePolicy() {
  try {
    return designPolicy({
      asset: "private-company",
      objective: "controlled-discovery",
      quote: "SOL",
      targetRaise: "100",
      typicalTrade: "1",
      participants: 12,
      stressPaths: 4,
      seed: 0xec0c,
    });
  } catch {
    return null;
  }
}

export default function PresetsPage() {
  const sample = illustrativePolicy();
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-fg-primary">Market designs</h1>
        <p className="mt-2 max-w-3xl text-sm text-fg-secondary">
          A launch design is a real Meteora config: fee schedule, market caps, creator fee, and LP lock. The table
          below is one labelled simulation, not a ranking of live launches. Fee-schedule seeds further down are the
          templates the search builds from. EquiCurve does not create shares and does not verify NAV or custody.
        </p>
        <div className="mt-3 max-w-3xl">
          <PresetShapeNote />
        </div>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-fg-primary">Illustrative brief, synthetic evidence</h2>
        <p className="max-w-3xl text-sm text-fg-secondary">
          Private-company profile, controlled discovery, 100 SOL raise, 1 SOL typical order, 12 participants, 4 cohort
          paths, seed {sample?.seed ?? "—"}. Every metric here is simulated. There is no observed launch record on this
          page.{" "}
          {sample
            ? `The leading row is the preferred feasible design among ${sample.search.candidateCount} candidates evaluated (price multiples ${sample.search.multiples.join(", ")}). It is not a proof that no better curve exists.`
            : "The search reports the preferred feasible design among the candidates it evaluates. It is not a proof that no better curve exists."}{" "}
          Illustrative layout, not live results.
        </p>
        {sample ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs" data-testid="design-sample">
              <thead className="text-fg-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3">Design</th>
                  <th className="py-2 pr-3">Typical impact</th>
                  <th className="py-2 pr-3">Whale impact</th>
                  <th className="py-2 pr-3">Retail fill</th>
                  <th className="py-2 pr-3">Graduation (synthetic)</th>
                  <th className="py-2 pr-3">Threshold</th>
                  <th className="py-2">Fee model</th>
                </tr>
              </thead>
              <tbody className="text-fg-secondary">
                {sample.candidates.map((row) => {
                  const whale = row.scenarios.find((s) => s.id === "whale");
                  const retail = row.scenarios.find((s) => s.id === "retail");
                  return (
                    <tr key={row.profileId} className="border-b border-line/60">
                      <td className="py-2 pr-3 font-semibold text-fg-primary">
                        {row.profileName}
                        <span className="block text-[10px] font-normal text-fg-muted">
                          {row.score > 0 ? "On the frontier" : "Not on the frontier"}
                          {row.feasible ? "" : " · constraint failed"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono">{row.reference.impactBps} bps</td>
                      <td className="py-2 pr-3 font-mono">{whale?.largestBuyImpactBps ?? "—"} bps</td>
                      <td className="py-2 pr-3 font-mono">{retail ? `${Math.round(retail.progress * 1000) / 10}%` : "—"}</td>
                      <td className="py-2 pr-3 font-mono">{Math.round(row.stressGraduationRate * 1000) / 10}%</td>
                      <td className="py-2 pr-3 font-mono">{formatAtomsExact(row.thresholdAtoms, 9)} SOL</td>
                      <td className="py-2">{row.dynamicFeeStatus}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-1 text-[10px] text-fg-muted">
              Policy {sample.policyId}. {sample.observedNote} No usage counts are shown because none have been read from
              chain.
            </p>
          </div>
        ) : (
          <p className="text-sm text-signal-warn">The illustrative search did not produce a policy. The fee seeds below are still real templates.</p>
        )}
        <Link href="/create?step=design" className="ec-btn-primary inline-flex">
          Design a market
        </Link>
      </section>

      <h2 className="text-lg font-semibold text-fg-primary">Fee-schedule seeds</h2>

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
            <Link href={`/create?step=design&preset=${p.id}`} className="ec-btn-primary mt-5 w-full">
              Design with this fee schedule available
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

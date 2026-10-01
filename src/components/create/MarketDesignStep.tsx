"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatAtomsExact } from "@/lib/amounts";
import { getOptionalPoolConfigKey } from "@/lib/constants";
import { toUserMessage } from "@/lib/errors";
import { scenarioAssumptions } from "@/lib/market/constraints";
import { designPolicy, toDesignedMarket } from "@/lib/market/policy";
import type { CandidateReport, LaunchPolicy, ScenarioTracePoint } from "@/lib/market/types";
import type { WizardState } from "./wizardTypes";

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function scenario(row: CandidateReport, id: CandidateReport["scenarios"][number]["id"]) {
  return row.scenarios.find((s) => s.id === id);
}

function feeStatusLabel(status: CandidateReport["dynamicFeeStatus"]): string {
  if (status === "simulated") return "dynamic fee simulated";
  if (status === "base-only") return "dynamic fee only partially modeled";
  return "dynamic fee not used";
}

function briefKey(state: WizardState): string {
  return [
    state.feeIssuer,
    state.lpLockPct,
    state.antiSniper,
    state.targetRaise,
    state.typicalTrade,
    state.participants,
    state.assetKind,
    state.objective,
    state.quote,
    state.totalSupply,
    state.stressPaths,
  ].join("|");
}

const CHART_COLORS = ["#7c6bf2", "#e2b657", "#3dbe8c"];

function PathChart({
  series,
  mode,
}: {
  series: { name: string; points: ScenarioTracePoint[] }[];
  mode: "price" | "progress";
}) {
  const width = 360;
  const height = 140;
  const pad = 18;
  const points = series.flatMap((item) => item.points);
  if (points.length === 0) {
    return <p className="text-xs text-fg-muted">The pinned designs have no retail orders to chart.</p>;
  }
  const maxStep = Math.max(...points.map((point) => point.step), 1);
  const values = points.map((point) => (mode === "price" ? point.priceMoveBps : point.progress));
  let min = Math.min(...values, 0);
  let max = Math.max(...values, mode === "progress" ? 1 : 0);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const x = (step: number) => pad + ((width - pad * 2) * step) / maxStep;
  const y = (value: number) => pad + ((height - pad * 2) * (max - value)) / (max - min);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-36 w-full"
      role="img"
      aria-label={mode === "price" ? "Synthetic retail price path" : "Synthetic reserve progress"}
    >
      <line x1={pad} y1={y(0)} x2={width - pad} y2={y(0)} stroke="currentColor" strokeOpacity="0.2" />
      {series.map((item, index) => (
        <polyline
          key={item.name}
          fill="none"
          stroke={CHART_COLORS[index % CHART_COLORS.length]}
          strokeWidth="2"
          points={item.points
            .map((point) => `${x(point.step)},${y(mode === "price" ? point.priceMoveBps : point.progress)}`)
            .join(" ")}
        />
      ))}
    </svg>
  );
}

export function MarketDesignStep({
  state,
  patch,
  onDeploy,
}: {
  state: WizardState;
  patch: (p: Partial<WizardState>) => void;
  onDeploy: (presetId: WizardState["presetId"]) => void;
}) {
  const [policy, setPolicy] = useState<LaunchPolicy | null>(null);
  const [ranKey, setRanKey] = useState<string | null>(null);
  const [pins, setPins] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = getOptionalPoolConfigKey();
  const decimals = state.quote === "USDC" ? 6 : 9;
  const assumptions = scenarioAssumptions(state.assetKind);
  const currentKey = briefKey(state);
  const stale = policy != null && ranKey !== currentKey;

  function run() {
    setRunning(true);
    setError(null);
    const key = briefKey(state);
    window.setTimeout(() => {
      try {
        const next = designPolicy({
          asset: state.assetKind,
          objective: state.objective,
          quote: state.quote,
          targetRaise: state.targetRaise,
          typicalTrade: state.typicalTrade,
          participants: state.participants,
          totalSupply: state.totalSupply,
          creatorPct: state.feeIssuer,
          lpLockPct: state.lpLockPct,
          antiSniper: state.antiSniper,
          stressPaths: state.stressPaths,
        });
        setPolicy(next);
        setRanKey(key);
        setPins(
          next.candidates
            .filter((row) => row.score > 0)
            .slice(0, 2)
            .map((row) => row.profileId),
        );
      } catch (e) {
        const message = toUserMessage(e);
        setError(message);
        setPolicy(null);
        setRanKey(null);
        toast.error(message);
      } finally {
        setRunning(false);
      }
    }, 30);
  }

  function togglePin(id: string) {
    setPins((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }

  function deploy(row: CandidateReport) {
    if (!policy || stale) return;
    const designed = toDesignedMarket(policy, row);
    const picked =
      row.profileId === policy.chosen.profileId
        ? `Selected ${row.profileName}. This is the preferred feasible design among ${policy.search.candidateCount} candidates evaluated for this objective.`
        : `Selected ${row.profileName}. The preferred design for this objective was ${policy.chosen.profileName}.`;
    patch({
      presetId: row.recipe.presetId,
      marketCaps: {
        initial: row.recipe.initialMarketCap,
        migration: row.recipe.migrationMarketCap,
      },
      designed,
      designWhy: [picked, ...policy.why, ...row.rejected.map((reason) => `Constraint: ${reason}`)],
      designLimits: policy.limits,
    });
    onDeploy(row.recipe.presetId);
  }

  const pinned = (policy ? pins.map((id) => policy.candidates.find((row) => row.profileId === id)) : []).filter(
    (row): row is CandidateReport => row != null,
  );
  const chartSeries = pinned.map((row) => ({
    name: row.profileName,
    points: scenario(row, "retail")?.trace ?? [],
  }));

  return (
    <section className="space-y-4">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">EquiCurve · Market design</p>
        <h1 className="text-2xl font-semibold text-fg-primary">Compare candidate policies</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Research mode. The search keeps configs that pass the hard constraints, then prefers one feasible design among
          the candidates it evaluated. Asset kind is a market-design assumption, not a legal claim. The row you deploy is
          the config the wallet will sign.
        </p>
      </header>

      <div className="ec-card space-y-2 p-4 text-xs text-fg-secondary">
        <p>
          Brief: {state.assetKind} · {state.objective} · raise {state.targetRaise} {state.quote} · typical order{" "}
          {state.typicalTrade} {state.quote} · {state.participants} participants · creator fee {state.feeIssuer}% · LP
          lock {state.lpLockPct}% · anti-sniper {state.antiSniper ? "on" : "off"}
        </p>
        <p>
          Whale orders in the named scenario are {assumptions.whaleMultiple}× a typical order, five buys at launch. The
          sell-pressure path sells {assumptions.sellFractionBps / 100}% of the base that path holds. Cohort retail orders
          scale with the participant count and stop at 64. That is a representative sample, not one order per participant.
        </p>
        <label className="flex flex-wrap items-center gap-2 text-fg-primary">
          Cohort paths
          <select
            className="rounded-input border border-line bg-base px-2 py-1 text-xs"
            value={state.stressPaths === 32 ? 32 : 8}
            onChange={(event) => patch({ stressPaths: Number(event.target.value) })}
          >
            <option value={8}>Quick preview · 8 paths</option>
            <option value={32}>Thorough run · 32 paths</option>
          </select>
        </label>
        <p>
          {state.stressPaths} cohort paths will be simulated. Eight paths are a quick preview. Thirty-two paths are a
          more thorough sample. Neither number is large enough to support a claim about real-world reliability.
        </p>
        {shared && (
          <p className="text-signal-warn">
            NEXT_PUBLIC_POOL_CONFIG_KEY is set. A shared config cannot deploy a searched curve. Unset it before you
            sign, or the launch will refuse to build.
          </p>
        )}
      </div>

      <div className="ec-card space-y-1 p-4 text-xs text-fg-secondary">
        <p className="font-medium text-fg-primary">What each metric means</p>
        <p>Typical impact: the opening buy of {state.typicalTrade} {state.quote} on an empty curve, in basis points.</p>
        <p>
          Whale impact: five buys of {assumptions.whaleMultiple}× {state.typicalTrade} {state.quote} at launch. The figure
          is the largest of those price moves.
        </p>
        <p>Sell drawdown: the price move from the path&apos;s peak to its end. A negative number is a price fall, not a quote-reserve reduction.</p>
        <p>
          Retail fill: how far a capped sample of orders moved toward the migration threshold, plus how many orders ran
          against the participant count you asked for. It is not a forecast.
        </p>
        <p>Graduation rate: the share of the simulated cohort paths that reached the threshold. The path count is the sample size. It is not a real-world probability.</p>
        <p>10th percentile and worst path: cohort progress toward the threshold. With few paths the 10th percentile sits near the worst path.</p>
      </div>

      <button type="button" className="ec-btn-primary" onClick={run} disabled={running}>
        {running ? "Simulating designs…" : policy ? "Run the search again" : "Simulate market designs"}
      </button>
      {error && (
        <p className="rounded-input border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-signal-danger">
          {error}
        </p>
      )}
      {stale && (
        <p className="rounded-input border border-signal-warn/30 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn">
          The brief changed after this search. Deploy stays blocked until you run it again.
        </p>
      )}

      {policy && (
        <>
          <div className="ec-card space-y-2 p-4 text-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              Feasible · Pareto frontier · selected for this objective
            </p>
            <p className="font-medium text-fg-primary">
              {policy.chosen.profileName} · policy {policy.policyId}
            </p>
            <p className="text-xs text-fg-secondary">
              Model {policy.modelVersion} · SDK {policy.sdkVersion} · seed {policy.seed} · fingerprint{" "}
              {policy.chosen.configFingerprint}. Preference order: {policy.priorities.join(", ")}.
            </p>
            <p className="text-xs text-fg-secondary">
              Search {policy.search.stage}: {policy.search.candidateCount} candidates, presets {policy.search.presets.join(", ")},
              price multiples {policy.search.multiples.join(", ")}. {policy.search.note}
            </p>
            <ul className="list-disc space-y-1 pl-5 text-xs text-fg-secondary">
              {policy.why.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <ul className="list-disc space-y-1 pl-5 text-xs text-fg-muted">
              {policy.limits.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <p className="text-xs text-fg-muted">{policy.observedNote}</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs" data-testid="market-design-table">
              <thead className="text-fg-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3">Design</th>
                  <th className="py-2 pr-3">Typical impact</th>
                  <th className="py-2 pr-3">Whale impact</th>
                  <th className="py-2 pr-3">Sell drawdown</th>
                  <th className="py-2 pr-3">Retail fill</th>
                  <th className="py-2 pr-3">Median</th>
                  <th className="py-2 pr-3">10th pct</th>
                  <th className="py-2 pr-3">Worst</th>
                  <th className="py-2 pr-3">Graduation</th>
                  <th className="py-2 pr-3">Threshold</th>
                  <th className="py-2 pr-3">Fee</th>
                  <th className="py-2">Deploy</th>
                </tr>
              </thead>
              <tbody>
                {policy.candidates.map((row) => {
                  const whale = scenario(row, "whale");
                  const sell = scenario(row, "sell-pressure");
                  const retail = scenario(row, "retail");
                  const selected =
                    !stale &&
                    state.designed?.configFingerprint === row.configFingerprint &&
                    state.presetId === row.recipe.presetId;
                  const pinnedRow = pins.includes(row.profileId);
                  return (
                    <tr key={row.profileId} className="border-b border-line/60 align-top text-fg-secondary">
                      <td className="py-2 pr-3">
                        <p className="font-semibold text-fg-primary">{row.profileName}</p>
                        <p className="text-[10px] text-fg-muted">
                          {row.score > 0 ? `On the frontier · preference ${row.score}` : "Outside the frontier"}
                          {row.feasible ? " · feasible" : " · failed a constraint"}
                        </p>
                        <p className="font-mono text-[10px] text-fg-muted">{row.configFingerprint}</p>
                        {row.rejected.map((reason) => (
                          <p key={reason} className="text-[10px] text-signal-warn">
                            {reason}
                          </p>
                        ))}
                        <button type="button" className="mt-1 text-[10px] text-accent hover:underline" onClick={() => togglePin(row.profileId)}>
                          {pinnedRow ? "Unpin" : pins.length >= 3 ? "Three designs are pinned" : "Pin to compare"}
                        </button>
                      </td>
                      <td className="py-2 pr-3 font-mono">{row.reference.impactBps} bps</td>
                      <td className="py-2 pr-3 font-mono">{whale?.largestBuyImpactBps ?? "—"} bps</td>
                      <td className="py-2 pr-3 font-mono">{sell?.drawdownBps ?? "—"} bps</td>
                      <td className="py-2 pr-3 font-mono">
                        {retail ? pct(retail.progress) : "—"}
                        {retail && (
                          <span className="block text-[10px] text-fg-muted">
                            {retail.ordersRun} orders
                            {retail.participantsAsked != null ? ` / ${retail.participantsAsked} asked` : ""}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono">{pct(row.stressMedianProgress)}</td>
                      <td className="py-2 pr-3 font-mono">{pct(row.stressP10Progress)}</td>
                      <td className="py-2 pr-3 font-mono">{pct(row.stressWorstProgress)}</td>
                      <td className="py-2 pr-3 font-mono">
                        {pct(row.stressGraduationRate)}
                        <span className="block text-[10px] text-fg-muted">{row.stressPaths} paths</span>
                      </td>
                      <td className="py-2 pr-3 font-mono">
                        {formatAtomsExact(row.thresholdAtoms, decimals)} {state.quote}
                        <span className="block text-[10px] text-fg-muted">{pct(row.thresholdGap)} from the raise</span>
                      </td>
                      <td className="py-2 pr-3">
                        {row.feeLabel}
                        <span className="block text-[10px] text-fg-muted">{feeStatusLabel(row.dynamicFeeStatus)}</span>
                      </td>
                      <td className="py-2">
                        <button
                          type="button"
                          className={selected ? "ec-btn-secondary" : "ec-btn-primary"}
                          disabled={stale}
                          onClick={() => deploy(row)}
                        >
                          Review this config
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {pinned.length > 0 && (
            <div className="ec-card space-y-3 p-4" data-testid="candidate-compare">
              <p className="font-medium text-fg-primary">Trade-off view</p>
              <p className="text-xs text-fg-muted">
                Numbers are this search&apos;s simulation output. Pin two or three rows to compare them. Synthetic retail
                paths, not a price forecast.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-xs">
                  <thead className="text-fg-muted">
                    <tr className="border-b border-line">
                      <th className="py-2 pr-3">Metric</th>
                      {pinned.map((row) => (
                        <th key={row.profileId} className="py-2 pr-3">
                          {row.profileName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-fg-secondary">
                    <tr className="border-b border-line/60">
                      <td className="py-2 pr-3">Typical impact</td>
                      {pinned.map((row) => (
                        <td key={row.profileId} className="py-2 pr-3 font-mono">
                          {row.reference.impactBps} bps
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-line/60">
                      <td className="py-2 pr-3">Whale impact</td>
                      {pinned.map((row) => (
                        <td key={row.profileId} className="py-2 pr-3 font-mono">
                          {scenario(row, "whale")?.largestBuyImpactBps ?? "—"} bps
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-line/60">
                      <td className="py-2 pr-3">Sell drawdown</td>
                      {pinned.map((row) => (
                        <td key={row.profileId} className="py-2 pr-3 font-mono">
                          {scenario(row, "sell-pressure")?.drawdownBps ?? "—"} bps
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-line/60">
                      <td className="py-2 pr-3">Retail progress</td>
                      {pinned.map((row) => (
                        <td key={row.profileId} className="py-2 pr-3 font-mono">
                          {scenario(row, "retail") ? pct(scenario(row, "retail")!.progress) : "—"}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <td className="py-2 pr-3">Graduation rate</td>
                      {pinned.map((row) => (
                        <td key={row.profileId} className="py-2 pr-3 font-mono">
                          {pct(row.stressGraduationRate)} of {row.stressPaths}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-fg-primary">Price path</p>
                  <p className="text-[10px] text-fg-muted">Basis points versus the opening price, after each retail order.</p>
                  <PathChart series={chartSeries} mode="price" />
                </div>
                <div>
                  <p className="text-xs font-medium text-fg-primary">Reserve progress</p>
                  <p className="text-[10px] text-fg-muted">Quote reserve divided by the migration threshold, after each retail order.</p>
                  <PathChart series={chartSeries} mode="progress" />
                </div>
              </div>
              <ul className="flex flex-wrap gap-3 text-[10px] text-fg-muted">
                {pinned.map((row, index) => (
                  <li key={row.profileId} className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} />
                    {row.profileName}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            {pinned.map((row) => (
              <div key={row.profileId} className="ec-card space-y-2 p-4 text-xs text-fg-secondary">
                <p className="font-medium text-fg-primary">Named scenarios · {row.profileName}</p>
                <ul className="space-y-2">
                  {row.scenarios.map((item) => (
                    <li key={item.id}>
                      <span className="font-medium text-fg-primary">{item.label}.</span> Progress {pct(item.progress)}
                      {item.graduated ? " · reached the threshold" : ""}. Largest buy {item.largestBuyImpactBps} bps.
                      Price from peak {item.drawdownBps} bps. {item.ordersRun} orders
                      {item.ordersSkipped > 0 ? `, ${item.ordersSkipped} skipped` : ""}. {item.note}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

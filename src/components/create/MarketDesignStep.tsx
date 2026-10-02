"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatAtomsExact } from "@/lib/amounts";
import { getOptionalPoolConfigKey } from "@/lib/constants";
import { toUserMessage } from "@/lib/errors";
import { constraintFailureCopy } from "@/lib/market/constraintNotice";
import { constraintFieldLabel, constraintPolicyFrom, formatConstraintValue } from "@/lib/market/constraintBudget";
import { scenarioAssumptions } from "@/lib/market/constraints";
import { deploymentAllowed, designPolicy, toDesignedMarket } from "@/lib/market/policy";
import type { CandidateReport, ConstraintBudget, LaunchPolicy, ScenarioTracePoint } from "@/lib/market/types";
import { ConstraintBudgetEditor } from "./ConstraintBudgetEditor";
import { RobustnessPanel } from "./RobustnessPanel";
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

function deployLabel(
  status: LaunchPolicy["negotiation"]["status"],
  row: CandidateReport,
  allowed: boolean,
): string {
  if (status === "needs-decision") return "Blocked until you accept a budget";
  if (!allowed) return "Outside this budget";
  return row.feasible ? "Review this config" : "Review with this budget";
}

function budgetKey(budget: ConstraintBudget | null | undefined): string {
  if (!budget) return "original";
  return [
    budget.maxThresholdGap,
    budget.maxReferenceImpactBps,
    budget.maxWhaleImpactBps,
    budget.maxConcentration,
    budget.minRetailProgress,
  ].join(",");
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
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [adjustingBudget, setAdjustingBudget] = useState(false);
  const shared = getOptionalPoolConfigKey();
  const decimals = state.quote === "USDC" ? 6 : 9;
  const assumptions = scenarioAssumptions(state.assetKind);
  const currentKey = `${briefKey(state)}|${budgetKey(state.constraintDraft)}`;
  const stale = policy != null && ranKey !== currentKey;

  function run(relaxation?: ConstraintBudget | null) {
    setRunning(true);
    setError(null);
    const accepted = relaxation === undefined ? state.constraintDraft : relaxation;
    const key = `${briefKey(state)}|${budgetKey(accepted)}`;
    window.setTimeout(() => {
      try {
        const next = designPolicy(
          {
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
          },
          accepted ? { acceptedBudget: accepted } : undefined,
        );
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

  function recalculate(budget: ConstraintBudget) {
    setAdjustingBudget(false);
    patch({ constraintDraft: budget });
    run(budget);
  }

  function clearBudget() {
    setAdjustingBudget(false);
    setEditorEpoch((epoch) => epoch + 1);
    patch({ constraintDraft: null });
    run(null);
  }

  function deploy(row: CandidateReport) {
    if (!policy || stale || !deploymentAllowed(policy, row)) return;
    const designed = toDesignedMarket(policy, row);
    const failure = constraintFailureCopy(policy);
    const picked = !row.feasible
      ? `Selected for comparison: ${row.profileName}. This is a tradeoff example, not a fully feasible recommendation.`
      : row.profileId === policy.chosen.profileId
        ? `Selected ${row.profileName}. This is the preferred feasible design among ${policy.search.candidateCount} candidates evaluated for this objective.`
        : `Selected ${row.profileName}. The preferred feasible design for this objective was ${policy.chosen.profileName}.`;
    patch({
      presetId: row.recipe.presetId,
      marketCaps: {
        initial: row.recipe.initialMarketCap,
        migration: row.recipe.migrationMarketCap,
      },
      designed,
      designWhy: [...(failure ?? []), picked, ...policy.why, ...row.rejected.map((reason) => `Constraint: ${reason}`)],
      designLimits: policy.limits,
    });
    onDeploy(row.recipe.presetId);
  }

  const pinned = (policy ? pins.map((id) => policy.candidates.find((row) => row.profileId === id)) : []).filter(
    (row): row is CandidateReport => row != null,
  );
  const failure = policy ? constraintFailureCopy(policy) : null;
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
          Research mode. The search scores a sample of configs against the hard constraints, then marks one preferred
          candidate among those it evaluated. A row that fails a constraint stays available to inspect and is labeled as
          a tradeoff example, not a design that meets the brief. If nothing passes, EquiCurve does not relax a limit.
          You choose each limit. Widening one limit leaves the others at the requested value until you change them.
          Deploy stays blocked until that search admits a curve. Asset kind is a market-design assumption, not a legal
          claim. The row you deploy is the config the wallet will sign.
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

      <button type="button" className="ec-btn-primary" onClick={() => run()} disabled={running}>
        {running ? "Simulating designs…" : policy ? "Run the search again" : "Simulate market designs"}
      </button>
      {error && (
        <p className="rounded-input border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-signal-danger">
          {error}
        </p>
      )}
      {stale && (
        <p className="rounded-input border border-signal-warn/30 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn">
          This search is out of date. Deploy stays blocked until you run it again.
        </p>
      )}

      {policy && (
        <>
          {policy.negotiation.status === "accepted" && !adjustingBudget ? (
            <div
              className="ec-scroll-target space-y-2 rounded-input border border-signal-warn/40 bg-signal-warn/10 px-4 py-3 text-sm"
              role="alert"
              data-testid="constraint-budget-accepted"
            >
              <p className="font-semibold text-fg-primary">Constraint decision</p>
              <p className="text-fg-primary">✓ Wider budget accepted</p>
              <p className="text-xs text-fg-secondary">The original constraints were not met.</p>
              <ul className="space-y-1 text-xs text-fg-secondary">
                {constraintPolicyFrom(policy.negotiation.requested, policy.negotiation.applied).relaxed.map((change) => (
                  <li key={change.field}>
                    <span className="block text-fg-primary">{constraintFieldLabel(change.field)}</span>
                    {formatConstraintValue(change.field, change.from)} → {formatConstraintValue(change.field, change.to)}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="ec-btn-secondary ec-scroll-target min-h-11"
                onClick={() => setAdjustingBudget(true)}
              >
                Adjust budget
              </button>
            </div>
          ) : (
            policy.negotiation.status !== "satisfied" && (
            <div
              className="ec-scroll-target space-y-2 rounded-input border border-signal-warn/40 bg-signal-warn/10 px-4 py-3 text-sm"
              role="alert"
              data-testid={policy.negotiation.status === "accepted" ? "constraint-budget-accepted" : "constraint-budget"}
            >
              <p className="font-semibold text-fg-primary">Constraint decision</p>
              {policy.negotiation.status === "needs-decision" && (
                <p className="text-fg-secondary">
                  No curve passed the requested constraints. Nothing was relaxed. Deploy stays blocked until a wider
                  budget you choose admits a curve.
                </p>
              )}
              {policy.negotiation.status === "accepted" && (
                <>
                  <p className="text-fg-secondary">
                    You accepted a wider budget. The original constraints were not met. Review uses this budget, and the
                    design record keeps the requested limits beside it.
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-xs text-fg-secondary">
                    {constraintPolicyFrom(policy.negotiation.requested, policy.negotiation.applied).relaxed.map((change) => (
                      <li key={change.field}>
                        {constraintFieldLabel(change.field)} {formatConstraintValue(change.field, change.from)} →{" "}
                        {formatConstraintValue(change.field, change.to)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {policy.negotiation.budgetError && (
                <p className="text-xs text-signal-danger" data-testid="constraint-budget-error">
                  {policy.negotiation.budgetError} This budget was not applied.
                </p>
              )}
              {state.constraintDraft &&
                policy.negotiation.status === "needs-decision" &&
                !policy.negotiation.budgetError &&
                !stale && (
                  <p className="text-xs text-fg-secondary" data-testid="constraint-budget-rejected">
                    This budget still admits no curve. The requested limits are still in force.
                  </p>
                )}
              <ConstraintBudgetEditor
                key={`${policy.policyId}|${policy.negotiation.status}|${budgetKey(policy.negotiation.applied)}|${editorEpoch}`}
                requested={policy.negotiation.requested}
                start={policy.negotiation.status === "accepted" ? policy.negotiation.applied : policy.negotiation.requested}
                proposal={policy.negotiation.proposal}
                profileName={policy.chosen.profileName}
                running={running}
                showReset={state.constraintDraft != null || policy.negotiation.status === "accepted"}
                onRecalculate={recalculate}
                onReset={clearBudget}
              />
            </div>
            )
          )}
          {policy.negotiation.status === "accepted" && !adjustingBudget && (
            <div className="ec-card ec-scroll-target space-y-2 p-4" data-testid="preferred-design">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Preferred design</p>
              <p className="font-medium text-fg-primary">{policy.chosen.profileName}</p>
              <p className="break-all font-mono text-xs text-fg-secondary">Fingerprint {policy.chosen.configFingerprint}</p>
            </div>
          )}
          {policy.negotiation.status === "accepted" && !adjustingBudget && (
            <RobustnessPanel
              key={`${policy.chosen.configFingerprint}|${budgetKey(policy.negotiation.applied)}|compact`}
              chosen={policy.chosen}
              brief={policy.brief}
              budget={policy.negotiation.applied}
              budgetLabel="accepted"
              disabled={running || stale}
            />
          )}
          {failure && (
            <div
              className="space-y-1 rounded-input border border-signal-warn/40 bg-signal-warn/10 px-4 py-3 text-sm"
              role="alert"
              data-testid="constraint-failure"
            >
              {failure.map((line) => (
                <p key={line} className={line === failure[0] ? "font-semibold text-fg-primary" : "text-fg-secondary"}>
                  {line}
                </p>
              ))}
            </div>
          )}
          <div className="ec-card space-y-2 p-4 text-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">
              {failure
                ? "Preferred among the candidates evaluated · constraints not all met"
                : "Feasible · Pareto frontier · selected for this objective"}
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

          {!(policy.negotiation.status === "accepted" && !adjustingBudget) && (
            <RobustnessPanel
              key={`${policy.chosen.configFingerprint}|${budgetKey(policy.negotiation.applied)}`}
              chosen={policy.chosen}
              brief={policy.brief}
              budget={policy.negotiation.applied}
              budgetLabel={policy.negotiation.status === "accepted" ? "accepted" : "requested"}
              disabled={running || stale}
            />
          )}

          <ul className="space-y-3 sm:hidden" data-testid="market-design-cards">
            {policy.candidates.map((row) => {
              const whale = scenario(row, "whale");
              const retail = scenario(row, "retail");
              const allowed = !stale && deploymentAllowed(policy, row);
              const selected =
                allowed &&
                state.designed?.configFingerprint === row.configFingerprint &&
                state.presetId === row.recipe.presetId;
              const pinnedRow = pins.includes(row.profileId);
              return (
                <li key={row.profileId} className="ec-card ec-scroll-target space-y-3 p-4 text-sm">
                  <div>
                    <p className="font-semibold text-fg-primary">{row.profileName}</p>
                    <p className="text-[10px] text-fg-muted">
                      {row.feasible ? "Feasible" : "Failed a constraint"}
                      {row.score > 0 ? ` · preference ${row.score}` : ""}
                    </p>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <div>
                      <dt className="text-fg-muted">Typical impact</dt>
                      <dd className="font-mono text-fg-primary">{row.reference.impactBps} bps</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Whale impact</dt>
                      <dd className="font-mono text-fg-primary">{whale?.largestBuyImpactBps ?? "—"} bps</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Retail fill</dt>
                      <dd className="font-mono text-fg-primary">{retail ? pct(retail.progress) : "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Graduation</dt>
                      <dd className="font-mono text-fg-primary">{pct(row.stressGraduationRate)}</dd>
                    </div>
                  </dl>
                  {row.rejected.length > 0 && (
                    <div className="text-xs text-signal-warn">
                      <p className="font-medium">Failed</p>
                      {row.rejected.map((reason) => (
                        <p key={reason}>{reason}</p>
                      ))}
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-fg-muted">Fingerprint</p>
                    <p className="break-all font-mono text-xs text-fg-secondary">{row.configFingerprint}</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      className="ec-btn-secondary ec-scroll-target min-h-11"
                      onClick={() => togglePin(row.profileId)}
                    >
                      {pinnedRow ? "Unpin" : pins.length >= 3 ? "Three designs are pinned" : "Pin"}
                    </button>
                    <button
                      type="button"
                      className={`${selected ? "ec-btn-secondary" : allowed ? "ec-btn-primary" : "ec-btn-secondary"} ec-scroll-target min-h-11`}
                      disabled={!allowed}
                      onClick={() => deploy(row)}
                    >
                      {deployLabel(policy.negotiation.status, row, allowed)}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
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
                  const allowed = !stale && deploymentAllowed(policy, row);
                  const selected =
                    allowed &&
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
                          className={`${selected ? "ec-btn-secondary" : allowed ? "ec-btn-primary" : "ec-btn-secondary"} ec-scroll-target`}
                          disabled={!allowed}
                          onClick={() => deploy(row)}
                        >
                          {deployLabel(policy.negotiation.status, row, allowed)}
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

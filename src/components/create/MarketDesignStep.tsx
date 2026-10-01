"use client";

import { useState } from "react";
import { toast } from "sonner";
import { formatAtomsExact } from "@/lib/amounts";
import { getOptionalPoolConfigKey } from "@/lib/constants";
import { toUserMessage } from "@/lib/errors";
import { designPolicy, toDesignedMarket } from "@/lib/market/policy";
import type { CandidateReport, LaunchPolicy } from "@/lib/market/types";
import type { WizardState } from "./wizardTypes";

const STRESS_PATHS = 8;

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function scenario(row: CandidateReport, id: CandidateReport["scenarios"][number]["id"]) {
  return row.scenarios.find((s) => s.id === id);
}

function feeStatusLabel(status: CandidateReport["dynamicFeeStatus"]): string {
  if (status === "simulated") return "dynamic fee simulated";
  if (status === "base-only") return "dynamic fee unread · base fee only";
  return "base fee only";
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
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shared = getOptionalPoolConfigKey();
  const decimals = state.quote === "USDC" ? 6 : 9;

  function run() {
    setRunning(true);
    setError(null);
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
          stressPaths: STRESS_PATHS,
        });
        setPolicy(next);
      } catch (e) {
        const message = toUserMessage(e);
        setError(message);
        setPolicy(null);
        toast.error(message);
      } finally {
        setRunning(false);
      }
    }, 30);
  }

  function deploy(row: CandidateReport) {
    if (!policy) return;
    const designed = toDesignedMarket(policy, row);
    const picked =
      row.profileId === policy.chosen.profileId
        ? `Selected ${row.profileName}, the frontier point for this brief.`
        : `Selected ${row.profileName}. The frontier point was ${policy.chosen.profileName}.`;
    patch({
      presetId: row.recipe.presetId,
      marketCaps: {
        initial: row.recipe.initialMarketCap,
        migration: row.recipe.migrationMarketCap,
      },
      designed,
      designWhy: [picked, ...policy.why, ...row.rejected.map((r) => `Constraint: ${r}`)],
      designLimits: policy.limits,
    });
    onDeploy(row.recipe.presetId);
  }

  return (
    <section className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-fg-primary">Market design</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          EquiCurve searches Meteora curve configs for this brief, keeps the ones that pass hard constraints, and
          ranks the rest on a Pareto frontier. The row you deploy is the config the wallet will sign. Asset kind is a
          design assumption, not a legal claim.
        </p>
      </header>

      <div className="ec-card space-y-2 p-4 text-xs text-fg-secondary">
        <p>
          Brief: {state.assetKind} · {state.objective} · raise {state.targetRaise} {state.quote} · typical order{" "}
          {state.typicalTrade} {state.quote} · {state.participants} participants · creator fee {state.feeIssuer}% · LP
          lock {state.lpLockPct}% · anti-sniper {state.antiSniper ? "on" : "off"}
        </p>
        <p>Stress test: {STRESS_PATHS} cohort paths. Synthetic order flow, not a forecast and not a track record.</p>
        {shared && (
          <p className="text-signal-warn">
            NEXT_PUBLIC_POOL_CONFIG_KEY is set. A shared config cannot deploy a searched curve. Unset it before you
            sign, or the launch will refuse to build.
          </p>
        )}
      </div>

      <button type="button" className="ec-btn-primary" onClick={run} disabled={running}>
        {running ? "Simulating designs…" : policy ? "Run the search again" : "Simulate market designs"}
      </button>
      {error && (
        <p className="rounded-input border border-signal-danger/30 bg-signal-danger/10 px-3 py-2 text-xs text-signal-danger">
          {error}
        </p>
      )}

      {policy && (
        <>
          <div className="ec-card space-y-2 p-4 text-sm">
            <p className="font-medium text-fg-primary">
              Policy {policy.policyId} · model {policy.modelVersion} · SDK {policy.sdkVersion} · seed {policy.seed}
            </p>
            <p className="text-xs text-fg-secondary">Preference order: {policy.priorities.join(", ")}.</p>
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
            <table className="w-full min-w-[880px] text-left text-xs" data-testid="market-design-table">
              <thead className="text-fg-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3">Design</th>
                  <th className="py-2 pr-3">Typical impact</th>
                  <th className="py-2 pr-3">Whale impact</th>
                  <th className="py-2 pr-3">Sell drawdown</th>
                  <th className="py-2 pr-3">Retail fill</th>
                  <th className="py-2 pr-3">Median progress</th>
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
                    state.designed?.configHash === toDesignedMarket(policy, row).configHash &&
                    state.presetId === row.recipe.presetId;
                  return (
                    <tr key={row.profileId} className="border-b border-line/60 align-top text-fg-secondary">
                      <td className="py-2 pr-3">
                        <p className="font-semibold text-fg-primary">{row.profileName}</p>
                        <p className="text-[10px] text-fg-muted">
                          {row.score > 0 ? `Frontier rank score ${row.score}` : "Outside the frontier"}
                          {row.feasible ? "" : " · failed a constraint"}
                        </p>
                        {row.rejected.map((r) => (
                          <p key={r} className="text-[10px] text-signal-warn">
                            {r}
                          </p>
                        ))}
                      </td>
                      <td className="py-2 pr-3 font-mono">{row.reference.impactBps} bps</td>
                      <td className="py-2 pr-3 font-mono">{whale?.largestBuyImpactBps ?? "—"} bps</td>
                      <td className="py-2 pr-3 font-mono">{sell?.drawdownBps ?? "—"} bps</td>
                      <td className="py-2 pr-3 font-mono">{retail ? pct(retail.progress) : "—"}</td>
                      <td className="py-2 pr-3 font-mono">{pct(row.stressMedianProgress)}</td>
                      <td className="py-2 pr-3 font-mono">{pct(row.stressGraduationRate)}</td>
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
                          onClick={() => deploy(row)}
                        >
                          Deploy this market design
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

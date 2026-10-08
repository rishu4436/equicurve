"use client";

import { useState } from "react";
import { toUserMessage } from "@/lib/errors";
import { formatConstraintValue } from "@/lib/market/constraintBudget";
import {
  assessRobustness,
  type RobustnessLevel,
  type RobustnessMetric,
  type RobustnessReport,
} from "@/lib/market/robustness";
import type { CandidateReport, ConstraintBudget, ConstraintField, LaunchBrief } from "@/lib/market/types";

const METRIC_FIELDS: Record<RobustnessMetric["id"], ConstraintField> = {
  threshold: "maxThresholdGap",
  reference: "maxReferenceImpactBps",
  whale: "maxWhaleImpactBps",
  concentration: "maxConcentration",
  retail: "minRetailProgress",
};

function formatLine(point: RobustnessMetric): string {
  const field = METRIC_FIELDS[point.id];
  const bound = point.bound === "minimum" ? "minimum" : "maximum";
  return `${formatConstraintValue(field, point.value)} / ${formatConstraintValue(field, point.limit)} ${bound}`;
}

function levelLabel(level: RobustnessLevel): string {
  if (level === "minus") return "−25%";
  if (level === "plus") return "+25%";
  return "Base";
}

function nameList(names: string[]): string {
  return names.join(", ");
}

export function RobustnessPanel({
  chosen,
  brief,
  budget,
  budgetLabel,
  disabled,
}: {
  chosen: CandidateReport;
  brief: LaunchBrief;
  budget: ConstraintBudget;
  budgetLabel: "requested" | "accepted";
  disabled: boolean;
}) {
  const [report, setReport] = useState<RobustnessReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run() {
    setRunning(true);
    setError(null);
    window.setTimeout(() => {
      try {
        setReport(assessRobustness({ chosen, brief, budget }));
      } catch (caught) {
        setReport(null);
        setError(toUserMessage(caught));
      } finally {
        setRunning(false);
      }
    }, 30);
  }

  const budgetWords = budgetLabel === "accepted" ? "the budget you accepted" : "the requested budget";

  return (
    <div className="ec-card ec-scroll-target space-y-5 p-5 sm:p-6" data-testid="robustness-check">
      <div>
        <h3 className="text-lg font-semibold tracking-tight">How resilient is this design?</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          How this exact design behaves when whale size, the typical order, the participant count, sell pressure, or
          late capital moves by 25%. The curve stays the one you select. This is not a score.
        </p>
      </div>
      <button type="button" className="ec-btn-secondary ec-scroll-target min-h-11" onClick={run} disabled={disabled || running}>
        {running ? "Checking this design…" : "Check robustness"}
      </button>
      {error && <p className="text-xs text-signal-danger">{error}</p>}
      {report && (
        <div className="space-y-3 text-xs text-fg-secondary" data-testid="robustness-report">
          <div data-testid="robustness-envelope">
            <p>
              5 assumptions. {report.shockCount} shocks around this design. {report.shockInsideCount} of{" "}
              {report.shockCount} stay inside {budgetWords}. The base design is{" "}
              {report.baseInside ? "inside" : "outside"} the budget
              {report.baseInside ? "" : `: ${report.baseBlocking.join(", ")}`}. Fingerprint {report.fingerprint}.
            </p>
            {report.tied ? (
              <p>Every assumption changes the budget result the same number of times.</p>
            ) : report.mostSensitive.length === 0 ? (
              <p>Most sensitive: none. No shock changed which constraints hold.</p>
            ) : (
              <>
                <p>Most sensitive: {nameList(report.mostSensitive)}.</p>
                <p>Least sensitive: {nameList(report.leastSensitive)}.</p>
              </>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <caption className="sr-only">Robustness envelope: budget outcome for each assumption at minus 25%, base, and plus 25%</caption>
              <thead className="text-fg-muted">
                <tr>
                  <th className="py-1 pr-3 font-medium">Assumption</th>
                  <th className="py-1 pr-3 font-medium">−25%</th>
                  <th className="py-1 pr-3 font-medium">Base</th>
                  <th className="py-1 pr-3 font-medium">+25%</th>
                </tr>
              </thead>
              <tbody>
                {report.axes.map((axis) => (
                  <tr key={axis.id} data-testid={`robustness-axis-${axis.id}`}>
                    <td className="py-1 pr-3 text-fg-primary">{axis.label}</td>
                    {axis.cells.map((cell) => (
                      <td key={cell.level} className="py-1 pr-2">
                        <span className={`inline-flex min-h-9 items-center justify-center rounded-lg px-2 sm:min-w-20 ${cell.insideBudget ? "bg-accent/10 text-accent" : "bg-signal-warn/10 text-signal-warn"}`}>
                          {cell.insideBudget ? "✓" : "✕"}<span className="ml-1.5 hidden sm:inline">{cell.insideBudget ? "Inside" : "Outside"}</span><span className="sr-only sm:hidden">{cell.insideBudget ? "Inside budget" : "Outside budget"}</span>
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3">
            {report.axes.map((axis) => (
              <li key={axis.id}>
                <details className="rounded-xl border border-line p-4">
                <summary className="font-medium text-fg-primary">{axis.label} <span className="ml-2 font-normal text-fg-muted">View exact results</span></summary>
                <ul className="mt-4 grid gap-4 lg:grid-cols-3">
                  {axis.cells.map((cell) => (
                    <li key={cell.level} className="space-y-2 rounded-lg bg-base/50 p-3" data-testid={`robustness-${axis.id}-${cell.level}`}>
                      <p>
                        {cell.insideBudget ? "✓ Inside the budget" : "✕ Outside the budget"} · {levelLabel(cell.level)}
                      </p>
                      <p className="text-fg-muted">{cell.note}</p>
                      <ul className="mt-1 space-y-1">
                        {cell.metrics.map((point) => (
                          <li key={point.id} className={point.focus ? "font-mono text-fg-primary" : "font-mono"}>
                            {point.passed ? "✓" : "✕"} {point.label}: {formatLine(point)}
                          </li>
                        ))}
                      </ul>
                      {cell.observation && <p className="text-fg-muted">{cell.observation.detail}</p>}
                      <p className={cell.insideBudget ? "text-fg-muted" : "text-signal-warn"}>
                        {cell.insideBudget ? "All constraints hold." : `Blocking: ${cell.blocking.join(", ")}.`}
                      </p>
                    </li>
                  ))}
                </ul>
                </details>
              </li>
            ))}
          </ul>
          <p className="text-fg-muted">{report.note}</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { toUserMessage } from "@/lib/errors";
import { assessRobustness, type RobustnessReport } from "@/lib/market/robustness";
import type { CandidateReport, ConstraintBudget, LaunchBrief } from "@/lib/market/types";

function formatMetric(kind: "bps" | "progress", value: number): string {
  if (kind === "bps") return `${value} bps`;
  return `${Math.round(value * 1000) / 10}%`;
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
    <div className="ec-card space-y-3 p-4" data-testid="robustness-check">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">Robustness check</p>
        <p className="mt-1 text-sm text-fg-secondary">
          How this exact design behaves when the whale size, the typical order, or the participant count moves. The
          curve stays the one you select.
        </p>
      </div>
      <button type="button" className="ec-btn-secondary" onClick={run} disabled={disabled || running}>
        {running ? "Checking this design…" : "Check robustness"}
      </button>
      {error && <p className="text-xs text-signal-danger">{error}</p>}
      {report && (
        <div className="space-y-3 text-xs text-fg-secondary" data-testid="robustness-report">
          <p>
            {report.insideCount} of {report.caseCount} cases stay inside {budgetWords}. Fingerprint {report.fingerprint}.
          </p>
          <ul className="space-y-3">
            {report.cases.map((item) => (
              <li key={item.id}>
                <p className="font-medium text-fg-primary">
                  {item.insideBudget ? "Inside the budget" : "Outside the budget"} · {item.label}
                </p>
                <p className="text-fg-muted">{item.note}</p>
                <ul className="mt-1 space-y-1">
                  {item.metrics.map((point) => (
                    <li key={point.id} className="font-mono">
                      {point.passed ? "✓" : "✕"} {point.label}: {formatMetric(point.kind, point.value)}
                    </li>
                  ))}
                </ul>
                {item.blocking.map((reason) => (
                  <p key={reason} className="text-signal-warn">
                    {reason}
                  </p>
                ))}
              </li>
            ))}
          </ul>
          <p className="text-fg-muted">{report.note}</p>
        </div>
      )}
    </div>
  );
}

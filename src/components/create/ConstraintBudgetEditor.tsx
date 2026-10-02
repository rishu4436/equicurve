"use client";

import { useState } from "react";
import {
  CONSTRAINT_FIELDS,
  constraintFieldLabel,
  constraintFieldProposal,
  explicitBudgetDecision,
  formatConstraintInput,
  formatConstraintValue,
  isFractionConstraint,
  parseConstraintInput,
} from "@/lib/market/constraintBudget";
import type { ConstraintBudget, ConstraintField } from "@/lib/market/types";

function textFrom(budget: ConstraintBudget): Record<ConstraintField, string> {
  const text = {} as Record<ConstraintField, string>;
  for (const field of CONSTRAINT_FIELDS) text[field] = formatConstraintInput(field, budget[field]);
  return text;
}

function ignoredSentence(fields: readonly ConstraintField[], requested: ConstraintBudget): string {
  return fields
    .map((field) => `${constraintFieldLabel(field)} stays at the requested ${formatConstraintValue(field, requested[field])}.`)
    .join(" ");
}

export function ConstraintBudgetEditor({
  requested,
  start,
  proposal,
  profileName,
  running,
  showReset,
  onRecalculate,
  onReset,
}: {
  requested: ConstraintBudget;
  start: ConstraintBudget;
  proposal: ConstraintBudget | null;
  profileName: string;
  running: boolean;
  showReset: boolean;
  onRecalculate: (budget: ConstraintBudget) => void;
  onReset: () => void;
}) {
  const [text, setText] = useState<Record<ConstraintField, string>>(() => textFrom(start));
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function submit(nextText: Record<ConstraintField, string>) {
    const draft = {} as ConstraintBudget;
    for (const field of CONSTRAINT_FIELDS) {
      const parsed = parseConstraintInput(field, nextText[field]);
      if (parsed == null) {
        setNote(null);
        setError("Enter a number for every limit.");
        return;
      }
      draft[field] = parsed;
    }
    const decision = explicitBudgetDecision(requested, draft);
    if (!decision.ok) {
      setNote(null);
      setError(decision.error);
      return;
    }
    setError(null);
    setText(textFrom(decision.budget));
    setNote(decision.ignored.length === 0 ? null : ignoredSentence(decision.ignored, requested));
    onRecalculate(decision.budget);
  }

  function suggest(field: ConstraintField, value: number) {
    const next = { ...text, [field]: formatConstraintInput(field, value, "loose") };
    setText(next);
    submit(next);
  }

  return (
    <div className="ec-scroll-target space-y-3">
      <p className="text-xs text-fg-secondary">
        Set each limit yourself. A suggested value updates that field and runs the search with every limit shown here.
        Typing a number waits until you recalculate.
      </p>
      <ul className="space-y-3">
        {CONSTRAINT_FIELDS.map((field) => {
          const suggestion = proposal ? constraintFieldProposal(field, requested, proposal) : null;
          const covered =
            suggestion != null &&
            (field === "minRetailProgress" ? start[field] <= suggestion.value : start[field] >= suggestion.value);
          const offer = suggestion?.inRange === true && !covered ? suggestion : null;
          return (
            <li key={field} className="space-y-1">
              <label className="block text-xs font-medium text-fg-primary" htmlFor={`constraint-${field}`}>
                {constraintFieldLabel(field)}
              </label>
              <p className="text-[10px] text-fg-muted">Requested {formatConstraintValue(field, requested[field])}</p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id={`constraint-${field}`}
                  data-testid={`constraint-${field}`}
                  className="ec-scroll-target min-h-11 w-28 rounded-input border border-line bg-base px-2 py-1 font-mono text-xs"
                  inputMode="decimal"
                  autoComplete="off"
                  value={text[field]}
                  onChange={(event) => setText((current) => ({ ...current, [field]: event.target.value }))}
                />
                <span className="text-[10px] text-fg-muted">{isFractionConstraint(field) ? "%" : "bps"}</span>
                {offer && (
                  <button
                    type="button"
                    className="ec-btn-secondary ec-scroll-target min-h-11"
                    disabled={running}
                    onClick={() => suggest(field, offer.value)}
                  >
                    Use {formatConstraintValue(field, offer.value)}
                  </button>
                )}
              </div>
              {suggestion && !suggestion.inRange && (
                <p className="text-[10px] text-signal-warn" data-testid={`constraint-out-of-range-${field}`}>
                  Admitting {profileName} would set {constraintFieldLabel(field).toLowerCase()} to{" "}
                  {formatConstraintValue(field, suggestion.value)}, which is outside the range that can be signed.
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="text-xs text-signal-danger" data-testid="constraint-draft-error">
          {error}
        </p>
      )}
      {note && <p className="text-xs text-fg-secondary">{note}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="ec-btn-primary ec-scroll-target min-h-11" disabled={running} onClick={() => submit(text)}>
          {running ? "Simulating designs…" : "Recalculate with these limits"}
        </button>
        {showReset && (
          <button type="button" className="ec-btn-secondary" disabled={running} onClick={onReset}>
            Use the original constraints
          </button>
        )}
      </div>
    </div>
  );
}

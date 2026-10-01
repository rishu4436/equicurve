import type { ConstraintBudget, ConstraintChange, ConstraintField, ConstraintPolicy } from "./types";

export const CONSTRAINT_FIELDS: readonly ConstraintField[] = [
  "maxThresholdGap",
  "maxReferenceImpactBps",
  "maxWhaleImpactBps",
  "maxConcentration",
  "minRetailProgress",
];

function fraction(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function nonNegative(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** Null when every field is inside the range that may be signed and stored. */
export function constraintBudgetError(budget: ConstraintBudget): string | null {
  if (!fraction(budget.maxThresholdGap)) return "Threshold gap must be from 0 to 1.";
  if (!nonNegative(budget.maxReferenceImpactBps)) return "Typical buy impact must be zero or greater.";
  if (!nonNegative(budget.maxWhaleImpactBps)) return "Whale buy impact must be zero or greater.";
  if (!fraction(budget.maxConcentration)) return "Concentration must be from 0 to 1.";
  if (!fraction(budget.minRetailProgress)) return "Retail progress must be from 0 to 1.";
  return null;
}

export function constraintFieldLabel(field: ConstraintField): string {
  switch (field) {
    case "maxThresholdGap":
      return "Threshold gap";
    case "maxReferenceImpactBps":
      return "Typical buy impact";
    case "maxWhaleImpactBps":
      return "Whale buy impact";
    case "maxConcentration":
      return "Largest buy share";
    case "minRetailProgress":
      return "Minimum retail fill";
  }
}

export function formatConstraintValue(field: ConstraintField, value: number): string {
  if (field === "maxReferenceImpactBps" || field === "maxWhaleImpactBps") return `${value} bps`;
  return `${Math.round(value * 1000) / 10}%`;
}

/** True when every applied field is equal to or looser than the requested budget. */
export function budgetOnlyLoosens(requested: ConstraintBudget, applied: ConstraintBudget): boolean {
  return (
    applied.maxThresholdGap >= requested.maxThresholdGap &&
    applied.maxReferenceImpactBps >= requested.maxReferenceImpactBps &&
    applied.maxWhaleImpactBps >= requested.maxWhaleImpactBps &&
    applied.maxConcentration >= requested.maxConcentration &&
    applied.minRetailProgress <= requested.minRetailProgress
  );
}

function finiteOr(value: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** A field that would tighten the requested budget is ignored. Acceptance can only loosen. */
export function loosenConstraintBudget(requested: ConstraintBudget, accepted: ConstraintBudget): ConstraintBudget {
  return {
    maxThresholdGap: Math.max(requested.maxThresholdGap, finiteOr(accepted.maxThresholdGap, requested.maxThresholdGap)),
    maxReferenceImpactBps: Math.max(
      requested.maxReferenceImpactBps,
      finiteOr(accepted.maxReferenceImpactBps, requested.maxReferenceImpactBps),
    ),
    maxWhaleImpactBps: Math.max(
      requested.maxWhaleImpactBps,
      finiteOr(accepted.maxWhaleImpactBps, requested.maxWhaleImpactBps),
    ),
    maxConcentration: Math.max(requested.maxConcentration, finiteOr(accepted.maxConcentration, requested.maxConcentration)),
    minRetailProgress: Math.min(
      requested.minRetailProgress,
      finiteOr(accepted.minRetailProgress, requested.minRetailProgress),
    ),
  };
}

function sameBudget(a: ConstraintBudget, b: ConstraintBudget): boolean {
  return CONSTRAINT_FIELDS.every((field) => a[field] === b[field]);
}

function tighterFields(requested: ConstraintBudget, draft: ConstraintBudget): ConstraintField[] {
  return CONSTRAINT_FIELDS.filter((field) =>
    field === "minRetailProgress" ? draft[field] > requested[field] : draft[field] < requested[field],
  );
}

export type ExplicitBudgetDecision =
  | { ok: true; budget: ConstraintBudget; ignored: ConstraintField[] }
  | { ok: false; error: string };

/**
 * Turn an issuer's edited limits into the budget a search may use.
 * An out-of-range field rejects the whole edit. A tighter field is dropped.
 * The returned budget changes only the limits the issuer actually widened.
 */
export function explicitBudgetDecision(requested: ConstraintBudget, draft: ConstraintBudget): ExplicitBudgetDecision {
  const rangeError = constraintBudgetError(draft);
  if (rangeError) return { ok: false, error: rangeError };
  const budget = loosenConstraintBudget(requested, draft);
  if (sameBudget(budget, requested)) {
    return {
      ok: false,
      error: "Widen at least one limit. A tighter limit stays at the requested value.",
    };
  }
  return { ok: true, budget, ignored: tighterFields(requested, draft) };
}

/**
 * The proposal's change for one limit, measured from the requested budget.
 * Null when that limit does not need to move. `inRange` is false when the
 * admitting value cannot be signed.
 */
export function constraintFieldProposal(
  field: ConstraintField,
  requested: ConstraintBudget,
  proposal: ConstraintBudget,
): { value: number; inRange: boolean } | null {
  const value = proposal[field];
  const looser = field === "minRetailProgress" ? value < requested[field] : value > requested[field];
  if (!looser || !Number.isFinite(value)) return null;
  const trial: ConstraintBudget = { ...requested, [field]: value };
  return { value, inRange: constraintBudgetError(trial) === null };
}

export function sameConstraintChanges(actual: readonly ConstraintChange[], expected: readonly ConstraintChange[]): boolean {
  return (
    actual.length === expected.length &&
    actual.every(
      (change, index) =>
        change.field === expected[index]?.field &&
        change.from === expected[index]?.from &&
        change.to === expected[index]?.to,
    )
  );
}

const PERCENT_PLACES = 6;

export function isFractionConstraint(field: ConstraintField): boolean {
  return field === "maxThresholdGap" || field === "maxConcentration" || field === "minRetailProgress";
}

function stripZeros(text: string): string {
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}

/**
 * Text for a limit input. Fraction fields are shown as percent.
 * `loose` rounds so parsing the text cannot tighten the underlying value.
 */
export function formatConstraintInput(
  field: ConstraintField,
  value: number,
  direction: "exact" | "loose" = "exact",
): string {
  if (!Number.isFinite(value)) return "";
  if (!isFractionConstraint(field)) return String(value);
  const scale = 10 ** PERCENT_PLACES;
  const scaled = value * 100 * scale;
  const rounded =
    direction === "loose" && field === "minRetailProgress"
      ? Math.floor(scaled + 1e-6)
      : direction === "loose"
        ? Math.ceil(scaled - 1e-6)
        : Math.round(scaled);
  return stripZeros((rounded / scale).toFixed(PERCENT_PLACES));
}

/** Parse an input. Fraction fields are percent and come back as 0..1 fractions. */
export function parseConstraintInput(field: ConstraintField, text: string): number | null {
  const raw = text.trim();
  if (raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return isFractionConstraint(field) ? value / 100 : value;
}

/** Record of requested versus applied. Only fields that differ are listed, in field order. */
export function constraintPolicyFrom(requested: ConstraintBudget, applied: ConstraintBudget): ConstraintPolicy {
  return {
    requested,
    applied,
    relaxed: CONSTRAINT_FIELDS.filter((field) => requested[field] !== applied[field]).map((field) => ({
      field,
      from: requested[field],
      to: applied[field],
    })),
  };
}

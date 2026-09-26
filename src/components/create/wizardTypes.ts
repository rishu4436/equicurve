import type { PresetId } from "@/lib/dbc/types";
import type { Sector } from "@/lib/demo/offerings";
import { MIN_LP_LOCK_PCT } from "@/lib/dbc/presets";
import { validateWizard, type FieldErrors } from "@/lib/validation";

export const WIZARD_STEPS = [
  { id: "basics", label: "Basics" },
  { id: "offering", label: "Offering" },
  { id: "curve", label: "Curve" },
  { id: "fees", label: "Fees & locks" },
  { id: "review", label: "Review" },
  { id: "launch", label: "Launch" },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

export type WizardState = {
  name: string;
  ticker: string;
  thesis: string;
  sector: Sector;
  website: string;
  raiseTarget: number;
  /** Quote mint wired on-chain when known for cluster (SOL default). */
  quote: "SOL" | "USDC";
  /** Exact decimal string in quote units (converted to atoms without floats). */
  seedBuy: string;
  jurisdictions: string;
  investorType: "Retail-friendly" | "Restricted" | "Accredited-oriented";
  /** open-spl | token-2022 | transfer-hook (hook requires env program). */
  transferProfile: "open-spl" | "token-2022" | "transfer-hook";
  /** Issuer attestation flags (stored locally — not an upload vault). */
  docMemo: boolean;
  docRisk: boolean;
  docIssuer: boolean;
  docLegal: boolean;
  docFinancials: boolean;
  geoBlockUs: boolean;
  presetId: PresetId;
  /** Creator (issuer) share of trading fees; platform/partner gets remainder. */
  feeIssuer: number;
  antiSniper: boolean;
  lpLockPct: number;
  mintRenounce: boolean;
  ackBonding: boolean;
  ackDocs: boolean;
  ackFees: boolean;
  ackClaimer: boolean;
  /** Optional partner fee claimer pubkey; blank = deployer wallet. */
  feeClaimer: string;
  uri: string;
  /** Token image (https). Checked server-side (type / size) before it is stored. */
  image: string;
  totalSupply: number;
};

export const INITIAL_WIZARD: WizardState = {
  name: "",
  ticker: "",
  thesis: "",
  sector: "Equity",
  website: "",
  raiseTarget: 100_000,
  quote: "SOL",
  seedBuy: "0",
  jurisdictions: "",
  investorType: "Retail-friendly",
  transferProfile: "open-spl",
  docMemo: false,
  docRisk: false,
  docIssuer: false,
  docLegal: false,
  docFinancials: false,
  geoBlockUs: true,
  presetId: "short",
  feeIssuer: 70,
  antiSniper: true,
  lpLockPct: 100,
  mintRenounce: true,
  ackBonding: false,
  ackDocs: false,
  ackFees: false,
  ackClaimer: false,
  feeClaimer: "",
  uri: "",
  image: "",
  totalSupply: 1_000_000_000,
};

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

/** Fields validated on each step (schema-backed via validateWizard). */
export const STEP_FIELDS: Record<WizardStepId, (keyof FieldErrors)[]> = {
  basics: ["name", "ticker", "thesis", "sector", "website", "uri", "image"],
  offering: ["raiseTarget", "quote", "seedBuy"],
  curve: ["presetId", "totalSupply"],
  fees: ["feeIssuer", "lpLockPct", "feeClaimer"],
  review: [],
  launch: [],
};

export function wizardErrors(s: WizardState): FieldErrors {
  return validateWizard(s);
}

/** Errors relevant to the given step and every step before it. */
export function stepErrors(step: WizardStepId, s: WizardState): FieldErrors {
  const all = validateWizard(s);
  const upto = WIZARD_STEPS.slice(0, stepIndex(step) + 1).flatMap((x) => STEP_FIELDS[x.id]);
  const out: FieldErrors = {};
  for (const k of upto) if (all[k]) out[k] = all[k];
  return out;
}

export function canContinue(step: WizardStepId, s: WizardState): boolean {
  if (Object.keys(stepErrors(step, s)).length > 0) return false;
  switch (step) {
    case "basics":
      return true;
    case "offering":
      return s.docMemo && s.docRisk && s.docIssuer;
    case "curve":
      return !!s.presetId;
    case "fees":
      return s.lpLockPct >= MIN_LP_LOCK_PCT;
    case "review":
      return s.ackBonding && s.ackDocs && s.ackFees && s.ackClaimer;
    case "launch":
      return true;
    default:
      return false;
  }
}

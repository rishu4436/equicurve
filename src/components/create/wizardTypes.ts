import type { PresetId } from "@/lib/dbc/types";
import type { Sector } from "@/lib/demo/offerings";
import { MIN_LP_LOCK_PCT } from "@/lib/dbc/presets";
import { parseUiAmount } from "@/lib/amounts";
import type { AssetKind, ConstraintBudget, DesignedMarket, MarketObjective } from "@/lib/market/types";
import { validateWizard, type FieldErrors } from "@/lib/validation";
import type { ImageUploadState } from "./TokenImageUpload";

export const WIZARD_STEPS = [
  { id: "basics", label: "Asset" },
  { id: "goals", label: "Market goals" },
  { id: "terms", label: "Terms" },
  { id: "design", label: "Market design" },
  { id: "review", label: "Policy review" },
  { id: "launch", label: "Deploy" },
] as const;

export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

/** Old step ids still linked from /presets and the homepage. */
export const STEP_ALIASES: Record<string, WizardStepId> = {
  offering: "goals",
  curve: "design",
  fees: "terms",
};

export function resolveWizardStep(raw: string | null): WizardStepId {
  if (raw && WIZARD_STEPS.some((s) => s.id === raw)) return raw as WizardStepId;
  if (raw && STEP_ALIASES[raw]) return STEP_ALIASES[raw];
  return "basics";
}

/** Review/deploy URLs are only valid for the design currently represented by the inputs. */
export function hasCurrentDesign(s: WizardState): boolean {
  return Boolean(
    s.marketCaps &&
      s.designed &&
      s.designed.asset === s.assetKind &&
      s.designed.objective === s.objective &&
      s.designed.presetId === s.presetId,
  );
}

export function guardWizardStep(requested: WizardStepId, s: WizardState): WizardStepId {
  return (requested === "review" || requested === "launch") && !hasCurrentDesign(s) ? "design" : requested;
}

export type WizardState = {
  name: string;
  ticker: string;
  thesis: string;
  sector: Sector;
  website: string;
  xProfile: string;
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
  /** Market-design assumption. It does not create a legal claim. */
  assetKind: AssetKind;
  objective: MarketObjective;
  /** Quote units the curve should hold before graduation. Decimal string. */
  targetRaise: string;
  /** Typical order, quote units. Decimal string. */
  typicalTrade: string;
  participants: number;
  /** Synthetic cohort paths. 8 is a quick preview. 32 is a more thorough run. */
  stressPaths: number;
  /** Set only by selecting a simulated design. Deploy builds these caps. */
  marketCaps: { initial: number; migration: number } | null;
  designed: DesignedMarket | null;
  designWhy: string[];
  designLimits: string[];
  /** Limits the issuer edited. Null until they explicitly widen one and rerun the search. */
  constraintDraft: ConstraintBudget | null;
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
  imageUploadState: ImageUploadState;
  imageUploadError: string;
  launchMode: "now" | "scheduled";
  /** Browser-local datetime-local value; converted to signed UTC before save. */
  scheduledForLocal: string;
  totalSupply: number;
};

export const INITIAL_WIZARD: WizardState = {
  name: "",
  ticker: "",
  thesis: "",
  sector: "Equity",
  website: "",
  xProfile: "",
  raiseTarget: 100,
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
  assetKind: "private-company",
  objective: "controlled-discovery",
  targetRaise: "100",
  typicalTrade: "1",
  participants: 40,
  stressPaths: 8,
  marketCaps: null,
  designed: null,
  designWhy: [],
  designLimits: [],
  constraintDraft: null,
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
  imageUploadState: "idle",
  imageUploadError: "",
  launchMode: "now",
  scheduledForLocal: "",
  totalSupply: 1_000_000_000,
};

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

/** Fields validated on each step (schema-backed via validateWizard). */
export const STEP_FIELDS: Record<WizardStepId, (keyof FieldErrors)[]> = {
  basics: ["name", "ticker", "thesis", "sector", "website", "xProfile", "uri", "image"],
  goals: ["raiseTarget", "quote", "seedBuy", "totalSupply"],
  terms: ["feeIssuer", "lpLockPct", "feeClaimer"],
  design: ["presetId"],
  review: [],
  launch: [],
};

/** Changing any of these throws away a previously selected design. */
export const DESIGN_INPUT_KEYS = [
  "feeIssuer",
  "lpLockPct",
  "antiSniper",
  "targetRaise",
  "typicalTrade",
  "participants",
  "assetKind",
  "objective",
  "quote",
  "totalSupply",
  "stressPaths",
] as const;

export function applyWizardPatch(s: WizardState, p: Partial<WizardState>): WizardState {
  const next: WizardState = { ...s, ...p };
  const touched = Object.keys(p);
  const clears =
    !("marketCaps" in p) &&
    (touched.some((k) => (DESIGN_INPUT_KEYS as readonly string[]).includes(k)) ||
      "presetId" in p ||
      "constraintDraft" in p);
  if (clears) {
    next.marketCaps = null;
    next.designed = null;
    next.designWhy = [];
    next.designLimits = [];
    if (!("constraintDraft" in p)) next.constraintDraft = null;
  }
  if (typeof p.targetRaise === "string") {
    const n = Number(p.targetRaise);
    if (Number.isFinite(n) && n >= 1 && n <= 1_000_000_000_000) {
      next.raiseTarget = Math.min(1_000_000_000_000, Math.max(1, Math.round(n)));
    }
  }
  return next;
}

function briefReady(s: WizardState): boolean {
  if (!Number.isInteger(s.participants) || s.participants < 1 || s.participants > 1_000_000) return false;
  try {
    const decimals = s.quote === "USDC" ? 6 : 9;
    const target = parseUiAmount(s.targetRaise, decimals);
    const typical = parseUiAmount(s.typicalTrade, decimals);
    return target > 0n && typical > 0n && typical <= target * 1_000n;
  } catch {
    return false;
  }
}

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
  if (step === "basics" && ["uploading", "invalid", "failed"].includes(s.imageUploadState)) return false;
  switch (step) {
    case "basics":
      return true;
    case "goals":
      return s.docMemo && s.docRisk && s.docIssuer && briefReady(s);
    case "terms":
      return s.lpLockPct >= MIN_LP_LOCK_PCT;
    case "design":
      return !!s.presetId && !!s.marketCaps && s.marketCaps.migration > s.marketCaps.initial;
    case "review":
      return s.ackBonding && s.ackDocs && s.ackFees && s.ackClaimer && hasCurrentDesign(s);
    case "launch":
      return hasCurrentDesign(s);
    default:
      return false;
  }
}

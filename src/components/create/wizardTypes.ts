import type { PresetId } from "@/lib/dbc/types";
import type { Sector } from "@/lib/demo/offerings";
import { MIN_LP_LOCK_PCT } from "@/lib/dbc/presets";

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
  /** SOL-only MVP — quote mint is always WSOL on-chain. */
  quote: "SOL";
  seedBuy: number;
  jurisdictions: string;
  investorType: "Retail-friendly" | "Restricted" | "Accredited-oriented";
  /** Open SPL only for now; Token-2022 transfer hooks = coming soon. */
  transferProfile: "Open SPL";
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
  uri: string;
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
  seedBuy: 0,
  jurisdictions: "",
  investorType: "Retail-friendly",
  transferProfile: "Open SPL",
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
  uri: "https://equicurve.dev/metadata.json",
  totalSupply: 1_000_000_000,
};

export function stepIndex(id: WizardStepId): number {
  return WIZARD_STEPS.findIndex((s) => s.id === id);
}

export function canContinue(step: WizardStepId, s: WizardState): boolean {
  switch (step) {
    case "basics":
      return (
        s.name.trim().length >= 2 &&
        s.ticker.trim().length >= 2 &&
        s.ticker.trim().length <= 8 &&
        s.thesis.trim().length >= 8
      );
    case "offering":
      return s.raiseTarget > 0 && s.docMemo && s.docRisk && s.docIssuer;
    case "curve":
      return !!s.presetId;
    case "fees":
      return (
        s.lpLockPct >= MIN_LP_LOCK_PCT &&
        s.feeIssuer >= 0 &&
        s.feeIssuer <= 100
      );
    case "review":
      return s.ackBonding && s.ackDocs && s.ackFees && s.ackClaimer;
    case "launch":
      return true;
    default:
      return false;
  }
}

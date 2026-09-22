import type { PresetId } from "@/lib/dbc/types";
import type { Sector } from "@/lib/demo/offerings";

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
  quote: "USDC" | "SOL";
  seedBuy: number;
  jurisdictions: string;
  investorType: "Retail-friendly" | "Restricted" | "Accredited-oriented";
  transferProfile: "Open SPL" | "Token-2022 hook" | "Hybrid";
  docMemo: boolean;
  docRisk: boolean;
  docIssuer: boolean;
  docLegal: boolean;
  docFinancials: boolean;
  geoBlockUs: boolean;
  presetId: PresetId;
  totalTradingFeeBps: number;
  feeIssuer: number;
  feePlatform: number;
  feeAdvisor: number;
  antiSniper: boolean;
  lpLockPct: number;
  vestingDays: number;
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
  quote: "USDC",
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
  presetId: "long",
  totalTradingFeeBps: 100,
  feeIssuer: 70,
  feePlatform: 20,
  feeAdvisor: 10,
  antiSniper: true,
  lpLockPct: 10,
  vestingDays: 1,
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
      return (
        s.raiseTarget > 0 && s.docMemo && s.docRisk && s.docIssuer
      );
    case "curve":
      return !!s.presetId;
    case "fees":
      return (
        s.lpLockPct >= 10 &&
        s.feeIssuer + s.feePlatform + s.feeAdvisor === 100
      );
    case "review":
      return s.ackBonding && s.ackDocs && s.ackFees && s.ackClaimer;
    case "launch":
      return true;
    default:
      return false;
  }
}

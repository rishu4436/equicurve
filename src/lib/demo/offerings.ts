import type { PresetId } from "@/lib/dbc/types";

export type Sector =
  | "Equity"
  | "RWA"
  | "Fund"
  | "Private Co"
  | "Other";

export type OfferingStatus = "raising" | "graduated" | "new";

export type DemoOffering = {
  id: string;
  name: string;
  ticker: string;
  sector: Sector;
  thesis: string;
  quote: "SOL" | "USDC";
  raiseTarget: number;
  raised: number;
  presetId: PresetId;
  feeBps: number;
  /** Never true for illustrative demos — no real attestation. */
  verified: boolean;
  lockPct: number;
  status: OfferingStatus;
  volume24h: number;
  createdAt: string; // ISO
  pool?: string;
  mint?: string;
  /** Static fiction for UI examples — not live pools. */
  illustrative?: boolean;
};

/**
 * Illustrative board only. Hidden from default Explore; behind
 * “Show examples” / `?demo=1`. Not live markets.
 */
export const DEMO_OFFERINGS: DemoOffering[] = [
  {
    id: "acme-equity",
    name: "Acme Equity Unit",
    ticker: "ACME",
    sector: "Equity",
    thesis: "Tokenized participating interest in Acme Labs Series A SPV.",
    quote: "SOL",
    raiseTarget: 150_000,
    raised: 98_400,
    presetId: "long",
    feeBps: 100,
    verified: false,
    lockPct: 100,
    status: "raising",
    volume24h: 42_100,
    createdAt: "2026-09-20T10:00:00+05:30",
    illustrative: true,
  },
  {
    id: "harbor-rwa",
    name: "Harbor Invoice Pool",
    ticker: "HRBR",
    sector: "RWA",
    thesis: "Short-duration invoice receivables pool with weekly NAV notes.",
    quote: "SOL",
    raiseTarget: 250_000,
    raised: 250_000,
    presetId: "flat",
    feeBps: 80,
    verified: false,
    lockPct: 100,
    status: "graduated",
    volume24h: 18_200,
    createdAt: "2026-09-10T09:00:00+05:30",
    illustrative: true,
  },
  {
    id: "northstar-fund",
    name: "Northstar Fund Interest",
    ticker: "NSTAR",
    sector: "Fund",
    thesis: "Fractional LP interest discovery for a Solana-native growth fund.",
    quote: "SOL",
    raiseTarget: 75_000,
    raised: 12_800,
    presetId: "exponential",
    feeBps: 120,
    verified: false,
    lockPct: 100,
    status: "new",
    volume24h: 6_400,
    createdAt: "2026-09-21T18:00:00+05:30",
    illustrative: true,
  },
  {
    id: "cedar-private",
    name: "Cedar Private Co",
    ticker: "CEDAR",
    sector: "Private Co",
    thesis: "Employee liquidity window for Cedar Robotics preferred units.",
    quote: "SOL",
    raiseTarget: 100_000,
    raised: 61_200,
    presetId: "equity",
    feeBps: 100,
    verified: false,
    lockPct: 100,
    status: "raising",
    volume24h: 9_900,
    createdAt: "2026-09-18T14:00:00+05:30",
    illustrative: true,
  },
  {
    id: "lumen-carbon",
    name: "Lumen Carbon Credits",
    ticker: "LUMN",
    sector: "RWA",
    thesis: "Verified carbon credit basket with quarterly retirement reports.",
    quote: "SOL",
    raiseTarget: 200_000,
    raised: 44_000,
    presetId: "short",
    feeBps: 90,
    verified: false,
    lockPct: 100,
    status: "new",
    volume24h: 3_100,
    createdAt: "2026-09-21T22:30:00+05:30",
    illustrative: true,
  },
  {
    id: "atlas-grad",
    name: "Atlas Warehouse ABS",
    ticker: "ATLAS",
    sector: "RWA",
    thesis: "Warehouse ABS tranche discovery; graduated to DAMM v2.",
    quote: "SOL",
    raiseTarget: 500_000,
    raised: 500_000,
    presetId: "flat",
    feeBps: 100,
    verified: false,
    lockPct: 100,
    status: "graduated",
    volume24h: 55_000,
    createdAt: "2026-08-28T11:00:00+05:30",
    illustrative: true,
  },
];

export function getOffering(id: string): DemoOffering | undefined {
  return DEMO_OFFERINGS.find((o) => o.id === id || o.ticker === id);
}

export function filterOfferings(
  tab: "trending" | "new" | "raising" | "graduated",
): DemoOffering[] {
  const now = Date.now();
  const fortyEightH = 48 * 60 * 60 * 1000;
  switch (tab) {
    case "trending":
      return [...DEMO_OFFERINGS].sort((a, b) => b.volume24h - a.volume24h);
    case "new":
      return DEMO_OFFERINGS.filter(
        (o) => now - new Date(o.createdAt).getTime() < fortyEightH,
      );
    case "raising":
      return DEMO_OFFERINGS.filter((o) => o.status === "raising");
    case "graduated":
      return DEMO_OFFERINGS.filter((o) => o.status === "graduated");
    default:
      return DEMO_OFFERINGS;
  }
}

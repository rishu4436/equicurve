import type { Sector } from "@/lib/demo/offerings";
import type { PresetId, QuoteLabel } from "@/lib/dbc/types";
import type { RegistryMeta } from "@/lib/registry/types";

export type ExploreOffering = {
  id: string;
  pool: string;
  mint: string;
  config: string;
  name: string;
  ticker: string;
  thesis: string;
  sector: Sector | string;
  quote: QuoteLabel;
  raiseTarget: number;
  raised: number;
  quoteProgress: number | null;
  presetId: PresetId | string;
  feeBps: number;
  lockPct: number;
  status: "raising" | "graduated" | "new";
  volume24h: number;
  createdAt: string;
  creator: string;
  cluster: string;
  verified: boolean;
  illustrative: false;
  source: "registry" | "config-gpa";
  onChain?: boolean;
};

export type ExploreResponse = {
  ok: boolean;
  source: string;
  label: string;
  cached: boolean;
  cacheAgeMs: number;
  cacheTtlSec: number;
  offerings: ExploreOffering[];
  counts: { registry: number; configGpa: number; enriched: number };
  limits: string[];
  warning?: string | null;
  error?: string | null;
  /** Active registry storage backend (file | upstash) — no secrets. */
  registry?: RegistryMeta;
};

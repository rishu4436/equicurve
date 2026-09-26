import type { Sector } from "@/lib/demo/offerings";
import type { PresetId, QuoteLabel } from "@/lib/dbc/types";
import type { RegistryMeta, RegistryStatus } from "@/lib/registry/types";

/** Per-offering on-chain verification state for Explore. */
export type VerificationState = "not_checked" | "verified" | "rpc_unavailable" | "not_found";

export type OfferingVerification = {
  state: VerificationState;
  /** ISO time of the last on-chain check attempt (null = never checked). */
  checkedAt: string | null;
  /** Cluster the check ran against. */
  cluster: string;
  error?: string;
};

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
  /** 0..1 from on-chain quote reserve / threshold; null = unknown. */
  quoteProgress: number | null;
  presetId: PresetId | string;
  lockPct: number | null;
  status: RegistryStatus;
  /** "chain" only when THIS response verified the pool on-chain. */
  statusSource: "chain" | "registry";
  verification: OfferingVerification;
  /** Profile text signed by the on-chain creator. */
  profileSigned: boolean;
  createdAt: string;
  creator: string;
  cluster: string;
  illustrative: false;
  source: "registry" | "config-gpa";
};

export type ExploreCounts = {
  registry: number;
  configGpa: number;
  enriched: number;
  verified: number;
  notFound: number;
  rpcUnavailable: number;
  notChecked: number;
};

export type ExploreResponse = {
  ok: boolean;
  source: string;
  label: string;
  cached: boolean;
  cacheAgeMs: number;
  cacheTtlSec: number;
  /** Active cluster for all verification states. */
  cluster: string;
  /** ok = all checked pools read; degraded = some RPC failures; unavailable = none read. */
  rpcStatus: "ok" | "degraded" | "unavailable" | "idle";
  offerings: ExploreOffering[];
  counts: ExploreCounts;
  limits: string[];
  warning?: string | null;
  error?: string | null;
  /** Active registry storage backend (file | upstash) — no secrets. */
  registry?: RegistryMeta;
};

import type { Sector } from "@/lib/demo/offerings";
import type { PresetId, QuoteLabel } from "@/lib/dbc/types";

/** Chain-derived status. "unknown" = never verified on-chain (legacy row). */
export type RegistryStatus = "new" | "raising" | "complete" | "graduated" | "unknown";

/** Active durable-storage backend for the Explore launch registry. */
export type RegistryBackend = "file" | "upstash";

export type RegistryMeta = {
  backend: RegistryBackend;
};

/**
 * Server-side EquiCurve launch registry entry (not a full chain indexer).
 *
 * Trust model:
 * - pool / mint / config / creator / quote / feeClaimer / lock / status /
 *   isMigrated / dammPool are written ONLY from on-chain reads by the server.
 * - name / ticker / thesis / sector / preset / raiseTarget / website are an
 *   off-chain profile authored by the on-chain creator (wallet-signed).
 */
export type RegistryLaunch = {
  pool: string;
  mint: string;
  config: string;
  creator: string;
  quoteMint: string | null;
  quote: QuoteLabel;
  feeClaimer: string | null;
  lockPct: number | null;
  creatorFeePct: number | null;
  status: RegistryStatus;
  isMigrated: boolean;
  /** Set only after the DAMM v2 pool account was fetched on-chain. */
  dammPool: string | null;

  name: string;
  ticker: string;
  thesis: string;
  sector: Sector;
  presetId: PresetId;
  raiseTarget: number;
  website?: string;

  cluster: string;
  createdAt: string;
  registeredAt: string;
  updatedAt: string;
  /** Last successful on-chain read by the server (ISO), null for legacy rows. */
  chainCheckedAt: string | null;
  /** Wallet that signed the profile (equals on-chain creator), null for legacy. */
  authSigner: string | null;
  authIssuedAt: string | null;
};

/** Durable store for EquiCurve Explore launch registry. */
export interface LaunchRegistryStore {
  readonly backend: RegistryBackend;
  list(): Promise<RegistryLaunch[]>;
  get(pool: string): Promise<RegistryLaunch | null>;
  /** Insert or replace an already-authorized, server-built entry. */
  put(entry: RegistryLaunch): Promise<RegistryLaunch>;
}

export type RegistryFilePayload = {
  version: 1 | 2;
  updatedAt: string;
  launches: RegistryLaunch[];
};

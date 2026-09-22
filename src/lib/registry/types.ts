import type { Sector } from "@/lib/demo/offerings";
import type { PresetId, QuoteLabel } from "@/lib/dbc/types";

export type RegistryStatus = "raising" | "graduated" | "new";

/** Active durable-storage backend for the Explore launch registry. */
export type RegistryBackend = "file" | "upstash";

export type RegistryMeta = {
  backend: RegistryBackend;
};

/** Server-side EquiCurve launch registry entry (not a full chain indexer). */
export type RegistryLaunch = {
  pool: string;
  mint: string;
  config: string;
  name: string;
  ticker: string;
  thesis: string;
  sector: Sector;
  quote: QuoteLabel;
  raiseTarget: number;
  presetId: PresetId;
  feeBps: number;
  feeIssuerPct?: number;
  lockPct: number;
  creator: string;
  /** Partner feeClaimer pubkey when known. */
  feeClaimer?: string;
  createdAt: string; // ISO
  cluster: string;
  status: RegistryStatus;
  sig: string;
  dammPool?: string;
  migrateSig?: string;
  /** When this record was last written to the registry. */
  registeredAt: string;
};

export type RegistryLaunchInput = Omit<RegistryLaunch, "registeredAt"> & {
  registeredAt?: string;
};

/** Durable store for EquiCurve Explore launch registry. */
export interface LaunchRegistryStore {
  readonly backend: RegistryBackend;
  list(): Promise<RegistryLaunch[]>;
  get(pool: string): Promise<RegistryLaunch | null>;
  upsert(input: RegistryLaunchInput): Promise<RegistryLaunch>;
  patch(
    pool: string,
    patch: Partial<RegistryLaunchInput>,
  ): Promise<RegistryLaunch | null>;
}

export type RegistryFilePayload = {
  version: 1;
  updatedAt: string;
  launches: RegistryLaunch[];
};

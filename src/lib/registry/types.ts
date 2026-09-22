import type { Sector } from "@/lib/demo/offerings";
import type { PresetId, QuoteLabel } from "@/lib/dbc/types";

export type RegistryStatus = "raising" | "graduated" | "new";

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

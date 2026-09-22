import type { RegistryLaunch, RegistryLaunchInput } from "./types";

export const MAX_REGISTRY_ENTRIES = 500;

export function emptyRegistryPayload(): {
  version: 1;
  updatedAt: string;
  launches: RegistryLaunch[];
} {
  return { version: 1, updatedAt: new Date().toISOString(), launches: [] };
}

export function sortLaunchesNewestFirst(
  launches: RegistryLaunch[],
): RegistryLaunch[] {
  return [...launches].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Validate + normalize an upsert input into a RegistryLaunch. */
export function normalizeLaunchInput(
  input: RegistryLaunchInput,
): RegistryLaunch {
  const pool = input.pool?.trim();
  const mint = input.mint?.trim();
  const config = input.config?.trim();
  const name = input.name?.trim();
  const ticker = input.ticker?.trim().toUpperCase();
  if (!pool || !mint || !config || !name || !ticker) {
    throw new Error("pool, mint, config, name, and ticker are required");
  }

  const now = new Date().toISOString();
  return {
    pool,
    mint,
    config,
    name,
    ticker,
    thesis: (input.thesis ?? "").trim(),
    sector: input.sector ?? "Other",
    quote: input.quote === "USDC" ? "USDC" : "SOL",
    raiseTarget: Math.max(0, Number(input.raiseTarget) || 0),
    presetId: input.presetId ?? "flat",
    feeBps: Math.max(0, Number(input.feeBps) || 0),
    feeIssuerPct:
      input.feeIssuerPct != null ? Number(input.feeIssuerPct) : undefined,
    lockPct: Math.max(0, Number(input.lockPct) || 0),
    creator: (input.creator ?? "").trim(),
    feeClaimer: input.feeClaimer?.trim() || undefined,
    createdAt: input.createdAt || now,
    cluster: input.cluster || "devnet",
    status:
      input.status === "graduated"
        ? "graduated"
        : input.status === "new"
          ? "new"
          : "raising",
    sig: (input.sig ?? "").trim(),
    dammPool: input.dammPool?.trim() || undefined,
    migrateSig: input.migrateSig?.trim() || undefined,
    registeredAt: input.registeredAt || now,
  };
}

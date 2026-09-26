import type { RegistryFilePayload, RegistryLaunch } from "./types";
import { isValidPublicKey, PRESET_IDS, SECTORS } from "@/lib/validation";

export const MAX_REGISTRY_ENTRIES = 500;

export function emptyRegistryPayload(): RegistryFilePayload {
  return { version: 2, updatedAt: new Date().toISOString(), launches: [] };
}

export function sortLaunchesNewestFirst(launches: RegistryLaunch[]): RegistryLaunch[] {
  return [...launches].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

const str = (v: unknown, max = 200): string =>
  typeof v === "string" ? v.slice(0, max) : "";

/**
 * Coerce a stored row (possibly legacy v1, written before authorization
 * existed) into the current shape. Legacy rows keep their descriptive fields
 * but are marked unverified: status "unknown", chainCheckedAt/authSigner null.
 * Rows with invalid addresses are dropped.
 */
export function coerceStoredLaunch(raw: unknown): RegistryLaunch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isValidPublicKey(r.pool) || !isValidPublicKey(r.mint)) return null;
  const verified = typeof r.authSigner === "string" && typeof r.chainCheckedAt === "string";
  const now = new Date().toISOString();
  const status = r.status;
  return {
    pool: r.pool,
    mint: r.mint,
    config: isValidPublicKey(r.config) ? r.config : "",
    creator: isValidPublicKey(r.creator) ? r.creator : "",
    quoteMint: isValidPublicKey(r.quoteMint) ? r.quoteMint : null,
    quote: r.quote === "USDC" ? "USDC" : "SOL",
    feeClaimer: isValidPublicKey(r.feeClaimer) ? r.feeClaimer : null,
    lockPct: typeof r.lockPct === "number" ? r.lockPct : null,
    creatorFeePct:
      typeof r.creatorFeePct === "number"
        ? r.creatorFeePct
        : typeof r.feeIssuerPct === "number"
          ? r.feeIssuerPct
          : null,
    status: verified &&
      (status === "new" || status === "raising" || status === "complete" || status === "graduated")
      ? status
      : "unknown",
    isMigrated: verified ? r.isMigrated === true : false,
    dammPool: verified && isValidPublicKey(r.dammPool) ? r.dammPool : null,
    name: str(r.name, 48) || `Pool ${String(r.pool).slice(0, 4)}…`,
    ticker: str(r.ticker, 8).toUpperCase(),
    thesis: str(r.thesis, 140),
    sector: (SECTORS as readonly string[]).includes(String(r.sector))
      ? (r.sector as RegistryLaunch["sector"])
      : "Other",
    presetId: (PRESET_IDS as readonly string[]).includes(String(r.presetId))
      ? (r.presetId as RegistryLaunch["presetId"])
      : "flat",
    raiseTarget: typeof r.raiseTarget === "number" && r.raiseTarget >= 0 ? r.raiseTarget : 0,
    website: typeof r.website === "string" && r.website ? r.website : undefined,
    cluster: str(r.cluster, 20) || "devnet",
    createdAt: str(r.createdAt, 40) || now,
    registeredAt: str(r.registeredAt, 40) || now,
    updatedAt: str(r.updatedAt, 40) || str(r.registeredAt, 40) || now,
    chainCheckedAt: verified ? (r.chainCheckedAt as string) : null,
    authSigner: verified ? (r.authSigner as string) : null,
    authIssuedAt: verified && typeof r.authIssuedAt === "string" ? r.authIssuedAt : null,
  };
}

export function parseRegistryPayload(raw: unknown): RegistryFilePayload {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return emptyRegistryPayload();
    }
  }
  if (!obj || typeof obj !== "object" || !Array.isArray((obj as { launches?: unknown }).launches)) {
    return emptyRegistryPayload();
  }
  const p = obj as { updatedAt?: unknown; launches: unknown[] };
  return {
    version: 2,
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
    launches: p.launches.map(coerceStoredLaunch).filter((x): x is RegistryLaunch => !!x),
  };
}

/** Replace/insert by pool, newest first, capped. */
export function mergeEntry(
  payload: RegistryFilePayload,
  entry: RegistryLaunch,
): RegistryFilePayload {
  const rest = payload.launches.filter((l) => l.pool !== entry.pool);
  return {
    version: 2,
    updatedAt: new Date().toISOString(),
    launches: [entry, ...rest].slice(0, MAX_REGISTRY_ENTRIES),
  };
}

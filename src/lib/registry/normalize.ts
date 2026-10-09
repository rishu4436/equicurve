import type { PublicRegistryLaunch, RegistryFilePayload, RegistryLaunch } from "./types";
import { parseStoredDesign } from "./design";
import { isValidPublicKey, normalizeHttpsUrl, normalizeXProfile, PRESET_IDS, SECTORS } from "@/lib/validation";
import { registryUsdcMints, supportedQuoteLabel } from "./quote";

export const MAX_REGISTRY_ENTRIES = 500;

export class StaleRegistryWrite extends Error {
  readonly code = "stale_authorization" as const;
  constructor() {
    super("A newer authorization for this pool is already stored");
    this.name = "StaleRegistryWrite";
  }
}

export function isStaleRegistryWrite(error: unknown): boolean {
  return error instanceof StaleRegistryWrite || (error instanceof Error && error.name === "StaleRegistryWrite");
}

export function readRegistryRevision(raw: unknown): number {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return 0;
    }
  }
  if (!obj || typeof obj !== "object") return 0;
  const rev = (obj as { revision?: unknown }).revision;
  if (typeof rev === "number" && Number.isInteger(rev) && rev >= 0) return rev;
  if (typeof rev === "string" && /^\d+$/.test(rev)) {
    const n = Number(rev);
    return Number.isSafeInteger(n) ? n : 0;
  }
  return 0;
}

export function emptyRegistryPayload(): RegistryFilePayload {
  return { version: 2, revision: 0, updatedAt: new Date().toISOString(), launches: [] };
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
 * Rows with invalid addresses or unsupported quote mints are dropped. Legacy
 * rows without a quote mint retain only an explicit stored denomination and
 * remain unverified; a missing label is never invented.
 */
export function coerceStoredLaunch(raw: unknown): RegistryLaunch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isValidPublicKey(r.pool) || !isValidPublicKey(r.mint)) return null;
  const quoteMint = isValidPublicKey(r.quoteMint) ? r.quoteMint : null;
  const chainQuote = supportedQuoteLabel(quoteMint, registryUsdcMints());
  // Legacy labels remain unverified claims; unknown mints are never relabelled SOL.
  const quote = chainQuote ?? (!quoteMint && (r.quote === "SOL" || r.quote === "USDC") ? r.quote : null);
  if (!quote) return null;
  const verified = !!chainQuote && typeof r.authSigner === "string" && typeof r.chainCheckedAt === "string";
  const now = new Date().toISOString();
  const status = r.status;
  return {
    pool: r.pool,
    mint: r.mint,
    config: isValidPublicKey(r.config) ? r.config : "",
    creator: isValidPublicKey(r.creator) ? r.creator : "",
    quoteMint,
    quote,
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
    website: typeof r.website === "string" && r.website ? normalizeHttpsUrl(r.website) ?? undefined : undefined,
    xProfile: typeof r.xProfile === "string" && r.xProfile ? normalizeXProfile(r.xProfile) ?? undefined : undefined,
    cluster: str(r.cluster, 20) || "devnet",
    createdAt: str(r.createdAt, 40) || now,
    registeredAt: str(r.registeredAt, 40) || now,
    updatedAt: str(r.updatedAt, 40) || str(r.registeredAt, 40) || now,
    chainCheckedAt: verified ? (r.chainCheckedAt as string) : null,
    authSigner: verified ? (r.authSigner as string) : null,
    authIssuedAt: verified && typeof r.authIssuedAt === "string" ? r.authIssuedAt : null,
    design: parseStoredDesign(r.design),
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
    revision: readRegistryRevision(obj),
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : new Date().toISOString(),
    launches: p.launches.map(coerceStoredLaunch).filter((x): x is RegistryLaunch => !!x),
  };
}

export type MergeResult =
  | { ok: true; payload: RegistryFilePayload }
  | { ok: false; reason: "stale_authorization" };

function olderAuthorization(prev: RegistryLaunch, entry: RegistryLaunch): boolean {
  if (!prev.authIssuedAt) return false;
  if (!entry.authIssuedAt) return true;
  const prevMs = Date.parse(prev.authIssuedAt);
  const nextMs = Date.parse(entry.authIssuedAt);
  if (!Number.isFinite(prevMs) || !Number.isFinite(nextMs)) return false;
  return nextMs < prevMs;
}

/** Replace/insert by pool, newest first, capped. A strictly older authorization is refused. */
export function mergeEntry(payload: RegistryFilePayload, entry: RegistryLaunch): MergeResult {
  const prev = payload.launches.find((row) => row.pool === entry.pool);
  if (prev && olderAuthorization(prev, entry)) return { ok: false, reason: "stale_authorization" };
  const rest = payload.launches.filter((row) => row.pool !== entry.pool);
  return {
    ok: true,
    payload: {
      version: 2,
      revision: payload.revision ?? 0,
      updatedAt: new Date().toISOString(),
      launches: [entry, ...rest].slice(0, MAX_REGISTRY_ENTRIES),
    },
  };
}

/** True only after server-side chain verification succeeded for this row. */
export function isRegistryVerified(r: Pick<RegistryLaunch, "authSigner" | "chainCheckedAt" | "creator" | "quoteMint" | "quote">): boolean {
  return (
    supportedQuoteLabel(r.quoteMint, registryUsdcMints()) === r.quote &&
    typeof r.authSigner === "string" &&
    typeof r.chainCheckedAt === "string" &&
    r.chainCheckedAt.length > 0 &&
    r.authSigner === r.creator
  );
}

/** API shape: adds the explicit `verified` flag. */
export function toPublicLaunch(r: RegistryLaunch): PublicRegistryLaunch {
  return { ...r, verified: isRegistryVerified(r) };
}

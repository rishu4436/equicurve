import { isValidPublicKey } from "@/lib/validation";

export type TokenMetadataJson = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url?: string;
};

/** Stored record: public JSON + who is allowed to change it. */
export type MetadataRecord = {
  v: 2;
  meta: TokenMetadataJson;
  /** Wallet that signed the write (pre-launch = future pool creator). null = legacy. */
  owner: string | null;
  pool: string | null;
  issuedAt: string | null;
  updatedAt: string;
};

/** Metadata ids are mint addresses (base58 public keys). */
export function isValidMetadataId(id: string): boolean {
  return isValidPublicKey(id);
}

export class StaleMetadataWrite extends Error {
  readonly code = "stale_authorization" as const;
  constructor() {
    super("A newer metadata authorization is already stored");
    this.name = "StaleMetadataWrite";
  }
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isMetadataJson(value: unknown): value is TokenMetadataJson {
  if (!value || typeof value !== "object") return false;
  const meta = value as Record<string, unknown>;
  if (typeof meta.name !== "string" || typeof meta.symbol !== "string") return false;
  if (typeof meta.description !== "string" || typeof meta.image !== "string") return false;
  if (meta.external_url != null && typeof meta.external_url !== "string") return false;
  return true;
}

function nullableKey(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && isValidPublicKey(value));
}

/** Accept a stored v2 object. Returns null for anything that is not that shape. */
export function parseMetadataRecord(raw: unknown): MetadataRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (obj.v !== 2 || !isMetadataJson(obj.meta)) return null;
  if (!nullableKey(obj.owner) || !nullableKey(obj.pool)) return null;
  if (!(obj.issuedAt === null || isIso(obj.issuedAt))) return null;
  if (!isIso(obj.updatedAt)) return null;
  const meta = obj.meta;
  return {
    v: 2,
    meta: {
      name: meta.name,
      symbol: meta.symbol,
      description: meta.description,
      image: meta.image,
      ...(typeof meta.external_url === "string" && meta.external_url ? { external_url: meta.external_url } : {}),
    },
    owner: obj.owner,
    pool: obj.pool,
    issuedAt: obj.issuedAt,
    updatedAt: obj.updatedAt,
  };
}

/** Bare v1 file: public metadata JSON and no owner. */
export function parseLegacyMetadata(raw: unknown): MetadataRecord | null {
  if (!isMetadataJson(raw)) return null;
  return {
    v: 2,
    meta: {
      name: raw.name,
      symbol: raw.symbol,
      description: raw.description,
      image: raw.image,
      ...(raw.external_url ? { external_url: raw.external_url } : {}),
    },
    owner: null,
    pool: null,
    issuedAt: null,
    updatedAt: new Date(0).toISOString(),
  };
}

export function metadataIssuedAtMs(record: Pick<MetadataRecord, "issuedAt">): number {
  if (!record.issuedAt) return Number.NEGATIVE_INFINITY;
  const ms = Date.parse(record.issuedAt);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** Equal timestamps are stale, matching authorizeMetadataWrite's `>=` check. */
export function metadataWriteIsNewer(current: Pick<MetadataRecord, "issuedAt">, next: Pick<MetadataRecord, "issuedAt">): boolean {
  return metadataIssuedAtMs(next) > metadataIssuedAtMs(current);
}

export function decodeStoredJson(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Compare-and-set token for one metadata key.
 * "*" = key absent. "?" = present but no issuedAt string to protect.
 * Any other value is the stored issuedAt string ("" when a valid record has null).
 */
export function metadataCasToken(raw: unknown): string {
  if (raw == null) return "*";
  const decoded = decodeStoredJson(raw);
  if (!decoded || typeof decoded !== "object") return "?";
  const issued = (decoded as { issuedAt?: unknown }).issuedAt;
  if (typeof issued === "string") return issued;
  if ((issued == null) && parseMetadataRecord(decoded)) return "";
  return "?";
}

export function observedIssuedAtMs(raw: unknown): number | null {
  const token = metadataCasToken(raw);
  if (token === "*" || token === "?" || token === "") return null;
  const ms = Date.parse(token);
  return Number.isFinite(ms) ? ms : null;
}

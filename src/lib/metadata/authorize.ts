/**
 * Hosted metadata write authorization (pure; chain access injected).
 *
 * - id must be a mint address and equal payload.mint
 * - body is a creator-signed launch payload with `metadata`
 * - new record + mint NOT yet on-chain (pre-launch): allowed; owner = signer
 * - new record + mint already on-chain: signer must be the on-chain creator of payload.pool
 *   (whose baseMint must equal the id)
 * - identity (id = mint, name, symbol) is immutable once a record exists;
 *   description / image / external_url are editable (see ./policy.ts)
 * - a non-empty image must pass the injected server-side check (https,
 *   image content-type, ≤ 2 MB) — see ./imageCheck.ts
 * - existing record: signer must equal stored owner (legacy owner-less rows
 *   require the on-chain creator) and issuedAt must be newer (anti-replay);
 *   identical content from the owner is an idempotent no-op
 */
import { canonicalJson, signedLaunchBodySchema, verifyLaunchAuth } from "@/lib/auth/launchAuth";
import { firstIssue } from "@/lib/validation";
import type { ChainLookupResult } from "@/lib/registry/authorize";
import type { ImageCheckResult } from "./imageCheck";
import { checkMetadataEdit } from "./policy";
import type { MetadataRecord, TokenMetadataJson } from "./store";

export type MintExistence = "exists" | "missing" | "unknown";

export type MetadataWriteResult =
  | { ok: true; record: MetadataRecord; unchanged: boolean }
  | { ok: false; status: number; code: string; error: string };

const fail = (status: number, code: string, error: string): MetadataWriteResult => ({
  ok: false,
  status,
  code,
  error,
});

export async function authorizeMetadataWrite(args: {
  id: string;
  body: unknown;
  serverCluster: string;
  nowMs: number;
  existing: MetadataRecord | null;
  mintExists: (mint: string) => Promise<MintExistence>;
  lookup: (pool: string) => Promise<ChainLookupResult>;
  /** Server-side image URL check (https, type, size). Skipped when omitted. */
  checkImage?: (url: string) => Promise<ImageCheckResult>;
}): Promise<MetadataWriteResult> {
  const parsed = signedLaunchBodySchema.safeParse(args.body);
  if (!parsed.success) return fail(400, "invalid_body", firstIssue(parsed.error));
  const body = parsed.data;
  const { payload } = body;
  if (!payload.metadata) return fail(400, "missing_metadata", "payload.metadata is required");
  if (payload.mint !== args.id) return fail(400, "id_mismatch", "URL id must equal payload.mint");
  if (payload.cluster !== args.serverCluster) {
    return fail(400, "cluster_mismatch", `This server hosts ${args.serverCluster} metadata`);
  }
  const v = verifyLaunchAuth(body, args.nowMs);
  if (!v.ok) return fail(v.status, v.code, v.error);

  const meta: TokenMetadataJson = {
    name: payload.metadata.name,
    symbol: payload.metadata.symbol,
    description: payload.metadata.description || `${payload.metadata.name} (${payload.metadata.symbol})`,
    image: payload.metadata.image,
    ...(payload.metadata.external_url ? { external_url: payload.metadata.external_url } : {}),
  };
  const record: MetadataRecord = {
    v: 2,
    meta,
    owner: v.signer,
    pool: payload.pool,
    issuedAt: body.auth.issuedAt,
    updatedAt: new Date(args.nowMs).toISOString(),
  };

  const requireOnChainCreator = async (): Promise<MetadataWriteResult | null> => {
    const chain = await args.lookup(payload.pool);
    if (chain.status === "rpc_unavailable") {
      return fail(503, "rpc_unavailable", "RPC unavailable — cannot verify the on-chain creator");
    }
    if (chain.status === "not_found") {
      return fail(403, "pool_not_found", "Mint exists on-chain but payload.pool is not its DBC pool");
    }
    if (chain.snapshot.baseMint !== args.id) {
      return fail(403, "mint_mismatch", "payload.pool's base mint does not match this metadata id");
    }
    if (chain.snapshot.creator !== v.signer) {
      return fail(403, "not_creator", "Only the on-chain pool creator can edit this metadata");
    }
    return null;
  };

  const imageOk = async (): Promise<MetadataWriteResult | null> => {
    if (!meta.image || !args.checkImage) return null;
    // Unchanged image on an existing record is not re-fetched.
    if (args.existing?.meta.image === meta.image) return null;
    const r = await args.checkImage(meta.image);
    return r.ok ? null : fail(422, `image_${r.code}`, r.error);
  };

  const ex = args.existing;
  const policy = checkMetadataEdit({
    action: payload.action,
    existing: ex?.meta ?? null,
    existingPool: ex?.pool ?? null,
    next: meta,
    pool: payload.pool,
  });
  if (ex) {
    if (ex.owner && ex.owner !== v.signer) {
      return fail(403, "not_owner", "Metadata is owned by another wallet");
    }
    if (!policy.ok) return fail(409, policy.code, policy.error);
    if (ex.owner === v.signer && canonicalJson(ex.meta) === canonicalJson(meta)) {
      return { ok: true, record: ex, unchanged: true };
    }
    if (ex.issuedAt && Date.parse(ex.issuedAt) >= v.issuedAtMs) {
      return fail(409, "stale_authorization", "A newer metadata authorization is already stored");
    }
    if (!ex.owner) {
      const denied = await requireOnChainCreator();
      if (denied) return denied;
    }
    const img = await imageOk();
    if (img) return img;
    return { ok: true, record, unchanged: false };
  }
  if (!policy.ok) return fail(409, policy.code, policy.error);

  const mint = await args.mintExists(args.id);
  if (mint === "unknown") {
    return fail(503, "rpc_unavailable", "RPC unavailable — cannot check whether the mint exists");
  }
  if (mint === "exists") {
    const denied = await requireOnChainCreator();
    if (denied) return denied;
  }
  const img = await imageOk();
  if (img) return img;
  return { ok: true, record, unchanged: false };
}

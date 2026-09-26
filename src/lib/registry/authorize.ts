/**
 * Registry write authorization (pure; chain access injected for tests).
 *
 * POST (register / profile update):
 *   - body must be a wallet-signed launch payload (strict schema — unknown
 *     keys such as `status`, `creator`, `isMigrated` are rejected outright)
 *   - signature + freshness verified (ed25519)
 *   - cluster must match the server cluster
 *   - pool must exist on-chain (404 if not, 503 if RPC unavailable)
 *   - on-chain baseMint must equal payload.mint; on-chain creator must equal signer
 *   - replay / stale: issuedAt must be newer than the stored authorization
 *   - every chain field (creator, mint, config, quote, status, …) comes from chain
 *
 * PATCH (refresh): body `{ pool }` only; re-reads chain, no client fields.
 */
import { z } from "zod";
import { chainStatusFromCurve } from "@/lib/dbc/curveState";
import type { PoolSnapshot } from "@/lib/dbc/types";
import {
  canonicalJson,
  signedLaunchBodySchema,
  verifyLaunchAuth,
} from "@/lib/auth/launchAuth";
import { addressSchema, firstIssue, type LaunchProfile } from "@/lib/validation";
import type { RegistryLaunch } from "./types";

export type ChainLookupResult =
  | { status: "verified"; snapshot: PoolSnapshot }
  | { status: "not_found"; error: string }
  | { status: "rpc_unavailable"; error: string };

export type RegistryWriteResult =
  | { ok: true; entry: RegistryLaunch; unchanged: boolean }
  | { ok: false; status: number; code: string; error: string };

function fail(status: number, code: string, error: string): RegistryWriteResult {
  return { ok: false, status, code, error };
}

function quoteLabel(snapshot: PoolSnapshot, usdcMints: readonly string[]): "SOL" | "USDC" {
  return snapshot.quoteMint && usdcMints.includes(snapshot.quoteMint) ? "USDC" : "SOL";
}

/** Build an entry from chain facts + (optional) creator profile. */
export function entryFromChain(args: {
  snapshot: PoolSnapshot;
  profile: LaunchProfile | null;
  prev: RegistryLaunch | null;
  cluster: string;
  nowIso: string;
  usdcMints: readonly string[];
  auth?: { signer: string; issuedAt: string } | null;
  dammPool?: string | null;
}): RegistryLaunch {
  const { snapshot: s, profile, prev, cluster, nowIso, usdcMints, auth } = args;
  const status = chainStatusFromCurve(s.curve, s.quoteReserve);
  const base = profile ?? {
    name: prev?.name ?? `Pool ${s.pool.slice(0, 4)}…`,
    ticker: prev?.ticker ?? "",
    thesis: prev?.thesis ?? "",
    sector: prev?.sector ?? "Other",
    presetId: prev?.presetId ?? "flat",
    raiseTarget: prev?.raiseTarget ?? 0,
    website: prev?.website,
  };
  return {
    pool: s.pool,
    mint: s.baseMint,
    config: s.config,
    creator: s.creator,
    quoteMint: s.quoteMint,
    quote: quoteLabel(s, usdcMints),
    feeClaimer: s.feeClaimer,
    lockPct: s.lockPct,
    creatorFeePct: s.creatorFeePct,
    status,
    isMigrated: s.isMigrated,
    dammPool: args.dammPool !== undefined ? args.dammPool : (prev?.dammPool ?? null),
    name: base.name,
    ticker: base.ticker,
    thesis: base.thesis,
    sector: base.sector,
    presetId: base.presetId,
    raiseTarget: base.raiseTarget,
    website: base.website || undefined,
    cluster,
    createdAt: prev?.createdAt ?? nowIso,
    registeredAt: prev?.registeredAt ?? nowIso,
    updatedAt: nowIso,
    chainCheckedAt: s.checkedAt,
    authSigner: auth?.signer ?? prev?.authSigner ?? null,
    authIssuedAt: auth?.issuedAt ?? prev?.authIssuedAt ?? null,
  };
}

function sameProfile(prev: RegistryLaunch, p: LaunchProfile): boolean {
  return (
    canonicalJson({
      name: prev.name,
      ticker: prev.ticker,
      thesis: prev.thesis,
      sector: prev.sector,
      presetId: prev.presetId,
      raiseTarget: prev.raiseTarget,
      website: prev.website || undefined,
    }) === canonicalJson({ ...p, website: p.website || undefined })
  );
}

export async function authorizeRegistration(args: {
  body: unknown;
  serverCluster: string;
  nowMs: number;
  lookup: (pool: string) => Promise<ChainLookupResult>;
  getExisting: (pool: string) => Promise<RegistryLaunch | null>;
  usdcMints: readonly string[];
}): Promise<RegistryWriteResult> {
  const parsed = signedLaunchBodySchema.safeParse(args.body);
  if (!parsed.success) {
    return fail(400, "invalid_body", firstIssue(parsed.error));
  }
  const body = parsed.data;
  const { payload } = body;
  if (!payload.profile) {
    return fail(400, "missing_profile", "payload.profile is required for registry writes");
  }
  if (payload.cluster !== args.serverCluster) {
    return fail(400, "cluster_mismatch", `This server indexes ${args.serverCluster}, not ${payload.cluster}`);
  }
  const v = verifyLaunchAuth(body, args.nowMs);
  if (!v.ok) return fail(v.status, v.code, v.error);

  const chain = await args.lookup(payload.pool);
  if (chain.status === "not_found") {
    return fail(404, "pool_not_found", `Pool ${payload.pool} not found on ${args.serverCluster}`);
  }
  if (chain.status === "rpc_unavailable") {
    return fail(503, "rpc_unavailable", "RPC unavailable — could not verify pool on-chain. Retry shortly.");
  }
  const snap = chain.snapshot;
  if (snap.baseMint !== payload.mint) {
    return fail(400, "mint_mismatch", "payload.mint does not match the pool's on-chain base mint");
  }
  if (snap.creator !== v.signer) {
    return fail(403, "not_creator", "Only the pool's on-chain creator can register or edit this offering");
  }

  const existing = await args.getExisting(payload.pool);
  if (existing?.authIssuedAt && Date.parse(existing.authIssuedAt) >= v.issuedAtMs) {
    if (existing.authSigner === v.signer && sameProfile(existing, payload.profile)) {
      return { ok: true, entry: existing, unchanged: true };
    }
    return fail(409, "stale_authorization", "A newer authorization for this pool is already stored");
  }
  const entry = entryFromChain({
    snapshot: snap,
    profile: payload.profile,
    prev: existing,
    cluster: args.serverCluster,
    nowIso: new Date(args.nowMs).toISOString(),
    usdcMints: args.usdcMints,
    auth: { signer: v.signer, issuedAt: body.auth.issuedAt },
  });
  const unchanged =
    !!existing && existing.authSigner === v.signer && sameProfile(existing, payload.profile);
  return { ok: true, entry, unchanged };
}

export const refreshBodySchema = z.object({ pool: addressSchema }).strict();

/** Re-derive chain fields for an existing entry. No client-provided fields. */
export async function refreshFromChain(args: {
  body: unknown;
  serverCluster: string;
  nowMs: number;
  lookup: (pool: string) => Promise<ChainLookupResult>;
  getExisting: (pool: string) => Promise<RegistryLaunch | null>;
  usdcMints: readonly string[];
  verifyDamm?: (snapshot: PoolSnapshot) => Promise<string | null>;
}): Promise<RegistryWriteResult> {
  const parsed = refreshBodySchema.safeParse(args.body);
  if (!parsed.success) {
    return fail(400, "invalid_body", `Only { pool } is accepted — status is derived from chain. ${firstIssue(parsed.error)}`);
  }
  const existing = await args.getExisting(parsed.data.pool);
  if (!existing) return fail(404, "not_registered", "Pool is not in the registry");
  const chain = await args.lookup(parsed.data.pool);
  if (chain.status === "not_found") {
    return fail(404, "pool_not_found", `Pool not found on ${args.serverCluster}`);
  }
  if (chain.status === "rpc_unavailable") {
    return fail(503, "rpc_unavailable", "RPC unavailable — could not refresh from chain");
  }
  let dammPool: string | null | undefined;
  if (chain.snapshot.isMigrated && args.verifyDamm) {
    dammPool = await args.verifyDamm(chain.snapshot);
  }
  const entry = entryFromChain({
    snapshot: chain.snapshot,
    profile: null,
    prev: existing,
    cluster: args.serverCluster,
    nowIso: new Date(args.nowMs).toISOString(),
    usdcMints: args.usdcMints,
    dammPool,
  });
  return { ok: true, entry, unchanged: false };
}

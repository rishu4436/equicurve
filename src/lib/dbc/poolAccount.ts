import { PublicKey, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { DBC_PROGRAM_ID } from "@/lib/constants";
import { withRpcRetry } from "@/lib/rpc";
import { getDbcClient } from "./client";

/**
 * Authoritative DBC pool account access.
 *
 * SDK ≥1.5.12 returns BOTH account variants (standard `VirtualPool` and
 * `TransferHookPool`) wrapped as `{ poolState: {...} }`, so the wrapper shape
 * cannot tell them apart. We read the raw account once, check the program
 * owner + 8-byte Anchor discriminator, and decode with the matching coder.
 */

/** Anchor account discriminators (from the DBC IDL shipped in the SDK). */
export const VIRTUAL_POOL_DISCRIMINATOR = [213, 224, 5, 209, 98, 69, 119, 92];
export const TRANSFER_HOOK_POOL_DISCRIMINATOR = [237, 219, 184, 23, 42, 189, 169, 35];

export type DbcPoolKind = "standard" | "transfer-hook";

/** Subset of on-chain `poolState` fields EquiCurve relies on. */
export type DbcPoolState = {
  config: PublicKey;
  creator: PublicKey;
  baseMint: PublicKey;
  baseVault?: PublicKey;
  quoteVault?: PublicKey;
  baseReserve?: BN;
  quoteReserve: BN;
  sqrtPrice?: BN;
  isMigrated: number;
  migrationProgress: number;
  poolType?: number;
  [key: string]: unknown;
};

export type FetchedDbcPool = {
  address: PublicKey;
  kind: DbcPoolKind;
  /** The SDK-shaped wrapped account (`{ poolState }`) — pass this to SDK quote fns. */
  account: { poolState: DbcPoolState };
  state: DbcPoolState;
};

function startsWith(data: Uint8Array, disc: number[]): boolean {
  if (data.length < 8) return false;
  for (let i = 0; i < 8; i++) if (data[i] !== disc[i]) return false;
  return true;
}

/** Pure: identify pool variant from raw account bytes. */
export function detectPoolKind(data: Uint8Array): DbcPoolKind | null {
  if (startsWith(data, VIRTUAL_POOL_DISCRIMINATOR)) return "standard";
  if (startsWith(data, TRANSFER_HOOK_POOL_DISCRIMINATOR)) return "transfer-hook";
  return null;
}

/**
 * Pure: unwrap `{ poolState }` (current SDK) or a legacy flat account.
 * Throws if required fields are missing — never guesses.
 */
export function unwrapPoolState(account: unknown): DbcPoolState {
  if (!account || typeof account !== "object") {
    throw new Error("DBC pool account is empty");
  }
  const a = account as Record<string, unknown>;
  const inner = (
    a.poolState && typeof a.poolState === "object" ? a.poolState : a
  ) as Record<string, unknown>;
  // Migration fields are required too: a missing isMigrated must never be
  // read as "not migrated".
  const missing = ["config", "creator", "baseMint", "quoteReserve", "isMigrated", "migrationProgress"].filter(
    (k) => inner[k] == null,
  );
  if (missing.length) {
    throw new Error(
      `Unexpected DBC pool account layout (missing ${missing.join(", ")})`,
    );
  }
  return {
    ...(inner as DbcPoolState),
    isMigrated: Number(inner.isMigrated),
    migrationProgress: Number(inner.migrationProgress),
  };
}

export class PoolNotFoundError extends Error {
  constructor(pool: string, reason = "not found") {
    super(`DBC pool ${pool} ${reason} on this cluster.`);
    this.name = "PoolNotFoundError";
  }
}

/**
 * Fetch + decode a DBC pool. Returns null when the address has no account,
 * is not owned by the DBC program, or is not a pool account.
 * RPC failures throw (callers map them to "rpc unavailable").
 */
export async function fetchDbcPool(
  connection: Connection,
  pool: PublicKey,
): Promise<FetchedDbcPool | null> {
  const info = await withRpcRetry(() => connection.getAccountInfo(pool, "confirmed"));
  if (!info) return null;
  if (!info.owner.equals(DBC_PROGRAM_ID)) return null;
  const kind = detectPoolKind(info.data);
  if (!kind) return null;
  const program = getDbcClient(connection).state.getProgram();
  const decoded = program.coder.accounts.decode(
    kind === "standard" ? "virtualPool" : "transferHookPool",
    info.data,
  ) as unknown;
  const state = unwrapPoolState(decoded);
  return {
    address: pool,
    kind,
    account: { poolState: state },
    state,
  };
}

/** Same as fetchDbcPool but throws PoolNotFoundError instead of returning null. */
export async function requireDbcPool(
  connection: Connection,
  pool: PublicKey,
): Promise<FetchedDbcPool> {
  const p = await fetchDbcPool(connection, pool);
  if (!p) throw new PoolNotFoundError(pool.toBase58());
  return p;
}

// ---- Back-compat helpers -------------------------------------------------

export type NormalizedPool = {
  config: PublicKey;
  baseMint: PublicKey;
  creator: PublicKey;
  raw: unknown;
};

/** @deprecated prefer fetchDbcPool / unwrapPoolState. */
export function normalizePoolAccount(account: unknown): NormalizedPool {
  const s = unwrapPoolState(account);
  return { config: s.config, baseMint: s.baseMint, creator: s.creator, raw: account };
}

export function toPublicKey(v: PublicKey | string): PublicKey {
  return typeof v === "string" ? new PublicKey(v) : new PublicKey(v.toBase58());
}

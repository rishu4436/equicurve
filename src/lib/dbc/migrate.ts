import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  deriveDammV2PoolAddress,
  getBaseTokenForSwap,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  PublicKey,
  type Connection,
  type Keypair,
  type Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { getCluster, getDammV2ConfigOverride, USDC_MINT_DEVNET, USDC_MINT_MAINNET, WSOL_MINT } from "@/lib/constants";
import { getCpAmm } from "@/lib/damm/client";
import { EquiCurveError } from "@/lib/errors";
import { withRpcRetry } from "@/lib/rpc";
import { setFreshBlockhash } from "@/lib/send";
import { getDbcClient } from "./client";
import {
  checkMigrationConfig,
  computeCurveState,
  type DestinationCheck,
  type MigrationConfigCheck,
} from "./curveState";
import { PoolNotFoundError, requireDbcPool } from "./poolAccount";
import type { PoolSnapshot } from "./types";

export const DAMM_V2_FEE_CONFIGS: readonly string[] = DAMM_V2_MIGRATION_FEE_ADDRESS.map(
  (k) => k.toBase58(),
);

function pk(v: unknown): PublicKey | null {
  if (!v) return null;
  try {
    return new PublicKey(v as PublicKey | string);
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bnStr(v: unknown): string | null {
  if (v == null) return null;
  try {
    return new BN(String((v as { toString(): string }).toString())).toString(10);
  } catch {
    return null;
  }
}

async function resolveQuoteDecimals(
  connection: Connection,
  quoteMint: PublicKey,
): Promise<number | null> {
  if (quoteMint.equals(WSOL_MINT)) return 9;
  if (quoteMint.equals(USDC_MINT_MAINNET) || quoteMint.equals(USDC_MINT_DEVNET)) return 6;
  try {
    const info = await withRpcRetry(() => connection.getParsedAccountInfo(quoteMint));
    const data = info.value?.data as { parsed?: { info?: { decimals?: number } } } | undefined;
    return num(data?.parsed?.info?.decimals);
  } catch {
    return null;
  }
}

/**
 * Authoritative snapshot from the pool + config accounts.
 * Pool read failure throws (PoolNotFoundError for missing); a config read
 * failure yields `curve.phase = "unknown"` — never 0% or complete.
 */
export async function fetchPoolSnapshot(
  connection: Connection,
  pool: PublicKey,
): Promise<PoolSnapshot> {
  const fetched = await requireDbcPool(connection, pool);
  const s = fetched.state;
  const client = getDbcClient(connection);

  let config: Record<string, unknown> | null = null;
  try {
    config = (await withRpcRetry(() =>
      client.state.getPoolConfig(s.config),
    )) as unknown as Record<string, unknown> | null;
  } catch {
    config = null;
  }

  const quoteMintPk = config ? pk(config.quoteMint) : null;
  const quoteDecimals = quoteMintPk ? await resolveQuoteDecimals(connection, quoteMintPk) : null;
  const threshold = config ? bnStr(config.migrationQuoteThreshold) : null;
  const quoteReserve = bnStr(s.quoteReserve);
  if (quoteReserve == null || !Number.isInteger(s.isMigrated) || !Number.isInteger(s.migrationProgress)) {
    // Layout drift: never default to "0 raised" / "not migrated".
    throw new Error("Unexpected DBC pool account layout (quoteReserve / isMigrated / migrationProgress)");
  }
  const isMigrated = s.isMigrated === 1;
  const curve = computeCurveState({
    quoteReserve,
    migrationQuoteThreshold: threshold,
    isMigrated,
    migrationProgress: s.migrationProgress,
  });

  let baseProgress: number | null = null;
  if (config && s.sqrtPrice) {
    try {
      const sold = getBaseTokenForSwap(
        config.sqrtStartPrice as BN,
        s.sqrtPrice as BN,
        config.curve as never,
      );
      const total = getBaseTokenForSwap(
        config.sqrtStartPrice as BN,
        config.migrationSqrtPrice as BN,
        config.curve as never,
      );
      if (!total.isZero()) {
        const r = Number(sold.muln(1_000_000).div(total).toString()) / 1_000_000;
        baseProgress = Math.max(0, Math.min(1, r));
      }
    } catch {
      baseProgress = null;
    }
  }

  return {
    pool: pool.toBase58(),
    config: s.config.toBase58(),
    baseMint: s.baseMint.toBase58(),
    quoteMint: quoteMintPk?.toBase58() ?? null,
    creator: s.creator.toBase58(),
    kind: fetched.kind,
    feeClaimer: config ? (pk(config.feeClaimer)?.toBase58() ?? null) : null,
    quoteReserve,
    migrationQuoteThreshold: threshold,
    isMigrated,
    migrationProgress: s.migrationProgress,
    migrationOption: config ? num(config.migrationOption) : null,
    migrationFeeOption: config ? num(config.migrationFeeOption) : null,
    baseDecimals: config ? num(config.tokenDecimal) : null,
    quoteDecimals,
    lockPct: config ? num(config.partnerPermanentLockedLiquidityPercentage) : null,
    creatorFeePct: config ? num(config.creatorTradingFeePercentage) : null,
    curve,
    quoteProgress: curve.progress,
    baseProgress,
    configRead: !!config,
    checkedAt: new Date().toISOString(),
  };
}

export type ChainLookup =
  | { status: "verified"; snapshot: PoolSnapshot }
  | { status: "not_found"; error: string }
  | { status: "rpc_unavailable"; error: string };

/** Classify a snapshot read into verified / not found / rpc unavailable. */
export async function lookupPoolOnChain(
  connection: Connection,
  pool: PublicKey,
): Promise<ChainLookup> {
  try {
    const snapshot = await fetchPoolSnapshot(connection, pool);
    return { status: "verified", snapshot };
  } catch (e) {
    if (e instanceof PoolNotFoundError) {
      return { status: "not_found", error: `Pool not found on ${getCluster()}.` };
    }
    return {
      status: "rpc_unavailable",
      error: e instanceof Error ? e.message : "RPC read failed",
    };
  }
}

/** Migration config check for a snapshot (DAMM v2 target + correct fee config). */
export function migrationConfigForSnapshot(snap: PoolSnapshot): MigrationConfigCheck {
  return checkMigrationConfig({
    migrationOption: snap.migrationOption,
    migrationFeeOption: snap.migrationFeeOption,
    dammV2FeeConfigs: DAMM_V2_FEE_CONFIGS,
    overrideDammConfig: getDammV2ConfigOverride()?.toBase58() ?? null,
  });
}

/** DAMM v2 pool PDA for (fee config, base, quote). SDK sorts mints internally. */
export function deriveDammV2Pool(args: {
  dammConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
}): PublicKey {
  return deriveDammV2PoolAddress(args.dammConfig, args.baseMint, args.quoteMint);
}

/** @deprecated kept for callers; returns null on failure. */
export function tryDeriveDammV2PoolAddress(args: {
  dammConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
}): string | null {
  try {
    return deriveDammV2Pool(args).toBase58();
  } catch {
    return null;
  }
}

/**
 * A derived address is not proof the pool exists — fetch the DAMM v2 pool
 * account itself. Returns exists only when the account decodes.
 */
export async function verifyDammV2Pool(
  connection: Connection,
  address: PublicKey,
): Promise<DestinationCheck> {
  const cp = getCpAmm(connection);
  try {
    const exists = await withRpcRetry(() => cp.isPoolExist(address));
    if (!exists) return "missing";
    await withRpcRetry(() => cp.fetchPoolState(address));
    return "exists";
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/not found|does not exist|Account does not exist/i.test(msg)) return "missing";
    return "rpc_unavailable";
  }
}

/** Expected DAMM v2 destination for a snapshot, or null if config unknown / invalid. */
export function expectedDammDestination(snap: PoolSnapshot): {
  dammConfig: PublicKey;
  dammPool: PublicKey;
} | null {
  const check = migrationConfigForSnapshot(snap);
  if (!check.ok || !snap.quoteMint) return null;
  const dammConfig = new PublicKey(check.expectedDammConfig);
  return {
    dammConfig,
    dammPool: deriveDammV2Pool({
      dammConfig,
      baseMint: new PublicKey(snap.baseMint),
      quoteMint: new PublicKey(snap.quoteMint),
    }),
  };
}

/**
 * Build migrateToDammV2 after checking actual eligibility from chain:
 * - curve complete (quoteReserve ≥ migrationQuoteThreshold) and not migrated
 * - config.migrationOption = DAMM v2 and DAMM config = fee-option config
 */
export async function prepareDammV2Migration(args: {
  connection: Connection;
  payer: PublicKey;
  pool: PublicKey;
}): Promise<{
  tx: Transaction;
  firstPositionNft: Keypair;
  secondPositionNft: Keypair;
  dammConfig: PublicKey;
  dammPoolAddress: string;
  snapshot: PoolSnapshot;
  lastValidBlockHeight: number;
}> {
  const { connection, payer, pool } = args;
  if (!payer) {
    throw new EquiCurveError("Connect a wallet to migrate.", "MISSING_WALLET");
  }

  const snapshot = await fetchPoolSnapshot(connection, pool);
  if (snapshot.isMigrated || snapshot.curve.phase === "migrated") {
    throw new EquiCurveError("This pool has already migrated to DAMM v2.", "VALIDATION");
  }
  if (snapshot.curve.phase === "unknown") {
    throw new EquiCurveError(
      `Cannot verify migration eligibility: ${snapshot.curve.reason ?? "pool state unknown"}. Try again when RPC is healthy.`,
      "RPC_UNAVAILABLE",
    );
  }
  if (snapshot.curve.phase !== "complete") {
    throw new EquiCurveError(
      `Curve not complete yet (${((snapshot.curve.progress ?? 0) * 100).toFixed(2)}% of the migration quote threshold).`,
      "VALIDATION",
    );
  }
  if (snapshot.curve.lockerPending) {
    throw new EquiCurveError(
      "Curve complete, but this config has locked vesting: create the DBC locker (createLocker) before migrating.",
      "VALIDATION",
    );
  }
  const check = migrationConfigForSnapshot(snapshot);
  if (!check.ok) {
    throw new EquiCurveError(check.reason, "VALIDATION");
  }
  const dest = expectedDammDestination(snapshot);
  if (!dest) {
    throw new EquiCurveError("Could not resolve the DAMM v2 destination pool.", "VALIDATION");
  }

  const client = getDbcClient(connection);
  const result = await client.migration.migrateToDammV2({
    payer,
    pool,
    dammConfig: dest.dammConfig,
  });

  const tx = result.transaction;
  const { lastValidBlockHeight } = await setFreshBlockhash(connection, tx, payer);
  tx.partialSign(result.firstPositionNftKeypair, result.secondPositionNftKeypair);

  return {
    tx,
    firstPositionNft: result.firstPositionNftKeypair,
    secondPositionNft: result.secondPositionNftKeypair,
    dammConfig: dest.dammConfig,
    dammPoolAddress: dest.dammPool.toBase58(),
    snapshot,
    lastValidBlockHeight,
  };
}

import { deriveDammV2PoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  PublicKey,
  type Connection,
  type Keypair,
  type Transaction,
} from "@solana/web3.js";
import { getDammV2ConfigKey, WSOL_MINT } from "@/lib/constants";
import { EquiCurveError } from "@/lib/errors";
import { getDbcClient } from "./client";
import { normalizePoolAccount } from "./poolAccount";
import type { PoolSnapshot } from "./types";

export async function fetchPoolSnapshot(
  connection: Connection,
  pool: PublicKey,
): Promise<PoolSnapshot> {
  const client = getDbcClient(connection);
  const account = await client.state.getPool(pool);
  if (!account) {
    throw new EquiCurveError(`Pool ${pool.toBase58()} not found.`, "SDK");
  }
  const virtualPool = normalizePoolAccount(
    account as Parameters<typeof normalizePoolAccount>[0],
  );

  let quoteProgress = 0;
  let baseProgress = 0;
  try {
    quoteProgress = await client.state.getPoolQuoteTokenCurveProgress(pool);
  } catch {
    /* ignore */
  }
  try {
    baseProgress = await client.state.getPoolBaseTokenCurveProgress(pool);
  } catch {
    /* ignore */
  }

  let migrationThreshold: string | undefined;
  try {
    const thr = await client.state.getPoolMigrationQuoteThreshold(pool);
    migrationThreshold = thr?.toString?.() ?? String(thr);
  } catch {
    /* ignore */
  }

  const isMigrated = Boolean(
    (account as { isMigrated?: number | boolean }).isMigrated ||
      (virtualPool.raw as { isMigrated?: number | boolean }).isMigrated,
  );

  let quoteMint = WSOL_MINT;
  try {
    const configAccount = await client.state.getPoolConfig(virtualPool.config);
    const raw = (configAccount as { quoteMint?: PublicKey | string } | null)
      ?.quoteMint;
    if (raw) {
      quoteMint =
        typeof raw === "string" ? new PublicKey(raw) : new PublicKey(raw);
    }
  } catch {
    /* keep WSOL fallback */
  }

  return {
    pool: pool.toBase58(),
    config: virtualPool.config.toBase58(),
    baseMint: virtualPool.baseMint.toBase58(),
    quoteMint: quoteMint.toBase58(),
    creator: virtualPool.creator.toBase58(),
    quoteProgress,
    baseProgress,
    isMigrated,
    migrationThreshold,
  };
}

/**
 * Best-effort DAMM v2 pool PDA from fee config + mints.
 * Token order matters; we sort mints (common DAMM convention). Returns null on failure.
 */
export function tryDeriveDammV2PoolAddress(args: {
  dammConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
}): string | null {
  try {
    const { dammConfig, baseMint, quoteMint } = args;
    const [first, second] =
      Buffer.compare(baseMint.toBuffer(), quoteMint.toBuffer()) <= 0
        ? [baseMint, quoteMint]
        : [quoteMint, baseMint];
    return deriveDammV2PoolAddress(dammConfig, first, second).toBase58();
  } catch {
    return null;
  }
}

export async function prepareDammV2Migration(args: {
  connection: Connection;
  payer: PublicKey;
  pool: PublicKey;
  dammConfig?: PublicKey;
}): Promise<{
  tx: Transaction;
  firstPositionNft: Keypair;
  secondPositionNft: Keypair;
  dammConfig: PublicKey;
  progress: number;
  dammPoolAddress: string | null;
  baseMint: PublicKey;
}> {
  const { connection, payer, pool } = args;
  if (!payer) {
    throw new EquiCurveError("Connect a wallet to migrate.", "MISSING_WALLET");
  }

  const snapshot = await fetchPoolSnapshot(connection, pool);
  const progress = snapshot.quoteProgress;

  if (progress < 0.999 && !snapshot.isMigrated) {
    throw new EquiCurveError(
      `Curve not complete yet (${(progress * 100).toFixed(2)}%). Keep buying until the migration threshold is met.`,
      "VALIDATION",
    );
  }

  const dammConfig = args.dammConfig ?? getDammV2ConfigKey();
  const client = getDbcClient(connection);
  const result = await client.migration.migrateToDammV2({
    payer,
    pool,
    dammConfig,
  });

  const tx = result.transaction;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = payer;
  tx.recentBlockhash = blockhash;
  tx.partialSign(
    result.firstPositionNftKeypair,
    result.secondPositionNftKeypair,
  );

  const baseMint = new PublicKey(snapshot.baseMint);
  const dammPoolAddress = tryDeriveDammV2PoolAddress({
    dammConfig,
    baseMint,
    quoteMint: new PublicKey(snapshot.quoteMint),
  });

  return {
    tx,
    firstPositionNft: result.firstPositionNftKeypair,
    secondPositionNft: result.secondPositionNftKeypair,
    dammConfig,
    progress,
    dammPoolAddress,
    baseMint,
  };
}

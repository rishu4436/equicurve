import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { EquiCurveError } from "@/lib/errors";
import { getDbcClient } from "./client";
import { withRpcRetry } from "@/lib/rpc";
import { setFreshBlockhash } from "@/lib/send";
import { requireDbcPool } from "./poolAccount";

export type FeeSideBreakdown = {
  unclaimedBase: string;
  unclaimedQuote: string;
  claimedBase: string;
  claimedQuote: string;
  totalBase: string;
  totalQuote: string;
};

export type FeeBreakdown = {
  creatorUnclaimedBase: string;
  creatorUnclaimedQuote: string;
  creatorClaimedBase: string;
  creatorClaimedQuote: string;
  creatorTotalBase: string;
  creatorTotalQuote: string;
  partnerUnclaimedBase: string;
  partnerUnclaimedQuote: string;
  partnerClaimedBase: string;
  partnerClaimedQuote: string;
  partnerTotalBase: string;
  partnerTotalQuote: string;
};

export type PoolFeeRoles = {
  pool: string;
  config: string;
  creator: string;
  feeClaimer: string;
};

function sideFromSdk(side: {
  unclaimedBaseFee: { toString(): string };
  unclaimedQuoteFee: { toString(): string };
  claimedBaseFee: { toString(): string };
  claimedQuoteFee: { toString(): string };
  totalBaseFee: { toString(): string };
  totalQuoteFee: { toString(): string };
}): FeeSideBreakdown {
  return {
    unclaimedBase: side.unclaimedBaseFee.toString(),
    unclaimedQuote: side.unclaimedQuoteFee.toString(),
    claimedBase: side.claimedBaseFee.toString(),
    claimedQuote: side.claimedQuoteFee.toString(),
    totalBase: side.totalBaseFee.toString(),
    totalQuote: side.totalQuoteFee.toString(),
  };
}

function toFeeBreakdown(
  creator: FeeSideBreakdown,
  partner: FeeSideBreakdown,
): FeeBreakdown {
  return {
    creatorUnclaimedBase: creator.unclaimedBase,
    creatorUnclaimedQuote: creator.unclaimedQuote,
    creatorClaimedBase: creator.claimedBase,
    creatorClaimedQuote: creator.claimedQuote,
    creatorTotalBase: creator.totalBase,
    creatorTotalQuote: creator.totalQuote,
    partnerUnclaimedBase: partner.unclaimedBase,
    partnerUnclaimedQuote: partner.unclaimedQuote,
    partnerClaimedBase: partner.claimedBase,
    partnerClaimedQuote: partner.claimedQuote,
    partnerTotalBase: partner.totalBase,
    partnerTotalQuote: partner.totalQuote,
  };
}

export async function fetchCreatorFeeBreakdown(
  connection: Connection,
  pool: PublicKey,
): Promise<FeeBreakdown> {
  return fetchPoolFeeBreakdown(connection, pool);
}

export async function fetchPoolFeeBreakdown(
  connection: Connection,
  pool: PublicKey,
): Promise<FeeBreakdown> {
  const client = getDbcClient(connection);
  const breakdown = await withRpcRetry(() => client.state.getPoolFeeBreakdown(pool));
  return toFeeBreakdown(
    sideFromSdk(breakdown.creator),
    sideFromSdk(breakdown.partner),
  );
}

/** Resolve on-chain creator + partner feeClaimer for a DBC pool. */
export async function resolvePoolFeeRoles(
  connection: Connection,
  pool: PublicKey,
): Promise<PoolFeeRoles> {
  const client = getDbcClient(connection);
  const virtualPool = (await requireDbcPool(connection, pool)).state;
  const configAccount = await withRpcRetry(() =>
    client.state.getPoolConfig(virtualPool.config),
  );
  if (!configAccount) {
    throw new EquiCurveError(
      `Pool config ${virtualPool.config.toBase58()} not found.`,
      "SDK",
    );
  }
  const rawClaimer = (
    configAccount as { feeClaimer?: PublicKey | string }
  ).feeClaimer;
  if (!rawClaimer) {
    throw new EquiCurveError(
      "Pool config has no feeClaimer — cannot resolve partner claim role.",
      "SDK",
    );
  }
  const feeClaimer =
    typeof rawClaimer === "string"
      ? new PublicKey(rawClaimer)
      : new PublicKey(rawClaimer);

  return {
    pool: pool.toBase58(),
    config: virtualPool.config.toBase58(),
    creator: virtualPool.creator.toBase58(),
    feeClaimer: feeClaimer.toBase58(),
  };
}

export async function prepareClaimCreatorFees(args: {
  connection: Connection;
  creator: PublicKey;
  pool: PublicKey;
}): Promise<{ tx: Transaction; breakdown: FeeBreakdown }> {
  const { connection, creator, pool } = args;
  if (!creator) {
    throw new EquiCurveError(
      "Connect the deployer (creator) wallet to claim creator fees.",
      "MISSING_WALLET",
    );
  }

  const roles = await resolvePoolFeeRoles(connection, pool);
  if (roles.creator !== creator.toBase58()) {
    throw new EquiCurveError(
      `Connected wallet is not this pool's creator. Creator is ${roles.creator.slice(0, 4)}…${roles.creator.slice(-4)}.`,
      "VALIDATION",
    );
  }

  const breakdown = await fetchPoolFeeBreakdown(connection, pool);
  const unclaimedBase = new BN(breakdown.creatorUnclaimedBase);
  const unclaimedQuote = new BN(breakdown.creatorUnclaimedQuote);

  if (unclaimedBase.isZero() && unclaimedQuote.isZero()) {
    throw new EquiCurveError(
      "No unclaimed creator trading fees for this pool.",
      "VALIDATION",
    );
  }

  const client = getDbcClient(connection);
  const { kind } = await requireDbcPool(connection, pool);
  const tx = kind === "transfer-hook"
    ? await client.creator.claimCreatorTradingFee2({
        creator,
        payer: creator,
        pool,
        receiver: creator,
        maxBaseAmount: unclaimedBase,
        maxQuoteAmount: unclaimedQuote,
      })
    : await client.creator.claimCreatorTradingFee({
        creator,
        payer: creator,
        pool,
        maxBaseAmount: unclaimedBase,
        maxQuoteAmount: unclaimedQuote,
      });

  await setFreshBlockhash(connection, tx, creator);

  return { tx, breakdown };
}

/**
 * Partner trading-fee claim via SDK `claimPartnerTradingFee` /
 * `claimPartnerTradingFee2` (transfer-hook pools).
 * Only the on-chain config `feeClaimer` can sign.
 */
export async function prepareClaimPartnerFees(args: {
  connection: Connection;
  feeClaimer: PublicKey;
  pool: PublicKey;
}): Promise<{ tx: Transaction; breakdown: FeeBreakdown; roles: PoolFeeRoles }> {
  const { connection, feeClaimer, pool } = args;
  if (!feeClaimer) {
    throw new EquiCurveError(
      "Connect the partner feeClaimer wallet to claim partner fees.",
      "MISSING_WALLET",
    );
  }

  const roles = await resolvePoolFeeRoles(connection, pool);
  if (roles.feeClaimer !== feeClaimer.toBase58()) {
    throw new EquiCurveError(
      `Connected wallet is not this pool's partner feeClaimer. feeClaimer is ${roles.feeClaimer.slice(0, 4)}…${roles.feeClaimer.slice(-4)}.`,
      "VALIDATION",
    );
  }

  const breakdown = await fetchPoolFeeBreakdown(connection, pool);
  const unclaimedBase = new BN(breakdown.partnerUnclaimedBase);
  const unclaimedQuote = new BN(breakdown.partnerUnclaimedQuote);

  if (unclaimedBase.isZero() && unclaimedQuote.isZero()) {
    throw new EquiCurveError(
      "No unclaimed partner trading fees for this pool.",
      "VALIDATION",
    );
  }

  const client = getDbcClient(connection);
  const { kind } = await requireDbcPool(connection, pool);
  const tx = kind === "transfer-hook"
    ? await client.partner.claimPartnerTradingFee2({
        feeClaimer,
        payer: feeClaimer,
        pool,
        receiver: feeClaimer,
        maxBaseAmount: unclaimedBase,
        maxQuoteAmount: unclaimedQuote,
      })
    : await client.partner.claimPartnerTradingFee({
        feeClaimer,
        payer: feeClaimer,
        pool,
        maxBaseAmount: unclaimedBase,
        maxQuoteAmount: unclaimedQuote,
      });

  await setFreshBlockhash(connection, tx, feeClaimer);

  return { tx, breakdown, roles };
}

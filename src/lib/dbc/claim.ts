import { PublicKey, type Connection, type Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { EquiCurveError } from "@/lib/errors";
import { getDbcClient } from "./client";

export type FeeBreakdown = {
  creatorUnclaimedBase: string;
  creatorUnclaimedQuote: string;
  creatorClaimedBase: string;
  creatorClaimedQuote: string;
  creatorTotalBase: string;
  creatorTotalQuote: string;
};

export async function fetchCreatorFeeBreakdown(
  connection: Connection,
  pool: PublicKey,
): Promise<FeeBreakdown> {
  const client = getDbcClient(connection);
  const breakdown = await client.state.getPoolFeeBreakdown(pool);
  return {
    creatorUnclaimedBase: breakdown.creator.unclaimedBaseFee.toString(),
    creatorUnclaimedQuote: breakdown.creator.unclaimedQuoteFee.toString(),
    creatorClaimedBase: breakdown.creator.claimedBaseFee.toString(),
    creatorClaimedQuote: breakdown.creator.claimedQuoteFee.toString(),
    creatorTotalBase: breakdown.creator.totalBaseFee.toString(),
    creatorTotalQuote: breakdown.creator.totalQuoteFee.toString(),
  };
}

export async function prepareClaimCreatorFees(args: {
  connection: Connection;
  creator: PublicKey;
  pool: PublicKey;
}): Promise<{ tx: Transaction; breakdown: FeeBreakdown }> {
  const { connection, creator, pool } = args;
  if (!creator) {
    throw new EquiCurveError("Connect the deployer wallet to claim.", "MISSING_WALLET");
  }

  const breakdown = await fetchCreatorFeeBreakdown(connection, pool);
  const unclaimedBase = new BN(breakdown.creatorUnclaimedBase);
  const unclaimedQuote = new BN(breakdown.creatorUnclaimedQuote);

  if (unclaimedBase.isZero() && unclaimedQuote.isZero()) {
    throw new EquiCurveError(
      "No unclaimed creator trading fees for this pool.",
      "VALIDATION",
    );
  }

  const client = getDbcClient(connection);
  const tx = await client.creator.claimCreatorTradingFee({
    creator,
    payer: creator,
    pool,
    maxBaseAmount: unclaimedBase,
    maxQuoteAmount: unclaimedQuote,
  });

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = creator;
  tx.recentBlockhash = blockhash;

  return { tx, breakdown };
}

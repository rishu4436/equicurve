import { SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { EquiCurveError } from "@/lib/errors";
import { getDbcClient } from "./client";
import { normalizePoolAccount } from "./poolAccount";
import { quoteDecimalsForMint } from "@/lib/constants";

export type SwapDirection = "buy" | "sell";

export async function quoteAndBuildSwap(args: {
  connection: Connection;
  owner: PublicKey;
  pool: PublicKey;
  direction: SwapDirection;
  amount: number;
  decimals?: number;
  slippageBps?: number;
}): Promise<{
  tx: Transaction;
  minimumAmountOut: string;
  amountIn: string;
}> {
  const {
    connection,
    owner,
    pool,
    direction,
    amount,
    decimals = 9,
    slippageBps = 100,
  } = args;

  if (!owner) {
    throw new EquiCurveError("Connect a wallet to trade.", "MISSING_WALLET");
  }
  if (!(amount > 0)) {
    throw new EquiCurveError("Enter a positive amount.", "VALIDATION");
  }

  const client = getDbcClient(connection);
  const account = await client.state.getPool(pool);
  if (!account) {
    throw new EquiCurveError(
      `Pool ${pool.toBase58()} not found on this RPC/cluster.`,
      "SDK",
    );
  }

  // Quote math expects the inner VirtualPool fields (unwrap transfer-hook wrapper).
  const normalized = normalizePoolAccount(
    account as Parameters<typeof normalizePoolAccount>[0],
  );
  const virtualPool =
    (account as { poolState?: unknown }).poolState ?? account;

  const config = await client.state.getPoolConfig(normalized.config);
  if (!config) {
    throw new EquiCurveError("Pool config account missing.", "SDK");
  }

    const quoteMintPk =
    (config as { quoteMint?: PublicKey }).quoteMint ??
    (normalized as { quoteMint?: PublicKey }).quoteMint;
  const resolvedDecimals = quoteMintPk
    ? quoteDecimalsForMint(quoteMintPk)
    : decimals;

const amountIn = new BN(Math.round(amount * 10 ** resolvedDecimals));
  const currentPoint =
    Number((config as { activationType?: number }).activationType) === 0
      ? new BN(await connection.getSlot("confirmed"))
      : new BN(Math.floor(Date.now() / 1000));

  const swapBaseForQuote = direction === "sell";

  const quote = client.pool.swapQuote2({
    virtualPool: virtualPool as never,
    config,
    swapBaseForQuote,
    swapMode: SwapMode.ExactIn,
    amountIn,
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  });

  const tx = await client.pool.swap2({
    owner,
    payer: owner,
    pool,
    swapBaseForQuote,
    swapMode: SwapMode.ExactIn,
    amountIn,
    minimumAmountOut: quote.minimumAmountOut ?? new BN(0),
    referralTokenAccount: null,
  });

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = owner;
  tx.recentBlockhash = blockhash;

  return {
    tx,
    minimumAmountOut: (quote.minimumAmountOut ?? new BN(0)).toString(),
    amountIn: amountIn.toString(),
  };
}

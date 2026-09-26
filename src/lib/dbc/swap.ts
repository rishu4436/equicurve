import { SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { AmountError, parseUiAmountToBN } from "@/lib/amounts";
import { EquiCurveError } from "@/lib/errors";
import { withRpcRetry } from "@/lib/rpc";
import { setFreshBlockhash } from "@/lib/send";
import { getDbcClient } from "./client";
import { requireDbcPool } from "./poolAccount";
import { isUsdcMint, WSOL_MINT } from "@/lib/constants";

export type SwapDirection = "buy" | "sell";

export const DEFAULT_SLIPPAGE_BPS = 100;

function knownQuoteDecimals(mint: PublicKey): number | null {
  if (mint.equals(WSOL_MINT)) return 9;
  if (isUsdcMint(mint)) return 6;
  return null;
}

export type SwapQuoteView = {
  tx: Transaction;
  /** Exact input atoms. */
  amountIn: string;
  inputDecimals: number;
  /** Expected output atoms (before slippage). */
  expectedOut: string;
  /** Min output atoms after slippage. */
  minimumAmountOut: string;
  outputDecimals: number;
  slippageBps: number;
};

/**
 * Quote + build a DBC ExactIn swap.
 * - buy: input = quote token (SOL 9 / USDC 6), output = base token
 * - sell: input = base token (config.tokenDecimal), output = quote
 * Amount is an exact decimal string — no float math.
 */
export async function quoteAndBuildSwap(args: {
  connection: Connection;
  owner: PublicKey;
  pool: PublicKey;
  direction: SwapDirection;
  /** Exact decimal string in input-token units. */
  amountUi: string;
  slippageBps?: number;
}): Promise<SwapQuoteView> {
  const { connection, owner, pool, direction, amountUi } = args;
  const slippageBps = args.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  if (!owner) {
    throw new EquiCurveError("Connect a wallet to trade.", "MISSING_WALLET");
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5_000) {
    throw new EquiCurveError("Slippage must be between 0.01% and 50%.", "VALIDATION");
  }

  const client = getDbcClient(connection);
  const fetched = await requireDbcPool(connection, pool);
  const config = await withRpcRetry(() => client.state.getPoolConfig(fetched.state.config));
  if (!config) {
    throw new EquiCurveError("Pool config account missing on this cluster.", "SDK");
  }
  if (fetched.state.isMigrated === 1) {
    throw new EquiCurveError(
      "This pool has graduated to DAMM v2 — trade on the DAMM v2 ticket instead.",
      "VALIDATION",
    );
  }

  const quoteMint = new PublicKey(config.quoteMint);
  const quoteDecimals = knownQuoteDecimals(quoteMint);
  if (quoteDecimals == null) {
    throw new EquiCurveError(
      `Unsupported quote mint ${quoteMint.toBase58()} (EquiCurve supports SOL / USDC).`,
      "VALIDATION",
    );
  }
  const baseDecimals = Number(config.tokenDecimal);
  if (!Number.isInteger(baseDecimals) || baseDecimals < 0 || baseDecimals > 18) {
    throw new EquiCurveError("Pool config has an invalid token decimal.", "SDK");
  }

  const swapBaseForQuote = direction === "sell";
  const inputDecimals = swapBaseForQuote ? baseDecimals : quoteDecimals;
  const outputDecimals = swapBaseForQuote ? quoteDecimals : baseDecimals;

  let amountIn: BN;
  try {
    amountIn = parseUiAmountToBN(amountUi, inputDecimals);
  } catch (e) {
    throw new EquiCurveError(
      e instanceof AmountError ? e.message : "Invalid amount.",
      "VALIDATION",
      e,
    );
  }

  const currentPoint =
    Number(config.activationType) === 0
      ? new BN(await withRpcRetry(() => connection.getSlot("confirmed")))
      : new BN(Math.floor(Date.now() / 1000));

  // SDK quote functions expect the wrapped `{ poolState }` account.
  const quote = client.pool.swapQuote2({
    virtualPool: fetched.account as never,
    config,
    swapBaseForQuote,
    swapMode: SwapMode.ExactIn,
    amountIn,
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    currentPoint,
  });

  const minOut = quote.minimumAmountOut;
  if (!minOut || minOut.isZero()) {
    throw new EquiCurveError(
      "Quote returned zero output — amount too small or curve exhausted.",
      "VALIDATION",
    );
  }

  const swapArgs = {
    owner,
    payer: owner,
    pool,
    swapBaseForQuote,
    swapMode: SwapMode.ExactIn,
    amountIn,
    minimumAmountOut: minOut,
    referralTokenAccount: null,
  } as const;
  const tx =
    fetched.kind === "transfer-hook"
      ? await client.pool.swap2WithTransferHook(swapArgs as never)
      : await client.pool.swap2(swapArgs as never);

  await setFreshBlockhash(connection, tx, owner);

  const expected =
    (quote as { outputAmount?: BN }).outputAmount ?? minOut;

  return {
    tx,
    amountIn: amountIn.toString(10),
    inputDecimals,
    expectedOut: expected.toString(10),
    minimumAmountOut: minOut.toString(10),
    outputDecimals,
    slippageBps,
  };
}

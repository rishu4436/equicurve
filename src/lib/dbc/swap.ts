import { SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getMint, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { AmountError, parseUiAmountToBN } from "@/lib/amounts";
import { EquiCurveError } from "@/lib/errors";
import { withRpcRetry } from "@/lib/rpc";
import { setFreshBlockhash } from "@/lib/send";
import { getDbcClient } from "./client";
import { planBuy, type BuyPlan } from "./fill";
import { requireDbcPool, type FetchedDbcPool } from "./poolAccount";
import { isUsdcMint, WSOL_MINT } from "@/lib/constants";

export type SwapDirection = "buy" | "sell";

export const DEFAULT_SLIPPAGE_BPS = 100;

function expectedQuoteDecimals(mint: PublicKey): number | null {
  if (mint.equals(WSOL_MINT)) return 9;
  if (isUsdcMint(mint)) return 6;
  return null;
}

/** Deterministic key of the DBC pool state a quote depends on. */
export function dbcPoolStateKey(state: { sqrtPrice?: unknown; quoteReserve?: unknown; baseReserve?: unknown }): string {
  const s = (v: unknown) => (v == null ? "?" : String((v as { toString(): string }).toString()));
  return `${s(state.sqrtPrice)}:${s(state.quoteReserve)}:${s(state.baseReserve)}`;
}

/** Re-read the pool and return its state key (null when the read fails). */
export async function fetchDbcPoolStateKey(connection: Connection, pool: PublicKey): Promise<string | null> {
  try {
    const f = await requireDbcPool(connection, pool);
    return dbcPoolStateKey(f.state as never);
  } catch {
    return null;
  }
}

export type SwapQuoteView = {
  tx: Transaction;
  direction: SwapDirection;
  /** Exact input atoms that will be passed to the program. */
  amountIn: string;
  inputDecimals: number;
  /** Expected output atoms (before slippage). */
  expectedOut: string;
  /** Min output atoms after slippage (enforced on-chain). */
  minimumAmountOut: string;
  outputDecimals: number;
  slippageBps: number;
  /** Total trading fee (creator/partner + protocol + referral), quote atoms. */
  feeAtoms: string;
  feeDecimals: number;
  /** "exact_in" or "partial_fill" (buy that reaches the curve end). */
  mode: BuyPlan["mode"];
  /** Input the curve will consume (atoms). Equals amountIn except for partial fills. */
  fillableIn: string;
  /** Input that will NOT be taken (partial fill remainder, atoms). */
  unusedIn: string;
  completesCurve: boolean;
  quoteMint: string;
  baseMint: string;
  quotedAt: number;
  poolStateKey: string;
};

async function readDecimals(connection: Connection, mint: PublicKey, programId: PublicKey): Promise<number> {
  try {
    const m = await withRpcRetry(() => getMint(connection, mint, "confirmed", programId));
    return m.decimals;
  } catch (e) {
    throw new EquiCurveError(
      `Could not read decimals for mint ${mint.toBase58()} from chain — refusing to guess.`,
      "RPC_UNAVAILABLE",
      e,
    );
  }
}

/**
 * Quote + build a DBC swap.
 * - buy: input = quote token, output = base token
 * - sell: input = base token, output = quote token
 * Both mints' decimals are read from chain. Amount is an exact decimal string.
 * Buys that would overrun the curve's migration threshold (DBC 6033) are
 * detected here and sent as PartialFill, consuming only what the curve can take.
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
  const fetched: FetchedDbcPool = await requireDbcPool(connection, pool);
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
  const expectedQ = expectedQuoteDecimals(quoteMint);
  if (expectedQ == null) {
    throw new EquiCurveError(
      `Unsupported quote mint ${quoteMint.toBase58()} (EquiCurve supports SOL / USDC).`,
      "VALIDATION",
    );
  }
  const baseMint = new PublicKey(fetched.state.baseMint);
  const baseInfo = await withRpcRetry(() => connection.getAccountInfo(baseMint, "confirmed"));
  if (!baseInfo) {
    throw new EquiCurveError(`Base mint ${baseMint.toBase58()} not found on this cluster.`, "RPC_UNAVAILABLE");
  }
  const baseProgram = baseInfo.owner.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  // Decimals come from the mint accounts, not defaults.
  const [quoteDecimals, baseDecimals] = await Promise.all([
    readDecimals(connection, quoteMint, TOKEN_PROGRAM_ID),
    readDecimals(connection, baseMint, baseProgram),
  ]);
  if (baseDecimals !== Number(config.tokenDecimal)) {
    throw new EquiCurveError(
      `Base mint decimals (${baseDecimals}) do not match the pool config (${config.tokenDecimal}).`,
      "SDK",
    );
  }
  if (quoteDecimals !== expectedQ) {
    throw new EquiCurveError(`Quote mint reports ${quoteDecimals} decimals; expected ${expectedQ}.`, "SDK");
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

  const quoteWith = (swapMode: SwapMode) =>
    // SDK quote functions expect the wrapped `{ poolState }` account.
    client.pool.swapQuote2({
      virtualPool: fetched.account as never,
      config,
      swapBaseForQuote,
      swapMode,
      amountIn,
      slippageBps,
      hasReferral: false,
      eligibleForFirstSwapWithMinFee: false,
      currentPoint,
    } as never) as unknown as import("./fill").DbcQuoteLike;

  const reserve = BigInt(String(fetched.state.quoteReserve ?? "0"));
  const threshold = BigInt(String(config.migrationQuoteThreshold));
  if (reserve >= threshold) {
    throw new EquiCurveError(
      "The bonding curve is complete — trading is closed until migration to DAMM v2.",
      "VALIDATION",
    );
  }

  let plan: BuyPlan;
  try {
    plan = swapBaseForQuote
      ? {
          mode: "exact_in",
          quote: quoteWith(SwapMode.ExactIn),
          requestedIn: BigInt(amountIn.toString(10)),
          fillableIn: BigInt(amountIn.toString(10)),
          unusedIn: 0n,
          completesCurve: false,
        }
      : planBuy({
          requestedIn: BigInt(amountIn.toString(10)),
          remainingToThreshold: threshold - reserve,
          quoteExactIn: () => quoteWith(SwapMode.ExactIn),
          quotePartialFill: () => quoteWith(SwapMode.PartialFill),
        });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/insufficient liquidity/i.test(msg)) {
      throw new EquiCurveError(
        "Not enough base tokens left in the curve for this sell/buy size. Reduce the amount.",
        "VALIDATION",
        e,
      );
    }
    throw new EquiCurveError(`Quote failed: ${msg}`, "SDK", e);
  }

  const quote = plan.quote;
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
    swapMode: plan.mode === "partial_fill" ? SwapMode.PartialFill : SwapMode.ExactIn,
    amountIn,
    minimumAmountOut: minOut,
    referralTokenAccount: null,
  } as const;
  const tx =
    fetched.kind === "transfer-hook"
      ? await client.pool.swap2WithTransferHook(swapArgs as never)
      : await client.pool.swap2(swapArgs as never);

  await setFreshBlockhash(connection, tx, owner);

  const expected = quote.outputAmount ?? minOut;
  const fee =
    BigInt((quote.tradingFee ?? new BN(0)).toString(10)) +
    BigInt((quote.protocolFee ?? new BN(0)).toString(10)) +
    BigInt((quote.referralFee ?? new BN(0)).toString(10));

  return {
    tx,
    direction,
    amountIn: amountIn.toString(10),
    inputDecimals,
    expectedOut: expected.toString(10),
    minimumAmountOut: minOut.toString(10),
    outputDecimals,
    slippageBps,
    feeAtoms: fee.toString(10),
    feeDecimals: quoteDecimals,
    mode: plan.mode,
    fillableIn: plan.fillableIn.toString(10),
    unusedIn: plan.unusedIn.toString(10),
    completesCurve: plan.completesCurve,
    quoteMint: quoteMint.toBase58(),
    baseMint: baseMint.toBase58(),
    quotedAt: Date.now(),
    poolStateKey: dbcPoolStateKey(fetched.state as never),
  };
}

import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { EquiCurveError, mapError } from "./errors";
import { withRpcRetry } from "./rpc";

type BlockhashCtx = { blockhash: string; lastValidBlockHeight: number };

/** Remember which lastValidBlockHeight belongs to each tx's blockhash. */
const blockhashCtx = new WeakMap<Transaction, BlockhashCtx>();

/**
 * Set a fresh blockhash + fee payer and remember its lastValidBlockHeight so
 * confirmation uses the SAME blockhash window the tx was signed against.
 * Must be called before any partialSign().
 */
export async function setFreshBlockhash(
  connection: Connection,
  tx: Transaction,
  feePayer: PublicKey,
): Promise<BlockhashCtx> {
  const latest = await withRpcRetry(() => connection.getLatestBlockhash("confirmed"));
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = feePayer;
  const ctx = { blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight };
  blockhashCtx.set(tx, ctx);
  return ctx;
}

export type SendProgress = {
  /** Called right after the RPC accepted the signed tx (before confirmation). */
  onSubmitted?: (signature: string) => void;
};

/**
 * Sign with the connected wallet, send, and wait for confirmation.
 * Throws (mapped) if the tx fails on-chain — a landed-but-failed tx is never
 * reported as success.
 */
export async function signAndSendTransaction(
  args: {
    connection: Connection;
    wallet: WalletContextState;
    tx: Transaction;
  } & SendProgress,
): Promise<string> {
  const { connection, wallet, tx, onSubmitted } = args;
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new EquiCurveError("Wallet not connected.", "MISSING_WALLET");
  }
  if (!tx.recentBlockhash) {
    await setFreshBlockhash(connection, tx, wallet.publicKey);
  }

  let signed: Transaction;
  try {
    signed = await wallet.signTransaction(tx);
  } catch (e) {
    const m = mapError(e);
    throw new EquiCurveError(m.message, m.kind === "user_rejected" ? "USER_REJECTED" : "SDK", e);
  }

  let sig: string;
  try {
    sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
  } catch (e) {
    throw new EquiCurveError(mapError(e).message, "SDK", e);
  }
  onSubmitted?.(sig);

  let ctx = blockhashCtx.get(tx);
  if (!ctx || ctx.blockhash !== signed.recentBlockhash) {
    // Unknown window: fall back to an upper bound from the latest blockhash.
    const latest = await withRpcRetry(() => connection.getLatestBlockhash("confirmed"));
    ctx = {
      blockhash: signed.recentBlockhash ?? latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    };
  }

  try {
    const res = await connection.confirmTransaction(
      { signature: sig, blockhash: ctx.blockhash, lastValidBlockHeight: ctx.lastValidBlockHeight },
      "confirmed",
    );
    if (res.value.err) {
      const detail = mapError({ message: JSON.stringify(res.value.err) });
      throw new EquiCurveError(
        `Transaction ${sig.slice(0, 8)}… failed on-chain: ${detail.message}`,
        "TX_FAILED",
        res.value.err,
      );
    }
  } catch (e) {
    if (e instanceof EquiCurveError) throw e;
    const m = mapError(e);
    if (m.kind === "blockhash_expired") {
      throw new EquiCurveError(
        `Transaction ${sig.slice(0, 8)}… was not confirmed before its blockhash expired. It may not have landed — check the explorer before retrying.`,
        "TX_EXPIRED",
        e,
      );
    }
    throw new EquiCurveError(m.message, "SDK", e);
  }
  return sig;
}

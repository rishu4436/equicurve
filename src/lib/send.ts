import type { WalletContextState } from "@solana/wallet-adapter-react";
import type { Connection, Transaction } from "@solana/web3.js";
import { EquiCurveError } from "./errors";

/**
 * Sign with the connected wallet and send a (possibly partially-signed) transaction.
 */
export async function signAndSendTransaction(args: {
  connection: Connection;
  wallet: WalletContextState;
  tx: Transaction;
}): Promise<string> {
  const { connection, wallet, tx } = args;
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new EquiCurveError("Wallet not connected.", "MISSING_WALLET");
  }

  try {
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      {
        signature: sig,
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
      },
      "confirmed",
    );
    return sig;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/User rejected|rejected the request/i.test(msg)) {
      throw new EquiCurveError("Wallet rejected the transaction.", "USER_REJECTED", e);
    }
    throw new EquiCurveError(msg, "SDK", e);
  }
}


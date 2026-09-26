import { getTokenProgram } from "@meteora-ag/cp-amm-sdk";
import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { EquiCurveError } from "@/lib/errors";
import { withRpcRetry } from "@/lib/rpc";
import { setFreshBlockhash } from "@/lib/send";
import { getCpAmm } from "./client";
import type { DammPoolSnapshot, DammPositionView } from "./types";

export async function fetchUserDammPositions(args: {
  connection: Connection;
  pool: PublicKey;
  user: PublicKey;
}): Promise<DammPositionView[]> {
  const { connection, pool, user } = args;
  const cp = getCpAmm(connection);
  const rows = await withRpcRetry(() => cp.getUserPositionByPool(pool, user));
  return rows.map((row) => {
    const st = row.positionState;
    return {
      position: row.position.toBase58(),
      positionNftAccount: row.positionNftAccount.toBase58(),
      unlockedLiquidity: st.unlockedLiquidity?.toString?.() ?? "0",
      feeAPending: st.feeAPending?.toString?.() ?? "0",
      feeBPending: st.feeBPending?.toString?.() ?? "0",
    };
  });
}

export async function buildClaimPositionFeeTx(args: {
  connection: Connection;
  owner: PublicKey;
  pool: PublicKey;
  snap: DammPoolSnapshot;
  position: PublicKey;
  positionNftAccount: PublicKey;
}): Promise<Transaction> {
  const { connection, owner, pool, snap, position, positionNftAccount } = args;
  if (!snap.exists) {
    throw new EquiCurveError("DAMM v2 pool not found.", "SDK");
  }
  const cp = getCpAmm(connection);
  const poolState = await cp.fetchPoolState(pool);

  const tx = await cp.claimPositionFee2({
    owner,
    position,
    pool,
    positionNftAccount,
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: getTokenProgram(Number(poolState.tokenAFlag)),
    tokenBProgram: getTokenProgram(Number(poolState.tokenBFlag)),
    receiver: owner,
    feePayer: owner,
  });

  await setFreshBlockhash(connection, tx, owner);
  return tx;
}

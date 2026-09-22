import { getTokenProgram } from "@meteora-ag/cp-amm-sdk";
import { getMint } from "@solana/spl-token";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  getDammV2ConfigKey,
  quoteLabelForMint,
  WSOL_MINT,
} from "@/lib/constants";
import { tryDeriveDammV2PoolAddress } from "@/lib/dbc/migrate";
import { EquiCurveError } from "@/lib/errors";
import { getCpAmm } from "./client";
import type { DammPoolSnapshot } from "./types";

/** Best-effort Meteora app deep-link for a DAMM v2 pool. */
export function meteoraDammPoolUrl(pool: string): string {
  return `https://app.meteora.ag/pools/${pool}`;
}

/**
 * Resolve the post-grad DAMM v2 pool address for a DBC offering.
 * Prefers stored launch.dammPool, else derives from fee config + mints,
 * then verifies via CpAmm.isPoolExist.
 */
export async function resolveDammPoolAddress(args: {
  connection: Connection;
  baseMint: string;
  quoteMint: string;
  storedDammPool?: string | null;
}): Promise<{
  address: string | null;
  exists: boolean;
  source: DammPoolSnapshot["source"];
}> {
  const { connection, baseMint, quoteMint, storedDammPool } = args;
  const cp = getCpAmm(connection);

  if (storedDammPool) {
    try {
      const pk = new PublicKey(storedDammPool);
      const exists = await cp.isPoolExist(pk);
      return { address: pk.toBase58(), exists, source: "launch" };
    } catch {
      /* fall through */
    }
  }

  const derived = tryDeriveDammV2PoolAddress({
    dammConfig: getDammV2ConfigKey(),
    baseMint: new PublicKey(baseMint),
    quoteMint: new PublicKey(quoteMint),
  });
  if (!derived) return { address: null, exists: false, source: "unknown" };

  try {
    const exists = await cp.isPoolExist(new PublicKey(derived));
    return { address: derived, exists, source: "derived" };
  } catch (e) {
    throw new EquiCurveError(
      "Failed to check DAMM v2 pool existence on RPC.",
      "RPC_UNAVAILABLE",
      e,
    );
  }
}

async function readMintDecimals(
  connection: Connection,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<number> {
  try {
    const info = await getMint(
      connection,
      mint,
      connection.commitment,
      tokenProgram,
    );
    return info.decimals;
  } catch {
    if (mint.equals(WSOL_MINT)) return 9;
    return quoteLabelForMint(mint) === "USDC" ? 6 : 9;
  }
}

export async function fetchDammPoolSnapshot(args: {
  connection: Connection;
  pool: PublicKey;
  baseMint: string;
  quoteMint: string;
  source: DammPoolSnapshot["source"];
}): Promise<DammPoolSnapshot> {
  const { connection, pool, baseMint, quoteMint, source } = args;
  const cp = getCpAmm(connection);
  const exists = await cp.isPoolExist(pool);
  if (!exists) {
    return {
      address: pool.toBase58(),
      exists: false,
      source,
      tokenAMint: "",
      tokenBMint: "",
      quoteMint,
      baseMint,
      poolStatus: -1,
      activationType: 0,
      sqrtPrice: "0",
      tokenADecimals: 0,
      tokenBDecimals: 0,
    };
  }

  const state = await cp.fetchPoolState(pool);
  const tokenAProgram = getTokenProgram(Number(state.tokenAFlag));
  const tokenBProgram = getTokenProgram(Number(state.tokenBFlag));
  const [tokenADecimals, tokenBDecimals] = await Promise.all([
    readMintDecimals(connection, state.tokenAMint, tokenAProgram),
    readMintDecimals(connection, state.tokenBMint, tokenBProgram),
  ]);

  return {
    address: pool.toBase58(),
    exists: true,
    source,
    tokenAMint: state.tokenAMint.toBase58(),
    tokenBMint: state.tokenBMint.toBase58(),
    quoteMint,
    baseMint,
    poolStatus: Number(state.poolStatus),
    activationType: Number(state.activationType),
    sqrtPrice: state.sqrtPrice?.toString?.() ?? String(state.sqrtPrice),
    tokenADecimals,
    tokenBDecimals,
  };
}

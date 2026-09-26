import { getTokenProgram } from "@meteora-ag/cp-amm-sdk";
import { getMint } from "@solana/spl-token";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { DestinationCheck } from "@/lib/dbc/curveState";
import { tryDeriveDammV2PoolAddress, verifyDammV2Pool } from "@/lib/dbc/migrate";
import { withRpcRetry } from "@/lib/rpc";
import { EquiCurveError } from "@/lib/errors";
import { getCpAmm } from "./client";
import type { DammPoolSnapshot } from "./types";

/** Best-effort Meteora app deep-link for a DAMM v2 pool. */
export function meteoraDammPoolUrl(pool: string): string {
  return `https://app.meteora.ag/pools/${pool}`;
}

/**
 * Resolve the post-grad DAMM v2 pool address for a DBC offering.
 * Derives from the DAMM v2 fee config required by the pool's on-chain
 * migrationFeeOption (caller passes it) + mints. A stored address is only used
 * when no config is known, and either way the account must be fetched before
 * it counts as existing — a derived address is not proof.
 */
export async function resolveDammPoolAddress(args: {
  connection: Connection;
  baseMint: string;
  quoteMint: string;
  storedDammPool?: string | null;
  /** DAMM v2 fee config from the pool's migrationFeeOption. */
  dammConfig?: string | null;
}): Promise<{
  address: string | null;
  exists: boolean;
  check: DestinationCheck;
  source: DammPoolSnapshot["source"];
}> {
  const { connection, baseMint, quoteMint, storedDammPool, dammConfig } = args;

  let address: string | null = null;
  let source: DammPoolSnapshot["source"] = "unknown";
  if (dammConfig) {
    address = tryDeriveDammV2PoolAddress({
      dammConfig: new PublicKey(dammConfig),
      baseMint: new PublicKey(baseMint),
      quoteMint: new PublicKey(quoteMint),
    });
    source = "derived";
  } else if (storedDammPool) {
    try {
      address = new PublicKey(storedDammPool).toBase58();
      source = "launch";
    } catch {
      address = null;
    }
  }
  if (!address) return { address: null, exists: false, check: "unchecked", source: "unknown" };

  const check = await verifyDammV2Pool(connection, new PublicKey(address));
  if (check === "rpc_unavailable") {
    throw new EquiCurveError(
      "Failed to check DAMM v2 pool existence on RPC.",
      "RPC_UNAVAILABLE",
    );
  }
  return { address, exists: check === "exists", check, source };
}

async function readMintDecimals(
  connection: Connection,
  mint: PublicKey,
  tokenProgram: PublicKey,
): Promise<number> {
  try {
    const info = await withRpcRetry(() => getMint(connection, mint, "confirmed", tokenProgram));
    return info.decimals;
  } catch (e) {
    // Decimals always come from chain — never guessed, not even for SOL/USDC.
    throw new EquiCurveError(`Could not read decimals for mint ${mint.toBase58()}.`, "RPC_UNAVAILABLE", e);
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
  const exists = await withRpcRetry(() => cp.isPoolExist(pool));
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

  const state = await withRpcRetry(() => cp.fetchPoolState(pool));
  // The account must be the pool for THIS offering's mints (guards a stale or
  // wrong stored address from being treated as the graduated pool).
  const mints = new Set([state.tokenAMint.toBase58(), state.tokenBMint.toBase58()]);
  if (!mints.has(baseMint) || !mints.has(quoteMint)) {
    throw new EquiCurveError(
      `DAMM v2 account ${pool.toBase58()} does not hold this offering's mints.`,
      "VALIDATION",
    );
  }
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

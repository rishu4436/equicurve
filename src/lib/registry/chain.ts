import { PublicKey } from "@solana/web3.js";
import { getServerConnection } from "@/lib/connection";
import { knownUsdcMints } from "@/lib/constants";
import {
  expectedDammDestination,
  lookupPoolOnChain,
  verifyDammV2Pool,
} from "@/lib/dbc/migrate";
import type { PoolSnapshot } from "@/lib/dbc/types";
import type { ChainLookupResult } from "./authorize";

export const USDC_MINTS: readonly string[] = knownUsdcMints();

export function serverLookup(pool: string): Promise<ChainLookupResult> {
  return lookupPoolOnChain(getServerConnection(), new PublicKey(pool));
}

/** Returns the DAMM v2 pool address only if its account was fetched on-chain. */
export async function serverVerifyDamm(snapshot: PoolSnapshot): Promise<string | null> {
  const dest = expectedDammDestination(snapshot);
  if (!dest) return null;
  const check = await verifyDammV2Pool(getServerConnection(), dest.dammPool);
  return check === "exists" ? dest.dammPool.toBase58() : null;
}

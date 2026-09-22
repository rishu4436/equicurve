import { CpAmm } from "@meteora-ag/cp-amm-sdk";
import type { Connection } from "@solana/web3.js";

let cache: { endpoint: string; client: CpAmm } | null = null;

/** Shared CpAmm client keyed by RPC endpoint. */
export function getCpAmm(connection: Connection): CpAmm {
  if (cache && cache.endpoint === connection.rpcEndpoint) return cache.client;
  const client = new CpAmm(connection);
  cache = { endpoint: connection.rpcEndpoint, client };
  return client;
}

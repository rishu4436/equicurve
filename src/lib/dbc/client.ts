import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import type { Commitment, Connection } from "@solana/web3.js";
import { getConnection } from "@/lib/connection";
import { EquiCurveError } from "@/lib/errors";

let cache: { endpoint: string; client: DynamicBondingCurveClient } | null = null;

export function getDbcClient(
  connection?: Connection,
  commitment: Commitment = "confirmed",
): DynamicBondingCurveClient {
  try {
    const conn = connection ?? getConnection(commitment);
    if (cache && cache.endpoint === conn.rpcEndpoint) return cache.client;
    const client = DynamicBondingCurveClient.create(conn, commitment);
    cache = { endpoint: conn.rpcEndpoint, client };
    return client;
  } catch (e) {
    if (e instanceof EquiCurveError) throw e;
    throw new EquiCurveError(
      "Failed to initialize Dynamic Bonding Curve client. Check NEXT_PUBLIC_RPC_URL.",
      "SDK",
      e,
    );
  }
}

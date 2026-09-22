import { Connection, type Commitment } from "@solana/web3.js";
import { getRpcUrl } from "./constants";
import { EquiCurveError } from "./errors";

let cached: Connection | null = null;

export function getConnection(commitment: Commitment = "confirmed"): Connection {
  const rpc = getRpcUrl();
  if (!rpc) {
    throw new EquiCurveError(
      "NEXT_PUBLIC_RPC_URL is missing. Copy .env.example → .env.local.",
      "MISSING_RPC",
    );
  }
  if (!cached || cached.rpcEndpoint !== rpc) {
    cached = new Connection(rpc, {
      commitment,
      confirmTransactionInitialTimeout: 60_000,
    });
  }
  return cached;
}

export async function pingRpc(): Promise<{
  ok: boolean;
  slot?: number;
  error?: string;
}> {
  try {
    const slot = await getConnection().getSlot("processed");
    return { ok: true, slot };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "RPC ping failed",
    };
  }
}

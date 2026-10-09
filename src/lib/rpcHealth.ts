import { withRpcRetry } from "./rpc";

export type RpcHealthStatus = "ok" | "unavailable";
export type RpcClusterStatus = "verified" | "mismatch" | "unavailable";

export type RpcIdentityCheck = {
  rpcStatus: RpcHealthStatus;
  rpcClusterStatus: RpcClusterStatus;
  genesisHash: string | null;
  slot: number | null;
  error: string | null;
};

type RpcProbe = {
  getGenesisHash(): Promise<string>;
  getSlot(commitment?: "processed" | "confirmed" | "finalized"): Promise<number>;
};

/** Probe transport and full-cluster identity without exposing endpoint details. */
export async function checkRpcIdentity(
  connection: RpcProbe,
  expectedGenesisHash: string,
): Promise<RpcIdentityCheck> {
  const [genesis, slot] = await Promise.allSettled([
    withRpcRetry(() => connection.getGenesisHash(), { retries: 1, timeoutMs: 5_000 }),
    withRpcRetry(() => connection.getSlot("processed"), { retries: 1, timeoutMs: 5_000 }),
  ]);

  const genesisHash = genesis.status === "fulfilled" ? genesis.value : null;
  const slotValue = slot.status === "fulfilled" ? slot.value : null;
  const rpcStatus: RpcHealthStatus = genesisHash != null || slotValue != null ? "ok" : "unavailable";
  const rpcClusterStatus: RpcClusterStatus =
    genesisHash == null
      ? "unavailable"
      : genesisHash === expectedGenesisHash
        ? "verified"
        : "mismatch";

  let error: string | null = null;
  if (rpcClusterStatus === "mismatch") error = "RPC cluster mismatch";
  else if (rpcClusterStatus === "unavailable") {
    error = rpcStatus === "ok" ? "RPC cluster identity unavailable" : "RPC unavailable";
  } else if (slot.status === "rejected") {
    error = "RPC slot unavailable";
  }

  return { rpcStatus, rpcClusterStatus, genesisHash, slot: slotValue, error };
}

export type RpcHealthSummary = {
  ok: boolean;
  rpcStatus: RpcHealthStatus;
  rpcClusterStatus: RpcClusterStatus;
  error: string | null;
};

/** Combine public and server probes into the health contract exposed by /api/health. */
export function summarizeRpcHealth(
  publicRpc: RpcIdentityCheck,
  serverRpc: RpcIdentityCheck,
): RpcHealthSummary {
  const rpcStatus: RpcHealthStatus =
    publicRpc.rpcStatus === "ok" || serverRpc.rpcStatus === "ok" ? "ok" : "unavailable";
  const rpcClusterStatus: RpcClusterStatus =
    publicRpc.rpcClusterStatus === "mismatch" || serverRpc.rpcClusterStatus === "mismatch"
      ? "mismatch"
      : publicRpc.rpcClusterStatus === "verified" && serverRpc.rpcClusterStatus === "verified"
        ? "verified"
        : "unavailable";
  const ok =
    rpcStatus === "ok" &&
    rpcClusterStatus === "verified" &&
    publicRpc.rpcStatus === "ok" &&
    serverRpc.rpcStatus === "ok";
  const error = ok
    ? null
    : rpcClusterStatus === "mismatch"
      ? "RPC cluster mismatch"
      : publicRpc.error ?? serverRpc.error ?? "RPC unavailable";
  return { ok, rpcStatus, rpcClusterStatus, error };
}

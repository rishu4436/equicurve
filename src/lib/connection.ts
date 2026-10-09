import { Connection, type Commitment } from "@solana/web3.js";
import { getCluster, getDevnetRpcReadUrls, getRpcUrl, getServerDevnetRpcReadUrls, getServerRpcUrl, isLocalRpc } from "./constants";
import { EquiCurveError } from "./errors";
import { withRpcRetry, withVerifiedRpcFallback, type RetryOptions } from "./rpc";

/**
 * These are full RPC `getGenesisHash` values. They are not CAIP-2/x402
 * network identifiers or shortened UI cluster labels.
 */
export const EXPECTED_CLUSTER_GENESIS_HASH = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
  "mainnet-beta": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const;

let cached: Connection | null = null;
let serverCached: Connection | null = null;
const readConnections = new Map<string, Connection>();

/** Browser/public connection (NEXT_PUBLIC_RPC_URL). */
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

/** Server routes: prefers private RPC_URL (dedicated endpoint), else public. */
export function getServerConnection(commitment: Commitment = "confirmed"): Connection {
  const rpc = getServerRpcUrl();
  if (!serverCached || serverCached.rpcEndpoint !== rpc) {
    serverCached = new Connection(rpc, { commitment, disableRetryOnRateLimit: true });
  }
  return serverCached;
}

function connectionsFor(urls: readonly string[], commitment: Commitment): Connection[] {
  return urls.map((url) => {
    const key = `${url}|${commitment}`;
    let connection = readConnections.get(key);
    if (!connection) {
      connection = new Connection(url, { commitment, disableRetryOnRateLimit: true });
      readConnections.set(key, connection);
    }
    return connection;
  });
}

export function getReadConnections(commitment: Commitment = "confirmed"): Connection[] {
  return connectionsFor(getDevnetRpcReadUrls(), commitment);
}

export function getServerReadConnections(commitment: Commitment = "confirmed"): Connection[] {
  return connectionsFor(getServerDevnetRpcReadUrls(), commitment);
}

/**
 * Run a read or pre-sign state/build operation against ordered, verified
 * same-cluster endpoints. This helper must never wrap transaction submission.
 */
export async function withReadConnection<T>(
  primary: Connection,
  read: (connection: Connection) => Promise<T>,
  opts: RetryOptions & { server?: boolean } = {},
): Promise<T> {
  const configured = opts.server ? getServerReadConnections() : getReadConnections();
  const sources = [
    primary,
    ...configured.filter((connection) => connection.rpcEndpoint !== primary.rpcEndpoint),
  ];
  const { server: _server, ...retry } = opts;
  if (isLocalRpc(primary.rpcEndpoint)) {
    const localGenesis = await withRpcRetry(() => primary.getGenesisHash(), retry);
    return withVerifiedRpcFallback([primary], localGenesis, read, retry);
  }
  return withVerifiedRpcFallback(
    sources,
    EXPECTED_CLUSTER_GENESIS_HASH[getCluster()],
    read,
    retry,
  );
}

export async function pingRpc(connection: Connection = getServerConnection()): Promise<{
  ok: boolean;
  slot?: number;
  error?: string;
}> {
  try {
    const slot = await withRpcRetry(() => connection.getSlot("processed"), {
      retries: 1,
      timeoutMs: 5_000,
    });
    return { ok: true, slot };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "RPC ping failed",
    };
  }
}

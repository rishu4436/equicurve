import { NextResponse } from "next/server";
import { EXPECTED_CLUSTER_GENESIS_HASH, getConnection, getServerConnection } from "@/lib/connection";
import { checkRpcIdentity, summarizeRpcHealth } from "@/lib/rpcHealth";
import { getCluster, getRpcHost, getServerRpcUrl } from "@/lib/constants";
import { getRegistryMeta } from "@/lib/registry/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const cluster = getCluster();
  const expectedGenesisHash = EXPECTED_CLUSTER_GENESIS_HASH[cluster];
  const [publicRpc, serverRpc] = await Promise.all([
    checkRpcIdentity(getConnection(), expectedGenesisHash),
    checkRpcIdentity(getServerConnection(), expectedGenesisHash),
  ]);
  const summary = summarizeRpcHealth(publicRpc, serverRpc);
  return NextResponse.json({
    ok: summary.ok,
    service: "equicurve",
    cluster,
    rpcHost: getRpcHost(),
    serverRpcHost: getRpcHost(getServerRpcUrl()),
    dedicatedServerRpc: Boolean(process.env.RPC_URL?.trim()),
    rpcStatus: summary.rpcStatus,
    rpcClusterStatus: summary.rpcClusterStatus,
    genesisHash: publicRpc.genesisHash,
    expectedGenesisHash,
    slot: publicRpc.slot,
    error: summary.error,
    publicRpcClusterStatus: publicRpc.rpcClusterStatus,
    serverRpcStatus: serverRpc.rpcStatus,
    serverRpcClusterStatus: serverRpc.rpcClusterStatus,
    serverGenesisHash: serverRpc.genesisHash,
    registry: getRegistryMeta(),
  });
}

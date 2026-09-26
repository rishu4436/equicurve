import { NextResponse } from "next/server";
import { pingRpc } from "@/lib/connection";
import { getCluster, getRpcHost, getServerRpcUrl } from "@/lib/constants";
import { getRegistryMeta } from "@/lib/registry/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const rpc = await pingRpc();
  return NextResponse.json({
    ok: rpc.ok,
    service: "equicurve",
    cluster: getCluster(),
    rpcHost: getRpcHost(),
    serverRpcHost: getRpcHost(getServerRpcUrl()),
    dedicatedServerRpc: Boolean(process.env.RPC_URL?.trim()),
    rpcStatus: rpc.ok ? "ok" : "unavailable",
    slot: rpc.slot ?? null,
    error: rpc.error ? "RPC unavailable" : null,
    registry: getRegistryMeta(),
  });
}

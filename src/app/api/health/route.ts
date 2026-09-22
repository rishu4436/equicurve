import { NextResponse } from "next/server";
import { pingRpc } from "@/lib/connection";
import { getCluster, getRpcHost } from "@/lib/constants";
import { getRegistryMeta } from "@/lib/registry/store";

export async function GET() {
  const rpc = await pingRpc();
  return NextResponse.json({
    ok: rpc.ok,
    service: "equicurve",
    cluster: getCluster(),
    rpcHost: getRpcHost(),
    slot: rpc.slot ?? null,
    error: rpc.error ?? null,
    registry: getRegistryMeta(),
  });
}

import { NextResponse } from "next/server";
import { pingRpc } from "@/lib/connection";
import { getCluster, getRpcUrl } from "@/lib/constants";

export async function GET() {
  const rpc = await pingRpc();
  return NextResponse.json({
    ok: rpc.ok,
    cluster: getCluster(),
    rpc: getRpcUrl().replace(/api-key=[^&]+/i, "api-key=***"),
    slot: rpc.slot,
    error: rpc.error,
  });
}

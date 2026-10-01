import { NextResponse } from "next/server";
import { getPublicDeployment } from "@/lib/registry/publicDeployments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pool: string }> },
) {
  const { pool } = await ctx.params;
  const deployment = getPublicDeployment(pool);
  if (!deployment) {
    return NextResponse.json({ ok: false, error: "No verified deployment for this pool." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, deployment });
}

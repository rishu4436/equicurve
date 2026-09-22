import { NextResponse } from "next/server";
import { invalidateExploreCache } from "@/lib/explore/discover";
import {
  getRegistryMeta,
  listRegistryLaunches,
  patchRegistryLaunch,
  upsertRegistryLaunch,
} from "@/lib/registry/store";
import type { RegistryLaunchInput } from "@/lib/registry/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const launches = await listRegistryLaunches();
  return NextResponse.json({
    ok: true,
    source: "equicurve-registry",
    label: "EquiCurve registry (not a full chain indexer)",
    registry: getRegistryMeta(),
    count: launches.length,
    launches,
  });
}

export async function POST(req: Request) {
  let body: RegistryLaunchInput;
  try {
    body = (await req.json()) as RegistryLaunchInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const entry = await upsertRegistryLaunch(body);
    invalidateExploreCache();
    return NextResponse.json({
      ok: true,
      launch: entry,
      registry: getRegistryMeta(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to register launch";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  let body: Partial<RegistryLaunchInput> & { pool?: string };
  try {
    body = (await req.json()) as Partial<RegistryLaunchInput> & {
      pool?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const pool = body.pool?.trim();
  if (!pool) {
    return NextResponse.json({ error: "pool required" }, { status: 400 });
  }
  const { pool: _p, ...patch } = body;
  const updated = await patchRegistryLaunch(pool, patch);
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  invalidateExploreCache();
  return NextResponse.json({
    ok: true,
    launch: updated,
    registry: getRegistryMeta(),
  });
}

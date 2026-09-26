import { NextResponse } from "next/server";
import { MAX_SIGNED_BODY_BYTES } from "@/lib/auth/launchAuth";
import { getCluster } from "@/lib/constants";
import { invalidateExploreCache } from "@/lib/explore/discover";
import { authorizeRegistration, refreshFromChain } from "@/lib/registry/authorize";
import { serverLookup, serverVerifyDamm, USDC_MINTS } from "@/lib/registry/chain";
import {
  getRegistryLaunch,
  getRegistryMeta,
  listRegistryLaunches,
  putRegistryLaunch,
} from "@/lib/registry/store";
import { checkRateLimit, clientKey, readJsonBody } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WRITE_LIMIT = 20;
const WRITE_WINDOW_MS = 10 * 60 * 1000;

function err(status: number, error: string, code?: string, headers?: Record<string, string>) {
  return NextResponse.json({ ok: false, error, code }, { status, headers });
}

export async function GET() {
  const launches = await listRegistryLaunches();
  return NextResponse.json({
    ok: true,
    source: "equicurve-registry",
    label: "EquiCurve registry (not a full chain indexer)",
    trust:
      "Chain fields (creator, mint, config, quote, status) are written only from server-side on-chain reads; profiles are signed by the on-chain creator.",
    registry: getRegistryMeta(),
    count: launches.length,
    launches,
  });
}

/** Register / update profile — requires a creator-signed payload. */
export async function POST(req: Request) {
  const rl = checkRateLimit(clientKey(req, "launches:post"), WRITE_LIMIT, WRITE_WINDOW_MS);
  if (!rl.ok) return err(429, "Too many registry writes — slow down.", "rate_limited", { "Retry-After": String(rl.retryAfterSec) });
  const body = await readJsonBody(req, MAX_SIGNED_BODY_BYTES);
  if (!body.ok) return err(body.status, body.error, "invalid_body");

  const result = await authorizeRegistration({
    body: body.value,
    serverCluster: getCluster(),
    nowMs: Date.now(),
    lookup: serverLookup,
    getExisting: getRegistryLaunch,
    usdcMints: USDC_MINTS,
  });
  if (!result.ok) return err(result.status, result.error, result.code);
  await putRegistryLaunch(result.entry);
  invalidateExploreCache();
  return NextResponse.json({
    ok: true,
    unchanged: result.unchanged,
    launch: result.entry,
    registry: getRegistryMeta(),
  });
}

/** Refresh chain-derived fields (status, graduation, DAMM pool). Body: { pool }. */
export async function PATCH(req: Request) {
  const rl = checkRateLimit(clientKey(req, "launches:patch"), WRITE_LIMIT * 2, WRITE_WINDOW_MS);
  if (!rl.ok) return err(429, "Too many refresh requests — slow down.", "rate_limited", { "Retry-After": String(rl.retryAfterSec) });
  const body = await readJsonBody(req, 1024);
  if (!body.ok) return err(body.status, body.error, "invalid_body");

  const result = await refreshFromChain({
    body: body.value,
    serverCluster: getCluster(),
    nowMs: Date.now(),
    lookup: serverLookup,
    getExisting: getRegistryLaunch,
    usdcMints: USDC_MINTS,
    verifyDamm: serverVerifyDamm,
  });
  if (!result.ok) return err(result.status, result.error, result.code);
  await putRegistryLaunch(result.entry);
  invalidateExploreCache();
  return NextResponse.json({ ok: true, launch: result.entry, registry: getRegistryMeta() });
}

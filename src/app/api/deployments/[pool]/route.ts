import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { compareDeploymentReadback } from "@/lib/dbc/deploymentReadback";
import { getDbcClient } from "@/lib/dbc/client";
import { fetchPoolSnapshot } from "@/lib/dbc/migrate";
import { getServerConnection } from "@/lib/connection";
import { WSOL_MINT, knownUsdcMints } from "@/lib/constants";
import { resolveDeploymentRecord } from "@/lib/registry/design";
import { getRecordedDeployment } from "@/lib/registry/publicDeployments";
import { getRegistryLaunch } from "@/lib/registry/store";
import { clientKey } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";
import { createTtlSingleFlight } from "@/lib/server/ttlCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEPLOYMENT_CACHE_MS = 15_000;
const READ_LIMIT = 30;
const READ_WINDOW_MS = 60_000;

type DeploymentPayload = { status: number; body: Record<string, unknown> };

const deploymentCache = createTtlSingleFlight<DeploymentPayload>(DEPLOYMENT_CACHE_MS);

function quoteMintFor(quote: string): string | null {
  if (quote === "SOL") return WSOL_MINT.toBase58();
  if (quote === "USDC") return knownUsdcMints()[0] ?? null;
  return null;
}

function cacheable(payload: DeploymentPayload): boolean {
  return payload.body.reason !== "rpc_unavailable";
}

async function loadDeployment(pool: string): Promise<DeploymentPayload> {
  const deployment = resolveDeploymentRecord({
    pool,
    registry: await getRegistryLaunch(pool),
    catalog: getRecordedDeployment(pool),
  });
  if (!deployment) {
    return {
      status: 404,
      body: { ok: false, verified: false, error: "No recorded design for this pool." },
    };
  }
  const quoteMint = quoteMintFor(deployment.quote);
  if (!quoteMint) {
    return {
      status: 200,
      body: {
        ok: true,
        verified: false,
        reason: "record_mismatch",
        source: deployment.source,
        deployment,
        checks: null,
      },
    };
  }

  try {
    const connection = getServerConnection();
    const snapshot = await fetchPoolSnapshot(connection, new PublicKey(deployment.pool));
    const onChain = await getDbcClient(connection).state.getPoolConfig(new PublicKey(deployment.config));
    if (!onChain) {
      return {
        status: 200,
        body: {
          ok: true,
          verified: false,
          reason: "config_unreadable",
          source: deployment.source,
          deployment,
          checks: null,
        },
      };
    }
    const verdict = compareDeploymentReadback({
      expected: deployment.expected,
      canonicalConfig: deployment.canonicalConfig,
      fingerprint: deployment.fingerprint,
      identity: {
        pool: deployment.pool,
        config: deployment.config,
        mint: deployment.mint,
        threshold: deployment.migrationQuoteThresholdAtoms,
        quoteMint,
      },
      snapshot,
      chain: onChain as unknown as Record<string, unknown>,
    });
    return {
      status: 200,
      body: {
        ok: true,
        verified: verdict.verified,
        reason: verdict.verified ? null : "readback_mismatch",
        source: deployment.source,
        checks: verdict.checks,
        deployment,
      },
    };
  } catch {
    return {
      status: 200,
      body: {
        ok: true,
        verified: false,
        reason: "rpc_unavailable",
        source: deployment.source,
        deployment,
        checks: null,
      },
    };
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ pool: string }> }) {
  const { pool } = await ctx.params;
  if (!deploymentCache.peek(pool)) {
    const rl = await limitRequest(clientKey(req, "deployments:get"), READ_LIMIT, READ_WINDOW_MS);
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, verified: false, error: "Too many deployment reads — slow down.", code: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }
  }
  const payload = await deploymentCache.get(pool, () => loadDeployment(pool), cacheable);
  return NextResponse.json(payload.body, { status: payload.status });
}

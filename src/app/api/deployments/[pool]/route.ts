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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function quoteMintFor(quote: string): string | null {
  if (quote === "SOL") return WSOL_MINT.toBase58();
  if (quote === "USDC") return knownUsdcMints()[0] ?? null;
  return null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ pool: string }> },
) {
  const { pool } = await ctx.params;
  const deployment = resolveDeploymentRecord({
    pool,
    registry: await getRegistryLaunch(pool),
    catalog: getRecordedDeployment(pool),
  });
  if (!deployment) {
    return NextResponse.json(
      { ok: false, verified: false, error: "No recorded design for this pool." },
      { status: 404 },
    );
  }
  const quoteMint = quoteMintFor(deployment.quote);
  if (!quoteMint) {
    return NextResponse.json({
      ok: true,
      verified: false,
      reason: "record_mismatch",
      source: deployment.source,
      deployment,
      checks: null,
    });
  }

  try {
    const connection = getServerConnection();
    const snapshot = await fetchPoolSnapshot(connection, new PublicKey(deployment.pool));
    const onChain = await getDbcClient(connection).state.getPoolConfig(new PublicKey(deployment.config));
    if (!onChain) {
      return NextResponse.json({
        ok: true,
        verified: false,
        reason: "config_unreadable",
        source: deployment.source,
        deployment,
        checks: null,
      });
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
    return NextResponse.json({
      ok: true,
      verified: verdict.verified,
      reason: verdict.verified ? null : "readback_mismatch",
      source: deployment.source,
      checks: verdict.checks,
      deployment,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      verified: false,
      reason: "rpc_unavailable",
      source: deployment.source,
      deployment,
      checks: null,
    });
  }
}

import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { getServerConnection, withReadConnection } from "@/lib/connection";
import { clientKey } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_LIMIT = 30;
const READ_WINDOW_MS = 60_000;
const MAX_HOLDER_ROWS = 8;

export type HoldersRouteResponse = {
  ok: boolean;
  supplyAtoms: string | null;
  decimals: number | null;
  creatorAta: string | null;
  creatorBalanceAtoms: string | null;
  largest: { address: string; amountAtoms: string }[];
  partial: boolean;
  error: string | null;
};

type Ctx = { params: Promise<{ mint: string }> };

function degraded(error: string): HoldersRouteResponse {
  return {
    ok: false,
    supplyAtoms: null,
    decimals: null,
    creatorAta: null,
    creatorBalanceAtoms: null,
    largest: [],
    partial: true,
    error,
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const { mint: rawMint } = await ctx.params;
  let mint: PublicKey;
  try {
    mint = new PublicKey(rawMint);
  } catch {
    return NextResponse.json(
      { ...degraded("Invalid mint address"), code: "invalid_mint" },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const rawCreator = url.searchParams.get("creator")?.trim() || null;
  let creator: PublicKey | null = null;
  if (rawCreator) {
    try {
      creator = new PublicKey(rawCreator);
    } catch {
      return NextResponse.json(
        { ...degraded("Invalid creator address"), code: "invalid_creator" },
        { status: 400 },
      );
    }
  }

  const rl = await limitRequest(clientKey(req, "markets:holders"), READ_LIMIT, READ_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { ...degraded("Holder reads are temporarily rate-limited."), code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  const serverConnection = getServerConnection();
  try {
    const supply = await withReadConnection(
      serverConnection,
      (connection) => connection.getTokenSupply(mint),
      { server: true },
    );
    const response: HoldersRouteResponse = {
      ok: true,
      supplyAtoms: supply.value.amount,
      decimals: supply.value.decimals,
      creatorAta: null,
      creatorBalanceAtoms: null,
      largest: [],
      partial: false,
      error: null,
    };

    if (creator) {
      const creatorAta = getAssociatedTokenAddressSync(mint, creator);
      response.creatorAta = creatorAta.toBase58();
      try {
        const balance = await withReadConnection(
          serverConnection,
          (connection) => connection.getTokenAccountBalance(creatorAta),
          { server: true },
        );
        response.creatorBalanceAtoms = balance.value.amount;
      } catch {
        response.partial = true;
      }
    }

    try {
      const largest = await withReadConnection(
        serverConnection,
        (connection) => connection.getTokenLargestAccounts(mint),
        { server: true },
      );
      response.largest = largest.value.slice(0, MAX_HOLDER_ROWS).map((row) => ({
        address: row.address.toBase58(),
        amountAtoms: row.amount,
      }));
    } catch {
      response.partial = true;
      response.error = "Largest token-account distribution is temporarily unavailable.";
    }

    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, max-age=5" },
    });
  } catch {
    return NextResponse.json(
      { ...degraded("Token supply is temporarily unavailable."), code: "rpc_unavailable" },
      { status: 503, headers: { "Retry-After": "5" } },
    );
  }
}

import { PublicKey } from "@solana/web3.js";
import { NextResponse } from "next/server";
import { MAX_SIGNED_BODY_BYTES } from "@/lib/auth/launchAuth";
import { getServerConnection } from "@/lib/connection";
import { getCluster } from "@/lib/constants";
import { authorizeMetadataWrite, type MintExistence } from "@/lib/metadata/authorize";
import {
  isValidMetadataId,
  readMetadata,
  readMetadataRecord,
  writeMetadataRecord,
} from "@/lib/metadata/store";
import { serverLookup } from "@/lib/registry/chain";
import { serverCheckImage } from "@/lib/server/imageCheck";
import { withRpcRetry } from "@/lib/rpc";
import { checkRateLimit, clientKey, readJsonBody } from "@/lib/server/http";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidMetadataId(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const meta = await readMetadata(id);
  if (!meta) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(meta, {
    headers: {
      "Cache-Control": "public, max-age=60",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function mintExists(mint: string): Promise<MintExistence> {
  try {
    const info = await withRpcRetry(() =>
      getServerConnection().getAccountInfo(new PublicKey(mint), "confirmed"),
    );
    return info ? "exists" : "missing";
  } catch {
    return "unknown";
  }
}

/**
 * Create (pre-launch, action "launch") or edit (creator-only, action "update")
 * hosted metadata. Wallet-signed. Name / symbol / mint are immutable after the
 * first write; description, image and external_url are editable.
 */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidMetadataId(id)) {
    return NextResponse.json({ error: "Metadata id must be a mint address" }, { status: 400 });
  }
  const rl = checkRateLimit(clientKey(req, "metadata:put"), 20, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many metadata writes — slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }
  const body = await readJsonBody(req, MAX_SIGNED_BODY_BYTES);
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });

  const result = await authorizeMetadataWrite({
    id,
    body: body.value,
    serverCluster: getCluster(),
    nowMs: Date.now(),
    existing: await readMetadataRecord(id),
    mintExists,
    lookup: serverLookup,
    checkImage: serverCheckImage,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  }
  if (!result.unchanged) await writeMetadataRecord(id, result.record);
  return NextResponse.json({ ok: true, id, unchanged: result.unchanged, meta: result.record.meta });
}

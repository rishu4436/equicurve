import { NextResponse } from "next/server";
import {
  readMetadata,
  writeMetadata,
  type TokenMetadataJson,
} from "@/lib/metadata/store";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
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

export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: Partial<TokenMetadataJson>;
  try {
    body = (await req.json()) as Partial<TokenMetadataJson>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const symbol = (body.symbol ?? "").trim();
  if (name.length < 2 || symbol.length < 1) {
    return NextResponse.json(
      { error: "name and symbol required" },
      { status: 400 },
    );
  }
  const meta: TokenMetadataJson = {
    name,
    symbol,
    description: (body.description ?? "").trim() || `${name} (${symbol})`,
    image: (body.image ?? "").trim(),
    external_url: body.external_url?.trim() || undefined,
  };
  const saved = await writeMetadata(id, meta);
  return NextResponse.json({ ok: true, id: saved, meta });
}

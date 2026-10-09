import { NextResponse } from "next/server";
import {
  getTokenImageStore,
  isTokenImageKey,
} from "@/lib/uploads/tokenImageStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  avif: "image/avif",
};

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!isTokenImageKey(id)) return new NextResponse("Not found", { status: 404 });
  let bytes: Buffer | null;
  try {
    bytes = await getTokenImageStore().read(id);
  } catch {
    return new NextResponse("Image storage is not configured.", { status: 503 });
  }
  if (!bytes) return new NextResponse("Not found", { status: 404 });
  const ext = id.split(".").pop()?.toLowerCase() ?? "";
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

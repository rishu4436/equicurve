import { NextResponse } from "next/server";
import { serverCheckImage } from "@/lib/server/imageCheck";
import { checkRateLimit, clientKey } from "@/lib/server/http";

export const runtime = "nodejs";

/**
 * Preview helper for Create: checks an image URL server-side (https, public
 * host, image content-type, ≤ 2 MB via HEAD / ranged GET). The same check runs
 * again on the signed metadata write, so this is advisory only.
 */
export async function GET(req: Request) {
  const rl = checkRateLimit(clientKey(req, "image-check"), 30, 10 * 60 * 1000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "Too many image checks — slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!url || url.length > 2048) {
    return NextResponse.json({ ok: false, code: "invalid_url", error: "Provide ?url= (max 2048 chars)." }, { status: 400 });
  }
  const r = await serverCheckImage(url);
  return NextResponse.json(r, { status: 200, headers: { "Cache-Control": "no-store" } });
}

import { NextResponse } from "next/server";
import { EquiCurveError } from "@/lib/errors";
import { designFromApiRequest, designRequestSchema } from "@/lib/market/designApi";
import { clientKey, readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(status: number, code: string, message: string, issues?: unknown[]) {
  return NextResponse.json({ ok: false, error: { code, message, ...(issues ? { issues } : {}) } }, { status });
}

export async function POST(req: Request) {
  const limited = await limitRequest(clientKey(req, "api:v1:design"), 30, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ ok: false, error: { code: "RATE_LIMITED", message: "Design preview rate limit exceeded." } }, {
      status: 429,
      headers: { "Retry-After": String(limited.retryAfterSec) },
    });
  }
  const body = await readJsonBody(req, 64 * 1024);
  if (!body.ok) return errorResponse(body.status, "INVALID_REQUEST", body.error);
  const parsed = designRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    const rawQuote = body.value && typeof body.value === "object" ? (body.value as { quote?: unknown }).quote : undefined;
    const unsupportedQuote = typeof rawQuote === "string" && rawQuote !== "SOL" && rawQuote !== "USDC";
    return errorResponse(unsupportedQuote ? 422 : 400, unsupportedQuote ? "UNSUPPORTED_QUOTE" : "INVALID_REQUEST", unsupportedQuote ? "EquiCurve supports only SOL and USDC quotes." : "Request does not match the design API schema.", parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
  }
  try {
    return NextResponse.json(designFromApiRequest(parsed.data));
  } catch (error) {
    if (error instanceof EquiCurveError) {
      const code = error.code === "VALIDATION" ? "INVALID_CONSTRAINTS" : "DESIGN_FAILED";
      return errorResponse(code === "INVALID_CONSTRAINTS" ? 422 : 422, code, error.message);
    }
    return errorResponse(500, "INTERNAL_ERROR", "Design evaluation failed.");
  }
}

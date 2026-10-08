import { NextResponse } from "next/server";
import { DeveloperApiError, robustnessFromReference, selectedDesignReferenceSchema } from "@/lib/market/designApi";
import { clientKey, readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(status: number, code: string, message: string, issues?: unknown[]) {
  return NextResponse.json({ ok: false, error: { code, message, ...(issues ? { issues } : {}) } }, { status });
}

export async function POST(req: Request) {
  const limited = await limitRequest(clientKey(req, "api:v1:robustness"), 30, 60_000);
  if (!limited.ok) return errorResponse(429, "RATE_LIMITED", "Robustness preview rate limit exceeded.");
  const body = await readJsonBody(req, 64 * 1024);
  if (!body.ok) return errorResponse(body.status, "INVALID_REQUEST", body.error);
  const rawQuote = body.value && typeof body.value === "object" && "designRequest" in body.value && body.value.designRequest && typeof body.value.designRequest === "object"
    ? (body.value.designRequest as { quote?: unknown }).quote
    : undefined;
  if (typeof rawQuote === "string" && rawQuote !== "SOL" && rawQuote !== "USDC") return errorResponse(422, "UNSUPPORTED_QUOTE", "EquiCurve supports only SOL and USDC quotes.");
  const parsed = selectedDesignReferenceSchema.safeParse(body.value);
  if (!parsed.success) return errorResponse(400, "INVALID_REQUEST", "Request does not match the selected-design reference schema.", parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
  try {
    return NextResponse.json(robustnessFromReference(parsed.data));
  } catch (error) {
    if (error instanceof DeveloperApiError) return errorResponse(error.status, error.code, error.message);
    return errorResponse(500, "INTERNAL_ERROR", "Robustness evaluation failed.");
  }
}

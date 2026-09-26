/**
 * Small server-side guards for public write routes: body size limit, JSON
 * parse, and a best-effort in-memory rate limiter (per instance — pair with a
 * platform limiter / Upstash ratelimit for multi-instance production).
 */

export type BodyResult<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 413 | 415; error: string };

export async function readJsonBody(req: Request, maxBytes: number): Promise<BodyResult> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct && !/application\/json/i.test(ct)) {
    return { ok: false, status: 415, error: "Content-Type must be application/json" };
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return { ok: false, status: 413, error: `Body too large (max ${maxBytes} bytes)` };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400, error: "Could not read body" };
  }
  if (new TextEncoder().encode(text).length > maxBytes) {
    return { ok: false, status: 413, error: `Body too large (max ${maxBytes} bytes)` };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
}

const buckets = new Map<string, number[]>();

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): { ok: boolean; retryAfterSec: number } {
  const since = nowMs - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > since);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    const retry = Math.max(1, Math.ceil((hits[0] + windowMs - nowMs) / 1000));
    return { ok: false, retryAfterSec: retry };
  }
  hits.push(nowMs);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (!v.some((t) => t > since)) buckets.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function clientKey(req: Request, scope: string): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || req.headers.get("x-real-ip") || "unknown";
  return `${scope}:${ip}`;
}

import { createUpstashClient, isUpstashConfigured } from "@/lib/registry/upstashStore";
import type { Redis } from "@upstash/redis";
import { checkRateLimit } from "./http";

const RATE_LUA = `
local current = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if current == 1 or ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[2])
  ttl = tonumber(ARGV[2])
end
if current > tonumber(ARGV[1]) then
  return {0, ttl}
end
return {1, 0}
`;

let shared: Redis | null = null;

function redisClient(): Redis {
  if (!shared) shared = createUpstashClient();
  return shared;
}

export function resetSharedRateLimit(): void {
  shared = null;
}

/**
 * Shared fixed window when Upstash is configured. This process's memory
 * limiter is the fallback for local runs, CI, and a Redis error.
 */
export async function limitRequest(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfterSec: number }> {
  if (!isUpstashConfigured()) return checkRateLimit(key, limit, windowMs);
  try {
    const result = await redisClient().eval<string[], number[]>(RATE_LUA, [`equicurve:rl:${key}`], [
      String(limit),
      String(windowMs),
    ]);
    const allowed = Array.isArray(result) ? Number(result[0]) === 1 : Number(result) === 1;
    if (allowed) return { ok: true, retryAfterSec: 0 };
    const ttlMs = Array.isArray(result) ? Number(result[1]) : windowMs;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((Number.isFinite(ttlMs) ? ttlMs : windowMs) / 1000)) };
  } catch {
    return checkRateLimit(key, limit, windowMs);
  }
}

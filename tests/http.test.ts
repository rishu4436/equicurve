import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, readJsonBody, resetRateLimits } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

describe("readJsonBody", () => {
  it("rejects wrong content-type, oversized and malformed bodies", async () => {
    const mk = (body: string, ct = "application/json") =>
      new Request("http://x/api", { method: "POST", headers: { "content-type": ct }, body });
    expect(await readJsonBody(mk("{}", "text/plain"), 100)).toMatchObject({ ok: false, status: 415 });
    expect(await readJsonBody(mk(JSON.stringify({ a: "x".repeat(500) })), 100)).toMatchObject({ ok: false, status: 413 });
    expect(await readJsonBody(mk("{nope"), 100)).toMatchObject({ ok: false, status: 400 });
    expect(await readJsonBody(mk('{"a":1}'), 100)).toEqual({ ok: true, value: { a: 1 } });
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => resetRateLimits());
  it("allows `limit` hits per window then blocks", () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(checkRateLimit("k", 3, 60_000, t + i).ok).toBe(true);
    const blocked = checkRateLimit("k", 3, 60_000, t + 10);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
    expect(checkRateLimit("k", 3, 60_000, t + 61_000).ok).toBe(true);
    expect(checkRateLimit("other", 3, 60_000, t + 10).ok).toBe(true);
  });

  it("uses the in-memory limiter when Upstash is unset", async () => {
    const keys = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    try {
      expect((await limitRequest("mem", 2, 60_000)).ok).toBe(true);
      expect((await limitRequest("mem", 2, 60_000)).ok).toBe(true);
      expect((await limitRequest("mem", 2, 60_000)).ok).toBe(false);
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });
});

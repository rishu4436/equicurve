import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, readJsonBody, resetRateLimits } from "@/lib/server/http";

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
});

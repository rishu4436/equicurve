import { describe, expect, it } from "vitest";
import { createTtlSingleFlight } from "@/lib/server/ttlCache";

describe("deployment read cache", () => {
  it("joins in-flight loads and serves a fresh value without loading again", async () => {
    const cache = createTtlSingleFlight<number>(1_000);
    let calls = 0;
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = cache.get("pool", async () => {
      calls += 1;
      await gate;
      return 7;
    });
    const second = cache.get("pool", async () => {
      calls += 1;
      return 9;
    });
    release();
    expect(await first).toBe(7);
    expect(await second).toBe(7);
    expect(calls).toBe(1);
    expect(await cache.get("pool", async () => {
      calls += 1;
      return 3;
    })).toBe(7);
    expect(calls).toBe(1);
  });
});

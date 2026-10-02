import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { mergeEntry, StaleRegistryWrite } from "@/lib/registry/normalize";
import { createUpstashStore, seedUpstashIfEmpty } from "@/lib/registry/upstashStore";
import type { RegistryFilePayload, RegistryLaunch } from "@/lib/registry/types";

function row(pool: string, mint: string, when: string, name: string): RegistryLaunch {
  return {
    pool,
    mint,
    config: pool,
    creator: mint,
    quoteMint: null,
    quote: "SOL",
    feeClaimer: null,
    lockPct: null,
    creatorFeePct: null,
    status: "raising",
    isMigrated: false,
    dammPool: null,
    name,
    ticker: "EQ",
    thesis: "A recorded offering.",
    sector: "Other",
    presetId: "flat",
    raiseTarget: 1,
    cluster: "devnet",
    createdAt: when,
    registeredAt: when,
    updatedAt: when,
    chainCheckedAt: when,
    authSigner: mint,
    authIssuedAt: when,
    design: null,
  };
}

class MemoryRedis {
  raw: string | null = null;
  async get(): Promise<unknown> {
    return this.raw ? (JSON.parse(this.raw) as unknown) : null;
  }
  async set(_key: string, value: unknown, opts?: { nx?: boolean }): Promise<"OK" | null> {
    if (opts?.nx && this.raw != null) return null;
    this.raw = JSON.stringify(value);
    return "OK";
  }
  async eval(_script: string, _keys: string[], args: string[]): Promise<number> {
    const expected = Number(args[0]);
    let rev = 0;
    if (this.raw) {
      const decoded = JSON.parse(this.raw) as { revision?: unknown };
      rev = typeof decoded.revision === "number" ? decoded.revision : 0;
    }
    if (rev !== expected) return 0;
    this.raw = args[1] ?? null;
    return 1;
  }
}

describe("registry authorization order", () => {
  const pool = Keypair.generate().publicKey.toBase58();
  const mint = Keypair.generate().publicKey.toBase58();
  const older = row(pool, mint, "2026-01-01T00:00:00.000Z", "Older");
  const newer = row(pool, mint, "2026-01-02T00:00:00.000Z", "Newer");

  it("refuses a strictly older authorization and allows an equal timestamp", () => {
    const first = mergeEntry({ version: 2, revision: 0, updatedAt: newer.updatedAt, launches: [] }, newer);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stale = mergeEntry(first.payload, older);
    expect(stale).toEqual({ ok: false, reason: "stale_authorization" });
    const sameTime = mergeEntry(first.payload, { ...newer, name: "Refreshed" });
    expect(sameTime.ok).toBe(true);
    if (!sameTime.ok) return;
    expect(sameTime.payload.launches[0]?.name).toBe("Refreshed");
    const unsigned = mergeEntry(first.payload, { ...older, authIssuedAt: null, authSigner: null, chainCheckedAt: null });
    expect(unsigned.ok).toBe(false);
  });

  it("keeps the newer row when a stale write loses the compare-and-set", async () => {
    const redis = new MemoryRedis();
    let races = 0;
    const racing = Object.assign(redis, {
      eval: async (_script: string, _keys: string[], args: string[]) => {
        races += 1;
        if (races === 1) {
          redis.raw = JSON.stringify({
            version: 2,
            revision: 1,
            updatedAt: newer.updatedAt,
            launches: [newer],
          });
          return 0;
        }
        return MemoryRedis.prototype.eval.call(redis, _script, _keys, args);
      },
    });
    const store = createUpstashStore(racing as never);
    await expect(store.put(older)).rejects.toBeInstanceOf(StaleRegistryWrite);
    expect((await store.get(pool))?.name).toBe("Newer");
  });

  it("does not overwrite an existing Redis key while seeding", async () => {
    const redis = new MemoryRedis();
    redis.raw = JSON.stringify({ version: 2, revision: 4, updatedAt: newer.updatedAt, launches: [newer] });
    const seed: RegistryFilePayload = {
      version: 2,
      revision: 0,
      updatedAt: older.updatedAt,
      launches: [older],
    };
    expect(await seedUpstashIfEmpty(redis as never, seed)).toBe(false);
    expect(JSON.parse(redis.raw).revision).toBe(4);
    const empty = new MemoryRedis();
    expect(await seedUpstashIfEmpty(empty as never, seed)).toBe(true);
    expect(JSON.parse(empty.raw ?? "{}").revision).toBe(1);
  });
});

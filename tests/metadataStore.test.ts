import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { Keypair } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import { createFileMetadataStore } from "@/lib/metadata/fileStore";
import {
  parseMetadataRecord,
  StaleMetadataWrite,
  type MetadataRecord,
} from "@/lib/metadata/record";
import { getMetadataBackend, resetMetadataStoreCache } from "@/lib/metadata/store";
import {
  createUpstashMetadataStore,
  METADATA_CAS_LUA,
  metadataRedisKey,
  type MetadataRedis,
} from "@/lib/metadata/upstashStore";

const ENV_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN"] as const;

function mint(): string {
  return Keypair.generate().publicKey.toBase58();
}

function record(id: string, issuedAt: string | null, name: string): MetadataRecord {
  return {
    v: 2,
    meta: {
      name,
      symbol: "SMK",
      description: "Smoke metadata",
      image: "https://example.com/token.png",
    },
    owner: id,
    pool: id,
    issuedAt,
    updatedAt: issuedAt ?? new Date(0).toISOString(),
  };
}

/** Mirrors METADATA_CAS_LUA against the raw Redis string. */
function luaAllows(raw: string | null, expected: string): boolean {
  if (expected === "*") return raw == null;
  if (raw == null) return false;
  let decoded: unknown = null;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    decoded = null;
  }
  const issued =
    decoded && typeof decoded === "object" ? (decoded as { issuedAt?: unknown }).issuedAt : undefined;
  if (expected === "?") {
    if (typeof issued === "string") return false;
    if (parseMetadataRecord(decoded) && issued == null) return false;
    return true;
  }
  if (!decoded || typeof decoded !== "object") return false;
  const token = issued == null ? "" : issued;
  return token === expected;
}

class MemoryRedis implements MetadataRedis {
  values = new Map<string, string>();
  async get(key: string): Promise<unknown> {
    const raw = this.values.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  async eval(_script: string, keys: string[], args: string[]): Promise<number> {
    const key = keys[0] ?? "";
    const current = this.values.get(key) ?? null;
    if (!luaAllows(current, args[0] ?? "")) return 0;
    this.values.set(key, args[1] ?? "");
    return 1;
  }
}

describe("metadata file store", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function openStore() {
    const dir = await mkdtemp(path.join(tmpdir(), "equicurve-metadata-"));
    dirs.push(dir);
    return { dir, backend: createFileMetadataStore(dir) };
  }

  it("writes and reads one file per mint", async () => {
    const { backend } = await openStore();
    const id = mint();
    expect(await backend.read(id)).toBeNull();
    const next = record(id, "2026-10-02T12:00:00.000Z", "First");
    await backend.write(id, next);
    expect(await backend.read(id)).toEqual(next);
  });

  it("keeps a v1 legacy file readable and refuses a malformed v2 file", async () => {
    const { dir, backend } = await openStore();
    const legacyId = mint();
    const brokenId = mint();
    await writeFile(
      path.join(dir, `${legacyId}.json`),
      JSON.stringify({
        name: "Legacy",
        symbol: "OLD",
        description: "Written before owners existed",
        image: "",
      }),
      "utf8",
    );
    await writeFile(path.join(dir, `${brokenId}.json`), JSON.stringify({ v: 2, meta: null }), "utf8");
    const legacy = await backend.read(legacyId);
    expect(legacy).toMatchObject({
      v: 2,
      owner: null,
      pool: null,
      issuedAt: null,
      meta: { name: "Legacy", symbol: "OLD" },
    });
    expect(await backend.read(brokenId)).toBeNull();
    expect(await backend.read("not-a-mint")).toBeNull();
  });

  it("does not let an older or equal issuedAt overwrite a newer file", async () => {
    const { backend } = await openStore();
    const id = mint();
    const older = record(id, "2026-10-01T00:00:00.000Z", "Older");
    const newer = record(id, "2026-10-02T00:00:00.000Z", "Newer");
    const results = await Promise.allSettled([backend.write(id, older), backend.write(id, newer)]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(await backend.read(id)).toMatchObject({ meta: { name: "Newer" } });
    await expect(backend.write(id, older)).rejects.toBeInstanceOf(StaleMetadataWrite);
    await expect(backend.write(id, { ...newer, meta: { ...newer.meta, name: "Same time" } })).rejects.toBeInstanceOf(
      StaleMetadataWrite,
    );
    expect((await backend.read(id))?.meta.name).toBe("Newer");
  });
});

describe("metadata upstash store", () => {
  it("uses one key per mint and rejects malformed payloads", async () => {
    const redis = new MemoryRedis();
    const store = createUpstashMetadataStore(redis);
    const id = mint();
    const other = mint();
    expect(await store.read(id)).toBeNull();
    redis.values.set(metadataRedisKey(id), JSON.stringify({ v: 2, meta: { name: 1 } }));
    expect(await store.read(id)).toBeNull();
    const next = record(id, "2026-10-02T12:00:00.000Z", "Stored");
    await store.write(id, next);
    expect(await store.read(id)).toEqual(next);
    await store.write(other, record(other, "2026-10-02T12:00:00.000Z", "Other"));
    expect(redis.values.size).toBe(2);
    expect([...redis.values.keys()].every((key) => key.startsWith("equicurve:metadata:"))).toBe(true);
    expect(METADATA_CAS_LUA).toContain('expected == "*"');
    expect(METADATA_CAS_LUA).toContain('expected == "?"');
    expect(METADATA_CAS_LUA).toContain('redis.call("SET"');
  });

  it("does not let a stale write replace a newer record, including a lost compare-and-set", async () => {
    const redis = new MemoryRedis();
    const id = mint();
    const older = record(id, "2026-10-01T00:00:00.000Z", "Older");
    const newer = record(id, "2026-10-02T00:00:00.000Z", "Newer");
    const store = createUpstashMetadataStore(redis);
    await store.write(id, newer);
    await expect(store.write(id, older)).rejects.toBeInstanceOf(StaleMetadataWrite);
    expect((await store.read(id))?.meta.name).toBe("Newer");

    let races = 0;
    const racing = new MemoryRedis();
    const raced = createUpstashMetadataStore(
      Object.assign(racing, {
        eval: async (_script: string, keys: string[], args: string[]) => {
          races += 1;
          if (races === 1) {
            racing.values.set(keys[0] ?? "", JSON.stringify(newer));
            return 0;
          }
          return MemoryRedis.prototype.eval.call(racing, _script, keys, args);
        },
      }),
    );
    await expect(raced.write(id, older)).rejects.toBeInstanceOf(StaleMetadataWrite);
    expect(JSON.parse(racing.values.get(metadataRedisKey(id)) ?? "{}")).toMatchObject({ meta: { name: "Newer" } });
  });

  it("replaces unprotected garbage and keeps a timestamped garbage row from going backwards", async () => {
    const redis = new MemoryRedis();
    const store = createUpstashMetadataStore(redis);
    const id = mint();
    const key = metadataRedisKey(id);
    redis.values.set(key, JSON.stringify({ nope: true }));
    const next = record(id, "2026-10-02T12:00:00.000Z", "Repaired");
    await store.write(id, next);
    expect((await store.read(id))?.meta.name).toBe("Repaired");

    redis.values.set(key, JSON.stringify({ issuedAt: "2026-10-03T00:00:00.000Z", meta: "broken" }));
    await expect(store.write(id, next)).rejects.toBeInstanceOf(StaleMetadataWrite);
    expect(JSON.parse(redis.values.get(key) ?? "{}")).toMatchObject({ meta: "broken" });
  });
});

describe("metadata backend selection", () => {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetMetadataStoreCache();
  });

  it("uses the file store unless Upstash or the KV alias is configured", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    resetMetadataStoreCache();
    expect(getMetadataBackend()).toBe("file");
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    process.env.KV_REST_API_TOKEN = "token";
    expect(getMetadataBackend()).toBe("upstash");
  });
});

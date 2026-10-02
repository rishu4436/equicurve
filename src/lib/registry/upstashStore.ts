import { Redis } from "@upstash/redis";
import {
  mergeEntry,
  MAX_REGISTRY_ENTRIES,
  parseRegistryPayload,
  readRegistryRevision,
  sortLaunchesNewestFirst,
  StaleRegistryWrite,
} from "./normalize";
import type { LaunchRegistryStore, RegistryFilePayload, RegistryLaunch } from "./types";

/** Single Redis key holding the whole registry JSON blob (same shape as the file). */
export const UPSTASH_REGISTRY_KEY = "equicurve:launches:registry";

/**
 * Set the blob only when its stored revision still equals the revision we merged.
 * A missing blob is revision 0. Returns 1 on write and 0 when another writer won.
 */
export const REGISTRY_CAS_LUA = `
local expected = tonumber(ARGV[1])
local next_payload = ARGV[2]
local raw = redis.call("GET", KEYS[1])
local rev = 0
if raw then
  local ok, decoded = pcall(cjson.decode, raw)
  if ok and type(decoded) == "table" and decoded.revision ~= nil then
    rev = tonumber(decoded.revision) or 0
  end
end
if rev ~= expected then
  return 0
end
redis.call("SET", KEYS[1], next_payload)
return 1
`;

function upstashRestUrl(): string {
  return process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim() || "";
}

function upstashRestToken(): string {
  return process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim() || "";
}

export function isUpstashConfigured(): boolean {
  return Boolean(upstashRestUrl() && upstashRestToken());
}

export function createUpstashClient(): Redis {
  if (!isUpstashConfigured()) throw new Error("Upstash Redis env not configured");
  // Redis.fromEnv reads UPSTASH_REDIS_REST_* and falls back to KV_REST_API_*.
  return Redis.fromEnv();
}

function casAccepted(result: unknown): boolean {
  if (result === 1 || result === "1") return true;
  return Array.isArray(result) && (result[0] === 1 || result[0] === "1");
}

export function createUpstashStore(redis: Redis): LaunchRegistryStore {
  const readRaw = async (): Promise<unknown> => redis.get(UPSTASH_REGISTRY_KEY);
  return {
    backend: "upstash",
    async list(): Promise<RegistryLaunch[]> {
      return sortLaunchesNewestFirst(parseRegistryPayload(await readRaw()).launches);
    },
    async get(pool: string): Promise<RegistryLaunch | null> {
      return parseRegistryPayload(await readRaw()).launches.find((row) => row.pool === pool) ?? null;
    },
    async put(entry: RegistryLaunch): Promise<RegistryLaunch> {
      for (let attempt = 0; attempt < 5; attempt++) {
        const raw = await readRaw();
        const expected = readRegistryRevision(raw);
        const merged = mergeEntry(parseRegistryPayload(raw), entry);
        if (!merged.ok) throw new StaleRegistryWrite();
        const next = { ...merged.payload, revision: expected + 1 };
        const won = await redis.eval(REGISTRY_CAS_LUA, [UPSTASH_REGISTRY_KEY], [String(expected), JSON.stringify(next)]);
        if (casAccepted(won)) return entry;
      }
      throw new Error("Registry write lost a concurrent update");
    },
  };
}

/** Write the seed only when the key is absent. A concurrent writer keeps its value. */
export async function seedUpstashIfEmpty(redis: Redis, payload: RegistryFilePayload): Promise<boolean> {
  if (!payload.launches.length) return false;
  const seeded = await redis.set(
    UPSTASH_REGISTRY_KEY,
    {
      version: 2 as const,
      revision: 1,
      updatedAt: new Date().toISOString(),
      launches: payload.launches.slice(0, MAX_REGISTRY_ENTRIES),
    },
    { nx: true },
  );
  return seeded != null;
}

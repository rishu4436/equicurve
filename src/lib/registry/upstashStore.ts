import { Redis } from "@upstash/redis";
import { mergeEntry, MAX_REGISTRY_ENTRIES, parseRegistryPayload, sortLaunchesNewestFirst } from "./normalize";
import type { LaunchRegistryStore, RegistryFilePayload, RegistryLaunch } from "./types";

/** Single Redis key holding the whole registry JSON blob (same shape as the file). */
export const UPSTASH_REGISTRY_KEY = "equicurve:launches:registry";

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

export function createUpstashStore(redis: Redis): LaunchRegistryStore {
  const read = async (): Promise<RegistryFilePayload> =>
    parseRegistryPayload(await redis.get(UPSTASH_REGISTRY_KEY));
  return {
    backend: "upstash",
    async list(): Promise<RegistryLaunch[]> {
      return sortLaunchesNewestFirst((await read()).launches);
    },
    async get(pool: string): Promise<RegistryLaunch | null> {
      return (await read()).launches.find((l) => l.pool === pool) ?? null;
    },
    async put(entry: RegistryLaunch): Promise<RegistryLaunch> {
      // One JSON blob. Retry when another writer replaces the key mid-update
      // so a successful response means this pool is actually stored.
      for (let attempt = 0; attempt < 4; attempt++) {
        await redis.set(UPSTASH_REGISTRY_KEY, mergeEntry(await read(), entry));
        const stored = (await read()).launches.find((row) => row.pool === entry.pool);
        if (stored && stored.updatedAt === entry.updatedAt && stored.authIssuedAt === entry.authIssuedAt) {
          return entry;
        }
      }
      throw new Error("Registry write lost a concurrent update");
    },
  };
}

/** One-time seed: write payload only if Redis key is missing/empty. */
export async function seedUpstashIfEmpty(redis: Redis, payload: RegistryFilePayload): Promise<boolean> {
  if (!payload.launches.length) return false;
  const existing = parseRegistryPayload(await redis.get(UPSTASH_REGISTRY_KEY));
  if (existing.launches.length > 0) return false;
  await redis.set(UPSTASH_REGISTRY_KEY, {
    version: 2 as const,
    updatedAt: new Date().toISOString(),
    launches: payload.launches.slice(0, MAX_REGISTRY_ENTRIES),
  });
  return true;
}

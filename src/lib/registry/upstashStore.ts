import { Redis } from "@upstash/redis";
import { mergeEntry, MAX_REGISTRY_ENTRIES, parseRegistryPayload, sortLaunchesNewestFirst } from "./normalize";
import type { LaunchRegistryStore, RegistryFilePayload, RegistryLaunch } from "./types";

/** Single Redis key holding the whole registry JSON blob (same shape as the file). */
export const UPSTASH_REGISTRY_KEY = "equicurve:launches:registry";

export function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

export function createUpstashClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new Error("Upstash Redis env not configured");
  return new Redis({ url, token });
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
      // Note: read-modify-write on one key; concurrent writers on different
      // instances can race (last write wins). Acceptable for the MVP registry.
      await redis.set(UPSTASH_REGISTRY_KEY, mergeEntry(await read(), entry));
      return entry;
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

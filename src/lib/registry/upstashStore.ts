import { Redis } from "@upstash/redis";
import {
  emptyRegistryPayload,
  MAX_REGISTRY_ENTRIES,
  normalizeLaunchInput,
  sortLaunchesNewestFirst,
} from "./normalize";
import type {
  LaunchRegistryStore,
  RegistryFilePayload,
  RegistryLaunch,
  RegistryLaunchInput,
} from "./types";

/** Single Redis key holding the whole registry JSON blob (same shape as the file). */
export const UPSTASH_REGISTRY_KEY = "equicurve:launches:registry";

function parsePayload(raw: unknown): RegistryFilePayload {
  if (raw == null) return emptyRegistryPayload();
  // @upstash/redis auto-deserializes JSON objects
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as RegistryFilePayload;
      if (!parsed || !Array.isArray(parsed.launches)) return emptyRegistryPayload();
      return {
        version: 1,
        updatedAt: parsed.updatedAt || new Date().toISOString(),
        launches: parsed.launches,
      };
    } catch {
      return emptyRegistryPayload();
    }
  }
  if (typeof raw === "object" && raw !== null && "launches" in raw) {
    const parsed = raw as RegistryFilePayload;
    if (!Array.isArray(parsed.launches)) return emptyRegistryPayload();
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      launches: parsed.launches,
    };
  }
  return emptyRegistryPayload();
}

export function isUpstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
      process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

export function createUpstashClient(): Redis {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) {
    throw new Error("Upstash Redis env not configured");
  }
  return new Redis({ url, token });
}

export function createUpstashStore(redis: Redis): LaunchRegistryStore {
  async function read(): Promise<RegistryFilePayload> {
    const raw = await redis.get(UPSTASH_REGISTRY_KEY);
    return parsePayload(raw);
  }

  async function write(data: RegistryFilePayload): Promise<void> {
    await redis.set(UPSTASH_REGISTRY_KEY, data);
  }

  const store: LaunchRegistryStore = {
    backend: "upstash",

    async list(): Promise<RegistryLaunch[]> {
      const file = await read();
      return sortLaunchesNewestFirst(file.launches);
    },

    async get(pool: string): Promise<RegistryLaunch | null> {
      const file = await read();
      return file.launches.find((l) => l.pool === pool) ?? null;
    },

    async upsert(input: RegistryLaunchInput): Promise<RegistryLaunch> {
      const entry = normalizeLaunchInput(input);
      const now = new Date().toISOString();
      const file = await read();
      const prev = file.launches.filter((l) => l.pool !== entry.pool);
      const merged: RegistryFilePayload = {
        version: 1,
        updatedAt: now,
        launches: [entry, ...prev].slice(0, MAX_REGISTRY_ENTRIES),
      };
      await write(merged);
      return entry;
    },

    async patch(
      pool: string,
      patch: Partial<RegistryLaunchInput>,
    ): Promise<RegistryLaunch | null> {
      const file = await read();
      const current = file.launches.find((l) => l.pool === pool);
      if (!current) return null;
      return store.upsert({
        ...current,
        ...patch,
        pool: current.pool,
        registeredAt: current.registeredAt,
      });
    },
  };

  return store;
}

/** One-time seed: write payload only if Redis key is missing/empty. */
export async function seedUpstashIfEmpty(
  redis: Redis,
  payload: RegistryFilePayload,
): Promise<boolean> {
  if (!payload.launches.length) return false;
  const existing = parsePayload(await redis.get(UPSTASH_REGISTRY_KEY));
  if (existing.launches.length > 0) return false;
  await redis.set(UPSTASH_REGISTRY_KEY, {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    launches: payload.launches.slice(0, MAX_REGISTRY_ENTRIES),
  });
  return true;
}

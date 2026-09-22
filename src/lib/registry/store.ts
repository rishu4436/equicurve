import { createFileStore, readLocalRegistryFile } from "./fileStore";
import type {
  LaunchRegistryStore,
  RegistryBackend,
  RegistryLaunch,
  RegistryLaunchInput,
  RegistryMeta,
} from "./types";
import {
  createUpstashClient,
  createUpstashStore,
  isUpstashConfigured,
  seedUpstashIfEmpty,
} from "./upstashStore";

let cached: LaunchRegistryStore | null = null;
let seedAttempted = false;

function resolveBackend(): RegistryBackend {
  return isUpstashConfigured() ? "upstash" : "file";
}

/**
 * Active launch registry store.
 * - Upstash Redis REST when UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set
 * - Local JSON file (data/launches/registry.json) otherwise — default for `next dev`
 */
export function getLaunchRegistryStore(): LaunchRegistryStore {
  if (cached) return cached;
  if (isUpstashConfigured()) {
    cached = createUpstashStore(createUpstashClient());
  } else {
    cached = createFileStore();
  }
  return cached;
}

/** Which backend would be selected from current env (no I/O). */
export function getRegistryBackend(): RegistryBackend {
  return resolveBackend();
}

export function getRegistryMeta(): RegistryMeta {
  return { backend: getRegistryBackend() };
}

/**
 * Optional one-time seed: if Upstash is active and empty, copy local file
 * entries (nice-to-have when promoting a populated local registry).
 */
async function maybeSeedFromFile(store: LaunchRegistryStore): Promise<void> {
  if (seedAttempted || store.backend !== "upstash") return;
  seedAttempted = true;
  try {
    const local = await readLocalRegistryFile();
    if (!local.launches.length) return;
    const redis = createUpstashClient();
    await seedUpstashIfEmpty(redis, local);
  } catch {
    /* seed is best-effort */
  }
}

export async function listRegistryLaunches(): Promise<RegistryLaunch[]> {
  const store = getLaunchRegistryStore();
  await maybeSeedFromFile(store);
  return store.list();
}

export async function getRegistryLaunch(
  pool: string,
): Promise<RegistryLaunch | null> {
  return getLaunchRegistryStore().get(pool);
}

export async function upsertRegistryLaunch(
  input: RegistryLaunchInput,
): Promise<RegistryLaunch> {
  return getLaunchRegistryStore().upsert(input);
}

export async function patchRegistryLaunch(
  pool: string,
  patch: Partial<RegistryLaunchInput>,
): Promise<RegistryLaunch | null> {
  return getLaunchRegistryStore().patch(pool, patch);
}

/** Test helper — drop cached store so env changes take effect. */
export function resetRegistryStoreCache(): void {
  cached = null;
  seedAttempted = false;
}

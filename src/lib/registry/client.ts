import type { ExploreResponse } from "@/lib/explore/types";
import type { RegistryLaunchInput } from "./types";

/** Fire-and-forget register of a successful Create into the shared registry. */
export async function registerLaunchRemote(
  launch: RegistryLaunchInput,
): Promise<void> {
  try {
    await fetch("/api/launches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(launch),
    });
  } catch {
    /* registry is best-effort — localStorage still has the launch */
  }
}

export async function patchLaunchRemote(
  pool: string,
  patch: Partial<RegistryLaunchInput>,
): Promise<void> {
  try {
    await fetch("/api/launches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pool, ...patch }),
    });
  } catch {
    /* ignore */
  }
}

export async function fetchExploreOfferings(): Promise<ExploreResponse> {
  const res = await fetch("/api/explore", { cache: "no-store" });
  const json = (await res.json()) as ExploreResponse;
  if (!res.ok) {
    return {
      ok: false,
      source: "equicurve-registry",
      label: "EquiCurve registry (not a full chain indexer)",
      cached: false,
      cacheAgeMs: 0,
      cacheTtlSec: 45,
      offerings: [],
      counts: { registry: 0, configGpa: 0, enriched: 0 },
      limits: [],
      error: json.error ?? `Explore API HTTP ${res.status}`,
      registry: json.registry,
    };
  }
  return json;
}

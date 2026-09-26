import type { SignedLaunchBody } from "@/lib/auth/launchAuth";
import type { ExploreResponse } from "@/lib/explore/types";

export type RegistryClientResult = { ok: true } | { ok: false; error: string };

/** Register a confirmed launch in the shared registry (creator-signed). */
export async function registerLaunchRemote(body: SignedLaunchBody): Promise<RegistryClientResult> {
  try {
    const res = await fetch("/api/launches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

/**
 * Ask the server to re-read a pool from chain (status / graduation / DAMM
 * pool). The client sends only the pool address — never status fields.
 */
export async function refreshLaunchRemote(pool: string): Promise<RegistryClientResult> {
  try {
    const res = await fetch("/api/launches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pool }),
    });
    if (res.ok) return { ok: true };
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: j.error || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}

export async function fetchExploreOfferings(opts: { refresh?: boolean } = {}): Promise<ExploreResponse> {
  const res = await fetch(`/api/explore${opts.refresh ? "?refresh=1" : ""}`, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as Partial<ExploreResponse>;
  if (!res.ok) {
    return {
      ok: false,
      source: "equicurve-registry",
      label: "EquiCurve registry (not a full chain indexer)",
      cached: false,
      cacheAgeMs: 0,
      cacheTtlSec: 45,
      cluster: json.cluster ?? "unknown",
      rpcStatus: json.rpcStatus ?? "unavailable",
      offerings: [],
      counts: { registry: 0, configGpa: 0, enriched: 0, verified: 0, notFound: 0, rpcUnavailable: 0, notChecked: 0 },
      limits: [],
      error: json.error ?? `Explore API HTTP ${res.status}`,
      registry: json.registry,
    };
  }
  return json as ExploreResponse;
}

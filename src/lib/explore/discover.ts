import { PublicKey } from "@solana/web3.js";
import { getCluster, getOptionalPoolConfigKey } from "@/lib/constants";
import { getServerConnection } from "@/lib/connection";
import { getDbcClient } from "@/lib/dbc/client";
import { lookupPoolOnChain } from "@/lib/dbc/migrate";
import { unwrapPoolState } from "@/lib/dbc/poolAccount";
import type { PresetId } from "@/lib/dbc/types";
import { entryFromChain, type ChainLookupResult } from "@/lib/registry/authorize";
import { USDC_MINTS } from "@/lib/registry/chain";
import { getRegistryMeta, listRegistryLaunches, putRegistryLaunch } from "@/lib/registry/store";
import type { RegistryLaunch } from "@/lib/registry/types";
import { isRateLimitError, mapWithConcurrency, withRpcRetry, withTimeout } from "@/lib/rpc";
import type { ExploreOffering, ExploreResponse } from "@/lib/explore/types";
import {
  applyChainLookup,
  countVerification,
  markNotChecked,
  rpcStatusFromCounts,
} from "./verification";

const CACHE_TTL_MS = 45_000;
export const MAX_ENRICH = 24;
export const ENRICH_CONCURRENCY = 4;
export const PER_POOL_TIMEOUT_MS = 8_000;
const MAX_CONFIG_GPA = 40;

type CacheEntry = { at: number; payload: ExploreResponse };
let cache: CacheEntry | null = null;

function isPresetId(v: string): v is PresetId {
  return v === "flat" || v === "exponential" || v === "long" || v === "equity" || v === "short";
}

function registryToOffering(r: RegistryLaunch, cluster: string): ExploreOffering {
  return markNotChecked(
    {
      id: r.pool,
      pool: r.pool,
      mint: r.mint,
      config: r.config,
      name: r.name,
      ticker: r.ticker,
      thesis: r.thesis,
      sector: r.sector,
      quote: r.quote,
      raiseTarget: r.raiseTarget,
      quoteProgress: null,
      presetId: isPresetId(r.presetId) ? r.presetId : "flat",
      lockPct: r.lockPct,
      status: r.status,
      statusSource: "registry",
      verification: { state: "not_checked", checkedAt: null, cluster },
      profileSigned: !!r.authSigner && r.authSigner === r.creator,
      createdAt: r.createdAt,
      creator: r.creator,
      cluster: r.cluster,
      illustrative: false,
      source: "registry",
    },
    cluster,
  );
}

/**
 * On-chain enrichment: at most MAX_ENRICH pools, ENRICH_CONCURRENCY at a time,
 * each with its own try/catch + timeout. Failures degrade that offering only.
 */
export async function enrichOfferings(
  offerings: ExploreOffering[],
  deps: {
    lookup: (pool: string) => Promise<ChainLookupResult>;
    cluster: string;
    now?: () => string;
    timeoutMs?: number;
    concurrency?: number;
    maxEnrich?: number;
  },
): Promise<{ offerings: ExploreOffering[]; enriched: number; rateLimited: boolean }> {
  const max = deps.maxEnrich ?? MAX_ENRICH;
  const now = deps.now ?? (() => new Date().toISOString());
  let rateLimited = false;
  const head = offerings.slice(0, max);
  const tail = offerings.slice(max).map((o) => markNotChecked(o, deps.cluster));
  const checked = await mapWithConcurrency(head, deps.concurrency ?? ENRICH_CONCURRENCY, async (o) => {
    let lookup: ChainLookupResult;
    try {
      lookup = await withTimeout(deps.lookup(o.pool), deps.timeoutMs ?? PER_POOL_TIMEOUT_MS);
    } catch (e) {
      if (isRateLimitError(e)) rateLimited = true;
      lookup = { status: "rpc_unavailable", error: e instanceof Error ? e.message : "RPC error" };
    }
    if (lookup.status === "rpc_unavailable" && isRateLimitError(lookup.error)) rateLimited = true;
    return applyChainLookup(o, lookup, now(), deps.cluster, USDC_MINTS);
  });
  const enriched = checked.filter((o) => o.verification.state === "verified").length;
  return { offerings: [...checked, ...tail], enriched, rateLimited };
}

/**
 * Best-effort: if a shared PoolConfig is configured, pull pools for that config
 * via filtered GPA (memcmp) — not a full-program scan.
 */
async function discoverBySharedConfig(
  existingPools: Set<string>,
  cluster: string,
): Promise<{ offerings: ExploreOffering[]; count: number; warning?: string }> {
  const configKey = getOptionalPoolConfigKey();
  if (!configKey) return { offerings: [], count: 0 };
  try {
    const connection = getServerConnection();
    const client = getDbcClient(connection);
    const pools = await withRpcRetry(() => client.state.getPoolsByConfig(configKey), { timeoutMs: 15_000 });
    const offerings: ExploreOffering[] = [];
    for (const p of pools.slice(0, MAX_CONFIG_GPA)) {
      const pool = p.publicKey.toBase58();
      if (existingPools.has(pool)) continue;
      try {
        const st = unwrapPoolState(p.account);
        const mint = st.baseMint.toBase58();
        offerings.push(
          markNotChecked(
            {
              id: pool,
              pool,
              mint,
              config: configKey.toBase58(),
              name: `Pool ${pool.slice(0, 4)}…`,
              ticker: mint.slice(0, 4).toUpperCase(),
              thesis: "Discovered via shared PoolConfig (getPoolsByConfig) — no creator profile.",
              sector: "Other",
              quote: "SOL",
              raiseTarget: 0,
              quoteProgress: null,
              presetId: "flat",
              lockPct: null,
              status: "unknown",
              statusSource: "registry",
              verification: { state: "not_checked", checkedAt: null, cluster },
              profileSigned: false,
              createdAt: new Date(0).toISOString(),
              creator: st.creator.toBase58(),
              cluster,
              illustrative: false,
              source: "config-gpa",
            },
            cluster,
          ),
        );
      } catch {
        /* skip malformed */
      }
    }
    return { offerings, count: offerings.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "config GPA failed";
    return {
      offerings: [],
      count: 0,
      warning: isRateLimitError(e)
        ? "RPC rate-limited on shared-config pool discovery."
        : `Shared-config discovery failed: ${msg}`,
    };
  }
}

/** Persist chain-derived status changes back to the registry (best-effort). */
async function persistStatusChanges(registry: RegistryLaunch[], offerings: ExploreOffering[], lookups: Map<string, ChainLookupResult>) {
  const byPool = new Map(registry.map((r) => [r.pool, r]));
  for (const o of offerings) {
    const prev = byPool.get(o.pool);
    const l = lookups.get(o.pool);
    if (!prev || !l || l.status !== "verified") continue;
    if (prev.status === o.status && prev.chainCheckedAt) continue;
    const entry = entryFromChain({
      snapshot: l.snapshot,
      profile: null,
      prev,
      cluster: getCluster(),
      nowIso: new Date().toISOString(),
      usdcMints: USDC_MINTS,
    });
    await putRegistryLaunch(entry).catch(() => undefined);
  }
}

export async function buildExploreResponse(
  opts: { bypassCache?: boolean } = {},
): Promise<ExploreResponse> {
  const now = Date.now();
  if (!opts.bypassCache && cache && now - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true, cacheAgeMs: now - cache.at };
  }

  const cluster = getCluster();
  const registryMeta = getRegistryMeta();
  const limits = [
    "Primary source is the EquiCurve shared registry — not a full DBC chain indexer.",
    "Registry chain fields are written only from server-side on-chain reads; profiles are signed by the on-chain creator.",
    `On-chain verification is capped at ${MAX_ENRICH} pools per refresh (${ENRICH_CONCURRENCY} concurrent, ${PER_POOL_TIMEOUT_MS / 1000}s timeout each). Others show "Not checked".`,
    `Results are cached ~${CACHE_TTL_MS / 1000}s — see "Last checked" per card.`,
    "Meteora DBC Data API cannot filter EquiCurve-created offerings, so it is not used.",
    registryMeta.backend === "upstash"
      ? "Registry backend: Upstash Redis REST (durable across deploys)."
      : "Registry backend: local JSON file (data/launches/) — ephemeral on many serverless hosts unless Upstash env is set.",
  ];

  const registry = await listRegistryLaunches();
  let offerings = registry.map((r) => registryToOffering(r, cluster));
  const gpa = await discoverBySharedConfig(new Set(offerings.map((o) => o.pool)), cluster);
  if (gpa.offerings.length) offerings = [...offerings, ...gpa.offerings];

  const connection = getServerConnection();
  const lookups = new Map<string, ChainLookupResult>();
  const enrich = await enrichOfferings(offerings, {
    cluster,
    lookup: async (pool) => {
      const r = await lookupPoolOnChain(connection, new PublicKey(pool));
      lookups.set(pool, r);
      return r;
    },
  });
  offerings = enrich.offerings;
  void persistStatusChanges(registry, offerings, lookups);

  const vc = countVerification(offerings);
  const rpcStatus = rpcStatusFromCounts(vc);
  const warning =
    (enrich.rateLimited
      ? "RPC rate-limited while verifying pools — some offerings show “RPC unavailable”."
      : rpcStatus === "unavailable"
        ? "RPC unavailable — no offering could be verified on-chain right now."
        : rpcStatus === "degraded"
          ? "Some offerings could not be verified (RPC unavailable)."
          : null) ||
    gpa.warning ||
    null;

  const payload: ExploreResponse = {
    ok: true,
    source: "equicurve-registry+rpc-verification",
    label: "EquiCurve registry (not a full chain indexer)",
    cached: false,
    cacheAgeMs: 0,
    cacheTtlSec: Math.round(CACHE_TTL_MS / 1000),
    cluster,
    rpcStatus,
    offerings,
    counts: {
      registry: registry.length,
      configGpa: gpa.count,
      enriched: enrich.enriched,
      ...vc,
    },
    limits,
    warning,
    error: null,
    registry: registryMeta,
  };

  cache = { at: now, payload };
  return payload;
}

/** Drop cache after a successful register so Explore sees new launches quickly. */
export function invalidateExploreCache(): void {
  cache = null;
}

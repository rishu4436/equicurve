import { PublicKey } from "@solana/web3.js";
import { getOptionalPoolConfigKey, quoteLabelForMint } from "@/lib/constants";
import { getConnection } from "@/lib/connection";
import { getDbcClient } from "@/lib/dbc/client";
import { fetchPoolSnapshot } from "@/lib/dbc/migrate";
import { normalizePoolAccount } from "@/lib/dbc/poolAccount";
import type { PresetId } from "@/lib/dbc/types";
import {
  getRegistryMeta,
  listRegistryLaunches,
  patchRegistryLaunch,
} from "@/lib/registry/store";
import type { RegistryLaunch } from "@/lib/registry/types";
import type { ExploreOffering, ExploreResponse } from "@/lib/explore/types";

const CACHE_TTL_MS = 45_000;
const MAX_ENRICH = 24;
const MAX_CONFIG_GPA = 40;

type CacheEntry = {
  at: number;
  payload: ExploreResponse;
};

let cache: CacheEntry | null = null;

function isPresetId(v: string): v is PresetId {
  return (
    v === "flat" ||
    v === "exponential" ||
    v === "long" ||
    v === "equity" ||
    v === "short"
  );
}

function registryToOffering(
  r: RegistryLaunch,
  extras?: Partial<ExploreOffering>,
): ExploreOffering {
  return {
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
    raised: extras?.raised ?? 0,
    quoteProgress: extras?.quoteProgress ?? null,
    presetId: isPresetId(r.presetId) ? r.presetId : "flat",
    feeBps: r.feeBps,
    lockPct: r.lockPct,
    status: r.status,
    volume24h: 0,
    createdAt: r.createdAt,
    creator: r.creator,
    cluster: r.cluster,
    verified: false,
    illustrative: false,
    source: "registry",
    onChain: extras?.onChain,
  };
}

async function enrichFromChain(
  offerings: ExploreOffering[],
): Promise<{ offerings: ExploreOffering[]; enriched: number; warning?: string }> {
  const connection = getConnection();
  const slice = offerings.slice(0, MAX_ENRICH);
  let enriched = 0;
  let warning: string | undefined;
  const results = await Promise.all(
    slice.map(async (o) => {
      try {
        const snap = await fetchPoolSnapshot(
          connection,
          new PublicKey(o.pool),
        );
        enriched += 1;
        const progress = Math.max(0, Math.min(1, snap.quoteProgress || 0));
        const raised =
          o.raiseTarget > 0
            ? Math.round(o.raiseTarget * progress)
            : Math.round(progress * 100);
        const status: ExploreOffering["status"] = snap.isMigrated
          ? "graduated"
          : o.status === "graduated"
            ? "graduated"
            : progress <= 0.02
              ? "new"
              : "raising";
        // Persist graduated flag back into registry (best-effort).
        if (snap.isMigrated && o.status !== "graduated" && o.source === "registry") {
          void patchRegistryLaunch(o.pool, { status: "graduated" }).catch(
            () => undefined,
          );
        }
        return {
          ...o,
          mint: o.mint || snap.baseMint,
          config: o.config || snap.config,
          quote: quoteLabelForMint(snap.quoteMint),
          quoteProgress: progress,
          raised,
          status,
          onChain: true,
        } satisfies ExploreOffering;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "RPC enrich failed";
        if (/429|rate|too many|limit/i.test(msg)) {
          warning = "RPC rate-limited while enriching pools — showing registry metadata only.";
        }
        return { ...o, onChain: false };
      }
    }),
  );

  const byPool = new Map(results.map((r) => [r.pool, r]));
  const merged = offerings.map((o) => byPool.get(o.pool) ?? o);
  return { offerings: merged, enriched, warning };
}

/**
 * Best-effort: if a shared PoolConfig is configured, pull pools for that config
 * via filtered GPA (cheap memcmp) — not a full-program scan.
 */
async function discoverBySharedConfig(
  existingPools: Set<string>,
): Promise<{ offerings: ExploreOffering[]; count: number; warning?: string }> {
  const configKey = getOptionalPoolConfigKey();
  if (!configKey) return { offerings: [], count: 0 };

  try {
    const connection = getConnection();
    const client = getDbcClient(connection);
    const pools = await client.state.getPoolsByConfig(configKey);
    const limited = pools.slice(0, MAX_CONFIG_GPA);
    const offerings: ExploreOffering[] = [];
    for (const p of limited) {
      const pool = p.publicKey.toBase58();
      if (existingPools.has(pool)) continue;
      try {
        const norm = normalizePoolAccount(
          p.account as Parameters<typeof normalizePoolAccount>[0],
        );
        const mint = norm.baseMint.toBase58();
        const creator = norm.creator.toBase58();
        const isMigrated = Boolean(
          (p.account as { isMigrated?: number | boolean }).isMigrated,
        );
        offerings.push({
          id: pool,
          pool,
          mint,
          config: configKey.toBase58(),
          name: `Pool ${pool.slice(0, 4)}…`,
          ticker: mint.slice(0, 4).toUpperCase(),
          thesis: "Discovered via shared PoolConfig (getPoolsByConfig).",
          sector: "Other",
          quote: "SOL",
          raiseTarget: 0,
          raised: 0,
          quoteProgress: null,
          presetId: "flat",
          feeBps: 0,
          lockPct: 0,
          status: isMigrated ? "graduated" : "raising",
          volume24h: 0,
          createdAt: new Date(0).toISOString(),
          creator,
          cluster: process.env.NEXT_PUBLIC_CLUSTER || "devnet",
          verified: false,
          illustrative: false,
          source: "config-gpa",
          onChain: true,
        });
      } catch {
        /* skip malformed */
      }
    }
    return { offerings, count: offerings.length };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "config GPA failed";
    const warning = /429|rate|too many|limit/i.test(msg)
      ? "RPC rate-limited on shared-config pool discovery."
      : `Shared-config discovery failed: ${msg}`;
    return { offerings: [], count: 0, warning };
  }
}

export async function buildExploreResponse(
  opts: { bypassCache?: boolean } = {},
): Promise<ExploreResponse> {
  const now = Date.now();
  if (
    !opts.bypassCache &&
    cache &&
    now - cache.at < CACHE_TTL_MS
  ) {
    return {
      ...cache.payload,
      cached: true,
      cacheAgeMs: now - cache.at,
    };
  }

  const registryMeta = getRegistryMeta();
  const limits = [
    "Primary source is the EquiCurve shared registry (POST /api/launches on Create) — not a full DBC chain indexer.",
    "Meteora DBC Data API (dbc.datapi.meteora.ag) lists all DBC pools but cannot filter EquiCurve-created offerings.",
    "Full-program getProgramAccounts is avoided on public RPC (cost / rate limits).",
    `On-chain progress enrichment is capped at ${MAX_ENRICH} pools per refresh.`,
    "In-memory cache ~45s to protect RPC.",
    registryMeta.backend === "upstash"
      ? "Registry backend: Upstash Redis REST (durable across deploys)."
      : "Registry backend: local JSON file (data/launches/) — default for next dev; ephemeral on many serverless hosts unless Upstash env is set.",
  ];

  const registry = await listRegistryLaunches();
  let offerings = registry.map((r) => registryToOffering(r));
  const existing = new Set(offerings.map((o) => o.pool));

  const gpa = await discoverBySharedConfig(existing);
  if (gpa.offerings.length) {
    offerings = [...offerings, ...gpa.offerings];
  }

  const enrich = await enrichFromChain(offerings);
  offerings = enrich.offerings;

  const warning =
    enrich.warning || gpa.warning || null;

  const payload: ExploreResponse = {
    ok: true,
    source: "equicurve-registry+best-effort-rpc",
    label: "EquiCurve registry (not a full chain indexer)",
    cached: false,
    cacheAgeMs: 0,
    cacheTtlSec: Math.round(CACHE_TTL_MS / 1000),
    offerings,
    counts: {
      registry: registry.length,
      configGpa: gpa.count,
      enriched: enrich.enriched,
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

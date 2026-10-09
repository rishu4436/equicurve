import { PublicKey } from "@solana/web3.js";
import { getCluster, knownUsdcMints, WSOL_MINT } from "@/lib/constants";
import { withReadConnection, getServerConnection } from "@/lib/connection";
import { fetchPoolSnapshot } from "@/lib/dbc/migrate";
import { expectedDammDestination, verifyDammV2Pool } from "@/lib/dbc/migrate";
import { getDbcClient } from "@/lib/dbc/client";
import { reconstructPoolPriceHistory } from "@/lib/dbc/priceHistory";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { compareDeploymentReadback } from "@/lib/dbc/deploymentReadback";
import { effectiveScheduleStatus, type ScheduledLaunch } from "@/lib/schedule/types";
import { getScheduledLaunchStore } from "@/lib/schedule/store";
import { getRecordedDeployment } from "@/lib/registry/publicDeployments";
import { getRegistryLaunch } from "@/lib/registry/store";
import { resolveDeploymentRecord, type ResolvedDeployment } from "@/lib/registry/design";
import type { RegistryDesign } from "@/lib/registry/design";
import type { RegistryLaunch } from "@/lib/registry/types";
import type { ConstraintBudget, ConstraintChange, DesignedMarket } from "@/lib/market/types";
import type {
  PassportCheck,
  PassportDesign,
  PassportDeployment,
  PassportMarket,
  PassportMonitor,
  PassportObserved,
  PassportResponse,
  PassportStatus,
} from "./types";

export class PassportQueryError extends Error {
  readonly status = 400;
  readonly code = "invalid_passport_query";
}

export class PassportNotFoundError extends Error {
  readonly status = 404;
  readonly code = "passport_not_found";
}

export class PassportStorageError extends Error {
  readonly status = 503;
  readonly code = "passport_storage_unavailable";
}

export type HolderObservation = {
  supplyAtoms: string | null;
  largest: { address: string; amountAtoms: string }[];
};

type DeploymentObservation = {
  status: PassportStatus;
  verified: boolean | null;
  poolFound: boolean | null;
  configMatch: boolean | null;
  fingerprintMatch: boolean | null;
  mintMatch: boolean | null;
  thresholdMatch: boolean | null;
  quoteMintMatch: boolean | null;
  creatorMatch: boolean | null;
  checkedAt: string | null;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function percentage(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed == null ? null : parsed > 1 ? parsed : parsed * 100;
}

function quoteMintFor(quote: string | null): string | null {
  if (quote === "SOL") return WSOL_MINT.toBase58();
  if (quote === "USDC") return knownUsdcMints()[0] ?? null;
  return null;
}

function policyFields(policy: { requested: ConstraintBudget; applied: ConstraintBudget; relaxed: ConstraintChange[] } | undefined) {
  return {
    requestedConstraints: policy?.requested ?? null,
    appliedConstraints: policy?.applied ?? null,
    acceptedRelaxations: policy?.relaxed ? [...policy.relaxed] : [],
  };
}

function designFromSources(args: {
  registry?: RegistryLaunch | null;
  deployment?: ResolvedDeployment | null;
  registryDesign?: RegistryDesign | null;
  designed?: DesignedMarket | null;
  targetRaise?: number | string | null;
  quote?: string | null;
  totalSupply?: number | null;
}): PassportDesign {
  const source = args.designed;
  const signed = args.registryDesign;
  const resolved = args.deployment;
  const policy = source?.constraintPolicy ?? signed?.constraintPolicy ?? resolved?.constraintPolicy;
  const fingerprint = source?.configFingerprint ?? signed?.fingerprint ?? resolved?.fingerprint ?? null;
  const expected = signed?.expected ?? resolved?.expected;
  return {
    fingerprint,
    policyId: source?.policyId ?? null,
    configHash: source?.configHash ?? null,
    presetId: source?.presetId ?? args.registry?.presetId ?? null,
    profileName: source?.profileName ?? signed?.profileName ?? resolved?.profileName ?? null,
    asset: source?.asset ?? null,
    objective: source?.objective ?? null,
    constraintsPassed: source?.constraintsPassed ?? signed?.constraintsPassed ?? resolved?.constraintsPassed ?? null,
    ...policyFields(policy),
    originalIntent: {
      targetRaise: args.targetRaise ?? args.registry?.raiseTarget ?? null,
      typicalTrade: null,
      expectedParticipants: null,
      totalSupply: args.totalSupply ?? null,
      quote: args.quote ?? args.registry?.quote ?? null,
    },
    robustness: source
      ? {
          scenarioCount: source.stressPaths,
          insideCount: Math.round(source.stressGraduationRate * source.stressPaths),
          source: "synthetic_cohort",
          note: "Deterministic simulation coverage under the selected assumptions.",
        }
      : null,
    migrationThresholdAtoms: source?.thresholdAtoms ?? signed?.migrationQuoteThresholdAtoms ?? resolved?.migrationQuoteThresholdAtoms ?? expected?.migrationQuoteThreshold ?? null,
    lpLockPct: percentage(expected?.partnerPermanentLockedLiquidityPercentage ?? args.registry?.lockPct),
    concentrationLimit: policy?.applied.maxConcentration ?? null,
  };
}

function lifecycleFor(snapshot: PoolSnapshot | null, destination: "exists" | "missing" | "unknown" | null): PassportMarket["lifecycle"] {
  if (!snapshot) return "Unknown";
  if (snapshot.curve.phase === "raising") return "Raising";
  if (snapshot.curve.phase === "complete") return "Curve complete";
  if (snapshot.curve.phase === "migrated") return destination === "exists" ? "DAMM v2 active" : "Migrated";
  return "Unknown";
}

function venueFor(snapshot: PoolSnapshot | null, destination: "exists" | "missing" | "unknown" | null): PassportMarket["activeVenue"] {
  if (!snapshot) return "Unknown";
  if (snapshot.curve.phase === "raising") return "DBC";
  if (snapshot.curve.phase === "migrated" && destination === "exists") return "DAMM v2";
  return "Pending";
}

function upperBoundState(designed: number | null, observed: number | null): PassportCheck["state"] {
  if (designed == null || observed == null) return "unknown";
  if (observed <= designed * 0.9) return "inside";
  if (observed <= designed) return "near";
  return "outside";
}

function equalityState(designed: number | string | null, observed: number | string | boolean | null): PassportCheck["state"] {
  if (designed == null || observed == null) return "unknown";
  return String(designed) === String(observed) ? "matched" : "mismatch";
}

export function largestTokenAccountShare(supplyAtoms: string | null, accounts: { amountAtoms: string }[]): number | null {
  if (!supplyAtoms || !/^\d+$/.test(supplyAtoms) || !accounts.length) return null;
  let supply: bigint;
  try {
    supply = BigInt(supplyAtoms);
  } catch {
    return null;
  }
  if (supply <= 0n) return null;
  let largest = 0n;
  for (const row of accounts) {
    if (!/^\d+$/.test(row.amountAtoms)) continue;
    try {
      const amount = BigInt(row.amountAtoms);
      if (amount > largest) largest = amount;
    } catch {
      continue;
    }
  }
  return Number((largest * 1_000_000n) / supply) / 1_000_000;
}

export function buildMonitor(args: {
  design: PassportDesign;
  deployment: DeploymentObservation;
  observed: PassportObserved;
  scheduled?: boolean;
}): PassportMonitor {
  if (args.scheduled) return { status: "not_applicable", checks: [], checkedAt: null, note: "Live monitor is not available until launch." };
  const checks: PassportCheck[] = [
    {
      id: "configuration-match",
      label: "Configuration match",
      designed: args.design.fingerprint,
      observed: args.deployment.configMatch,
      state: args.deployment.configMatch == null ? "unknown" : args.deployment.configMatch ? "matched" : "mismatch",
      note: "The fingerprint identifies the canonical configuration; it is not stored on-chain.",
    },
    {
      id: "migration-target",
      label: "Migration target",
      designed: args.design.migrationThresholdAtoms,
      observed: args.observed.migrationComplete ? true : args.observed.quoteProgress,
      state: args.observed.migrationComplete ? "matched" : upperBoundState(1, args.observed.quoteProgress),
    },
    {
      id: "lp-lock",
      label: "LP lock",
      designed: args.design.lpLockPct,
      observed: args.observed.lpLockPct,
      state: equalityState(args.design.lpLockPct, args.observed.lpLockPct),
    },
    {
      id: "participation",
      label: "Participation",
      designed: args.design.originalIntent.expectedParticipants,
      observed: null,
      state: "informational",
      note: "Unique trading wallets are not available from the current confirmed read path.",
    },
    {
      id: "holder-concentration",
      label: "Largest observed token account share",
      designed: args.design.concentrationLimit,
      observed: args.observed.largestObservedTokenAccountShare,
      state: upperBoundState(args.design.concentrationLimit, args.observed.largestObservedTokenAccountShare),
      note: "Token accounts may not map one-to-one to beneficial owners.",
    },
    {
      id: "observed-swaps",
      label: "Observed swap count",
      designed: null,
      observed: args.observed.observedSwapCount,
      state: "informational",
      note: "Confirmed parsed DBC swaps only; this is not a performance forecast.",
    },
  ];
  const unknown = checks.filter((check) => check.state === "unknown").length;
  return {
    status: unknown === checks.length ? "unknown" : unknown > 0 ? "partial" : "available",
    checks,
    checkedAt: args.observed.checkedAt,
  };
}

async function readHolders(connection: ReturnType<typeof getServerConnection>, mint: string): Promise<HolderObservation> {
  const publicMint = new PublicKey(mint);
  const [supply, largest] = await Promise.all([
    withReadConnection(connection, (read) => read.getTokenSupply(publicMint), { server: true }),
    withReadConnection(connection, (read) => read.getTokenLargestAccounts(publicMint), { server: true }),
  ]);
  return {
    supplyAtoms: supply.value.amount,
    largest: largest.value.slice(0, 8).map((row) => ({ address: row.address.toBase58(), amountAtoms: row.amount })),
  };
}

function deploymentFromReadback(args: {
  resolved: ResolvedDeployment | null;
  registry: RegistryLaunch;
  snapshot: PoolSnapshot | null;
  onChain: Record<string, unknown> | null;
  checkedAt: string;
}): DeploymentObservation {
  const { resolved, registry, snapshot, onChain, checkedAt } = args;
  if (!resolved || !snapshot || !onChain) return { status: "unknown", verified: null, poolFound: snapshot != null, configMatch: null, fingerprintMatch: null, mintMatch: null, thresholdMatch: null, quoteMintMatch: null, creatorMatch: null, checkedAt };
  const quoteMint = quoteMintFor(resolved.quote);
  if (!quoteMint) return { status: "unknown", verified: null, poolFound: true, configMatch: null, fingerprintMatch: null, mintMatch: null, thresholdMatch: null, quoteMintMatch: null, creatorMatch: null, checkedAt };
  const verdict = compareDeploymentReadback({
    expected: resolved.expected,
    canonicalConfig: resolved.canonicalConfig,
    fingerprint: resolved.fingerprint,
    identity: { pool: resolved.pool, config: resolved.config, mint: resolved.mint, threshold: resolved.migrationQuoteThresholdAtoms, quoteMint },
    snapshot,
    chain: onChain,
  });
  const mintMatch = snapshot.baseMint === resolved.mint;
  const quoteMintMatch = snapshot.quoteMint === quoteMint && String(onChain.quoteMint) === quoteMint;
  const creatorMatch = snapshot.creator === registry.creator;
  const mismatch = !verdict.verified || !mintMatch || !quoteMintMatch || !creatorMatch;
  return {
    status: mismatch ? "mismatch" : "verified",
    verified: !mismatch,
    poolFound: true,
    configMatch: verdict.checks.poolConfiguration,
    fingerprintMatch: verdict.checks.fingerprint,
    mintMatch,
    thresholdMatch: verdict.checks.migrationThreshold,
    quoteMintMatch,
    creatorMatch,
    checkedAt,
  };
}

function observedFrom(args: {
  snapshot: PoolSnapshot | null;
  destination: "exists" | "missing" | "unknown" | null;
  holders: HolderObservation | null;
  swapCount: number | null;
  checkedAt: string | null;
}): PassportObserved {
  return {
    quoteProgress: args.snapshot?.quoteProgress ?? null,
    migrationComplete: args.snapshot?.isMigrated ?? null,
    lpLockPct: args.snapshot?.lockPct ?? null,
    holders: null,
    observedSwapCount: args.swapCount,
    largestObservedTrade: null,
    largestObservedTokenAccountShare: args.holders ? largestTokenAccountShare(args.holders.supplyAtoms, args.holders.largest) : null,
    currentVenue: venueFor(args.snapshot, args.destination),
    checkedAt: args.checkedAt,
  };
}

export function buildScheduledPassport(schedule: ScheduledLaunch): PassportResponse {
  const design = designFromSources({
    registryDesign: schedule.design,
    designed: schedule.designed,
    targetRaise: schedule.raiseTarget,
    quote: schedule.quote,
    totalSupply: schedule.totalSupply,
  });
  const market: PassportMarket = {
    id: schedule.id,
    kind: "scheduled",
    pool: null,
    mint: null,
    config: null,
    creator: schedule.creatorWallet,
    quote: schedule.quote,
    name: schedule.name,
    ticker: schedule.ticker,
    lifecycle: "Scheduled",
    activeVenue: "Pending",
  };
  const deployment: PassportDeployment = { status: "not_applicable", verified: null, poolFound: null, configMatch: null, fingerprintMatch: null, mintMatch: null, thresholdMatch: null, quoteMintMatch: null, creatorMatch: null, checkedAt: null };
  const observed: PassportObserved = { quoteProgress: null, migrationComplete: null, lpLockPct: null, holders: null, observedSwapCount: null, largestObservedTrade: null, largestObservedTokenAccountShare: null, currentVenue: "Pending", checkedAt: null };
  return { ok: true, schemaVersion: "1", market, design, deployment, observed, monitor: buildMonitor({ design, deployment, observed, scheduled: true }), schedule: { status: effectiveScheduleStatus(schedule), scheduledForUtc: schedule.scheduledForUtc, note: "No market exists on-chain yet" } };
}

export function buildLivePassportFromReadings(args: {
  id: string;
  registry: RegistryLaunch;
  catalog: ReturnType<typeof getRecordedDeployment>;
  resolved?: ResolvedDeployment | null;
  snapshot: PoolSnapshot | null;
  onChain: Record<string, unknown> | null;
  destination: "exists" | "missing" | "unknown" | null;
  holders: HolderObservation | null;
  swapCount: number | null;
  checkedAt: string;
}): PassportResponse {
  const { id, registry, catalog, snapshot, onChain, destination, holders, swapCount, checkedAt } = args;
  const resolved = args.resolved ?? resolveDeploymentRecord({ pool: id, registry, catalog });
  const design = designFromSources({ registry, registryDesign: registry.design, deployment: resolved, targetRaise: registry.raiseTarget, quote: registry.quote });
  const deployment = deploymentFromReadback({ resolved, registry, snapshot, onChain, checkedAt });
  const observed = observedFrom({ snapshot, destination, holders, swapCount, checkedAt });
  const market: PassportMarket = {
    id,
    kind: "live",
    pool: id,
    mint: registry.mint,
    config: (resolved?.config ?? registry.config) || null,
    creator: registry.creator || null,
    quote: registry.quote,
    name: registry.name,
    ticker: registry.ticker,
    lifecycle: lifecycleFor(snapshot, destination),
    activeVenue: venueFor(snapshot, destination),
  };
  return { ok: true, schemaVersion: "1", market, design, deployment, observed, monitor: buildMonitor({ design, deployment, observed }), schedule: null };
}

async function livePassport(id: string, registry: RegistryLaunch, catalog: ReturnType<typeof getRecordedDeployment>): Promise<PassportResponse> {
  let pool: PublicKey;
  try { pool = new PublicKey(id); } catch { throw new PassportQueryError("Market id must be a valid pool address or scheduled launch id."); }
  const resolved = resolveDeploymentRecord({ pool: id, registry, catalog });
  const checkedAt = new Date().toISOString();
  let connection: ReturnType<typeof getServerConnection> | null = null;
  try { connection = getServerConnection(); } catch { connection = null; }
  let snapshot: PoolSnapshot | null = null;
  let onChain: Record<string, unknown> | null = null;
  let destination: "exists" | "missing" | "unknown" | null = null;
  let holders: HolderObservation | null = null;
  let swapCount: number | null = null;
  if (connection) {
    try { snapshot = await withReadConnection(connection, (read) => fetchPoolSnapshot(read, pool), { server: true }); } catch { snapshot = null; }
    if (snapshot?.config && resolved) {
      try { onChain = await withReadConnection(connection, (read) => getDbcClient(read).state.getPoolConfig(new PublicKey(snapshot!.config)), { server: true }) as unknown as Record<string, unknown> | null; } catch { onChain = null; }
    }
    try { holders = await readHolders(connection, registry.mint); } catch { holders = null; }
    try {
      const history = await withReadConnection(connection, (read) => reconstructPoolPriceHistory(read, pool, { limit: 100 }), { server: true });
      swapCount = history.parsedSwaps;
    } catch { swapCount = null; }
    if (snapshot?.isMigrated) {
      try {
        const expected = expectedDammDestination(snapshot);
        const result = expected ? await verifyDammV2Pool(connection, expected.dammPool) : "unknown";
        destination = result === "exists" || result === "missing" ? result : "unknown";
      } catch { destination = "unknown"; }
    }
  }
  return buildLivePassportFromReadings({ id, registry, catalog, resolved, snapshot, onChain, destination, holders, swapCount, checkedAt });
}

export async function getPassport(id: string): Promise<PassportResponse> {
  if (!id || id.length > 120) throw new PassportQueryError("Invalid market id.");
  let schedule: ScheduledLaunch | null = null;
  let scheduleStorageUnavailable = false;
  try { schedule = await getScheduledLaunchStore().get(id); } catch (error) { if (error instanceof Error && error.name === "ScheduleStorageConfigError") scheduleStorageUnavailable = true; }
  if (schedule && schedule.cluster === getCluster() && !["cancelled", "launched", "invalidated"].includes(schedule.status)) return buildScheduledPassport(schedule);
  const registry = await getRegistryLaunch(id);
  const catalog = getRecordedDeployment(id);
  if (!registry && !catalog) {
    if (scheduleStorageUnavailable) throw new PassportStorageError("Scheduled Passport storage is unavailable in this environment.");
    try { new PublicKey(id); } catch { throw new PassportQueryError("Market id must be a valid pool address or scheduled launch id."); }
    throw new PassportNotFoundError("No canonical Passport exists for this market.");
  }
  const row = registry ?? (catalog ? {
    pool: catalog.pool, mint: catalog.mint, config: catalog.config, creator: catalog.creator, quoteMint: null, quote: catalog.quote,
    feeClaimer: catalog.creator, lockPct: null, creatorFeePct: null, status: "unknown" as const, isMigrated: false, dammPool: null,
    name: catalog.name, ticker: catalog.ticker, thesis: catalog.thesis, sector: catalog.sector, presetId: catalog.presetId, raiseTarget: catalog.raiseTarget,
    cluster: catalog.cluster, createdAt: catalog.deployedAt, registeredAt: catalog.deployedAt, updatedAt: catalog.deployedAt, chainCheckedAt: null, authSigner: null, authIssuedAt: null, design: null,
  } satisfies RegistryLaunch : null);
  if (!row || row.cluster !== getCluster()) throw new PassportNotFoundError("No canonical Passport exists for this cluster.");
  return livePassport(id, row, catalog);
}

import { CP_AMM_PROGRAM_ID } from "@meteora-ag/cp-amm-sdk";
import { PublicKey, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { atomsRatioToDecimalString, formatAtomsExact } from "@/lib/amounts";
import { fetchDammPoolSnapshot } from "@/lib/damm/pool";
import type { DammPoolSnapshot } from "@/lib/damm/types";
import { expectedDammDestination, fetchPoolSnapshot } from "@/lib/dbc/migrate";
import {
  parseSwapEventsFromLogs,
  swapEventToAmounts,
  type SwapEventLike,
} from "@/lib/dbc/priceHistory";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { isTransientRpcError } from "@/lib/rpc";
import { createTtlSingleFlight } from "@/lib/server/ttlCache";
import { fetchSpotPrice } from "@/lib/dbc/spotPrice";

export type HistoryVenue = "dbc" | "damm-v2";
export type HistoryTimeframe = "5m" | "15m" | "1h" | "4h" | "1D" | "ALL";
export type HistoryMode = "trades" | "candles";

export type HistoricalTrade = {
  signature: string;
  slot: number;
  blockTime: number;
  venue: HistoryVenue;
  baseMint: string;
  quoteMint: string;
  side: "buy" | "sell";
  baseAmountAtoms: string;
  quoteAmountAtoms: string;
  baseAmount: string;
  quoteAmount: string;
  priceQuotePerToken: string;
  source: "dbc-confirmed-swap" | "damm-v2-confirmed-swap";
  verified: true;
};

export type HistoryCandle = {
  startTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  baseVolume: string;
  quoteVolume: string;
  tradeCount: number;
  venues: HistoryVenue[];
};

export type MigrationBoundary = {
  known: boolean;
  blockTime: number | null;
  signature: string | null;
  /** When exact migration evidence is unavailable, this is the observed transition region. */
  transitionStartTime?: number | null;
  transitionEndTime?: number | null;
  source?: "migration-transaction" | "first-verified-damm-trade" | "last-dbc-swap" | "unknown";
};

export type VenueCoverage = {
  complete: boolean;
  oldestObservedAt: string | null;
  newestObservedAt: string | null;
  signaturesScanned: number;
  swapsParsed: number;
};

export type HistoryCoverage = {
  from: string | null;
  to: string | null;
  dbc: VenueCoverage;
  dammV2: VenueCoverage;
  reaches24hBoundary: boolean;
};

export type MarketHistory = {
  ok: true;
  market: {
    pool: string;
    baseMint: string;
    quoteMint: string;
    baseDecimals: number | null;
    quoteDecimals: number | null;
    activeVenue: "DBC" | "DAMM v2" | "Unknown";
    currentPriceQuotePerToken: string | null;
  };
  timeframe: HistoryTimeframe;
  mode: HistoryMode;
  candleIntervalSeconds: number;
  coverage: HistoryCoverage;
  migrationBoundary: MigrationBoundary;
  trades: HistoricalTrade[];
  candles: HistoryCandle[];
  volume24h: string | null;
  change24hPct: string | null;
  referencePrice24h: string | null;
  partial: boolean;
  unavailableReasons: string[];
};

type ScanResult = {
  trades: HistoricalTrade[];
  coverage: VenueCoverage;
  partial: boolean;
  error: string | null;
};

const MAX_PAGES = 8;
const PAGE_SIZE = 50;
const MAX_SIGNATURES = 400;
const MAX_PARSED_TRANSACTIONS = 400;
const MAX_SCAN_MS = 8_000;
const CHUNK_SIZE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const TIMEFRAME_WINDOWS: Record<HistoryTimeframe, number | null> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1D": DAY_MS,
  ALL: null,
};

const TIMEFRAME_BUCKETS: Record<Exclude<HistoryTimeframe, "ALL">, number> = {
  "5m": 30_000,
  "15m": 60_000,
  "1h": 5 * 60_000,
  "4h": 15 * 60_000,
  "1D": 60 * 60_000,
};

const historyCache = createTtlSingleFlight<MarketHistory>(10_000);

function parseDecimal(value: string): { integer: bigint; scale: number } | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) return null;
  const scale = match[3]?.length ?? 0;
  const integer = BigInt(`${match[1] === "-" ? "-" : ""}${match[2]}${match[3] ?? ""}`);
  return { integer, scale };
}

function formatScaled(integer: bigint, scale: number): string {
  const neg = integer < 0n;
  const abs = neg ? -integer : integer;
  const base = 10n ** BigInt(scale);
  const whole = abs / base;
  const frac = scale ? abs % base : 0n;
  const suffix = frac ? `.${frac.toString().padStart(scale, "0").replace(/0+$/, "")}` : "";
  return `${neg ? "-" : ""}${whole.toString()}${suffix}`;
}

/** Exact decimal addition used for volume aggregation. */
export function addDecimalStrings(a: string, b: string): string {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right) return "0";
  const scale = Math.max(left.scale, right.scale);
  return formatScaled(
    left.integer * 10n ** BigInt(scale - left.scale) + right.integer * 10n ** BigInt(scale - right.scale),
    scale,
  );
}

export function compareDecimalStrings(a: string, b: string): number {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right) return 0;
  const scale = Math.max(left.scale, right.scale);
  const l = left.integer * 10n ** BigInt(scale - left.scale);
  const r = right.integer * 10n ** BigInt(scale - right.scale);
  return l < r ? -1 : l > r ? 1 : 0;
}

/** Percentage change with a bounded decimal presentation, never via atom floats. */
export function percentChangeString(current: string, reference: string, fractionDigits = 4): string | null {
  const c = parseDecimal(current);
  const r = parseDecimal(reference);
  if (!c || !r || r.integer <= 0n) return null;
  const scale = Math.max(c.scale, r.scale);
  const cv = c.integer * 10n ** BigInt(scale - c.scale);
  const rv = r.integer * 10n ** BigInt(scale - r.scale);
  const denominator = rv;
  const numerator = (cv - rv) * 100n * 10n ** BigInt(fractionDigits);
  return formatScaled(numerator / denominator, fractionDigits);
}

function normalizeTimeframe(value: string | null | undefined): HistoryTimeframe | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "5m") return "5m";
  if (normalized === "15m") return "15m";
  if (normalized === "1h") return "1h";
  if (normalized === "4h") return "4h";
  if (normalized === "1d") return "1D";
  if (normalized === "all") return "ALL";
  return null;
}

export function parseHistoryTimeframe(value: string | null | undefined): HistoryTimeframe | null {
  return normalizeTimeframe(value);
}

export function parseHistoryMode(value: string | null | undefined): HistoryMode | null {
  return value === "trades" || value === "candles" ? value : null;
}

export function candleIntervalSeconds(timeframe: HistoryTimeframe, observedSpanMs = 0): number {
  if (timeframe !== "ALL") return TIMEFRAME_BUCKETS[timeframe] / 1000;
  if (observedSpanMs <= 7 * DAY_MS) return 60 * 60;
  if (observedSpanMs <= 30 * DAY_MS) return 4 * 60 * 60;
  return DAY_MS / 1000;
}

function toIso(ms: number | null): string | null {
  return ms == null || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}

function keyString(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof (value as { toBase58?: unknown }).toBase58 === "function") {
    return (value as { toBase58: () => string }).toBase58();
  }
  return null;
}

function transactionKeys(tx: ParsedTransactionWithMeta): string[] {
  return (tx.transaction.message.accountKeys ?? []).map((key) => keyString((key as { pubkey?: unknown }).pubkey ?? key) ?? "");
}

function involvesProgram(tx: ParsedTransactionWithMeta, program: PublicKey): boolean {
  const programAddress = program.toBase58();
  return transactionKeys(tx).includes(programAddress) || Boolean(tx.meta?.logMessages?.some((line) => line.includes(programAddress)));
}

function eventPoolAddress(event: SwapEventLike): string | null {
  return keyString(event.data.pool);
}

function makeTrade(args: {
  signature: string;
  slot: number;
  blockTime: number;
  venue: HistoryVenue;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  side: "buy" | "sell";
  baseAmountAtoms: bigint;
  quoteAmountAtoms: bigint;
  priceQuotePerToken: string;
}): HistoricalTrade {
  return {
    signature: args.signature,
    slot: args.slot,
    blockTime: args.blockTime,
    venue: args.venue,
    baseMint: args.baseMint,
    quoteMint: args.quoteMint,
    side: args.side,
    baseAmountAtoms: args.baseAmountAtoms.toString(),
    quoteAmountAtoms: args.quoteAmountAtoms.toString(),
    baseAmount: formatAtomsExact(args.baseAmountAtoms, args.baseDecimals),
    quoteAmount: formatAtomsExact(args.quoteAmountAtoms, args.quoteDecimals),
    priceQuotePerToken: args.priceQuotePerToken,
    source: args.venue === "dbc" ? "dbc-confirmed-swap" : "damm-v2-confirmed-swap",
    verified: true,
  };
}

function dbcTradesFromTransaction(args: {
  tx: ParsedTransactionWithMeta;
  signature: string;
  slot: number;
  blockTime: number | null;
  pool: string;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
}): HistoricalTrade[] {
  const { tx, blockTime } = args;
  if (!tx.meta || tx.meta.err || !involvesProgram(tx, new PublicKey(args.pool))) return [];
  const events = parseSwapEventsFromLogs(tx.meta.logMessages);
  const trades: HistoricalTrade[] = [];
  for (const event of events) {
    if (eventPoolAddress(event) && eventPoolAddress(event) !== args.pool) continue;
    const normalized = swapEventToAmounts(event, args.baseDecimals, args.quoteDecimals);
    if (!normalized) continue;
    const eventTime = normalized.tsSec != null && normalized.tsSec > 1_000_000_000 ? normalized.tsSec * 1000 : null;
    const timestamp = eventTime ?? (blockTime == null ? null : blockTime * 1000);
    if (timestamp == null) continue;
    trades.push(makeTrade({
      signature: args.signature,
      slot: args.slot,
      blockTime: timestamp,
      venue: "dbc",
      baseMint: args.baseMint,
      quoteMint: args.quoteMint,
      baseDecimals: args.baseDecimals,
      quoteDecimals: args.quoteDecimals,
      ...normalized,
    }));
  }
  return trades;
}

type VaultDelta = { pre: bigint; post: bigint };

function vaultDelta(tx: ParsedTransactionWithMeta, vault: string, mint: string): VaultDelta | null {
  const index = transactionKeys(tx).findIndex((key) => key === vault);
  if (index < 0 || !tx.meta) return null;
  const get = (entries: typeof tx.meta.preTokenBalances): bigint | null => {
    const entry = entries?.find((balance) => balance.accountIndex === index && balance.mint === mint);
    if (!entry) return null;
    try {
      return BigInt(entry.uiTokenAmount.amount);
    } catch {
      return null;
    }
  };
  const pre = get(tx.meta.preTokenBalances);
  const post = get(tx.meta.postTokenBalances);
  if (pre == null || post == null) return null;
  return { pre, post };
}

/** Strict balance attribution for CP-AMM swaps. LP and transfer-only deltas fail closed. */
export function inferDammSwapFromVaultDeltas(args: {
  baseDeltaAtoms: bigint;
  quoteDeltaAtoms: bigint;
  baseDecimals: number;
  quoteDecimals: number;
}): { side: "buy" | "sell"; baseAmountAtoms: bigint; quoteAmountAtoms: bigint; priceQuotePerToken: string } | null {
  const { baseDeltaAtoms, quoteDeltaAtoms } = args;
  if (baseDeltaAtoms === 0n || quoteDeltaAtoms === 0n || (baseDeltaAtoms > 0n) === (quoteDeltaAtoms > 0n)) return null;
  const side = baseDeltaAtoms < 0n ? "buy" : "sell";
  const baseAmountAtoms = baseDeltaAtoms < 0n ? -baseDeltaAtoms : baseDeltaAtoms;
  const quoteAmountAtoms = quoteDeltaAtoms < 0n ? -quoteDeltaAtoms : quoteDeltaAtoms;
  const priceQuotePerToken = atomsRatioToDecimalString(quoteAmountAtoms, baseAmountAtoms, args.quoteDecimals, args.baseDecimals);
  return priceQuotePerToken ? { side, baseAmountAtoms, quoteAmountAtoms, priceQuotePerToken } : null;
}

function dammTradeFromTransaction(args: {
  tx: ParsedTransactionWithMeta;
  signature: string;
  slot: number;
  blockTime: number | null;
  pool: DammPoolSnapshot;
}): HistoricalTrade | null {
  const { tx, pool } = args;
  if (!tx.meta || tx.meta.err || !pool.tokenAVault || !pool.tokenBVault || !involvesProgram(tx, CP_AMM_PROGRAM_ID)) return null;
  const a = vaultDelta(tx, pool.tokenAVault, pool.tokenAMint);
  const b = vaultDelta(tx, pool.tokenBVault, pool.tokenBMint);
  if (!a || !b || args.blockTime == null) return null;
  const deltaA = a.post - a.pre;
  const deltaB = b.post - b.pre;
  const baseIsA = pool.tokenAMint === pool.baseMint;
  const baseDeltaAtoms = baseIsA ? deltaA : deltaB;
  const quoteDeltaAtoms = baseIsA ? deltaB : deltaA;
  const inferred = inferDammSwapFromVaultDeltas({
    baseDeltaAtoms,
    quoteDeltaAtoms,
    baseDecimals: baseIsA ? pool.tokenADecimals : pool.tokenBDecimals,
    quoteDecimals: baseIsA ? pool.tokenBDecimals : pool.tokenADecimals,
  });
  if (!inferred) return null;
  return makeTrade({
    signature: args.signature,
    slot: args.slot,
    blockTime: args.blockTime * 1000,
    venue: "damm-v2",
    baseMint: pool.baseMint,
    quoteMint: pool.quoteMint,
    baseDecimals: baseIsA ? pool.tokenADecimals : pool.tokenBDecimals,
    quoteDecimals: baseIsA ? pool.tokenBDecimals : pool.tokenADecimals,
    ...inferred,
  });
}

function sortTrades(trades: HistoricalTrade[]): HistoricalTrade[] {
  return [...trades].sort((a, b) => a.blockTime - b.blockTime || a.slot - b.slot || a.signature.localeCompare(b.signature));
}

/** One confirmed signature can contain multiple parsers' observations; keep one canonical observation. */
export function dedupeHistoricalTrades(trades: HistoricalTrade[]): HistoricalTrade[] {
  const bySignature = new Map<string, HistoricalTrade>();
  for (const trade of sortTrades(trades)) {
    const existing = bySignature.get(trade.signature);
    if (!existing || (trade.venue === "damm-v2" && existing.venue === "dbc")) bySignature.set(trade.signature, trade);
  }
  return sortTrades([...bySignature.values()]);
}

function emptyCoverage(): VenueCoverage {
  return { complete: false, oldestObservedAt: null, newestObservedAt: null, signaturesScanned: 0, swapsParsed: 0 };
}

async function scanVenue(args: {
  connection: Connection;
  address: PublicKey;
  fromMs: number;
  parse: (tx: ParsedTransactionWithMeta, signature: string, slot: number, blockTime: number | null) => HistoricalTrade[];
}): Promise<ScanResult> {
  const started = Date.now();
  const coverage = emptyCoverage();
  const trades: HistoricalTrade[] = [];
  let before: string | undefined;
  let partial = false;
  let error: string | null = null;
  let complete = false;
  let pages = 0;
  let parsedTransactionCount = 0;
  while (pages < MAX_PAGES && coverage.signaturesScanned < MAX_SIGNATURES) {
    if (Date.now() - started >= MAX_SCAN_MS) {
      partial = true;
      error = "History scan time ceiling reached.";
      break;
    }
    const pageLimit = Math.min(PAGE_SIZE, MAX_SIGNATURES - coverage.signaturesScanned);
    let page: Awaited<ReturnType<Connection["getSignaturesForAddress"]>>;
    try {
      page = await args.connection.getSignaturesForAddress(args.address, { limit: pageLimit, before });
    } catch (e) {
      partial = true;
      error = isTransientRpcError(e) ? "RPC temporarily unavailable while scanning history." : "History signature scan failed.";
      break;
    }
    pages += 1;
    coverage.signaturesScanned += page.length;
    if (page.length === 0) {
      complete = true;
      break;
    }
    coverage.newestObservedAt ??= toIso(page[0]?.blockTime == null ? null : page[0].blockTime * 1000);
    const oldest = page.at(-1)?.blockTime;
    if (oldest != null) coverage.oldestObservedAt = toIso(oldest * 1000);
    const parseable = page
      .filter((item) => !item.err && item.blockTime != null)
      .slice(0, Math.max(0, MAX_PARSED_TRANSACTIONS - parsedTransactionCount));
    parsedTransactionCount += parseable.length;
    for (let i = 0; i < parseable.length; i += CHUNK_SIZE) {
      if (Date.now() - started >= MAX_SCAN_MS) {
        partial = true;
        error = "History scan time ceiling reached.";
        break;
      }
      const chunk = parseable.slice(i, i + CHUNK_SIZE);
      let txs: (ParsedTransactionWithMeta | null)[];
      try {
        txs = await args.connection.getParsedTransactions(chunk.map((item) => item.signature), { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      } catch (e) {
        partial = true;
        error = isTransientRpcError(e) ? "RPC temporarily unavailable while parsing history." : "History transaction parsing failed.";
        break;
      }
      for (let j = 0; j < chunk.length; j += 1) {
        const tx = txs[j];
        if (!tx) continue;
        trades.push(...args.parse(tx, chunk[j].signature, chunk[j].slot, chunk[j].blockTime ?? null));
      }
    }
    // A page can reach the requested timestamp while transaction parsing has
    // already failed. That is not complete coverage: do not let a partial RPC
    // read produce a false zero-volume or 24h-change result.
    if (partial) break;
    if (oldest != null && oldest * 1000 <= args.fromMs) {
      complete = true;
      break;
    }
    if (page.length < pageLimit) {
      complete = true;
      break;
    }
    before = page.at(-1)?.signature;
    if (!before) {
      complete = true;
      break;
    }
  }
  if (!complete && !partial) {
    partial = true;
    error = "History scan ceiling reached before the requested range.";
  }
  coverage.complete = complete && !partial;
  const normalizedTrades = dedupeHistoricalTrades(trades);
  coverage.swapsParsed = normalizedTrades.length;
  return { trades: normalizedTrades, coverage, partial, error };
}

async function scanDbc(args: { connection: Connection; pool: PublicKey; snapshot: PoolSnapshot; fromMs: number }): Promise<ScanResult> {
  if (!args.snapshot.quoteMint || args.snapshot.baseDecimals == null || args.snapshot.quoteDecimals == null) {
    return { trades: [], coverage: { ...emptyCoverage(), complete: true }, partial: true, error: "Verified DBC mint decimals are unavailable." };
  }
  return scanVenue({
    connection: args.connection,
    address: args.pool,
    fromMs: args.fromMs,
    parse: (tx, signature, slot, blockTime) => dbcTradesFromTransaction({
      tx,
      signature,
      slot,
      blockTime,
      pool: args.snapshot.pool,
      baseMint: args.snapshot.baseMint,
      quoteMint: args.snapshot.quoteMint!,
      baseDecimals: args.snapshot.baseDecimals!,
      quoteDecimals: args.snapshot.quoteDecimals!,
    }),
  });
}

async function scanDamm(args: { connection: Connection; pool: DammPoolSnapshot; fromMs: number }): Promise<ScanResult> {
  if (!args.pool.exists || !args.pool.tokenAVault || !args.pool.tokenBVault) {
    return { trades: [], coverage: { ...emptyCoverage(), complete: true }, partial: true, error: "Verified DAMM v2 vault accounts are unavailable." };
  }
  const address = new PublicKey(args.pool.address);
  return scanVenue({
    connection: args.connection,
    address,
    fromMs: args.fromMs,
    parse: (tx, signature, slot, blockTime) => {
      const trade = dammTradeFromTransaction({ tx, signature, slot, blockTime, pool: args.pool });
      return trade ? [trade] : [];
    },
  });
}

function filterTradesForWindow(trades: HistoricalTrade[], timeframe: HistoryTimeframe, nowMs: number): HistoricalTrade[] {
  const windowMs = TIMEFRAME_WINDOWS[timeframe];
  if (windowMs == null) return sortTrades(trades);
  const start = nowMs - windowMs;
  return sortTrades(trades.filter((trade) => trade.blockTime >= start && trade.blockTime <= nowMs));
}

export function aggregateCandles(trades: HistoricalTrade[], intervalSeconds: number): HistoryCandle[] {
  const intervalMs = intervalSeconds * 1000;
  const buckets = new Map<number, HistoryCandle>();
  for (const trade of sortTrades(trades)) {
    const startTime = Math.floor(trade.blockTime / intervalMs) * intervalMs;
    const existing = buckets.get(startTime);
    if (!existing) {
      buckets.set(startTime, {
        startTime,
        open: trade.priceQuotePerToken,
        high: trade.priceQuotePerToken,
        low: trade.priceQuotePerToken,
        close: trade.priceQuotePerToken,
        baseVolume: trade.baseAmount,
        quoteVolume: trade.quoteAmount,
        tradeCount: 1,
        venues: [trade.venue],
      });
      continue;
    }
    if (compareDecimalStrings(trade.priceQuotePerToken, existing.high) > 0) existing.high = trade.priceQuotePerToken;
    if (compareDecimalStrings(trade.priceQuotePerToken, existing.low) < 0) existing.low = trade.priceQuotePerToken;
    existing.close = trade.priceQuotePerToken;
    existing.baseVolume = addDecimalStrings(existing.baseVolume, trade.baseAmount);
    existing.quoteVolume = addDecimalStrings(existing.quoteVolume, trade.quoteAmount);
    existing.tradeCount += 1;
    if (!existing.venues.includes(trade.venue)) existing.venues.push(trade.venue);
  }
  return [...buckets.values()].sort((a, b) => a.startTime - b.startTime);
}

export function resolveMigrationBoundary(args: {
  migrated: boolean;
  migrationTransaction?: { blockTime: number; signature: string } | null;
  dbcTrades: HistoricalTrade[];
  dammTrades: HistoricalTrade[];
}): MigrationBoundary {
  if (args.migrationTransaction) {
    return { known: true, blockTime: args.migrationTransaction.blockTime, signature: args.migrationTransaction.signature, source: "migration-transaction" };
  }
  if (!args.migrated) return { known: false, blockTime: null, signature: null, source: "unknown" };
  const lastDbc = sortTrades(args.dbcTrades).at(-1);
  const firstDamm = sortTrades(args.dammTrades)[0];
  if (!lastDbc && !firstDamm) return { known: false, blockTime: null, signature: null, source: "unknown" };
  return {
    known: false,
    blockTime: null,
    signature: null,
    transitionStartTime: lastDbc?.blockTime ?? null,
    transitionEndTime: firstDamm?.blockTime ?? null,
    source: firstDamm ? "first-verified-damm-trade" : "last-dbc-swap",
  };
}

export function canClaim24hCoverage(args: {
  dbc: VenueCoverage;
  dammV2: VenueCoverage;
  migrated: boolean;
  requestedBoundaryMs: number;
  observedFromMs: number | null;
}): boolean {
  const venueComplete = args.migrated ? args.dbc.complete && args.dammV2.complete : args.dbc.complete;
  return venueComplete && (args.observedFromMs == null || args.observedFromMs <= args.requestedBoundaryMs);
}

function mergeCoverage(dbc: VenueCoverage, damm: VenueCoverage, migrated: boolean, fromMs: number): HistoryCoverage {
  const times = [dbc.oldestObservedAt, dbc.newestObservedAt, damm.oldestObservedAt, damm.newestObservedAt].filter(Boolean).map((value) => new Date(value as string).getTime());
  const observedFrom = times.length ? Math.min(...times) : null;
  const observedTo = times.length ? Math.max(...times) : null;
  const reaches24hBoundary = canClaim24hCoverage({ dbc, dammV2: damm, migrated, requestedBoundaryMs: fromMs, observedFromMs: observedFrom });
  return {
    from: toIso(observedFrom),
    to: toIso(observedTo),
    dbc,
    dammV2: damm,
    reaches24hBoundary: reaches24hBoundary && (observedFrom == null || observedFrom <= fromMs),
  };
}

async function buildMarketHistoryUncached(args: {
  connection: Connection;
  pool: PublicKey;
  timeframe: HistoryTimeframe;
  mode: HistoryMode;
}): Promise<MarketHistory> {
  const nowMs = Date.now();
  const snapshot = await fetchPoolSnapshot(args.connection, args.pool);
  if (!snapshot.quoteMint) throw new Error("Verified quote mint is unavailable.");
  const requestedWindow = TIMEFRAME_WINDOWS[args.timeframe];
  const boundaryMs = nowMs - DAY_MS;
  const fromMs = requestedWindow == null ? boundaryMs - 30 * DAY_MS : Math.min(nowMs - requestedWindow, boundaryMs);
  const reasons: string[] = [];
  const dbc = await scanDbc({ connection: args.connection, pool: args.pool, snapshot, fromMs });
  if (dbc.error) reasons.push(`DBC: ${dbc.error}`);
  let damm: ScanResult = { trades: [], coverage: { ...emptyCoverage(), complete: !snapshot.isMigrated }, partial: false, error: null };
  let dammSnapshot: DammPoolSnapshot | null = null;
  if (snapshot.isMigrated) {
    const destination = expectedDammDestination(snapshot);
    if (!destination) {
      damm = { trades: [], coverage: emptyCoverage(), partial: true, error: "Verified migration destination is unavailable." };
    } else {
      try {
        dammSnapshot = await fetchDammPoolSnapshot({ connection: args.connection, pool: destination.dammPool, baseMint: snapshot.baseMint, quoteMint: snapshot.quoteMint, source: "derived" });
        damm = await scanDamm({ connection: args.connection, pool: dammSnapshot, fromMs });
      } catch (e) {
        damm = { trades: [], coverage: emptyCoverage(), partial: true, error: isTransientRpcError(e) ? "RPC temporarily unavailable while reading DAMM v2 history." : "Verified DAMM v2 history is unavailable." };
      }
    }
    if (damm.error) reasons.push(`DAMM v2: ${damm.error}`);
  }
  const allTrades = dedupeHistoricalTrades([...dbc.trades, ...damm.trades].filter((trade) => trade.baseMint === snapshot.baseMint && trade.quoteMint === snapshot.quoteMint));
  let currentPrice: string | null = null;
  let activeVenue: "DBC" | "DAMM v2" | "Unknown" = "Unknown";
  try {
    if (snapshot.isMigrated && dammSnapshot?.exists) {
      currentPrice = dammSnapshot.spotQuotePerBase ?? null;
      activeVenue = currentPrice ? "DAMM v2" : "Unknown";
    } else {
      const spot = await fetchSpotPrice(args.connection, args.pool);
      currentPrice = spot?.priceExact ?? null;
      activeVenue = currentPrice ? "DBC" : "Unknown";
    }
  } catch {
    reasons.push("Current active-venue spot was unavailable; historical data remains usable.");
  }
  const coverage = mergeCoverage(dbc.coverage, damm.coverage, snapshot.isMigrated, boundaryMs);
  const recentTrades = allTrades.filter((trade) => trade.blockTime >= boundaryMs && trade.blockTime <= nowMs);
  const volume24h = coverage.reaches24hBoundary ? recentTrades.reduce((sum, trade) => addDecimalStrings(sum, trade.quoteAmount), "0") : null;
  const reference = sortTrades(allTrades.filter((trade) => trade.blockTime <= boundaryMs)).at(-1) ?? null;
  const change24hPct = currentPrice && reference ? percentChangeString(currentPrice, reference.priceQuotePerToken) : null;
  const chartTrades = filterTradesForWindow(allTrades, args.timeframe, nowMs);
  const observedSpan = chartTrades.length > 1 ? chartTrades.at(-1)!.blockTime - chartTrades[0].blockTime : 0;
  const intervalSeconds = candleIntervalSeconds(args.timeframe, observedSpan);
  const candles = aggregateCandles(chartTrades, intervalSeconds);
  const boundary = resolveMigrationBoundary({ migrated: snapshot.isMigrated, dbcTrades: dbc.trades, dammTrades: damm.trades });
  return {
    ok: true,
    market: {
      pool: snapshot.pool,
      baseMint: snapshot.baseMint,
      quoteMint: snapshot.quoteMint,
      baseDecimals: snapshot.baseDecimals,
      quoteDecimals: snapshot.quoteDecimals,
      activeVenue,
      currentPriceQuotePerToken: currentPrice,
    },
    timeframe: args.timeframe,
    mode: args.mode,
    candleIntervalSeconds: intervalSeconds,
    coverage,
    migrationBoundary: boundary,
    trades: args.mode === "trades" ? chartTrades : chartTrades,
    candles,
    volume24h,
    change24hPct,
    referencePrice24h: reference?.priceQuotePerToken ?? null,
    partial: dbc.partial || damm.partial,
    unavailableReasons: reasons,
  };
}

export async function buildMarketHistory(args: {
  connection: Connection;
  pool: PublicKey;
  timeframe: HistoryTimeframe;
  mode: HistoryMode;
}): Promise<MarketHistory> {
  const key = `${args.pool.toBase58()}:${args.timeframe}:${args.mode}`;
  return historyCache.get(key, () => buildMarketHistoryUncached(args), (value) => value.ok);
}

export function clearMarketHistoryCache(): void {
  historyCache.clear();
}

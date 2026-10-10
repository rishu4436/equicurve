import { PublicKey, type Connection } from "@solana/web3.js";
import { fetchDammPoolSnapshot } from "@/lib/damm/pool";
import { fetchSpotPrice } from "@/lib/dbc/spotPrice";
import {
  expectedDammDestination,
  fetchPoolSnapshot,
  migrationConfigForSnapshot,
} from "@/lib/dbc/migrate";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { formatAtomsExact } from "@/lib/amounts";
import { isUsdcMint, WSOL_MINT } from "@/lib/constants";
import { withReadConnection } from "@/lib/connection";
import type { CurvePhase } from "@/lib/dbc/curveState";

export type ActiveVenue = "dbc" | "damm-v2" | "pending" | "unknown";
export type MetricQuote = "SOL" | "USDC";

export type SolUsdReference = {
  usdPerSol: string;
  observedAt: string;
  source: "coingecko";
};

export type MarketMetrics = {
  market: {
    pool: string;
    mint: string;
    quote: MetricQuote | null;
    lifecycle: CurvePhase;
    activeVenue: "DBC" | "DAMM v2" | "Pending" | "Unknown";
  };
  price: {
    quotePerToken: string | null;
    quoteSymbol: MetricQuote | null;
    solPerToken: string | null;
    usdPerToken: string | null;
    sourceVenue: ActiveVenue;
    observedAt: string | null;
  };
  supply: {
    totalTokens: string | null;
    circulatingTokens: string | null;
    circulatingSource: "unavailable" | null;
  };
  valuation: {
    marketCapSol: string | null;
    marketCapUsd: string | null;
    fdvSol: string | null;
    fdvUsd: string | null;
  };
  liquidity: {
    sol: string | null;
    usd: string | null;
  };
  volume24h: { sol: string | null; usd: string | null };
  change24hPct: string | null;
  holders: {
    supplyAtoms: string | null;
    decimals: number | null;
    largestCount: number;
    partial: boolean;
    source: "RPC token accounts" | "unavailable";
  };
  partial: boolean;
  unavailableReasons: string[];
  provenance: {
    price: string;
    valuation: string;
    marketCap: string;
    liquidity: string;
    holders: string;
    usd: string;
  };
};

type DecimalParts = { coefficient: bigint; scale: number };

function parseDecimal(value: string | number | null | undefined): DecimalParts | null {
  if (value == null) return null;
  const raw = String(value).trim();
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (!match) return null;
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent)) return null;
  const coefficient = sign * BigInt(`${match[2]}${fraction}`) * 1n;
  const scale = fraction.length - exponent;
  if (scale >= 0) return { coefficient, scale };
  return { coefficient: coefficient * 10n ** BigInt(-scale), scale: 0 };
}

function decimalString(parts: DecimalParts): string {
  const negative = parts.coefficient < 0n;
  const digits = (negative ? -parts.coefficient : parts.coefficient).toString();
  if (parts.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const padded = digits.padStart(parts.scale + 1, "0");
  const split = padded.length - parts.scale;
  const integer = padded.slice(0, split) || "0";
  const fraction = padded.slice(split).replace(/0+$/, "");
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

export function multiplyDecimalStrings(a: string | null, b: string | null): string | null {
  const left = parseDecimal(a);
  const right = parseDecimal(b);
  if (!left || !right) return null;
  return decimalString({ coefficient: left.coefficient * right.coefficient, scale: left.scale + right.scale });
}

export function atomsToDecimalString(atoms: string | null, decimals: number | null): string | null {
  if (atoms == null || decimals == null || !/^\d+$/.test(atoms) || !Number.isInteger(decimals) || decimals < 0) return null;
  return formatAtomsExact(atoms, decimals);
}

export function multiplyDecimalByAtoms(value: string | null, atoms: string | null, decimals: number | null): string | null {
  const amount = atomsToDecimalString(atoms, decimals);
  return multiplyDecimalStrings(value, amount);
}

const SOL_USD_TTL_MS = 30_000;
let solUsdCache: { value: SolUsdReference; expiresAt: number } | null = null;

/** Narrow server-side SOL/USD reference. It is intentionally optional to keep SOL usable. */
export async function fetchSolUsdReference(fetchImpl: typeof fetch = fetch): Promise<SolUsdReference | null> {
  if (solUsdCache && solUsdCache.expiresAt > Date.now()) return solUsdCache.value;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  try {
    const response = await fetchImpl("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { solana?: { usd?: unknown } };
    const usd = parseDecimal(typeof body.solana?.usd === "number" || typeof body.solana?.usd === "string" ? body.solana.usd : null);
    if (!usd || usd.coefficient <= 0n) return null;
    const value: SolUsdReference = { usdPerSol: decimalString(usd), observedAt: new Date().toISOString(), source: "coingecko" };
    solUsdCache = { value, expiresAt: Date.now() + SOL_USD_TTL_MS };
    return value;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function resetSolUsdReferenceCache(): void {
  solUsdCache = null;
}

export function activeVenueLabel(venue: ActiveVenue): MarketMetrics["market"]["activeVenue"] {
  if (venue === "dbc") return "DBC";
  if (venue === "damm-v2") return "DAMM v2";
  if (venue === "pending") return "Pending";
  return "Unknown";
}

export function isDammVenueVerified(snapshot: PoolSnapshot, destinationExists: boolean): boolean {
  return snapshot.curve.phase === "migrated" && destinationExists && migrationConfigForSnapshot(snapshot).ok;
}

export function resolveActiveVenue(
  snapshot: Pick<PoolSnapshot, "curve" | "migrationOption" | "migrationFeeOption" | "quoteMint">,
  destination: "exists" | "missing" | "rpc_unavailable" | "unchecked",
): ActiveVenue {
  if (snapshot.curve.phase === "unknown") return "unknown";
  if (snapshot.curve.phase !== "migrated") return "dbc";
  if (destination === "rpc_unavailable") return "unknown";
  if (destination === "exists" && migrationConfigForSnapshot(snapshot as PoolSnapshot).ok) return "damm-v2";
  return "pending";
}

function quoteForMint(mint: string | null): MetricQuote | null {
  if (!mint) return null;
  if (mint === WSOL_MINT.toBase58()) return "SOL";
  return isUsdcMint(mint) ? "USDC" : null;
}

function emptyMetrics(snapshot: PoolSnapshot): MarketMetrics {
  const quote = quoteForMint(snapshot.quoteMint);
  return {
    market: { pool: snapshot.pool, mint: snapshot.baseMint, quote, lifecycle: snapshot.curve.phase, activeVenue: "Unknown" },
    price: { quotePerToken: null, quoteSymbol: quote, solPerToken: null, usdPerToken: null, sourceVenue: "unknown", observedAt: null },
    supply: { totalTokens: null, circulatingTokens: null, circulatingSource: "unavailable" },
    valuation: { marketCapSol: null, marketCapUsd: null, fdvSol: null, fdvUsd: null },
    liquidity: { sol: null, usd: null },
    volume24h: { sol: null, usd: null },
    change24hPct: null,
    holders: { supplyAtoms: null, decimals: null, largestCount: 0, partial: true, source: "unavailable" },
    partial: true,
    unavailableReasons: [],
    provenance: {
      price: "Unavailable until the active venue is verified.",
      valuation: "FDV uses active venue price × verified mint total supply.",
      marketCap: "Circulating supply methodology is not currently defensible.",
      liquidity: "Unavailable until active venue reserves are verified.",
      holders: "RPC token accounts",
      usd: "SOL/USD reference unavailable.",
    },
  };
}

function addReason(metrics: MarketMetrics, reason: string): void {
  if (!metrics.unavailableReasons.includes(reason)) metrics.unavailableReasons.push(reason);
  metrics.partial = true;
}

function applyValuation(metrics: MarketMetrics, totalTokens: string | null, solUsd: SolUsdReference | null): void {
  metrics.supply.totalTokens = totalTokens;
  if (!totalTokens || !metrics.price.quotePerToken) {
    addReason(metrics, "FDV requires a verified total supply and active venue price.");
    return;
  }
  const fdvQuote = multiplyDecimalStrings(metrics.price.quotePerToken, totalTokens);
  if (!fdvQuote) {
    addReason(metrics, "FDV could not be represented as a decimal-safe value.");
    return;
  }
  if (metrics.price.quoteSymbol === "SOL") {
    metrics.valuation.fdvSol = fdvQuote;
    metrics.valuation.fdvUsd = solUsd ? multiplyDecimalStrings(fdvQuote, solUsd.usdPerSol) : null;
    if (!solUsd) addReason(metrics, "SOL/USD reference unavailable; USD valuation is unavailable.");
  } else if (metrics.price.quoteSymbol === "USDC") {
    metrics.valuation.fdvUsd = fdvQuote;
    metrics.provenance.usd = "USDC quote is treated as USD-equivalent under EquiCurve quote semantics.";
  }
}

async function readSupplyAndHolders(connection: Connection, mint: PublicKey): Promise<{
  supplyAtoms: string;
  decimals: number;
  largestCount: number;
  partial: boolean;
}> {
  const supply = await withReadConnection(connection, (read) => read.getTokenSupply(mint), { server: true });
  let largestCount = 0;
  let partial = false;
  try {
    const largest = await withReadConnection(connection, (read) => read.getTokenLargestAccounts(mint), { server: true });
    largestCount = largest.value.length;
  } catch {
    partial = true;
  }
  return { supplyAtoms: supply.value.amount, decimals: supply.value.decimals, largestCount, partial };
}

export async function buildMarketMetrics(connection: Connection, pool: PublicKey): Promise<MarketMetrics> {
  const snapshot = await withReadConnection(connection, (read) => fetchPoolSnapshot(read, pool), { server: true });
  const metrics = emptyMetrics(snapshot);
  const quote = quoteForMint(snapshot.quoteMint);
  if (!quote) addReason(metrics, "Quote mint is not a verified EquiCurve SOL or USDC quote.");

  let supply: Awaited<ReturnType<typeof readSupplyAndHolders>> | null = null;
  try {
    supply = await readSupplyAndHolders(connection, new PublicKey(snapshot.baseMint));
    metrics.supply.totalTokens = atomsToDecimalString(supply.supplyAtoms, supply.decimals);
    metrics.holders = {
      supplyAtoms: supply.supplyAtoms,
      decimals: supply.decimals,
      largestCount: supply.largestCount,
      partial: supply.partial,
      source: "RPC token accounts",
    };
    if (supply.partial) addReason(metrics, "Largest holder accounts are temporarily unavailable.");
  } catch {
    addReason(metrics, "Token supply is temporarily unavailable.");
  }

  let dammSnapshot: Awaited<ReturnType<typeof fetchDammPoolSnapshot>> | null = null;
  let venue: ActiveVenue = resolveActiveVenue(snapshot, snapshot.curve.phase === "migrated" ? "unchecked" : "exists");
  if (snapshot.curve.phase === "migrated") {
    const destination = expectedDammDestination(snapshot);
    if (!destination) {
      venue = "unknown";
      addReason(metrics, "DAMM v2 migration destination could not be verified from pool configuration.");
    } else {
      try {
        dammSnapshot = await withReadConnection(
          connection,
          (read) => fetchDammPoolSnapshot({
            connection: read,
            pool: destination.dammPool,
            baseMint: snapshot.baseMint,
            quoteMint: snapshot.quoteMint!,
            source: "derived",
          }),
          { server: true },
        );
        venue = dammSnapshot.exists && dammSnapshot.spotQuotePerBase ? resolveActiveVenue(snapshot, "exists") : "pending";
        if (venue !== "damm-v2") addReason(metrics, "DAMM v2 destination exists check did not produce a verified spot price.");
      } catch {
        venue = "unknown";
        addReason(metrics, "DAMM v2 pool read is temporarily unavailable.");
      }
    }
  }

  metrics.market.activeVenue = activeVenueLabel(venue);
  metrics.price.sourceVenue = venue;
  const observedAt = new Date().toISOString();
  if (venue === "dbc") {
    try {
      const spot = await withReadConnection(connection, (read) => fetchSpotPrice(read, pool), { server: true });
      if (spot && quote) {
        metrics.price.quotePerToken = spot.priceExact;
        metrics.price.quoteSymbol = quote;
        metrics.price.solPerToken = quote === "SOL" ? spot.priceExact : null;
        metrics.price.observedAt = observedAt;
        metrics.provenance.price = "DBC virtual pool √price, verified pool and mint decimals.";
      } else addReason(metrics, "DBC current spot is unavailable.");
    } catch {
      addReason(metrics, "DBC current spot is temporarily unavailable.");
    }
  } else if (venue === "damm-v2" && dammSnapshot?.spotQuotePerBase && quote) {
    metrics.price.quotePerToken = dammSnapshot.spotQuotePerBase;
    metrics.price.quoteSymbol = quote;
    metrics.price.solPerToken = quote === "SOL" ? dammSnapshot.spotQuotePerBase : null;
    metrics.price.observedAt = observedAt;
    metrics.provenance.price = "Verified DAMM v2 pool √price, mint orientation, and mint decimals.";
  } else {
    addReason(metrics, "Current active venue price is unavailable.");
  }

  let solUsd: SolUsdReference | null = null;
  if (metrics.price.quoteSymbol === "SOL") solUsd = await fetchSolUsdReference();
  if (metrics.price.quoteSymbol === "SOL" && metrics.price.quotePerToken && solUsd) {
    metrics.price.usdPerToken = multiplyDecimalStrings(metrics.price.quotePerToken, solUsd.usdPerSol);
    metrics.provenance.usd = `SOL/USD reference at ${solUsd.observedAt} (${solUsd.source}).`;
  } else if (metrics.price.quoteSymbol === "USDC" && metrics.price.quotePerToken) {
    metrics.price.usdPerToken = metrics.price.quotePerToken;
    metrics.provenance.usd = "USDC quote is treated as USD-equivalent under EquiCurve quote semantics.";
  } else if (metrics.price.quotePerToken) {
    addReason(metrics, "USD conversion is unavailable; SOL remains the canonical quote where supported.");
  }

  applyValuation(metrics, metrics.supply.totalTokens, solUsd);
  if (venue === "damm-v2" && dammSnapshot) {
    const quoteReserve = dammSnapshot.tokenAMint === snapshot.quoteMint ? dammSnapshot.tokenAReserve : dammSnapshot.tokenBReserve;
    const quoteDecimals = dammSnapshot.tokenAMint === snapshot.quoteMint ? dammSnapshot.tokenADecimals : dammSnapshot.tokenBDecimals;
    const quoteAmount = atomsToDecimalString(quoteReserve ?? null, quoteDecimals);
    if (quote === "SOL") {
      metrics.liquidity.sol = quoteAmount;
      metrics.liquidity.usd = solUsd && quoteAmount ? multiplyDecimalStrings(quoteAmount, solUsd.usdPerSol) : null;
    } else if (quote === "USDC") {
      metrics.liquidity.usd = quoteAmount;
    }
    metrics.provenance.liquidity = "Verified DAMM v2 quote-vault reserve; base-side depth is not represented in Phase 1.";
  } else {
    addReason(metrics, "Liquidity is unavailable until active venue reserve normalization is defined.");
  }
  metrics.provenance.marketCap = "Market Cap requires a defensible circulating-supply methodology; EquiCurve reports it as unavailable in Phase 1.";
  metrics.provenance.valuation = metrics.price.quoteSymbol === "USDC"
    ? "FDV = verified DAMM/DBC price × mint total supply; USDC is treated as USD-equivalent."
    : "FDV = verified active-venue price × mint total supply.";
  return metrics;
}

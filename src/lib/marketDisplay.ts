import type { CurvePhase, DestinationCheck } from "@/lib/dbc/curveState";

export function formatProgressRatio(progress: number | null, fractionDigits = 2): string {
  if (progress == null || !Number.isFinite(progress)) return "unknown";
  return `${(Math.min(1, Math.max(0, progress)) * 100).toFixed(fractionDigits)}%`;
}

function fixedSignificant(value: number, digits = 6): string {
  if (!(value > 0) || !Number.isFinite(value)) return "—";
  const places = Math.min(18, Math.max(0, digits - Math.floor(Math.log10(value)) - 1));
  return value.toFixed(places).replace(/\.?0+$/, "");
}

export function formatTokenPrice(price: number, quote: string, ticker = "token") {
  if (!(price > 0) || !Number.isFinite(price)) return { primary: "Unavailable", secondary: "Price unavailable" };
  if (quote === "SOL" && price < 0.000001) {
    const lamports = price * 1_000_000_000;
    return {
      primary: `${lamports.toFixed(lamports < 1 ? 4 : 2)} lamports / ${ticker}`,
      secondary: `${fixedSignificant(price, 8)} SOL / ${ticker}`,
    };
  }
  const precise = fixedSignificant(price, 8);
  return { primary: `${precise} ${quote} / ${ticker}`, secondary: `${precise} ${quote}` };
}

/** Exact-string counterpart used by the server metrics contract. */
export function formatTokenPriceExact(price: string | null, quote: string, ticker = "token") {
  if (!price) return { primary: "Unavailable", secondary: "Price unavailable" };
  const numeric = Number(price);
  if (!(numeric > 0) || !Number.isFinite(numeric)) return { primary: "Unavailable", secondary: "Price unavailable" };
  if (quote === "SOL" && numeric < 0.000001) {
    return {
      primary: `${fixedSignificant(numeric * 1_000_000_000, 8)} lamports / ${ticker}`,
      secondary: `${fixedSignificant(numeric, 8)} SOL / ${ticker}`,
    };
  }
  const precise = fixedSignificant(numeric, 8);
  return { primary: `${precise} ${quote} / ${ticker}`, secondary: `${precise} ${quote}` };
}

export function formatPriceAxis(price: number, quote: string): string {
  if (!(price >= 0) || !Number.isFinite(price)) return "—";
  if (quote === "SOL" && price < 0.000001) return `${fixedSignificant(price * 1_000_000_000, 6)} lamports`;
  return fixedSignificant(price, 4);
}

export function formatMetricValue(value: string | null, unit: "SOL" | "USD"): string {
  if (value == null) return "—";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  if (numeric === 0) return unit === "USD" ? "$0" : "0 SOL";
  if (unit === "USD") {
    if (Math.abs(numeric) >= 1_000) {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(numeric);
    }
    return `$${fixedSignificant(numeric, 8)}`;
  }
  return `${fixedSignificant(numeric, 8)} SOL`;
}

/** Locale/time-zone independent output keeps server and browser hydration identical. */
export function formatMarketTimestamp(value: string | number | Date, includeDate = true): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "unknown";
  const text = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(includeDate ? { year: "numeric", month: "short", day: "2-digit" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${text} UTC`;
}

export function formatPermanentLock(lockPct: number | null | undefined): string {
  if (lockPct == null || !Number.isFinite(lockPct)) return "Configured lock unavailable";
  return lockPct === 100
    ? "100% permanently locked"
    : `${lockPct}% configured permanent lock`;
}

export function formatQuoteReserveLabel(quoteLabel: string): string {
  return `Quote reserve (${quoteLabel})`;
}

export type MarketLifecycle = { label: string; activeVenue: "DBC" | "DAMM v2" | "Pending" | "Unknown"; tradeEnabled: boolean };

export function marketLifecycle(phase: CurvePhase, destination: DestinationCheck): MarketLifecycle {
  if (phase === "migrated") return {
    label: destination === "exists" ? "Migrated · DAMM v2" : destination === "rpc_unavailable" ? "Migrated · venue unknown" : "Migrated · verifying DAMM v2",
    activeVenue: destination === "exists" ? "DAMM v2" : destination === "rpc_unavailable" ? "Unknown" : "Pending",
    tradeEnabled: destination === "exists",
  };
  if (phase === "complete") return { label: "Curve complete · eligible to migrate", activeVenue: "Pending", tradeEnabled: false };
  if (phase === "raising") return { label: "Raising on DBC", activeVenue: "DBC", tradeEnabled: true };
  return { label: "Lifecycle unknown", activeVenue: "Unknown", tradeEnabled: false };
}

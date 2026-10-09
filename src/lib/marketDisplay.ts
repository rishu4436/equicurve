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

export function formatPriceAxis(price: number, quote: string): string {
  if (!(price >= 0) || !Number.isFinite(price)) return "—";
  if (quote === "SOL" && price < 0.000001) return `${(price * 1_000_000_000).toFixed(1)}ℓ`;
  return fixedSignificant(price, 4);
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

export type MarketLifecycle = { label: string; activeVenue: "DBC" | "DAMM v2" | "Pending"; tradeEnabled: boolean };

export function marketLifecycle(phase: CurvePhase, destination: DestinationCheck): MarketLifecycle {
  if (phase === "migrated") return {
    label: destination === "exists" ? "Migrated · DAMM v2" : "Migrated · verifying DAMM v2",
    activeVenue: destination === "exists" ? "DAMM v2" : "Pending",
    tradeEnabled: destination === "exists",
  };
  if (phase === "complete") return { label: "Curve complete · eligible to migrate", activeVenue: "Pending", tradeEnabled: false };
  if (phase === "raising") return { label: "Raising on DBC", activeVenue: "DBC", tradeEnabled: true };
  return { label: "Lifecycle unknown", activeVenue: "Pending", tradeEnabled: false };
}

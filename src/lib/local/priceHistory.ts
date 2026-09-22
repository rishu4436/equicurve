/**
 * Browser-local price points keyed by pool. Accumulates reconstructed
 * swap-implied prices across sessions — never invents timestamps.
 */

export const PRICE_HISTORY_PREFIX = "equicurve.priceHistory.v1.";

export type PricePointSource = "swap" | "spot" | "local";

export type PricePoint = {
  /** Unix ms (from blockTime / event timestamp / wall clock for spot). */
  t: number;
  /** Quote per 1 base (UI units), e.g. SOL per token. */
  price: number;
  /** Tx signature when sourced from a confirmed swap. */
  sig?: string;
  source: PricePointSource;
};

const MAX_POINTS = 250;

function storageKey(pool: string): string {
  return `${PRICE_HISTORY_PREFIX}${pool}`;
}

function safeParse(raw: string | null): PricePoint[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as PricePoint[];
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (p) =>
        p &&
        typeof p.t === "number" &&
        typeof p.price === "number" &&
        Number.isFinite(p.price) &&
        p.price > 0 &&
        (p.source === "swap" || p.source === "spot" || p.source === "local"),
    );
  } catch {
    return [];
  }
}

export function loadPriceHistory(pool: string): PricePoint[] {
  if (typeof window === "undefined") return [];
  return safeParse(localStorage.getItem(storageKey(pool)));
}

function persist(pool: string, points: PricePoint[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(pool), JSON.stringify(points.slice(-MAX_POINTS)));
}

/** Merge by signature (preferred) or by t+price for spot/local. Keeps chronological order. */
export function mergePricePoints(
  pool: string,
  incoming: PricePoint[],
): PricePoint[] {
  const prev = loadPriceHistory(pool);
  const bySig = new Map<string, PricePoint>();
  const noSig: PricePoint[] = [];

  for (const p of [...prev, ...incoming]) {
    if (p.sig) {
      const existing = bySig.get(p.sig);
      // Prefer swap over spot/local for the same sig
      if (!existing || (p.source === "swap" && existing.source !== "swap")) {
        bySig.set(p.sig, p);
      }
    } else if (p.source === "spot") {
      // Keep a single latest spot marker (replace older spot without sig)
      const idx = noSig.findIndex((x) => x.source === "spot" && !x.sig);
      if (idx >= 0) noSig[idx] = p;
      else noSig.push(p);
    } else {
      noSig.push(p);
    }
  }

  const merged = [...bySig.values(), ...noSig]
    .filter((p) => p.price > 0 && Number.isFinite(p.price))
    .sort((a, b) => a.t - b.t);

  // Dedupe near-identical consecutive points
  const deduped: PricePoint[] = [];
  for (const p of merged) {
    const last = deduped[deduped.length - 1];
    if (
      last &&
      last.sig &&
      p.sig &&
      last.sig === p.sig
    ) {
      continue;
    }
    if (
      last &&
      !p.sig &&
      !last.sig &&
      last.source === p.source &&
      Math.abs(last.t - p.t) < 2_000 &&
      Math.abs(last.price - p.price) / last.price < 1e-9
    ) {
      deduped[deduped.length - 1] = p;
      continue;
    }
    deduped.push(p);
  }

  const capped = deduped.slice(-MAX_POINTS);
  persist(pool, capped);
  return capped;
}

export function clearPriceHistory(pool?: string): void {
  if (typeof window === "undefined") return;
  if (pool) {
    localStorage.removeItem(storageKey(pool));
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PRICE_HISTORY_PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}

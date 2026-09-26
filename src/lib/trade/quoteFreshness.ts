/**
 * Pre-sign quote freshness (pure, unit-tested). A quote shown to the user is
 * only sent as-is when it is younger than QUOTE_MAX_AGE_MS AND the pool state
 * it was computed from is unchanged; otherwise the UI re-quotes and asks the
 * user to confirm the new amounts before anything is signed.
 */
export const QUOTE_MAX_AGE_MS = 15_000;

export type QuoteStamp = {
  /** ms since epoch when the quote was computed. */
  quotedAt: number;
  /** Deterministic key of the pool state the quote used (e.g. sqrtPrice:reserves). */
  poolStateKey: string;
};

export type Freshness =
  | { fresh: true }
  | { fresh: false; reason: "expired" | "pool_changed" | "unknown_state" };

export function quoteFreshness(
  q: QuoteStamp,
  currentPoolStateKey: string | null,
  nowMs: number,
  maxAgeMs = QUOTE_MAX_AGE_MS,
): Freshness {
  if (nowMs - q.quotedAt > maxAgeMs) return { fresh: false, reason: "expired" };
  if (currentPoolStateKey == null) return { fresh: false, reason: "unknown_state" };
  if (currentPoolStateKey !== q.poolStateKey) return { fresh: false, reason: "pool_changed" };
  return { fresh: true };
}

export function freshnessMessage(f: Freshness): string | null {
  if (f.fresh) return null;
  switch (f.reason) {
    case "expired":
      return "Quote was older than 15s. It was refreshed; review the new amounts and confirm again.";
    case "pool_changed":
      return "Pool state changed since your quote (someone traded). It was refreshed; review the new amounts and confirm again.";
    default:
      return "Could not re-read pool state. The quote was refreshed; review and confirm again.";
  }
}

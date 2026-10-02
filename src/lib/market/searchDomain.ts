/**
 * Market-cap search converts the target raise into a JavaScript number, then
 * binary-searches quote-unit market caps. The AMM math after a config is built
 * stays bigint.
 *
 * A JavaScript number is exact for every integer up to Number.MAX_SAFE_INTEGER.
 * searchCaps may probe a migration cap as large as target × 40 × 4^6.
 * A raise is accepted only when that whole window still fits in the safe integer.
 * SOL raises hit the u64 atom limit before they reach this window.
 *
 * The builder also rejects some caps inside that integer, around 1e12 quote
 * units at the default supply. Search treats a rejected cap as above the usable
 * window and looks lower. It does not keep the 5% floor and call it a match.
 */
export const SEARCH_MAX_MARKET_CAP = Number.MAX_SAFE_INTEGER;

/** Initial high bound in searchCaps, as a multiple of the target raise. */
export const SEARCH_CAP_HIGH_FACTOR = 40;

/** searchCaps may multiply the high bound by 4, at most this many times. */
export const SEARCH_CAP_EXPAND = 4;
export const SEARCH_CAP_EXPAND_STEPS = 6;

export const SEARCH_CAP_SPAN = SEARCH_CAP_HIGH_FACTOR * SEARCH_CAP_EXPAND ** SEARCH_CAP_EXPAND_STEPS;

const MAX_SAFE_INTEGER_ATOMS = BigInt(Number.MAX_SAFE_INTEGER);
const SEARCH_CAP_SPAN_ATOMS = BigInt(SEARCH_CAP_SPAN);

/** Largest target raise, in whole quote tokens, whose expanded probe window stays exact. */
export const SEARCH_MAX_RAISE_UI = Number(MAX_SAFE_INTEGER_ATOMS / SEARCH_CAP_SPAN_ATOMS);

/** Null when this quote-unit raise can be searched. */
export function searchableRaiseError(targetUi: number): string | null {
  if (!Number.isFinite(targetUi) || !(targetUi > 0)) {
    return "Market-cap search needs a positive finite raise.";
  }
  if (targetUi > SEARCH_MAX_RAISE_UI) {
    return `Market-cap search accepts a raise up to ${SEARCH_MAX_RAISE_UI} quote tokens. Above that, the search window would pass a market cap through a JavaScript number that cannot hold every integer.`;
  }
  return null;
}

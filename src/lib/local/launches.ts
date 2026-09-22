/**
 * Browser-local launch / activity persistence so Explore, Portfolio, and
 * Offering detail work without an indexer. Never implies fake txs.
 */

import type { Sector } from "@/lib/demo/offerings";
import type { PresetId } from "@/lib/dbc/types";
import { clearPriceHistory } from "@/lib/local/priceHistory";

export const LAUNCHES_KEY = "equicurve.launches.v1";
export const ACTIVITY_KEY = "equicurve.activity.v1";

export type StoredLaunch = {
  id: string; // pool address preferred
  pool: string;
  mint: string;
  config: string;
  name: string;
  ticker: string;
  thesis: string;
  sector: Sector;
  quote: "SOL" | "USDC";
  raiseTarget: number;
  presetId: PresetId;
  /** Legacy display field; prefer feeIssuerPct. */
  feeBps: number;
  feeIssuerPct?: number;
  lockPct: number;
  mintRenounce?: boolean;
  attestations?: {
    memo: boolean;
    risk: boolean;
    issuer: boolean;
    legal: boolean;
    financials: boolean;
  };
  sig: string;
  creator: string;
  /** Partner / platform fee claimer (config feeClaimer). Defaults to creator when unset. */
  feeClaimer?: string;
  createdAt: string; // ISO
  cluster: string;
  status: "raising" | "graduated" | "new";
  dammPool?: string;
  migrateSig?: string;
};

export type StoredActivity = {
  id: string;
  pool: string;
  mint?: string;
  kind: "buy" | "sell" | "launch" | "migrate" | "claim";
  amount?: string;
  sig: string;
  wallet?: string;
  at: string; // ISO
};

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function listLaunches(): StoredLaunch[] {
  if (typeof window === "undefined") return [];
  return safeParse<StoredLaunch[]>(localStorage.getItem(LAUNCHES_KEY), []);
}

export function getLaunch(idOrPool: string): StoredLaunch | undefined {
  return listLaunches().find(
    (l) =>
      l.id === idOrPool ||
      l.pool === idOrPool ||
      l.mint === idOrPool ||
      l.ticker.toLowerCase() === idOrPool.toLowerCase(),
  );
}

export function upsertLaunch(launch: StoredLaunch): void {
  if (typeof window === "undefined") return;
  const prev = listLaunches().filter(
    (l) => l.pool !== launch.pool && l.id !== launch.id,
  );
  localStorage.setItem(LAUNCHES_KEY, JSON.stringify([launch, ...prev]));
}

export function updateLaunch(
  pool: string,
  patch: Partial<StoredLaunch>,
): void {
  if (typeof window === "undefined") return;
  const next = listLaunches().map((l) =>
    l.pool === pool ? { ...l, ...patch } : l,
  );
  localStorage.setItem(LAUNCHES_KEY, JSON.stringify(next));
}

export function listActivity(pool?: string): StoredActivity[] {
  if (typeof window === "undefined") return [];
  const all = safeParse<StoredActivity[]>(
    localStorage.getItem(ACTIVITY_KEY),
    [],
  );
  if (!pool) return all;
  return all.filter((a) => a.pool === pool);
}

export function pushActivity(entry: StoredActivity): void {
  if (typeof window === "undefined") return;
  const prev = listActivity();
  localStorage.setItem(
    ACTIVITY_KEY,
    JSON.stringify([entry, ...prev].slice(0, 200)),
  );
}

export function launchesForWallet(wallet: string): StoredLaunch[] {
  return listLaunches().filter(
    (l) => l.creator.toLowerCase() === wallet.toLowerCase(),
  );
}

export function launchesForFeeClaimer(wallet: string): StoredLaunch[] {
  const w = wallet.toLowerCase();
  return listLaunches().filter((l) => {
    const claimer = (l.feeClaimer ?? l.creator).toLowerCase();
    return claimer === w;
  });
}

/** Launches where wallet is creator and/or partner feeClaimer. */
export function launchesForCreatorOrPartner(wallet: string): StoredLaunch[] {
  const w = wallet.toLowerCase();
  const seen = new Set<string>();
  const out: StoredLaunch[] = [];
  for (const l of listLaunches()) {
    const claimer = (l.feeClaimer ?? l.creator).toLowerCase();
    if (l.creator.toLowerCase() === w || claimer === w) {
      if (!seen.has(l.pool)) {
        seen.add(l.pool);
        out.push(l);
      }
    }
  }
  return out;
}

export function clearLaunches(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(LAUNCHES_KEY);
}

export function clearActivity(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ACTIVITY_KEY);
}

export function clearLocalLaunchData(): void {
  clearLaunches();
  clearActivity();
  clearPriceHistory();
}


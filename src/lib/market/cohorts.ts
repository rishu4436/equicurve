import type { BookState, CurveBook } from "./book";
import { applyBuy, applySell, initialState } from "./book";

/**
 * Cohort stress. Each path has its own buyers. A sell can only spend the base
 * that cohort received, so an early buyer and a late buyer are not one pile of tokens.
 */

export type CohortId = "retail" | "whale" | "late" | "momentum";

type CohortOrder =
  | { cohort: CohortId; side: "buy"; quoteAtoms: bigint; atSec: number }
  | { cohort: CohortId; side: "sell"; fractionBps: number; atSec: number };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scaleAtoms(typical: bigint, scaleHundredths: number): bigint {
  const n = BigInt(Math.max(1, Math.round(scaleHundredths)));
  return (typical * n) / 100n;
}

export function buildCohortPath(args: {
  typicalAtoms: bigint;
  feeDurationSec: number;
  seed: number;
  /** Whale order size in hundredths of a typical order. Default matches a private-company profile. */
  whaleHundredths?: number;
}): CohortOrder[] {
  const whaleBase = args.whaleHundredths ?? 600;
  const rand = mulberry32(args.seed);
  const duration = Math.max(1, args.feeDurationSec);
  const orders: CohortOrder[] = [];
  const retailN = 6 + Math.floor(rand() * 6);
  for (let i = 0; i < retailN; i++) {
    orders.push({
      cohort: "retail",
      side: "buy",
      quoteAtoms: scaleAtoms(args.typicalAtoms, 40 + Math.floor(rand() * 120)),
      atSec: Math.floor((duration * i) / retailN),
    });
  }
  const whales = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < whales; i++) {
    orders.push({
      cohort: "whale",
      side: "buy",
      quoteAtoms: scaleAtoms(args.typicalAtoms, whaleBase + Math.floor(rand() * whaleBase)),
      atSec: Math.floor(rand() * Math.max(1, duration / 5)),
    });
  }
  const lateN = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < lateN; i++) {
    orders.push({
      cohort: "late",
      side: "buy",
      quoteAtoms: scaleAtoms(args.typicalAtoms, 80 + Math.floor(rand() * 200)),
      atSec: Math.floor(duration * 0.75) + i,
    });
  }
  for (let i = 0; i < 4; i++) {
    orders.push({
      cohort: "momentum",
      side: "buy",
      quoteAtoms: scaleAtoms(args.typicalAtoms, 50 * (i + 1)),
      atSec: Math.floor(duration * 0.3) + i * 15,
    });
  }
  orders.sort((a, b) => a.atSec - b.atSec);
  const sellers: CohortId[] = ["retail", "whale", "late", "momentum"];
  for (const cohort of sellers) {
    if (rand() < 0.85) {
      orders.push({
        cohort,
        side: "sell",
        fractionBps: 1_500 + Math.floor(rand() * 5_500),
        atSec: duration,
      });
    }
  }
  return orders;
}

export function replayCohorts(book: CurveBook, orders: CohortOrder[]): BookState {
  let state = initialState(book);
  const held: Record<CohortId, bigint> = { retail: 0n, whale: 0n, late: 0n, momentum: 0n };
  for (const order of orders) {
    if (order.side === "buy") {
      const before = state.heldBase;
      const step = applyBuy(book, state, order.quoteAtoms, order.atSec);
      state = step.state;
      held[order.cohort] += state.heldBase - before;
    } else {
      const mine = held[order.cohort];
      const sell = (mine * BigInt(order.fractionBps)) / 10_000n;
      if (sell <= 0n) continue;
      const before = state.heldBase;
      const step = applySell(book, state, sell, order.atSec);
      state = step.state;
      const sold = before > state.heldBase ? before - state.heldBase : 0n;
      held[order.cohort] = mine > sold ? mine - sold : 0n;
    }
  }
  return state;
}

export type CohortStress = {
  paths: number;
  seed: number;
  graduationRate: number;
  medianProgress: number;
  /** Stable fingerprint of this seed's path results. */
  signature: string;
};

export function runCohortStress(args: {
  book: CurveBook;
  typicalAtoms: bigint;
  feeDurationSec: number;
  paths: number;
  seed: number;
  whaleHundredths?: number;
}): CohortStress {
  const paths = Math.max(1, Math.min(5_000, Math.floor(args.paths)));
  const progresses: number[] = [];
  let graduated = 0;
  for (let i = 0; i < paths; i++) {
    const orders = buildCohortPath({
      typicalAtoms: args.typicalAtoms,
      feeDurationSec: args.feeDurationSec,
      seed: (args.seed + i * 997) >>> 0,
      whaleHundredths: args.whaleHundredths,
    });
    const state = replayCohorts(args.book, orders);
    const prog =
      args.book.threshold <= 0n
        ? 0
        : state.quoteReserve >= args.book.threshold
          ? 1
          : Number((state.quoteReserve * 10_000n) / args.book.threshold) / 10_000;
    progresses.push(prog);
    if (state.quoteReserve >= args.book.threshold) graduated += 1;
  }
  const sorted = [...progresses].sort((a, b) => a - b);
  return {
    paths,
    seed: args.seed,
    graduationRate: graduated / paths,
    medianProgress: sorted[Math.floor(sorted.length / 2)] ?? 0,
    signature: progresses.map((n) => n.toFixed(4)).join(","),
  };
}

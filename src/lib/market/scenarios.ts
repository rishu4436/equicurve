import type { BookState, CurveBook, Fill } from "./book";
import { applyBuy, applySell, initialState, moveBps } from "./book";
import { scenarioAssumptions } from "./constraints";
import type { AssetKind, ReferenceImpact, ScenarioId, ScenarioReport, ScenarioTracePoint } from "./types";

export type SimOrder =
  | { side: "buy"; quoteAtoms: bigint; atSec: number }
  | { side: "sell"; baseAtoms: bigint; atSec: number }
  | { side: "sellFraction"; fractionBps: number; atSec: number };

const SAMPLE_CAP = 64;

function progressOf(reserve: bigint, threshold: bigint): number {
  if (threshold <= 0n) return 0;
  if (reserve >= threshold) return 1;
  return Number((reserve * 10_000n) / threshold) / 10_000;
}

export function replay(book: CurveBook, orders: SimOrder[]): {
  state: BookState;
  fills: Fill[];
  peakSqrt: bigint;
  trace: ScenarioTracePoint[];
} {
  let state = initialState(book);
  let peakSqrt = state.sqrtPrice;
  const fills: Fill[] = [];
  const trace: ScenarioTracePoint[] = [];
  for (const order of orders) {
    const step =
      order.side === "buy"
        ? applyBuy(book, state, order.quoteAtoms, order.atSec)
        : order.side === "sell"
          ? applySell(book, state, order.baseAtoms, order.atSec)
          : applySell(book, state, (state.heldBase * BigInt(order.fractionBps)) / 10_000n, order.atSec);
    state = step.state;
    if (state.sqrtPrice > peakSqrt) peakSqrt = state.sqrtPrice;
    fills.push(step.fill);
    trace.push({
      step: trace.length + 1,
      priceMoveBps: moveBps(book.sqrtStart, state.sqrtPrice),
      progress: progressOf(state.quoteReserve, book.threshold),
    });
  }
  return { state, fills, peakSqrt, trace };
}

export function summarize(
  book: CurveBook,
  id: ScenarioId,
  label: string,
  note: string,
  participantsAsked: number | null,
  orders: SimOrder[],
): ScenarioReport {
  const { state, fills, peakSqrt, trace } = replay(book, orders);
  let paid = 0n;
  let fees = 0n;
  let largestIn = 0n;
  let largestImpact = 0;
  let skipped = 0;
  for (const f of fills) {
    if (f.skipped) skipped += 1;
    fees += f.feeAtoms;
    if (f.side === "buy" && !f.skipped) {
      paid += f.filledInputAtoms;
      if (f.reserveAddedAtoms > largestIn) largestIn = f.reserveAddedAtoms;
      if (f.impactBps > largestImpact) largestImpact = f.impactBps;
    }
  }
  const filled = state.quoteReserve;
  return {
    id,
    label,
    participantsAsked,
    ordersRun: fills.length - skipped,
    ordersSkipped: skipped,
    quoteFilledAtoms: filled.toString(10),
    quotePaidAtoms: paid.toString(10),
    feesAtoms: fees.toString(10),
    progress: progressOf(filled, book.threshold),
    graduated: filled >= book.threshold,
    largestBuyImpactBps: largestImpact,
    endMoveBps: moveBps(book.sqrtStart, state.sqrtPrice),
    drawdownBps: Math.min(0, moveBps(peakSqrt, state.sqrtPrice)),
    concentration: filled > 0n ? Number((largestIn * 10_000n) / filled) / 10_000 : 0,
    note,
    trace,
  };
}

export function referenceBuy(book: CurveBook, typicalAtoms: bigint): ReferenceImpact {
  const { fill } = applyBuy(book, initialState(book), typicalAtoms, 0);
  return {
    tradeAtoms: typicalAtoms.toString(10),
    impactBps: fill.impactBps,
    graduated: fill.completed,
  };
}

function spreadBuys(count: number, size: bigint, durationSec: number, startSec: number): SimOrder[] {
  const n = Math.max(1, count);
  const span = Math.max(0, durationSec);
  const orders: SimOrder[] = [];
  for (let i = 0; i < n; i++) {
    const at = n === 1 ? startSec : startSec + Math.round((span * i) / (n - 1));
    orders.push({ side: "buy", quoteAtoms: size, atSec: at });
  }
  return orders;
}

export function namedScenarios(args: {
  book: CurveBook;
  typicalAtoms: bigint;
  participants: number;
  feeDurationSec: number;
  asset?: AssetKind;
  /** When set, the five whale buys use this size instead of typical × the asset multiple. */
  whaleSizeAtoms?: bigint;
}): ScenarioReport[] {
  const { book, typicalAtoms, participants, feeDurationSec } = args;
  const assumptions = scenarioAssumptions(args.asset ?? "private-company");
  const sample = Math.min(SAMPLE_CAP, Math.max(1, participants));
  const whaleSize = args.whaleSizeAtoms ?? typicalAtoms * BigInt(assumptions.whaleMultiple);
  const duration = Math.max(0, feeDurationSec);
  const lateAt = Math.floor(duration * assumptions.lateStart);

  const retailNote =
    participants > sample
      ? `Sample of ${sample} typical buys out of ${participants} expected participants. Not a forecast.`
      : `${sample} typical buys spread across the fee window. Not a forecast.`;

  const retail = summarize(
    book,
    "retail",
    "Retail",
    retailNote,
    participants,
    spreadBuys(sample, typicalAtoms, duration, 0),
  );

  const whale = summarize(
    book,
    "whale",
    "Whale",
    args.whaleSizeAtoms == null
      ? `Five buys at ${assumptions.whaleMultiple}× the typical size, placed at launch while the early fee is highest.`
      : "Five buys of a fixed size, placed at launch while the early fee is highest.",
    null,
    spreadBuys(5, whaleSize, Math.min(duration, 300), 0),
  );

  const earlyCount = 4;
  const lateCount = 4;
  const late = summarize(
    book,
    "late",
    "Late capital",
    "Some size arrives at launch. The rest arrives later in the fee window. When that starts depends on the asset profile.",
    null,
    [
      ...spreadBuys(earlyCount, typicalAtoms, 0, 0),
      ...spreadBuys(lateCount, typicalAtoms * 4n, 0, lateAt),
    ],
  );

  const sell = summarize(
    book,
    "sell-pressure",
    "Sell pressure",
    `Buyers take a position, then sell ${assumptions.sellFractionBps / 100}% of the base they received.`,
    null,
    [
      ...spreadBuys(sample, typicalAtoms, Math.floor(duration / 2), 0),
      { side: "sellFraction", fractionBps: assumptions.sellFractionBps, atSec: duration },
    ],
  );

  const volatileOrders: SimOrder[] = [];
  for (let i = 0; i < 8; i++) {
    volatileOrders.push({ side: "buy", quoteAtoms: typicalAtoms * 2n, atSec: i * 60 });
    volatileOrders.push({ side: "sellFraction", fractionBps: 4_000, atSec: i * 60 + 30 });
  }
  const volatile = summarize(
    book,
    "volatile",
    "Volatile",
    "Alternating buys and partial sells. A dynamic fee is replayed when the config has one.",
    null,
    volatileOrders,
  );

  return [retail, whale, late, sell, volatile];
}

/** Deterministic generator. Same seed, same paths. */
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

export type StressSummary = {
  paths: number;
  graduationRate: number;
  medianProgress: number;
};

export function stressPaths(args: {
  book: CurveBook;
  typicalAtoms: bigint;
  feeDurationSec: number;
  paths: number;
  seed?: number;
}): StressSummary {
  const paths = Math.max(1, Math.min(5_000, Math.floor(args.paths)));
  const rand = mulberry32(args.seed ?? 0xec0c);
  const duration = Math.max(1, args.feeDurationSec);
  const progresses: number[] = [];
  let graduated = 0;
  for (let p = 0; p < paths; p++) {
    const steps = 12 + Math.floor(rand() * 18);
    const orders: SimOrder[] = [];
    let t = 0;
    for (let i = 0; i < steps; i++) {
      t += Math.floor(rand() * (duration / 6 + 1));
      const buy = rand() < 0.72;
      const scale = 0.25 + rand() * 6;
      const size = BigInt(Math.max(1, Math.round(Number(args.typicalAtoms) * scale)));
      // typicalAtoms can exceed 2^53. Scale with bigint instead when it does.
      const sized =
        args.typicalAtoms > BigInt(Number.MAX_SAFE_INTEGER)
          ? (args.typicalAtoms * BigInt(Math.max(1, Math.round(scale * 100)))) / 100n
          : size;
      if (buy) orders.push({ side: "buy", quoteAtoms: sized, atSec: t });
      else orders.push({ side: "sellFraction", fractionBps: 1_000 + Math.floor(rand() * 5_000), atSec: t });
    }
    const { state } = replay(args.book, orders);
    const prog = state.quoteReserve >= args.book.threshold
      ? 1
      : Number((state.quoteReserve * 10_000n) / args.book.threshold) / 10_000;
    progresses.push(prog);
    if (state.quoteReserve >= args.book.threshold) graduated += 1;
  }
  progresses.sort((a, b) => a - b);
  const mid = progresses[Math.floor(progresses.length / 2)] ?? 0;
  return {
    paths,
    graduationRate: graduated / paths,
    medianProgress: mid,
  };
}

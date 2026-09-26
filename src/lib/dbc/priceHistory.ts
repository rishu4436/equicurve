import {
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
  DynamicBondingCurveIdl,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { BorshCoder, EventParser, type Idl } from "@coral-xyz/anchor";
import {
  PublicKey,
  type Connection,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import type { PricePoint } from "@/lib/local/priceHistory";
import { atomsRatioToPrice } from "@/lib/amounts";
import { fetchSpotPrice } from "./spotPrice";

const DBC = DYNAMIC_BONDING_CURVE_PROGRAM_ID;

type SwapEventLike = {
  name: string;
  data: {
    tradeDirection?: number;
    amountIn?: { toString(): string } | number | string;
    currentTimestamp?: { toString(): string } | number | string;
    swapResult?: {
      actualInputAmount?: { toString(): string } | number | string;
      includedFeeInputAmount?: { toString(): string } | number | string;
      outputAmount?: { toString(): string } | number | string;
      nextSqrtPrice?: unknown;
    };
  };
};

/** u64 event field → exact bigint (never via float). */
function asAtoms(v: unknown): bigint | null {
  if (v == null) return null;
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return Number.isSafeInteger(v) ? BigInt(v) : null;
    const str = typeof v === "string" ? v : (v as { toString: () => string }).toString();
    return /^\d+$/.test(str) ? BigInt(str) : null;
  } catch {
    return null;
  }
}

function asSeconds(v: unknown): number | null {
  const a = asAtoms(v);
  return a == null ? null : Number(a);
}

/**
 * Implied execution price (quote per base) from EvtSwap / EvtSwap2 fields.
 * TradeDirection: 0 = BaseToQuote (sell), 1 = QuoteToBase (buy).
 * Amounts stay bigint until the final ratio (see atomsRatioToPrice).
 */
export function priceFromSwapEvent(
  ev: SwapEventLike,
  baseDecimals: number,
  quoteDecimals: number,
): { price: number; tsSec: number | null } | null {
  const dir = Number(ev.data.tradeDirection ?? -1);
  const result = ev.data.swapResult;
  if (!result) return null;

  const outRaw = asAtoms(result.outputAmount);
  const inRaw =
    asAtoms(result.includedFeeInputAmount) ??
    asAtoms(result.actualInputAmount) ??
    asAtoms(ev.data.amountIn);
  if (outRaw == null || inRaw == null || outRaw <= 0n || inRaw <= 0n) return null;

  let price: number | null;
  if (dir === 1) {
    // Buy: quote in → base out
    price = atomsRatioToPrice(inRaw, outRaw, quoteDecimals, baseDecimals);
  } else if (dir === 0) {
    // Sell: base in → quote out
    price = atomsRatioToPrice(outRaw, inRaw, quoteDecimals, baseDecimals);
  } else {
    return null;
  }
  if (price == null) return null;
  return { price, tsSec: asSeconds(ev.data.currentTimestamp) };
}

function parseSwapEventsFromLogs(logs: string[] | null | undefined): SwapEventLike[] {
  if (!logs?.length) return [];
  try {
    const coder = new BorshCoder(DynamicBondingCurveIdl as Idl);
    const parser = new EventParser(DBC, coder);
    const out: SwapEventLike[] = [];
    for (const ev of parser.parseLogs(logs)) {
      if (
        ev.name === "EvtSwap" ||
        ev.name === "EvtSwap2" ||
        ev.name === "EvtSwap2WithTransferHook"
      ) {
        out.push(ev as unknown as SwapEventLike);
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Fallback: largest |Δ| for base + quote mints from token balance changes. */
function priceFromTokenBalances(
  tx: ParsedTransactionWithMeta,
  baseMint: string,
  quoteMint: string,
  baseDecimals: number,
  quoteDecimals: number,
): number | null {
  const meta = tx.meta;
  if (!meta || meta.err) return null;

  const pre = meta.preTokenBalances ?? [];
  const post = meta.postTokenBalances ?? [];

  type Bal = { mint: string; amount: bigint };
  const preMap = new Map<string, Bal>();
  for (const b of pre) {
    if (b.mint !== baseMint && b.mint !== quoteMint) continue;
    const amt = asAtoms(b.uiTokenAmount.amount);
    if (amt == null) continue;
    preMap.set(`${b.accountIndex}:${b.mint}`, { mint: b.mint, amount: amt });
  }

  const absDiff = (a: bigint, b: bigint) => (a > b ? a - b : b - a);
  let maxBaseAbs = 0n;
  let maxQuoteAbs = 0n;
  for (const b of post) {
    if (b.mint !== baseMint && b.mint !== quoteMint) continue;
    const key = `${b.accountIndex}:${b.mint}`;
    const postAmt = asAtoms(b.uiTokenAmount.amount);
    if (postAmt == null) continue;
    const delta = absDiff(postAmt, preMap.get(key)?.amount ?? 0n);
    if (b.mint === baseMint) maxBaseAbs = delta > maxBaseAbs ? delta : maxBaseAbs;
    else maxQuoteAbs = delta > maxQuoteAbs ? delta : maxQuoteAbs;
  }
  // Accounts that only appear in pre (fully drained)
  for (const [key, bal] of preMap) {
    const still = post.some((b) => `${b.accountIndex}:${b.mint}` === key);
    if (still) continue;
    if (bal.mint === baseMint) maxBaseAbs = bal.amount > maxBaseAbs ? bal.amount : maxBaseAbs;
    else maxQuoteAbs = bal.amount > maxQuoteAbs ? bal.amount : maxQuoteAbs;
  }

  if (maxBaseAbs <= 0n || maxQuoteAbs <= 0n) return null;
  return atomsRatioToPrice(maxQuoteAbs, maxBaseAbs, quoteDecimals, baseDecimals);
}

function txInvolvesDbc(tx: ParsedTransactionWithMeta): boolean {
  const keys = tx.transaction.message.accountKeys ?? [];
  for (const k of keys) {
    const pk =
      typeof k === "string"
        ? k
        : (k as { pubkey?: PublicKey }).pubkey?.toBase58?.() ??
          String((k as { pubkey?: unknown }).pubkey ?? "");
    if (pk === DBC.toBase58()) return true;
  }
  const logs = tx.meta?.logMessages ?? [];
  return logs.some((l) => l.includes(DBC.toBase58()));
}

export type ReconstructResult = {
  points: PricePoint[];
  spot: number | null;
  scanned: number;
  parsedSwaps: number;
  error: string | null;
};

/**
 * Reconstruct recent swap-implied prices from confirmed pool txs + live spot.
 * Timestamps come from blockTime / event clock — never invented.
 */
export async function reconstructPoolPriceHistory(
  connection: Connection,
  pool: PublicKey,
  opts?: { limit?: number; baseMint?: string; quoteMint?: string },
): Promise<ReconstructResult> {
  const limit = opts?.limit ?? 40;
  let spot: number | null = null;
  let baseMint = opts?.baseMint;
  let quoteMint = opts?.quoteMint;
  // Decimals come from chain via fetchSpotPrice; without them no price is derived.
  let baseDecimals: number | null = null;
  let quoteDecimals: number | null = null;

  try {
    const spotRes = await fetchSpotPrice(connection, pool);
    if (spotRes) {
      spot = spotRes.price;
      baseMint = spotRes.baseMint;
      quoteMint = spotRes.quoteMint;
      baseDecimals = spotRes.baseDecimals;
      quoteDecimals = spotRes.quoteDecimals;
    }
  } catch {
    /* spot optional */
  }

  if (baseDecimals == null || quoteDecimals == null) {
    return {
      points: [],
      spot: null,
      scanned: 0,
      parsedSwaps: 0,
      error: "Could not read pool / mint decimals from chain; price history not derived.",
    };
  }
  const bDec = baseDecimals;
  const qDec = quoteDecimals;

  let sigs: { signature: string; blockTime: number | null }[] = [];
  try {
    const raw = await connection.getSignaturesForAddress(pool, { limit });
    sigs = raw.map((s) => ({
      signature: s.signature,
      blockTime: s.blockTime ?? null,
    }));
  } catch (e) {
    return {
      points: spot
        ? [
            {
              t: Date.now(),
              price: spot,
              source: "spot",
            },
          ]
        : [],
      spot,
      scanned: 0,
      parsedSwaps: 0,
      error: e instanceof Error ? e.message : "Signature fetch failed",
    };
  }

  const points: PricePoint[] = [];
  let parsedSwaps = 0;

  // Batch getParsedTransactions (RPC-friendly chunks)
  const chunkSize = 10;
  for (let i = 0; i < sigs.length; i += chunkSize) {
    const chunk = sigs.slice(i, i + chunkSize);
    let txs: (ParsedTransactionWithMeta | null)[] = [];
    try {
      txs = await connection.getParsedTransactions(
        chunk.map((c) => c.signature),
        { maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      );
    } catch {
      continue;
    }

    for (let j = 0; j < chunk.length; j++) {
      const tx = txs[j];
      const metaSig = chunk[j];
      if (!tx?.meta || tx.meta.err) continue;
      if (!txInvolvesDbc(tx)) continue;

      const events = parseSwapEventsFromLogs(tx.meta.logMessages);
      let price: number | null = null;
      let tMs: number | null =
        metaSig.blockTime != null ? metaSig.blockTime * 1000 : null;

      for (const ev of events) {
        const parsed = priceFromSwapEvent(ev, bDec, qDec);
        if (!parsed) continue;
        price = parsed.price;
        if (parsed.tsSec != null && parsed.tsSec > 1_000_000_000) {
          tMs = parsed.tsSec * 1000;
        }
        break;
      }

      if (price == null && baseMint && quoteMint) {
        price = priceFromTokenBalances(tx, baseMint, quoteMint, bDec, qDec);
      }

      if (price == null || tMs == null) continue;
      parsedSwaps += 1;
      points.push({
        t: tMs,
        price,
        sig: metaSig.signature,
        source: "swap",
      });
    }
  }

  if (spot != null) {
    points.push({
      t: Date.now(),
      price: spot,
      source: "spot",
    });
  }

  points.sort((a, b) => a.t - b.t);

  return {
    points,
    spot,
    scanned: sigs.length,
    parsedSwaps,
    error: null,
  };
}

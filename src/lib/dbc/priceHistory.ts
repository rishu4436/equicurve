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
import { quoteDecimalsForMint } from "@/lib/constants";
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

function asNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === "object" && v !== null && "toString" in v) {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function uiAmount(raw: number, decimals: number): number {
  return raw / 10 ** decimals;
}

/**
 * Implied execution price (quote per base) from EvtSwap / EvtSwap2 fields.
 * TradeDirection: 0 = BaseToQuote (sell), 1 = QuoteToBase (buy).
 */
function priceFromSwapEvent(
  ev: SwapEventLike,
  baseDecimals: number,
  quoteDecimals: number,
): { price: number; tsSec: number | null } | null {
  const dir = Number(ev.data.tradeDirection ?? -1);
  const result = ev.data.swapResult;
  if (!result) return null;

  const outRaw = asNum(result.outputAmount);
  const inRaw =
    asNum(result.includedFeeInputAmount) ??
    asNum(result.actualInputAmount) ??
    asNum(ev.data.amountIn);
  if (outRaw == null || inRaw == null || outRaw <= 0 || inRaw <= 0) return null;

  let price: number;
  if (dir === 1) {
    // Buy: quote in → base out
    const quoteIn = uiAmount(inRaw, quoteDecimals);
    const baseOut = uiAmount(outRaw, baseDecimals);
    if (!(baseOut > 0)) return null;
    price = quoteIn / baseOut;
  } else if (dir === 0) {
    // Sell: base in → quote out
    const baseIn = uiAmount(inRaw, baseDecimals);
    const quoteOut = uiAmount(outRaw, quoteDecimals);
    if (!(baseIn > 0)) return null;
    price = quoteOut / baseIn;
  } else {
    return null;
  }

  if (!(price > 0) || !Number.isFinite(price)) return null;
  const tsSec = asNum(ev.data.currentTimestamp);
  return { price, tsSec };
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

  type Bal = { mint: string; amount: number; decimals: number };
  const preMap = new Map<string, Bal>();
  for (const b of pre) {
    if (b.mint !== baseMint && b.mint !== quoteMint) continue;
    const amt = Number(b.uiTokenAmount.amount);
    if (!Number.isFinite(amt)) continue;
    preMap.set(`${b.accountIndex}:${b.mint}`, {
      mint: b.mint,
      amount: amt,
      decimals: b.uiTokenAmount.decimals,
    });
  }

  let maxBaseAbs = 0;
  let maxQuoteAbs = 0;
  for (const b of post) {
    if (b.mint !== baseMint && b.mint !== quoteMint) continue;
    const key = `${b.accountIndex}:${b.mint}`;
    const postAmt = Number(b.uiTokenAmount.amount);
    if (!Number.isFinite(postAmt)) continue;
    const prev = preMap.get(key)?.amount ?? 0;
    const delta = Math.abs(postAmt - prev);
    if (b.mint === baseMint) maxBaseAbs = Math.max(maxBaseAbs, delta);
    else maxQuoteAbs = Math.max(maxQuoteAbs, delta);
  }
  // Accounts that only appear in pre (fully drained)
  for (const [key, bal] of preMap) {
    const still = post.some(
      (b) => `${b.accountIndex}:${b.mint}` === key,
    );
    if (still) continue;
    if (bal.mint === baseMint) maxBaseAbs = Math.max(maxBaseAbs, bal.amount);
    else maxQuoteAbs = Math.max(maxQuoteAbs, bal.amount);
  }

  if (maxBaseAbs <= 0 || maxQuoteAbs <= 0) return null;
  const baseUi = maxBaseAbs / 10 ** baseDecimals;
  const quoteUi = maxQuoteAbs / 10 ** quoteDecimals;
  if (!(baseUi > 0)) return null;
  const price = quoteUi / baseUi;
  return price > 0 && Number.isFinite(price) ? price : null;
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
  let baseDecimals = 9;
  let quoteDecimals = 9;

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

  if (quoteMint) {
    quoteDecimals = quoteDecimalsForMint(quoteMint);
  }

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
        const parsed = priceFromSwapEvent(ev, baseDecimals, quoteDecimals);
        if (!parsed) continue;
        price = parsed.price;
        if (parsed.tsSec != null && parsed.tsSec > 1_000_000_000) {
          tMs = parsed.tsSec * 1000;
        }
        break;
      }

      if (price == null && baseMint && quoteMint) {
        price = priceFromTokenBalances(
          tx,
          baseMint,
          quoteMint,
          baseDecimals,
          quoteDecimals,
        );
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

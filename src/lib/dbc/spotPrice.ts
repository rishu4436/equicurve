import { PublicKey, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { sqrtPriceX64ToDecimalString } from "@/lib/amounts";
import { getDbcClient } from "./client";
import { withRpcRetry } from "@/lib/rpc";
import { fetchDbcPool } from "./poolAccount";

function bnishToBn(v: unknown): BN | null {
  if (v == null) return null;
  if (BN.isBN(v)) return v as BN;
  if (typeof v === "string" || typeof v === "number") {
    try {
      return new BN(v);
    } catch {
      return null;
    }
  }
  if (typeof v === "object" && v !== null && "toString" in v) {
    try {
      return new BN((v as { toString: () => string }).toString());
    } catch {
      return null;
    }
  }
  return null;
}

export type SpotPriceResult = {
  /** Quote per 1 base in UI units. */
  price: number;
  baseDecimals: number;
  quoteDecimals: number;
  quoteMint: string;
  baseMint: string;
  sqrtPrice: string;
  /** Exact decimal string (bigint math from sqrtPrice). */
  priceExact: string;
};

async function readMintDecimals(connection: Connection, mint: PublicKey): Promise<number | null> {
  try {
    const info = await withRpcRetry(() => connection.getParsedAccountInfo(mint, "confirmed"));
    const d = (info.value?.data as { parsed?: { info?: { decimals?: unknown } } } | undefined)?.parsed?.info?.decimals;
    return typeof d === "number" && Number.isInteger(d) ? d : null;
  } catch {
    return null;
  }
}

/**
 * Live spot from on-chain virtual pool `sqrtPrice` (Q64.64, exact bigint math).
 * Not a historical sample — use for the "now" marker only.
 */
export async function fetchSpotPrice(
  connection: Connection,
  pool: PublicKey,
): Promise<SpotPriceResult | null> {
  const client = getDbcClient(connection);
  const fetched = await fetchDbcPool(connection, pool);
  if (!fetched) return null;
  const normalized = fetched.state;
  const sqrtPrice = bnishToBn(fetched.state.sqrtPrice);
  if (!sqrtPrice || sqrtPrice.isZero()) return null;

  const config = await withRpcRetry(() => client.state.getPoolConfig(normalized.config));
  if (!config) return null;

  const quoteMintPk = (config as { quoteMint?: PublicKey }).quoteMint;
  if (!quoteMintPk) return null;
  // Decimals from the mint accounts (not defaults / known-mint tables).
  const [baseDecimals, quoteDecimals] = await Promise.all([
    readMintDecimals(connection, normalized.baseMint),
    readMintDecimals(connection, quoteMintPk),
  ]);
  if (baseDecimals == null || quoteDecimals == null) return null;

  const priceStr = sqrtPriceX64ToDecimalString(sqrtPrice.toString(10), baseDecimals, quoteDecimals);
  const price = Number(priceStr);
  if (!(price > 0) || !Number.isFinite(price)) return null;

  return {
    price,
    baseDecimals,
    quoteDecimals,
    quoteMint: quoteMintPk.toBase58(),
    baseMint: normalized.baseMint.toBase58(),
    sqrtPrice: sqrtPrice.toString(),
    priceExact: priceStr,
  };
}

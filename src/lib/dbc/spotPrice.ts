import {
  getPriceFromSqrtPrice,
  TokenDecimal,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey, type Connection } from "@solana/web3.js";
import BN from "bn.js";
import { quoteDecimalsForMint } from "@/lib/constants";
import { getDbcClient } from "./client";
import { withRpcRetry } from "@/lib/rpc";
import { fetchDbcPool } from "./poolAccount";

function toTokenDecimal(n: number): TokenDecimal {
  if (n === 6) return TokenDecimal.SIX;
  if (n === 7) return TokenDecimal.SEVEN;
  if (n === 8) return TokenDecimal.EIGHT;
  return TokenDecimal.NINE;
}

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
};

/**
 * Live spot from on-chain virtual pool `sqrtPrice` via SDK `getPriceFromSqrtPrice`.
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

  const baseDecimalsRaw = Number(
    (config as { tokenDecimal?: number }).tokenDecimal ?? 9,
  );
  const baseDecimals =
    baseDecimalsRaw === 6 ||
    baseDecimalsRaw === 7 ||
    baseDecimalsRaw === 8 ||
    baseDecimalsRaw === 9
      ? baseDecimalsRaw
      : 9;

  const quoteMintPk =
    (config as { quoteMint?: PublicKey }).quoteMint ??
    new PublicKey("So11111111111111111111111111111111111111112");
  const quoteDecimals = quoteDecimalsForMint(quoteMintPk);

  const decimal = getPriceFromSqrtPrice(
    sqrtPrice,
    toTokenDecimal(baseDecimals),
    toTokenDecimal(quoteDecimals),
  );
  const price = Number(String(decimal));
  if (!(price > 0) || !Number.isFinite(price)) return null;

  return {
    price,
    baseDecimals,
    quoteDecimals,
    quoteMint: quoteMintPk.toBase58(),
    baseMint: normalized.baseMint.toBase58(),
    sqrtPrice: sqrtPrice.toString(),
  };
}

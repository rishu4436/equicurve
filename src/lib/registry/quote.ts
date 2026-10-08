import type { PoolSnapshot } from "@/lib/dbc/types";
import { isValidPublicKey } from "@/lib/validation";

/** Lightweight registry equivalent of knownUsdcMints; parity is regression-tested.
 * Avoid importing constants.ts here: it initializes the Meteora SDK in client readers.
 */
export function registryUsdcMints(): string[] {
  const mints = ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"];
  const cluster = (process.env.NEXT_PUBLIC_CLUSTER || "devnet").toLowerCase();
  const override = process.env.NEXT_PUBLIC_USDC_MINT_OVERRIDE?.trim();
  if (cluster !== "mainnet" && cluster !== "mainnet-beta" && isValidPublicKey(override)) mints.push(override);
  return mints;
}

/** Only explicit supported mints are evidence of a quote denomination. */
export function supportedQuoteLabel(mint: string | null, usdcMints: readonly string[]): "SOL" | "USDC" | null {
  if (mint === "So11111111111111111111111111111111111111112") return "SOL";
  if (mint && usdcMints.includes(mint)) return "USDC";
  return null;
}

export function quoteVerificationError(snapshot: PoolSnapshot, usdcMints: readonly string[]) {
  if (snapshot.configRead !== true || !snapshot.quoteMint) {
    return { ok: false as const, status: 503, code: "config_unavailable", error: "Pool configuration or quote mint could not be verified. Retry shortly." };
  }
  if (!supportedQuoteLabel(snapshot.quoteMint, usdcMints)) {
    return { ok: false as const, status: 400, code: "unsupported_quote", error: "Unsupported quote mint. EquiCurve supports only WSOL and known USDC mints." };
  }
  return null;
}

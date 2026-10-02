import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import { getUsdcMintOverride } from "@/lib/constants";
import { EquiCurveError } from "@/lib/errors";

const accepted = new Set<string>();

export type UsdcMintFacts = { owner: PublicKey; decimals: number };

export function resetUsdcOverrideCache(): void {
  accepted.clear();
}

export function usdcMintFactsError(facts: UsdcMintFacts | null): string | null {
  if (!facts) return "USDC override mint could not be read.";
  if (!facts.owner.equals(TOKEN_PROGRAM_ID)) return "USDC override mint must be an SPL token mint.";
  if (facts.decimals !== 6) return "USDC override mint must use 6 decimals.";
  return null;
}

async function readSplMint(connection: Connection, mint: PublicKey): Promise<UsdcMintFacts | null> {
  const account = await getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID);
  return { owner: TOKEN_PROGRAM_ID, decimals: account.decimals };
}

/**
 * When NEXT_PUBLIC_USDC_MINT_OVERRIDE is set, the mint must be an SPL token
 * with 6 decimals. An unset override, including on mainnet, does nothing.
 * A failed read is not cached.
 */
export async function assertUsdcOverrideMint(
  connection: Connection,
  read: (connection: Connection, mint: PublicKey) => Promise<UsdcMintFacts | null> = readSplMint,
): Promise<void> {
  const override = getUsdcMintOverride();
  if (!override) return;
  const key = override.toBase58();
  if (accepted.has(key)) return;
  let facts: UsdcMintFacts | null = null;
  try {
    facts = await read(connection, override);
  } catch {
    facts = null;
  }
  const error = usdcMintFactsError(facts);
  if (error) throw new EquiCurveError(error, "VALIDATION");
  accepted.add(key);
}

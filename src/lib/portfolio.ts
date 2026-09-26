/**
 * Portfolio aggregation (pure). Sums a wallet's parsed token accounts per
 * mint using exact integer atoms from the chain (tokenAmount.amount + decimals)
 * and keeps only mints EquiCurve knows about (local launches ∪ registry).
 */
export type ParsedTokenAccountLike = {
  pubkey: string;
  mint: string;
  amount: string;
  decimals: number;
  program: "spl-token" | "spl-token-2022";
};

export type WalletPosition = {
  mint: string;
  atoms: bigint;
  decimals: number;
  accounts: number;
  program: ParsedTokenAccountLike["program"];
};

export function aggregatePositions(accounts: ParsedTokenAccountLike[], knownMints: Set<string>): WalletPosition[] {
  const byMint = new Map<string, WalletPosition>();
  for (const a of accounts) {
    if (!knownMints.has(a.mint)) continue;
    if (!/^\d+$/.test(a.amount)) continue;
    const atoms = BigInt(a.amount);
    const prev = byMint.get(a.mint);
    if (prev) {
      prev.atoms += atoms;
      prev.accounts += 1;
    } else {
      byMint.set(a.mint, { mint: a.mint, atoms, decimals: a.decimals, accounts: 1, program: a.program });
    }
  }
  return [...byMint.values()].filter((p) => p.atoms > 0n).sort((a, b) => (a.mint < b.mint ? -1 : 1));
}

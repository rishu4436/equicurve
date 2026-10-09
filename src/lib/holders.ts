import { formatAtomsExact } from "@/lib/amounts";

export type TokenAccountDistributionRow = {
  address: string;
  balance: string;
  supplyPct: string;
  role: "Creator token account" | "Token account";
};

function compact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

export function formatTokenSupply(atoms: string, decimals: number, ticker: string): string {
  const exact = formatAtomsExact(atoms, decimals);
  const numeric = Number(exact);
  return `${Number.isFinite(numeric) ? compact(numeric) : exact} ${ticker}`;
}

export function tokenAccountDistribution(args: {
  supplyAtoms: string;
  decimals: number;
  accounts: { address: string; amountAtoms: string }[];
  creatorAta?: string | null;
}): TokenAccountDistributionRow[] {
  const supply = /^\d+$/.test(args.supplyAtoms) ? BigInt(args.supplyAtoms) : 0n;
  return args.accounts
    .filter((row) => /^\d+$/.test(row.amountAtoms) && BigInt(row.amountAtoms) > 0n)
    .sort((a, b) => {
      const aa = BigInt(a.amountAtoms);
      const bb = BigInt(b.amountAtoms);
      return aa === bb ? a.address.localeCompare(b.address) : aa > bb ? -1 : 1;
    })
    .map((row) => {
      const amount = BigInt(row.amountAtoms);
      const percent = supply > 0n ? Number((amount * 1_000_000n) / supply) / 10_000 : 0;
      return {
        address: row.address,
        balance: formatAtomsExact(amount, args.decimals),
        supplyPct: `${percent.toFixed(percent < 0.01 ? 4 : 2)}%`,
        role: row.address === args.creatorAta ? "Creator token account" as const : "Token account" as const,
      };
    });
}

import {
  DAMM_V2_MIGRATION_FEE_ADDRESS,
  DAMM_V2_PROGRAM_ID,
  DYNAMIC_BONDING_CURVE_PROGRAM_ID,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";

export const DBC_PROGRAM_ID = DYNAMIC_BONDING_CURVE_PROGRAM_ID;
export const DAMM_V2_PROGRAM = DAMM_V2_PROGRAM_ID;
export const WSOL_MINT = NATIVE_MINT;

/** Circle USDC (mainnet). */
export const USDC_MINT_MAINNET = new PublicKey(
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
);
/** Circle / faucet USDC (devnet). */
export const USDC_MINT_DEVNET = new PublicKey(
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
);

export type QuoteLabel = "SOL" | "USDC";

/** Known USDC mint for the active cluster, or null if none. */
export function getUsdcMint(): PublicKey | null {
  const cluster = getCluster();
  if (cluster === "mainnet-beta") return USDC_MINT_MAINNET;
  if (cluster === "devnet") return USDC_MINT_DEVNET;
  return null;
}

export function quoteLabelForMint(mint: PublicKey | string): QuoteLabel {
  const s = typeof mint === "string" ? mint : mint.toBase58();
  if (s === WSOL_MINT.toBase58()) return "SOL";
  if (
    s === USDC_MINT_MAINNET.toBase58() ||
    s === USDC_MINT_DEVNET.toBase58()
  ) {
    return "USDC";
  }
  return "SOL";
}

export function quoteDecimalsForMint(mint: PublicKey | string): number {
  return quoteLabelForMint(mint) === "USDC" ? 6 : 9;
}

export function isPlaceholderMetadataUri(uri: string): boolean {
  const u = uri.trim().toLowerCase();
  if (!u) return true;
  // Old create default pointed at a non-existent product domain.
  return (
    u.includes("equicurve.dev") ||
    (u.includes("://") && u.endsWith("/metadata.json") && !u.startsWith("data:") && !u.includes("/api/metadata/"))
  );
}

export const DEFAULT_DAMM_V2_CONFIG =
  DAMM_V2_MIGRATION_FEE_ADDRESS?.[2] ??
  new PublicKey("Hv8Lmzmnju6m7kcokVKvwqz7QPmdX9XfKjJsXz8RXcjp");

export const DOCS = {
  dbc: "https://docs.meteora.ag/developer-guides/dbc/index.md",
  dbcSdk:
    "https://docs.meteora.ag/developer-guides/dbc/typescript-sdk/getting-started.md",
  dbcExamples:
    "https://docs.meteora.ag/developer-guides/dbc/typescript-sdk/examples.md",
  migration:
    "https://docs.meteora.ag/core-products/dbc/migration-and-liquidity.md",
  funLaunch: "https://docs.meteora.ag/invent/scaffold/fun-launch.md",
  earnListing: "https://superteam.fun/earn/listing/meteora-dbc",
  colosseum: "https://www.colosseum.org/",
} as const;

export const HACKATHON = {
  deadline: "2026-10-13",
  listing: DOCS.earnListing,
  note:
    "Dual-submit to Colosseum Crypto World's Fair sidetrack + Superteam Earn listing.",
  collaborator: "dannxbt",
} as const;

export function getRpcUrl(): string {
  return (
    process.env.NEXT_PUBLIC_RPC_URL?.trim() ||
    "https://api.devnet.solana.com"
  );
}

/** Hostname (+ pathname) only — strips query/api-key secrets for health/UI. */
export function getRpcHost(): string {
  try {
    const u = new URL(getRpcUrl());
    return u.host + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return "invalid-rpc-url";
  }
}

export function getCluster(): "devnet" | "mainnet-beta" | "testnet" {
  const raw = (process.env.NEXT_PUBLIC_CLUSTER || "devnet").toLowerCase();
  if (raw === "mainnet" || raw === "mainnet-beta") return "mainnet-beta";
  if (raw === "testnet") return "testnet";
  return "devnet";
}

export function getOptionalPoolConfigKey(): PublicKey | null {
  const raw = process.env.NEXT_PUBLIC_POOL_CONFIG_KEY?.trim();
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}

export function getDammV2ConfigKey(): PublicKey {
  const raw = process.env.NEXT_PUBLIC_DAMM_V2_CONFIG?.trim();
  if (!raw) return DEFAULT_DAMM_V2_CONFIG;
  try {
    return new PublicKey(raw);
  } catch {
    return DEFAULT_DAMM_V2_CONFIG;
  }
}

export function explorerTxUrl(signature: string): string {
  const cluster = getCluster();
  const q = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${q}`;
}

export function explorerAddressUrl(address: string): string {
  const cluster = getCluster();
  const q = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${q}`;
}

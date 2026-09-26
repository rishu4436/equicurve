/**
 * Must be the FIRST import of the e2e runner: sets the env the app's lib code
 * reads (cluster, RPC, USDC stand-in) before any module computes constants.
 */
import fs from "node:fs";
import path from "node:path";
import { Keypair } from "@solana/web3.js";

export const KEYS_DIR = process.env.E2E_KEYS_DIR || "/workspace/equicurve-e2e/keys";
export const RPC_URL = process.env.E2E_RPC_URL || "https://api.devnet.solana.com";
/** "devnet" (real devnet) or "localnet" (solana-test-validator with programs cloned from devnet). */
export const NETWORK: "devnet" | "localnet" =
  /localhost|127\.0\.0\.1/.test(RPC_URL) ? "localnet" : "devnet";
export const APP_URL = process.env.E2E_APP_URL || "http://localhost:3011";
export const OUT_DIR = process.env.E2E_OUT_DIR || "/workspace/equicurve-e2e";

export function loadKeypair(name: string): Keypair {
  const p = path.join(KEYS_DIR, `${name}.json`);
  if (!fs.existsSync(p)) {
    fs.mkdirSync(KEYS_DIR, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

/** Self-minted 6-decimal SPL mint used as the "USDC" quote stand-in. */
export const USDC_STANDIN = loadKeypair("usdc-standin-mint");

// The app's lib code reads these (NEXT_PUBLIC_* are plain env in Node).
process.env.NEXT_PUBLIC_CLUSTER = "devnet";
process.env.NEXT_PUBLIC_RPC_URL = RPC_URL;
process.env.RPC_URL = RPC_URL;
process.env.NEXT_PUBLIC_USDC_MINT_OVERRIDE = USDC_STANDIN.publicKey.toBase58();
delete process.env.NEXT_PUBLIC_POOL_CONFIG_KEY; // scenario 1: default config-and-pool mode
delete process.env.NEXT_PUBLIC_DAMM_V2_CONFIG;
delete process.env.NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM;

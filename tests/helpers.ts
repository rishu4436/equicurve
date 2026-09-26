import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  signLaunchPayload,
  type LaunchAuthPayload,
  type SignedLaunchBody,
} from "@/lib/auth/launchAuth";
import { computeCurveState } from "@/lib/dbc/curveState";
import type { PoolSnapshot } from "@/lib/dbc/types";

export const POOL = Keypair.generate().publicKey.toBase58();
export const MINT = Keypair.generate().publicKey.toBase58();
export const CONFIG = Keypair.generate().publicKey.toBase58();
export const WSOL = "So11111111111111111111111111111111111111112";

export function signerFor(kp: Keypair) {
  return async (msg: Uint8Array) => nacl.sign.detached(msg, kp.secretKey);
}

export function payload(over: Partial<LaunchAuthPayload> = {}): LaunchAuthPayload {
  return {
    v: 1,
    action: "launch",
    cluster: "devnet",
    pool: POOL,
    mint: MINT,
    profile: {
      name: "Acme Robotics",
      ticker: "ACME",
      thesis: "Tokenized exposure to a robotics issuer.",
      sector: "Equity",
      presetId: "short",
      raiseTarget: 100000,
    },
    metadata: {
      name: "Acme Robotics",
      symbol: "ACME",
      description: "Acme Robotics offering",
      image: "",
    },
    ...over,
  };
}

export async function signed(
  kp: Keypair,
  over: Partial<LaunchAuthPayload> = {},
  now = new Date(),
): Promise<SignedLaunchBody> {
  return signLaunchPayload({
    payload: payload(over),
    signer: kp.publicKey.toBase58(),
    signMessage: signerFor(kp),
    now,
  });
}

export function snapshot(over: Partial<PoolSnapshot> = {}): PoolSnapshot {
  const quoteReserve = over.quoteReserve ?? "10000000000";
  const migrationQuoteThreshold = over.migrationQuoteThreshold ?? "85000000000";
  const isMigrated = over.isMigrated ?? false;
  const migrationProgress = over.migrationProgress ?? 0;
  const curve =
    over.curve ?? computeCurveState({ quoteReserve, migrationQuoteThreshold, isMigrated, migrationProgress });
  return {
    pool: POOL,
    config: CONFIG,
    baseMint: MINT,
    quoteMint: WSOL,
    creator: Keypair.generate().publicKey.toBase58(),
    kind: "standard",
    feeClaimer: null,
    quoteReserve,
    migrationQuoteThreshold,
    isMigrated,
    migrationProgress,
    migrationOption: 1,
    migrationFeeOption: 2,
    baseDecimals: 9,
    quoteDecimals: 9,
    lockPct: 100,
    creatorFeePct: 70,
    curve,
    quoteProgress: curve.progress,
    baseProgress: null,
    configRead: true,
    checkedAt: new Date().toISOString(),
    ...over,
  };
}

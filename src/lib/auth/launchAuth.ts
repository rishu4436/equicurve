/**
 * Wallet-signed launch authorization (ed25519 via tweetnacl).
 *
 * One `signMessage` from the creator wallet authorizes BOTH the hosted token
 * metadata write and the shared-registry entry for a launch. The message
 * commits to a SHA-512 digest of the canonical payload, the cluster and an
 * issuedAt timestamp. Servers additionally require the signer to equal the
 * on-chain pool creator; chain-derived fields are never taken from the payload.
 */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";
import {
  addressSchema,
  clusterSchema,
  launchProfileSchema,
  tokenMetadataSchema,
  walletSchema,
} from "@/lib/validation";

export const LAUNCH_AUTH_MAX_AGE_MS = 20 * 60 * 1000;
export const LAUNCH_AUTH_MAX_FUTURE_MS = 2 * 60 * 1000;
export const MAX_SIGNED_BODY_BYTES = 8 * 1024;

export const launchAuthPayloadSchema = z
  .object({
    v: z.literal(1),
    action: z.enum(["launch", "update"]),
    cluster: clusterSchema,
    pool: addressSchema,
    mint: addressSchema,
    profile: launchProfileSchema.optional(),
    metadata: tokenMetadataSchema.optional(),
  })
  .strict();

export type LaunchAuthPayload = z.infer<typeof launchAuthPayloadSchema>;

export const launchAuthSchema = z
  .object({
    signer: walletSchema,
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/, "Invalid signature encoding"),
    issuedAt: z.string().datetime({ message: "issuedAt must be an ISO timestamp" }),
  })
  .strict();

export type LaunchAuth = z.infer<typeof launchAuthSchema>;

export const signedLaunchBodySchema = z
  .object({
    payload: launchAuthPayloadSchema,
    auth: launchAuthSchema,
  })
  .strict();

export type SignedLaunchBody = z.infer<typeof signedLaunchBodySchema>;

/** Deterministic JSON: object keys sorted, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function payloadDigest(payload: LaunchAuthPayload): string {
  return toHex(nacl.hash(new TextEncoder().encode(canonicalJson(payload))));
}

export function buildLaunchAuthMessage(
  payload: LaunchAuthPayload,
  signer: string,
  issuedAt: string,
): string {
  return [
    "EquiCurve launch authorization",
    "Signing proves you control this wallet. It is not a transaction and costs nothing.",
    "",
    `action: ${payload.action}`,
    `cluster: ${payload.cluster}`,
    `wallet: ${signer}`,
    `pool: ${payload.pool}`,
    `mint: ${payload.mint}`,
    `payload-sha512: ${payloadDigest(payload)}`,
    `issued-at: ${issuedAt}`,
  ].join("\n");
}

export type VerifyResult =
  | { ok: true; signer: string; issuedAtMs: number }
  | { ok: false; status: 400 | 401; code: string; error: string };

/** Verify signature + freshness. Does NOT check on-chain creator (caller does). */
export function verifyLaunchAuth(body: SignedLaunchBody, nowMs: number): VerifyResult {
  const { payload, auth } = body;
  const issuedAtMs = Date.parse(auth.issuedAt);
  if (!Number.isFinite(issuedAtMs)) {
    return { ok: false, status: 400, code: "bad_issued_at", error: "issuedAt is not a valid time" };
  }
  if (issuedAtMs > nowMs + LAUNCH_AUTH_MAX_FUTURE_MS) {
    return { ok: false, status: 401, code: "issued_in_future", error: "Authorization issuedAt is in the future" };
  }
  if (nowMs - issuedAtMs > LAUNCH_AUTH_MAX_AGE_MS) {
    return { ok: false, status: 401, code: "expired", error: "Authorization expired — sign again" };
  }
  let sig: Uint8Array;
  let pub: Uint8Array;
  try {
    sig = bs58.decode(auth.signature);
    pub = bs58.decode(auth.signer);
  } catch {
    return { ok: false, status: 400, code: "bad_encoding", error: "Signature or signer is not base58" };
  }
  if (sig.length !== 64 || pub.length !== 32) {
    return { ok: false, status: 400, code: "bad_encoding", error: "Signature must be 64 bytes, signer 32 bytes" };
  }
  const msg = new TextEncoder().encode(buildLaunchAuthMessage(payload, auth.signer, auth.issuedAt));
  if (!nacl.sign.detached.verify(msg, sig, pub)) {
    return { ok: false, status: 401, code: "bad_signature", error: "Signature does not match wallet and payload" };
  }
  return { ok: true, signer: auth.signer, issuedAtMs };
}

/** Client helper: sign a payload with a wallet-adapter `signMessage`. */
export async function signLaunchPayload(args: {
  payload: LaunchAuthPayload;
  signer: string;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
  now?: Date;
}): Promise<SignedLaunchBody> {
  const issuedAt = (args.now ?? new Date()).toISOString();
  const message = buildLaunchAuthMessage(args.payload, args.signer, issuedAt);
  const sig = await args.signMessage(new TextEncoder().encode(message));
  return {
    payload: args.payload,
    auth: { signer: args.signer, signature: bs58.encode(sig), issuedAt },
  };
}

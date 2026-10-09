import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";
import { clusterSchema, walletSchema } from "@/lib/validation";
import { getCommunityStore } from "./store";

export const WALLET_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const WALLET_SESSION_TTL_MS = 30 * 60 * 1000;
export const WALLET_AUTH_COOKIE = "equicurve_wallet_session";

export const walletChallengeRequestSchema = z.object({ wallet: walletSchema }).strict();
export const walletVerifyRequestSchema = z.object({
  wallet: walletSchema,
  nonce: z.string().regex(/^[a-f0-9-]{32,80}$/i, "Invalid challenge nonce"),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/, "Invalid signature encoding"),
}).strict();

export type WalletChallenge = {
  nonce: string;
  wallet: string;
  cluster: z.infer<typeof clusterSchema>;
  issuedAt: string;
  expiresAt: string;
  consumedAt?: string;
};

export type WalletSession = {
  tokenHash: string;
  wallet: string;
  cluster: z.infer<typeof clusterSchema>;
  createdAt: string;
  expiresAt: string;
};

type AuthPayload = { challenges: WalletChallenge[]; sessions: WalletSession[] };

const DOMAIN = "EquiCurve community wallet authentication";

function authFilePaths() {
  return {
    challenges: "challenges.json",
    sessions: "sessions.json",
  };
}

function authDir(): string {
  return path.join(process.cwd(), "data", "community", "auth");
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function authMessage(challenge: Pick<WalletChallenge, "wallet" | "cluster" | "nonce" | "issuedAt" | "expiresAt">): string {
  return [
    DOMAIN,
    "This signature authenticates your wallet for short-lived EquiCurve community actions.",
    "It is not a transaction and costs nothing.",
    "",
    `domain: equicurve.community`,
    `cluster: ${challenge.cluster}`,
    `wallet: ${challenge.wallet}`,
    `nonce: ${challenge.nonce}`,
    `issued-at: ${challenge.issuedAt}`,
    `expires-at: ${challenge.expiresAt}`,
  ].join("\n");
}

export function buildWalletAuthMessage(challenge: WalletChallenge): string {
  return authMessage(challenge);
}

async function readAuthFile(name: "challenges" | "sessions"): Promise<WalletChallenge[] | WalletSession[]> {
  try {
    const raw = JSON.parse(await readFile(path.join(authDir(), authFilePaths()[name]), "utf8")) as AuthPayload;
    return name === "challenges" ? (Array.isArray(raw.challenges) ? raw.challenges : []) : (Array.isArray(raw.sessions) ? raw.sessions : []);
  } catch {
    return [];
  }
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

async function writeAuthFiles(challenges: WalletChallenge[], sessions: WalletSession[]): Promise<void> {
  await mkdir(authDir(), { recursive: true });
  for (const [name, value] of [["challenges", challenges], ["sessions", sessions]] as const) {
    const file = path.join(authDir(), authFilePaths()[name]);
    const tmp = `${file}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), [name]: value }, null, 2), "utf8");
    await rename(tmp, file);
  }
}

async function updateAuth<T>(fn: (payload: AuthPayload) => Promise<{ value: T; payload: AuthPayload }>): Promise<T> {
  return serialized(async () => {
    const [challenges, sessions] = await Promise.all([readAuthFile("challenges"), readAuthFile("sessions")]);
    const result = await fn({ challenges: challenges as WalletChallenge[], sessions: sessions as WalletSession[] });
    await writeAuthFiles(result.payload.challenges, result.payload.sessions);
    return result.value;
  });
}

function purge(payload: AuthPayload, nowMs: number): AuthPayload {
  return {
    // Keep consumed nonces until their expiry so replay returns a clear
    // single-use error instead of silently looking like an unknown nonce.
    challenges: payload.challenges.filter((item) => Date.parse(item.expiresAt) > nowMs).slice(-5000),
    sessions: payload.sessions.filter((item) => Date.parse(item.expiresAt) > nowMs).slice(-5000),
  };
}

export async function issueWalletChallenge(args: { wallet: string; cluster: z.infer<typeof clusterSchema>; nowMs?: number }): Promise<{ challenge: WalletChallenge; message: string }> {
  walletSchema.parse(args.wallet);
  const nowMs = args.nowMs ?? Date.now();
  const issuedAt = new Date(nowMs).toISOString();
  const expiresAt = new Date(nowMs + WALLET_CHALLENGE_TTL_MS).toISOString();
  const challenge: WalletChallenge = { nonce: randomBytes(24).toString("hex"), wallet: args.wallet, cluster: args.cluster, issuedAt, expiresAt };
  await updateAuth(async (payload) => {
    const clean = purge(payload, nowMs);
    return { value: undefined, payload: { ...clean, challenges: [...clean.challenges, challenge] } };
  });
  return { challenge, message: authMessage(challenge) };
}

export type WalletVerifyResult =
  | { ok: true; wallet: string; expiresAt: string; token: string }
  | { ok: false; status: 400 | 401 | 409; code: string; error: string };

export async function verifyWalletChallenge(args: {
  wallet: string;
  nonce: string;
  signature: string;
  cluster: z.infer<typeof clusterSchema>;
  nowMs?: number;
}): Promise<WalletVerifyResult> {
  const parsed = walletVerifyRequestSchema.safeParse({ wallet: args.wallet, nonce: args.nonce, signature: args.signature });
  if (!parsed.success) return { ok: false, status: 400, code: "invalid_body", error: parsed.error.issues[0]?.message ?? "Invalid wallet authentication" };
  const nowMs = args.nowMs ?? Date.now();
  return updateAuth(async (payload) => {
    const clean = purge(payload, nowMs);
    const challenge = clean.challenges.find((item) => item.nonce === args.nonce);
    if (!challenge) return { value: { ok: false, status: 401, code: "unknown_challenge", error: "Wallet challenge is missing or expired" } as WalletVerifyResult, payload: clean };
    if (challenge.consumedAt) return { value: { ok: false, status: 409, code: "challenge_replayed", error: "Wallet challenge has already been used" } as WalletVerifyResult, payload: clean };
    if (challenge.wallet !== args.wallet || challenge.cluster !== args.cluster) return { value: { ok: false, status: 401, code: "challenge_mismatch", error: "Wallet challenge does not match this wallet or cluster" } as WalletVerifyResult, payload: clean };
    if (Date.parse(challenge.expiresAt) <= nowMs) return { value: { ok: false, status: 401, code: "challenge_expired", error: "Wallet challenge expired — request a new one" } as WalletVerifyResult, payload: clean };
    let sig: Uint8Array;
    let pub: Uint8Array;
    try {
      sig = bs58.decode(args.signature);
      pub = bs58.decode(args.wallet);
    } catch {
      return { value: { ok: false, status: 400, code: "bad_encoding", error: "Wallet or signature is not base58" } as WalletVerifyResult, payload: clean };
    }
    if (sig.length !== 64 || pub.length !== 32 || !nacl.sign.detached.verify(new TextEncoder().encode(authMessage(challenge)), sig, pub)) {
      return { value: { ok: false, status: 401, code: "bad_signature", error: "Signature does not match the wallet challenge" } as WalletVerifyResult, payload: clean };
    }
    const consumedAt = new Date(nowMs).toISOString();
    const token = randomBytes(32).toString("base64url");
    const session: WalletSession = { tokenHash: tokenHash(token), wallet: challenge.wallet, cluster: challenge.cluster, createdAt: consumedAt, expiresAt: new Date(nowMs + WALLET_SESSION_TTL_MS).toISOString() };
    const challenges = clean.challenges.map((item) => item.nonce === challenge.nonce ? { ...item, consumedAt } : item);
    return { value: { ok: true, wallet: session.wallet, expiresAt: session.expiresAt, token } as WalletVerifyResult, payload: { ...clean, challenges, sessions: [...clean.sessions, session] } };
  });
}

export async function getWalletSession(req: Request): Promise<{ wallet: string; cluster: string; expiresAt: string } | null> {
  const raw = req.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${WALLET_AUTH_COOKIE}=`))?.slice(WALLET_AUTH_COOKIE.length + 1);
  if (!raw) return null;
  const hash = tokenHash(decodeURIComponent(raw));
  const sessions = await readAuthFile("sessions") as WalletSession[];
  const session = sessions.find((item) => item.tokenHash === hash && Date.parse(item.expiresAt) > Date.now());
  return session ? { wallet: session.wallet, cluster: session.cluster, expiresAt: session.expiresAt } : null;
}

export function walletSessionCookie(token: string, expiresAt: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${WALLET_AUTH_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000))}${secure}`;
}

export function expiredWalletSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${WALLET_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** Exposed for focused tests without exposing the opaque token format. */
export function hashWalletSessionToken(token: string): string {
  return tokenHash(token);
}

/** Ensures the auth storage configuration is checked by API handlers before mutation. */
export function assertCommunityAuthStorage(): void {
  if (process.env.NODE_ENV === "production") {
    // Calling the shared storage selector keeps the production fail-closed
    // behavior in one place while allowing a future Upstash adapter to land
    // behind the same abstraction.
    getCommunityStore();
  }
}

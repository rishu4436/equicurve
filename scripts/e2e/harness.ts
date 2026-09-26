import fs from "node:fs";
import path from "node:path";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import nacl from "tweetnacl";
import { signAndSendTransaction, setFreshBlockhash } from "@/lib/send";
import { APP_URL, NETWORK, OUT_DIR, RPC_URL, loadKeypair } from "./env";

export const connection = new Connection(RPC_URL, { commitment: "confirmed", disableRetryOnRateLimit: false });

/* ------------------------------------------------------------ results */

export type Status = "pass" | "fail" | "skipped" | "info";
export type ResultRow = {
  scenario: string;
  step: string;
  status: Status;
  sigs: { label: string; sig: string; ok: boolean }[];
  addresses: Record<string, string>;
  notes: string[];
  at: string;
};

const RESULTS_FILE = path.join(OUT_DIR, `results-${NETWORK}.json`);
export const results: ResultRow[] = [];

export function explorerTx(sig: string): string {
  if (NETWORK === "devnet") return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
}
export function explorerAddr(a: string): string {
  if (NETWORK === "devnet") return `https://explorer.solana.com/address/${a}?cluster=devnet`;
  return `https://explorer.solana.com/address/${a}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
}

export class Step {
  row: ResultRow;
  constructor(scenario: string, step: string) {
    this.row = { scenario, step, status: "info", sigs: [], addresses: {}, notes: [], at: new Date().toISOString() };
    results.push(this.row);
    log(`\n=== [${scenario}] ${step}`);
  }
  sig(label: string, sig: string, ok = true) {
    this.row.sigs.push({ label, sig, ok });
    log(`  tx ${label}: ${sig} ${ok ? "" : "(FAILED ON-CHAIN, expected)"}\n     ${explorerTx(sig)}`);
    flush();
  }
  addr(label: string, a: string) {
    this.row.addresses[label] = a;
    log(`  ${label}: ${a}`);
  }
  note(n: string) {
    this.row.notes.push(n);
    log(`  • ${n}`);
  }
  check(cond: boolean, what: string): boolean {
    this.note(`${cond ? "OK" : "MISMATCH"}: ${what}`);
    if (!cond) this.row.status = "fail";
    return cond;
  }
  done(status?: Status) {
    if (status) this.row.status = status;
    else if (this.row.status === "info") this.row.status = "pass";
    log(`  → ${this.row.status.toUpperCase()}`);
    flush();
  }
  fail(e: unknown) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    this.note(`ERROR: ${msg.slice(0, 600)}`);
    const logs = (e as { logs?: string[]; cause?: { logs?: string[] } })?.logs ?? (e as { cause?: { logs?: string[] } })?.cause?.logs;
    if (Array.isArray(logs)) this.note(`logs: ${logs.slice(-8).join(" | ").slice(0, 1200)}`);
    this.row.status = "fail";
    log(`  → FAIL`);
    flush();
  }
}

export function flush() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_FILE, JSON.stringify({ network: NETWORK, rpc: RPC_URL, results }, null, 2));
}

const LOG_FILE = path.join(OUT_DIR, `e2e-${NETWORK}.log`);
export function log(s: string) {
  console.log(s);
  fs.appendFileSync(LOG_FILE, s + "\n");
}

/* ------------------------------------------------------------ state */

const STATE_FILE = path.join(OUT_DIR, `state-${NETWORK}.json`);
export function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
export function saveState(patch: Record<string, unknown>) {
  const s = { ...loadState(), ...patch };
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

/* ------------------------------------------------------------ wallet shim */

/** Minimal wallet-adapter stand-in: same signAndSendTransaction path as the UI. */
export function walletFor(kp: Keypair, opts: { declineSignMessage?: boolean } = {}): WalletContextState {
  return {
    publicKey: kp.publicKey,
    connected: true,
    signTransaction: async <T,>(tx: T) => {
      (tx as unknown as Transaction).partialSign(kp);
      return tx;
    },
    signMessage: async (msg: Uint8Array) => {
      if (opts.declineSignMessage) {
        const e = new Error("User rejected the request.");
        e.name = "WalletSignMessageError";
        throw e;
      }
      return nacl.sign.detached(msg, kp.secretKey);
    },
  } as unknown as WalletContextState;
}

/** UI path: fresh blockhash → partialSign extra signers → wallet sign → send → confirm (value.err checked). */
export async function sendLikeUi(args: {
  tx: Transaction;
  signer: Keypair;
  extraSigners?: Keypair[];
  conn?: Connection;
  refreshBlockhash?: boolean;
  onSubmitted?: (sig: string) => void;
}): Promise<string> {
  const conn = args.conn ?? connection;
  if (args.refreshBlockhash !== false) await setFreshBlockhash(conn, args.tx, args.signer.publicKey);
  if (args.extraSigners?.length) args.tx.partialSign(...args.extraSigners);
  return signAndSendTransaction({ connection: conn, wallet: walletFor(args.signer), tx: args.tx, onSubmitted: args.onSubmitted });
}

/* ------------------------------------------------------------ fetch shim */

const realFetch = globalThis.fetch;
/** The UI calls relative /api/* URLs; resolve them against the local app. */
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/")) input = APP_URL + input;
  return realFetch(input as RequestInfo, init);
}) as typeof fetch;

/** Run fn with window.location.origin = APP_URL (metadata client needs it). */
export async function withBrowserOrigin<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as unknown as { window?: unknown };
  const had = "window" in g;
  const prev = g.window;
  g.window = { location: { origin: APP_URL } };
  try {
    return await fn();
  } finally {
    if (had) g.window = prev;
    else delete g.window;
  }
}

/* ------------------------------------------------------------ chain helpers */

export async function getTx(sig: string): Promise<ParsedTransactionWithMeta> {
  for (let i = 0; i < 20; i++) {
    const t = await connection.getParsedTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (t) return t;
    await sleep(1000);
  }
  throw new Error(`tx ${sig} not found`);
}

/** Token balance delta (atoms) for owner+mint within a tx. */
export function tokenDelta(t: ParsedTransactionWithMeta, owner: PublicKey, mint: PublicKey): bigint {
  const sum = (arr: typeof t.meta extends null ? never : NonNullable<typeof t.meta>["preTokenBalances"]) =>
    (arr ?? [])
      .filter((b) => b.owner === owner.toBase58() && b.mint === mint.toBase58())
      .reduce((a, b) => a + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(t.meta!.postTokenBalances) - sum(t.meta!.preTokenBalances);
}

/** Lamport delta for an account (fee-payer delta includes the fee). */
export function lamportDelta(t: ParsedTransactionWithMeta, who: PublicKey): bigint {
  const idx = t.transaction.message.accountKeys.findIndex((k) => k.pubkey.equals(who));
  if (idx < 0) return 0n;
  return BigInt(t.meta!.postBalances[idx]) - BigInt(t.meta!.preBalances[idx]);
}

/**
 * Native-SOL value received by `owner` in a tx: lamport delta (+ fee if payer)
 * + rent paid for token accounts the tx created for owner + WSOL token delta.
 * (Temp WSOL accounts created and closed inside the tx net to zero.)
 */
export function solReceived(t: ParsedTransactionWithMeta, owner: PublicKey): bigint {
  const keys = t.transaction.message.accountKeys;
  const payer = keys[0].pubkey;
  let v = lamportDelta(t, owner) + (payer.equals(owner) ? BigInt(t.meta!.fee) : 0n);
  const pre = new Set((t.meta!.preTokenBalances ?? []).map((b) => b.accountIndex));
  for (const b of t.meta!.postTokenBalances ?? []) {
    if (b.owner !== owner.toBase58()) continue;
    const isWsol = b.mint === "So11111111111111111111111111111111111111112";
    if (!pre.has(b.accountIndex)) {
      const lamports = BigInt(t.meta!.postBalances[b.accountIndex]);
      v += isWsol ? lamports - BigInt(b.uiTokenAmount.amount) : lamports; // rent paid by owner
    }
  }
  const wsol = new PublicKey("So11111111111111111111111111111111111111112");
  return v + tokenDelta(t, owner, wsol);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ------------------------------------------------------------ funding */

export async function balance(pk: PublicKey): Promise<number> {
  return (await connection.getBalance(pk, "confirmed")) / LAMPORTS_PER_SOL;
}

/**
 * Ensure `kp` has ≥ minSol. localnet: airdrop. devnet: transfer from any
 * funded e2e key (funders are topped up only via the public devnet faucet).
 */
export async function ensureSol(kp: Keypair, minSol: number, exact = false): Promise<void> {
  const have = await balance(kp.publicKey);
  if (have >= minSol) return;
  const need = Math.ceil((minSol - have) * LAMPORTS_PER_SOL) + (exact ? 0 : 5_000_000);
  if (NETWORK === "localnet") {
    const sig = await connection.requestAirdrop(kp.publicKey, need + (exact ? 0 : 5 * LAMPORTS_PER_SOL));
    await connection.confirmTransaction(sig, "confirmed");
    return;
  }
  for (const name of ["funder1", "funder2", "funder3", "creator", "trader", "partner", "other"]) {
    const src = loadKeypair(name);
    if (src.publicKey.equals(kp.publicKey)) continue;
    const bal = await connection.getBalance(src.publicKey, "confirmed");
    const reserve = ["creator", "trader"].includes(name) ? 0.3 * LAMPORTS_PER_SOL : 0.002 * LAMPORTS_PER_SOL;
    const avail = bal - reserve;
    if (avail <= 0) continue;
    const amt = Math.min(avail, need);
    const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: src.publicKey, toPubkey: kp.publicKey, lamports: amt }));
    await sendLikeUi({ tx, signer: src });
    if ((await balance(kp.publicKey)) >= minSol) return;
  }
  throw new Error(`Not enough devnet SOL to fund ${kp.publicKey.toBase58()} to ${minSol} SOL (faucet rate-limited?)`);
}

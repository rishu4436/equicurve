/**
 * Turns $E2E_OUT_DIR/results-<network>.json into a markdown evidence table and
 * re-fetches every recorded signature from the same RPC (so the table only
 * lists signatures that actually exist on that ledger, with their on-chain
 * err/slot). Usage:
 *   E2E_RPC_URL=... npx tsx scripts/e2e/report.ts > /tmp/table.md
 * Also writes $E2E_OUT_DIR/txs-<network>.json (slot, err, fee, logs per sig).
 */
import fs from "node:fs";
import path from "node:path";
import { Connection } from "@solana/web3.js";

const RPC_URL = process.env.E2E_RPC_URL || "https://api.devnet.solana.com";
const NETWORK = /localhost|127\.0\.0\.1/.test(RPC_URL) ? "localnet" : "devnet";
const OUT_DIR = process.env.E2E_OUT_DIR || "/workspace/equicurve-e2e";

type Sig = { label: string; sig: string; ok: boolean };
type Result = { scenario: string; step: string; status: string; sigs: Sig[]; addresses?: Record<string, string>; notes: string[]; at: string };

const txLink = (s: string) =>
  NETWORK === "devnet"
    ? `https://explorer.solana.com/tx/${s}?cluster=devnet`
    : `https://explorer.solana.com/tx/${s}?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;

async function main() {
  const file = path.join(OUT_DIR, `results-${NETWORK}.json`);
  const { results } = JSON.parse(fs.readFileSync(file, "utf8")) as { results: Result[] };
  const conn = new Connection(RPC_URL, "confirmed");
  const dump: Record<string, unknown> = {};
  const lines: string[] = [];
  lines.push(`| # | Scenario | Step | Result | Transactions (${NETWORK}) | Addresses | Key checks / notes |`);
  lines.push("|---|---|---|---|---|---|---|");
  let i = 0;
  for (const r of results) {
    i++;
    const txCells: string[] = [];
    for (const s of r.sigs) {
      const tx = await conn.getTransaction(s.sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) {
        txCells.push(`${s.label}: \`${s.sig.slice(0, 8)}…\` **NOT FOUND on ${NETWORK} RPC — not evidence**`);
        continue;
      }
      const err = tx.meta?.err ?? null;
      dump[s.sig] = { label: s.label, scenario: r.scenario, slot: tx.slot, blockTime: tx.blockTime, err, fee: tx.meta?.fee, logMessages: tx.meta?.logMessages };
      txCells.push(`${s.label}${err ? ` (**failed on-chain as intended**: \`${JSON.stringify(err)}\`)` : ""}: [\`${s.sig.slice(0, 16)}…\`](${txLink(s.sig)})`);
    }
    const addr = Object.entries(r.addresses ?? {}).map(([k, v]) => `${k}: \`${v}\``).join("<br>");
    const notes = r.notes.map((n) => n.replace(/\|/g, "\\|")).join("<br>");
    lines.push(`| ${i} | ${r.scenario} | ${r.step.replace(/\|/g, "\\|")} | **${r.status.toUpperCase()}** | ${txCells.join("<br>") || "—"} | ${addr || "—"} | ${notes} |`);
  }
  const total = results.reduce((n, r) => n + r.sigs.length, 0);
  const found = Object.keys(dump).length;
  // solana-test-validator keeps a size-limited ledger, so old signatures age out of the RPC.
  // Never overwrite a complete proof file with a partial one.
  const target = found === total ? `txs-${NETWORK}.json` : `txs-${NETWORK}.partial.json`;
  fs.writeFileSync(path.join(OUT_DIR, target), JSON.stringify(dump, null, 1));
  process.stdout.write(lines.join("\n") + "\n");
  process.stderr.write(`${found} of ${total} signatures confirmed on ${NETWORK} (wrote ${target})\n`);
  if (found !== total) process.exitCode = 2;
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

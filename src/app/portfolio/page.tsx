"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { explorerAddressUrl } from "@/lib/constants";
import {
  listActivity,
  listLaunches,
  type StoredActivity,
  type StoredLaunch,
} from "@/lib/local/launches";

type PositionRow = {
  launch: StoredLaunch;
  balanceHint?: string;
};

export default function PortfolioPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [tab, setTab] = useState<"positions" | "history" | "documents">(
    "positions",
  );
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [history, setHistory] = useState<StoredActivity[]>([]);

  useEffect(() => {
    const launches = listLaunches();
    const acts = listActivity();
    setHistory(acts);
    setRows(launches.map((l) => ({ launch: l })));
  }, []);

  useEffect(() => {
    if (!wallet.publicKey) return;
    let cancelled = false;
    (async () => {
      const next: PositionRow[] = [];
      for (const l of listLaunches()) {
        let balanceHint: string | undefined;
        try {
          const mint = new PublicKey(l.mint);
          const accounts = await connection.getParsedTokenAccountsByOwner(
            wallet.publicKey!,
            { mint },
          );
          const amt = accounts.value.reduce((sum, a) => {
            const ui =
              a.account.data.parsed?.info?.tokenAmount?.uiAmountString ?? "0";
            return sum + Number(ui);
          }, 0);
          if (amt > 0) balanceHint = amt.toLocaleString();
        } catch {
          /* best effort */
        }
        if (!cancelled) next.push({ launch: l, balanceHint });
      }
      if (!cancelled) setRows(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet.publicKey, connection]);

  const walletActs = wallet.publicKey
    ? history.filter(
        (a) =>
          a.wallet?.toLowerCase() === wallet.publicKey!.toBase58().toLowerCase(),
      )
    : history;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-fg-primary">Portfolio</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            Positions from wallet-connected local launch history + best-effort
            SPL balances. No indexer required for the demo path.
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-line pb-2">
        {(
          [
            ["positions", "Positions"],
            ["history", "History"],
            ["documents", "Documents"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? "rounded-pill bg-accent/15 px-4 py-1.5 text-sm text-accent"
                : "rounded-pill px-4 py-1.5 text-sm text-fg-secondary"
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "positions" && (
        <>
          {rows.length === 0 ? (
            <div className="ec-card flex flex-col items-center gap-3 p-12 text-center">
              <p className="text-fg-secondary">No positions yet.</p>
              <Link href="/explore?tab=raising" className="ec-btn-primary">
                Explore raising offerings
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto ec-card">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Offering</th>
                    <th className="px-4 py-3 font-medium">Phase</th>
                    <th className="px-4 py-3 font-medium">Qty (hint)</th>
                    <th className="px-4 py-3 font-medium">Lock</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ launch: l, balanceHint }) => (
                    <tr key={l.pool} className="border-b border-line/60">
                      <td className="px-4 py-3">
                        <div className="font-medium text-fg-primary">
                          ${l.ticker}
                        </div>
                        <div className="text-xs text-fg-muted">{l.name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={l.status} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {balanceHint ??
                          (wallet.publicKey ? "0 / unknown" : "Connect wallet")}
                      </td>
                      <td className="px-4 py-3 text-xs">≥{l.lockPct}%</td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/o/${l.pool}`}
                          className="text-xs text-accent hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "history" && (
        <div className="space-y-2">
          {walletActs.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No local trade / launch history yet.
            </p>
          ) : (
            walletActs.map((a) => (
              <div
                key={a.id}
                className="ec-card flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <div>
                  <span className="capitalize text-fg-primary">{a.kind}</span>
                  {a.amount && (
                    <span className="ml-2 font-mono text-fg-muted">
                      {a.amount}
                    </span>
                  )}
                  <div className="font-mono text-[10px] text-fg-muted">
                    {a.pool.slice(0, 12)}… · {new Date(a.at).toLocaleString()}
                  </div>
                </div>
                <a
                  href={`https://explorer.solana.com/tx/${a.sig}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-accent hover:underline"
                >
                  {a.sig.slice(0, 8)}…
                </a>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "documents" && (
        <div className="ec-card space-y-2 p-5 text-sm text-fg-secondary">
          <p>
            Disclosure vault copies for holdings — MVP lists offerings you
            launched locally. PDF attach lands post-submit.
          </p>
          <ul className="space-y-2 text-xs">
            {listLaunches().map((l) => (
              <li
                key={l.pool}
                className="flex justify-between rounded-input border border-line bg-subtle px-3 py-2"
              >
                <span>
                  ${l.ticker} — risk + issuer attestations
                </span>
                <a
                  href={explorerAddressUrl(l.pool)}
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  On-chain
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

"use client";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatAtomsExact } from "@/lib/amounts";
import { explorerAddressUrl, explorerTxUrl, getClusterLabel } from "@/lib/constants";
import {
  listActivity,
  listLaunches,
  type StoredActivity,
  type StoredLaunch,
} from "@/lib/local/launches";
import { aggregatePositions, type ParsedTokenAccountLike, type WalletPosition } from "@/lib/portfolio";
import type { PublicRegistryLaunch } from "@/lib/registry/types";
import { toUserMessage } from "@/lib/errors";

type Profile = { name: string; ticker: string; pool: string; source: "registry (verified)" | "registry (unverified)" | "this browser" };

type ChainRead =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; positions: WalletPosition[]; readAt: string }
  | { state: "error"; error: string };

export default function PortfolioPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [tab, setTab] = useState<"positions" | "history" | "documents">("positions");
  const [launches, setLaunches] = useState<StoredLaunch[]>([]);
  const [history, setHistory] = useState<StoredActivity[]>([]);
  const [registry, setRegistry] = useState<PublicRegistryLaunch[]>([]);
  const [chain, setChain] = useState<ChainRead>({ state: "idle" });

  useEffect(() => {
    setLaunches(listLaunches());
    setHistory(listActivity());
    void fetch("/api/launches", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { launches?: PublicRegistryLaunch[] }) => setRegistry(j.launches ?? []))
      .catch(() => setRegistry([]));
  }, []);

  const profiles = useMemo(() => {
    const m = new Map<string, Profile>();
    for (const l of launches) m.set(l.mint, { name: l.name, ticker: l.ticker, pool: l.pool, source: "this browser" });
    for (const r of registry) {
      m.set(r.mint, {
        name: r.name,
        ticker: r.ticker,
        pool: r.pool,
        source: r.verified ? "registry (verified)" : "registry (unverified)",
      });
    }
    return m;
  }, [launches, registry]);

  const readChain = useCallback(async () => {
    if (!wallet.publicKey) return;
    setChain({ state: "loading" });
    try {
      const owner = wallet.publicKey;
      const [spl, t22] = await Promise.all([
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
        connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
      ]);
      const flat: ParsedTokenAccountLike[] = [];
      for (const [list, program] of [
        [spl.value, "spl-token"],
        [t22.value, "spl-token-2022"],
      ] as const) {
        for (const a of list) {
          const info = (a.account.data as { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } })
            .parsed?.info;
          if (!info?.mint || info.tokenAmount?.amount == null || info.tokenAmount.decimals == null) continue;
          flat.push({
            pubkey: a.pubkey.toBase58(),
            mint: info.mint,
            amount: info.tokenAmount.amount,
            decimals: info.tokenAmount.decimals,
            program,
          });
        }
      }
      setChain({ state: "ok", positions: aggregatePositions(flat, new Set(profiles.keys())), readAt: new Date().toISOString() });
    } catch (e) {
      setChain({ state: "error", error: toUserMessage(e) });
    }
  }, [wallet.publicKey, connection, profiles]);

  useEffect(() => {
    void readChain();
  }, [readChain]);

  const walletActs = wallet.publicKey
    ? history.filter((a) => a.wallet === wallet.publicKey!.toBase58())
    : history;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-fg-primary">Portfolio</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Two separate sources: <strong className="text-fg-primary">verified on-chain positions</strong> read from your
          wallet&apos;s token accounts on {getClusterLabel()}, and <strong className="text-fg-primary">locally recorded
          activity</strong> that this browser saved when you used EquiCurve (not verified, may be stale or incomplete).
        </p>
      </div>

      <div className="flex gap-2 border-b border-line pb-2">
        {(
          [
            ["positions", "Positions"],
            ["history", "Local activity"],
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
        <div className="space-y-6">
          <section className="ec-card overflow-x-auto" data-testid="verified-positions">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-fg-primary">Verified on-chain wallet positions</h2>
                <p className="text-[11px] text-fg-muted">
                  Exact balances from token accounts owned by the connected wallet (SPL + Token-2022), for mints
                  EquiCurve knows (registry + this browser).
                  {chain.state === "ok" && ` Read ${new Date(chain.readAt).toLocaleTimeString()}.`}
                </p>
              </div>
              {wallet.publicKey && (
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => void readChain()}>
                  Refresh
                </button>
              )}
            </div>
            {!wallet.publicKey ? (
              <p className="p-4 text-sm text-fg-muted">Connect a wallet to read positions from chain.</p>
            ) : chain.state === "loading" || chain.state === "idle" ? (
              <p className="p-4 text-sm text-fg-muted">Reading token accounts…</p>
            ) : chain.state === "error" ? (
              <p className="p-4 text-sm text-signal-warn">Unknown: could not read token accounts ({chain.error}).</p>
            ) : chain.positions.length === 0 ? (
              <div className="flex flex-col items-center gap-3 p-8 text-center">
                <p className="text-sm text-fg-secondary">This wallet holds no EquiCurve-known tokens on {getClusterLabel()}.</p>
                <Link href="/explore?tab=raising" className="ec-btn-primary">
                  Explore offerings
                </Link>
              </div>
            ) : (
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="border-b border-line text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Token</th>
                    <th className="px-4 py-3 font-medium">Balance (exact)</th>
                    <th className="px-4 py-3 font-medium">Mint</th>
                    <th className="px-4 py-3 font-medium">Profile source</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {chain.positions.map((p) => {
                    const prof = profiles.get(p.mint);
                    return (
                      <tr key={p.mint} className="border-b border-line/60">
                        <td className="px-4 py-3">
                          <div className="font-medium text-fg-primary">${prof?.ticker ?? "?"}</div>
                          <div className="text-xs text-fg-muted">{prof?.name ?? "unknown"}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-fg-primary">
                          {formatAtomsExact(p.atoms, p.decimals)}
                          <span className="block text-[10px] text-fg-muted">
                            {p.accounts} account{p.accounts === 1 ? "" : "s"} · {p.program}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <a className="text-accent hover:underline" href={explorerAddressUrl(p.mint)} target="_blank" rel="noreferrer">
                            {p.mint.slice(0, 6)}…{p.mint.slice(-4)}
                          </a>
                        </td>
                        <td className="px-4 py-3 text-xs text-fg-muted">{prof?.source ?? "—"}</td>
                        <td className="px-4 py-3">
                          {prof && (
                            <Link href={`/o/${prof.pool}`} className="text-xs text-accent hover:underline">
                              Open
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section className="ec-card overflow-x-auto" data-testid="local-launches">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-fg-primary">Launched from this browser (local record)</h2>
              <p className="text-[11px] text-fg-muted">
                Saved in localStorage at launch time. Status and lock shown here are the values recorded then, not a
                chain read; open the offering for live state.
              </p>
            </div>
            {launches.length === 0 ? (
              <p className="p-4 text-sm text-fg-muted">No launches recorded in this browser.</p>
            ) : (
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-line text-xs text-fg-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Offering</th>
                    <th className="px-4 py-3 font-medium">Recorded status</th>
                    <th className="px-4 py-3 font-medium">Recorded lock</th>
                    <th className="px-4 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {launches.map((l) => (
                    <tr key={l.pool} className="border-b border-line/60">
                      <td className="px-4 py-3">
                        <div className="font-medium text-fg-primary">${l.ticker}</div>
                        <div className="text-xs text-fg-muted">{l.name}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={l.status} unverified />
                      </td>
                      <td className="px-4 py-3 text-xs">{l.lockPct}%</td>
                      <td className="px-4 py-3">
                        <Link href={`/o/${l.pool}`} className="text-xs text-accent hover:underline">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-2" data-testid="local-activity">
          <p className="text-xs text-fg-muted">
            Locally recorded activity (this browser, unverified). Each entry links to its transaction so you can check
            it on the explorer; swaps made elsewhere do not appear here.
          </p>
          {walletActs.length === 0 ? (
            <p className="text-sm text-fg-muted">No local trade / launch history yet.</p>
          ) : (
            walletActs.map((a) => (
              <div key={a.id} className="ec-card flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <span className="capitalize text-fg-primary">{a.kind}</span>
                  {a.amount && <span className="ml-2 font-mono text-fg-muted">{a.amount}</span>}
                  <div className="font-mono text-[10px] text-fg-muted">
                    {a.pool.slice(0, 12)}… · {new Date(a.at).toLocaleString()}
                  </div>
                </div>
                <a
                  href={explorerTxUrl(a.sig)}
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
            Issuer attestations recorded in this browser at Create time (self-attested, not uploaded or verified).
          </p>
          <ul className="space-y-2 text-xs">
            {launches.map((l) => (
              <li key={l.pool} className="flex justify-between rounded-input border border-line bg-subtle px-3 py-2">
                <span>${l.ticker} — risk + issuer attestations</span>
                <a href={explorerAddressUrl(l.pool)} className="text-accent hover:underline" target="_blank" rel="noreferrer">
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

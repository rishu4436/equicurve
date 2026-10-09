"use client";

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { formatAtomsExact } from "@/lib/amounts";
import { explorerAddressUrl, explorerTxUrl, getClusterLabel, getUsdcMint, WSOL_MINT } from "@/lib/constants";
import {
  listActivity,
  listLaunches,
  activityForWallet,
  MARKET_CHANGED_EVENT,
  type StoredActivity,
  type StoredLaunch,
} from "@/lib/local/launches";
import { aggregatePositions, type ParsedTokenAccountLike, type WalletPosition } from "@/lib/portfolio";
import type { PublicRegistryLaunch } from "@/lib/registry/types";
import { toUserMessage } from "@/lib/errors";
import { fetchDammPoolSnapshot, fetchUserDammPositions, type DammPositionView } from "@/lib/damm";
import { withReadConnection } from "@/lib/connection";
import { dedupeRpcRead } from "@/lib/rpc";

type Profile = { name: string; ticker: string; pool: string; source: "registry (verified)" | "registry (unverified)" | "this browser" };

type ChainRead =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; positions: WalletPosition[]; readAt: string }
  | { state: "error"; error: string };

type PortfolioLpPosition = DammPositionView & { dammPool: string; ticker: string; lockPct: number };

export default function PortfolioPage() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [tab, setTab] = useState<"positions" | "history" | "documents">("positions");
  const [launches, setLaunches] = useState<StoredLaunch[]>([]);
  const [history, setHistory] = useState<StoredActivity[]>([]);
  const [registry, setRegistry] = useState<PublicRegistryLaunch[]>([]);
  const [chain, setChain] = useState<ChainRead>({ state: "idle" });
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [lpPositions, setLpPositions] = useState<PortfolioLpPosition[]>([]);
  const [lpError, setLpError] = useState<string | null>(null);
  const [lpLoading, setLpLoading] = useState(false);

  useEffect(() => {
    setLaunches(listLaunches());
    setHistory(listActivity());
    void fetch("/api/launches", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { launches?: PublicRegistryLaunch[] }) => setRegistry(j.launches ?? []))
      .catch(() => setRegistry([]));
  }, [refreshRevision]);

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
      const readProgram = (programId: PublicKey) => dedupeRpcRead(
        `portfolio:${owner.toBase58()}:${programId.toBase58()}`,
        () => withReadConnection(connection, (readConnection) =>
          readConnection.getParsedTokenAccountsByOwner(owner, { programId }, "confirmed"), {
          retries: 1,
          baseDelayMs: 500,
          timeoutMs: 12_000,
        }),
      );
      // Sequential scans avoid a rate-limit burst on public RPC endpoints.
      const spl = await readProgram(TOKEN_PROGRAM_ID);
      const t22 = await readProgram(TOKEN_2022_PROGRAM_ID);
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
  }, [readChain, refreshRevision]);

  const readLpPositions = useCallback(async () => {
    if (!wallet.publicKey) {
      setLpPositions([]);
      return;
    }
    setLpLoading(true);
    setLpError(null);
    const owner = wallet.publicKey;
    const found: PortfolioLpPosition[] = [];
    const failures: string[] = [];
    for (const launch of launches.filter((item) => item.dammPool)) {
      try {
        const quoteMint = launch.quote === "USDC" ? getUsdcMint() : WSOL_MINT;
        if (!quoteMint || !launch.dammPool) throw new Error("Quote mint unavailable on this cluster.");
        const pool = new PublicKey(launch.dammPool);
        const lpRead = await withReadConnection(connection, async (readConnection) => {
          const verified = await fetchDammPoolSnapshot({
            connection: readConnection,
            pool,
            baseMint: launch.mint,
            quoteMint: quoteMint.toBase58(),
            source: "launch",
          });
          if (!verified.exists) return { verified, positions: [] as DammPositionView[] };
          const positions = await fetchUserDammPositions({ connection: readConnection, pool, user: owner });
          return { verified, positions };
        });
        if (!lpRead.verified.exists) continue;
        const positions = lpRead.positions;
        found.push(...positions.map((position) => ({ ...position, dammPool: launch.dammPool!, ticker: launch.ticker, lockPct: launch.lockPct })));
      } catch (error) {
        failures.push(toUserMessage(error));
      }
    }
    setLpPositions(found);
    setLpError(failures.length ? `Some DAMM positions could not be refreshed: ${failures[0]}` : null);
    setLpLoading(false);
  }, [connection, launches, wallet.publicKey]);

  useEffect(() => {
    void readLpPositions();
  }, [readLpPositions, refreshRevision]);

  useEffect(() => {
    const refresh = () => setRefreshRevision((value) => value + 1);
    window.addEventListener(MARKET_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(MARKET_CHANGED_EVENT, refresh);
  }, []);

  const walletActs = activityForWallet(history, wallet.publicKey?.toBase58() ?? null);

  return (
    <div className="space-y-6">
      <div>
        <p className="ec-eyebrow mb-3">Your markets, in view</p>
        <h1 className="text-3xl font-semibold text-fg-primary">Portfolio</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Two separate sources: <strong className="text-fg-primary">verified on-chain positions</strong> read from your
          wallet&apos;s token accounts on {getClusterLabel()}, and <strong className="text-fg-primary">locally recorded
          activity</strong> that this browser saved when you used EquiCurve (not verified, may be stale or incomplete).
        </p>
      </div>

      <div className="ec-tabs w-fit max-w-full" role="group" aria-label="Portfolio view">
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
            aria-pressed={tab === id}
            className={
              tab === id
                ? "min-h-11 whitespace-nowrap rounded-lg bg-accent/15 px-4 py-2 text-sm text-accent"
                : "min-h-11 whitespace-nowrap rounded-lg px-4 py-2 text-sm text-fg-secondary"
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
                <p className="text-xs text-fg-muted">
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
              <div className="flex flex-col items-center gap-4 px-6 py-14 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-xl text-accent" aria-hidden="true">◈</span><h3 className="text-xl font-medium tracking-tight">Your portfolio starts here.</h3><p className="max-w-sm text-sm leading-relaxed text-fg-muted">Connect a wallet from the navigation to see your verified on-chain positions.</p><Link href="/explore" className="ec-btn-secondary">Explore markets →</Link></div>
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
                          <span className="block text-xs text-fg-muted">
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

          <section className="ec-card overflow-x-auto" data-testid="damm-lp-positions">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div><h2 className="text-sm font-semibold text-fg-primary">Verified DAMM v2 LP positions</h2><p className="text-xs text-fg-muted">Position NFTs are non-fungible ownership records and are shown separately from token balances.</p></div>
              {wallet.publicKey && <button type="button" className="text-xs text-accent hover:underline" onClick={() => void readLpPositions()}>Refresh</button>}
            </div>
            {lpLoading ? <p className="p-4 text-sm text-fg-muted">Reading DAMM v2 positions…</p> : lpError && lpPositions.length === 0 ? <p className="p-4 text-sm text-signal-warn">{lpError}</p> : lpPositions.length === 0 ? <p className="p-4 text-sm text-fg-muted">No verified DAMM v2 LP position found for this wallet in locally known migrated markets.</p> : <table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b border-line text-fg-muted"><tr><th className="px-4 py-3">Market / pool</th><th className="px-4 py-3">Position</th><th className="px-4 py-3">Position NFT</th><th className="px-4 py-3">Lock / ownership</th><th className="px-4 py-3">Liquidity</th></tr></thead><tbody>{lpPositions.map((position) => <tr key={position.position} className="border-b border-line/60"><td className="px-4 py-3"><span className="font-medium text-fg-primary">${position.ticker}</span><a href={explorerAddressUrl(position.dammPool)} target="_blank" rel="noreferrer" className="ml-2 font-mono text-accent hover:underline">{position.dammPool.slice(0, 6)}…</a></td><td className="px-4 py-3 font-mono"><a href={explorerAddressUrl(position.position)} target="_blank" rel="noreferrer" className="text-accent hover:underline">{position.position.slice(0, 6)}…{position.position.slice(-4)}</a></td><td className="px-4 py-3 font-mono">{position.positionNftMint ? <a href={explorerAddressUrl(position.positionNftMint)} target="_blank" rel="noreferrer" className="text-accent hover:underline">{position.positionNftMint.slice(0, 6)}…{position.positionNftMint.slice(-4)}</a> : `${position.positionNftAccount.slice(0, 6)}… token account`}</td><td className="px-4 py-3">{position.lockState ?? `${position.lockPct}% configured`} · owned by connected wallet</td><td className="px-4 py-3 font-mono">{position.liquidityStatus ?? "verified"} · {position.unlockedLiquidity} unlocked</td></tr>)}</tbody></table>}
            {lpError && lpPositions.length > 0 && <p className="border-t border-line p-3 text-xs text-signal-warn">{lpError}</p>}
          </section>

          <section className="ec-card overflow-x-auto" data-testid="local-launches">
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-fg-primary">Launched from this browser (local record)</h2>
              <p className="text-xs text-fg-muted">
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
            Wallet activity for the connected wallet, recorded locally in this browser and unverified. Each entry links to its transaction so you can check
            it on the explorer; swaps made elsewhere do not appear here.
          </p>
          {!wallet.publicKey && <p className="text-sm text-fg-muted">Connect a wallet to view its scoped local activity.</p>}
          {walletActs.length === 0 ? (
            <p className="text-sm text-fg-muted">No local trade / launch history yet.</p>
          ) : (
            walletActs.map((a) => (
              <div key={a.id} className="ec-card flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <span className="capitalize text-fg-primary">{a.kind}</span>
                  {a.amount && <span className="ml-2 font-mono text-fg-muted">{a.amount}</span>}
                  <div className="font-mono text-xs text-fg-muted">
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

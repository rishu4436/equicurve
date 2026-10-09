"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { TradePanel } from "@/components/TradePanel";
import { DammTicket } from "@/components/offering/DammTicket";
import { FeeClaimsCard } from "@/components/issuer/FeeClaimsCard";
import { EligibilityGate, useEligibilityGate } from "@/components/gate/EligibilityGate";
import { PriceHistoryChart } from "@/components/offering/PriceHistoryChart";
import { GraduationCard } from "@/components/offering/GraduationCard";
import { presetPriceMultiple } from "@/lib/dbc/presets";
import { IssuerFaq } from "@/components/issuer/IssuerAnswers";
import { MetadataEditor } from "@/components/offering/MetadataEditor";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  GraduationStatusCard,
  useDammDestination,
  useGraduationView,
} from "@/components/offering/GraduationStatus";
import { chainStatusFromCurve } from "@/lib/dbc/curveState";
import { migrationConfigForSnapshot } from "@/lib/dbc/migrate";
import { PoolNotFoundError } from "@/lib/dbc/poolAccount";
import { formatAtomsExact } from "@/lib/amounts";
import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM,
  explorerAddressUrl,
  explorerTxUrl,
  getCluster,
  quoteLabelForMint,
} from "@/lib/constants";
import { fetchPoolSnapshot } from "@/lib/dbc/migrate";
import type { PoolSnapshot } from "@/lib/dbc/types";
import type { DesignedMarket } from "@/lib/market/types";
import type { DemoOffering } from "@/lib/demo/offerings";
import {
  getLaunch,
  listActivity,
  type StoredActivity,
  type StoredLaunch,
} from "@/lib/local/launches";
import { formatTokenSupply, tokenAccountDistribution } from "@/lib/holders";
import { withReadConnection } from "@/lib/connection";
import { formatMarketTimestamp, formatPermanentLock, formatProgressRatio, marketLifecycle } from "@/lib/marketDisplay";

const TABS = [
  "Overview",
  "Disclosures",
  "Holders",
  "Activity",
  "On-chain",
] as const;

type TabId = (typeof TABS)[number];

type Props = {
  id: string;
  demo?: DemoOffering;
};

type HolderHint = {
  supplyAtoms: string | null;
  decimals: number | null;
  creatorAta: string | null;
  creatorBalanceAtoms: string | null;
  largest: { address: string; amountAtoms: string }[];
  loading: boolean;
  partial: boolean;
  error: string | null;
};

type RpcActivity = {
  signature: string;
  slot: number;
  blockTime: number | null;
};

function short(a: string, n = 4) {
  return a.length > 12 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function OfferingDetailClient({ id, demo }: Props) {
  const { connection } = useConnection();
  const [tab, setTab] = useState<TabId>("Overview");
  const [launch, setLaunch] = useState<StoredLaunch | null>(null);
  const [activity, setActivity] = useState<StoredActivity[]>([]);
  const [rpcActivity, setRpcActivity] = useState<RpcActivity[]>([]);
  const [rpcActivityError, setRpcActivityError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [snapReadFailed, setSnapReadFailed] = useState(false);
  const [snapCheckedAt, setSnapCheckedAt] = useState<string | null>(null);
  const [holders, setHolders] = useState<HolderHint>({
    supplyAtoms: null,
    decimals: null,
    creatorAta: null,
    creatorBalanceAtoms: null,
    largest: [],
    loading: false,
    partial: false,
    error: null,
  });
  const [historyNonce, setHistoryNonce] = useState(0);
  const eligibility = useEligibilityGate();

  const illustrative = !!(demo?.illustrative || (demo && !demo.pool && !launch));

  const poolAddress = useMemo(() => {
    if (launch?.pool) return launch.pool;
    if (demo?.pool) return demo.pool;
    if (id.length >= 32 && !demo) return id;
    return null;
  }, [launch, demo, id]);

  useEffect(() => {
    setLaunch(getLaunch(id) ?? null);
    setActivity(
      listActivity(getLaunch(id)?.pool ?? (id.length >= 32 ? id : undefined)),
    );
  }, [id, historyNonce]);

  const refreshSnap = useCallback(async () => {
    if (!poolAddress) {
      setSnapshot(null);
      return;
    }
    try {
      setSnapError(null);
      const s = await withReadConnection(connection, (readConnection) =>
        fetchPoolSnapshot(readConnection, new PublicKey(poolAddress)),
      );
      setSnapshot(s);
      setSnapReadFailed(false);
      setSnapCheckedAt(s.checkedAt);
    } catch (e) {
      setSnapError(
        (e instanceof PoolNotFoundError ? "Pool not found on this cluster: " : "RPC unavailable — state unknown: ") +
          (e instanceof Error ? e.message : "Pool fetch failed"),
      );
      setSnapshot(null);
      setSnapReadFailed(true);
      setSnapCheckedAt(new Date().toISOString());
    }
  }, [connection, poolAddress]);

  useEffect(() => {
    void refreshSnap();
  }, [refreshSnap, historyNonce]);

  useEffect(() => {
    let cancelled = false;
    async function loadRpcActivity() {
      if (!poolAddress) {
        setRpcActivity([]);
        return;
      }
      try {
        setRpcActivityError(null);
        const sigs = await withReadConnection(connection, (readConnection) =>
          readConnection.getSignaturesForAddress(new PublicKey(poolAddress), { limit: 15 }),
        );
        if (!cancelled) {
          setRpcActivity(
            sigs.map((s) => ({
              signature: s.signature,
              slot: s.slot,
              blockTime: s.blockTime ?? null,
            })),
          );
        }
      } catch (e) {
        if (!cancelled) {
          setRpcActivity([]);
          setRpcActivityError(
            e instanceof Error ? e.message : "Signature fetch failed",
          );
        }
      }
    }
    void loadRpcActivity();
    return () => {
      cancelled = true;
    };
  }, [connection, poolAddress, historyNonce]);


  useEffect(() => {
    let cancelled = false;
    async function loadHolders() {
      const mintStr = snapshot?.baseMint ?? launch?.mint ?? demo?.mint;
      const creatorStr = snapshot?.creator ?? launch?.creator;
      if (!mintStr) {
        setHolders({
          supplyAtoms: null,
          decimals: null,
          creatorAta: null,
          creatorBalanceAtoms: null,
          largest: [],
          loading: false,
          partial: false,
          error: null,
        });
        return;
      }
      setHolders((current) => ({ ...current, loading: true, error: null }));
      try {
        const query = creatorStr ? `?creator=${encodeURIComponent(creatorStr)}` : "";
        const response = await fetch(`/api/markets/${encodeURIComponent(mintStr)}/holders${query}`, {
          headers: { Accept: "application/json" },
        });
        const body = (await response.json()) as {
          ok?: boolean;
          supplyAtoms?: string | null;
          decimals?: number | null;
          creatorAta?: string | null;
          creatorBalanceAtoms?: string | null;
          largest?: { address: string; amountAtoms: string }[];
          partial?: boolean;
          error?: string | null;
        };
        if (!response.ok || !body.ok || body.supplyAtoms == null || body.decimals == null) {
          throw new Error(body.error ?? "Holder distribution unavailable");
        }
        if (!cancelled) {
          setHolders({
            supplyAtoms: body.supplyAtoms,
            decimals: body.decimals,
            creatorAta: body.creatorAta ?? null,
            creatorBalanceAtoms: body.creatorBalanceAtoms ?? null,
            largest: body.largest ?? [],
            loading: false,
            partial: body.partial ?? false,
            error: body.error ?? null,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setHolders({
            supplyAtoms: null,
            decimals: null,
            creatorAta: null,
            creatorBalanceAtoms: null,
            largest: [],
            loading: false,
            partial: false,
            error: e instanceof Error ? e.message : "Holder fetch failed",
          });
        }
      }
    }
    void loadHolders();
    return () => {
      cancelled = true;
    };
  }, [connection, snapshot, launch, demo, historyNonce]);

  const name = launch?.name ?? demo?.name ?? "Live DBC pool";
  const ticker = launch?.ticker ?? demo?.ticker ?? "POOL";
  const thesis =
    launch?.thesis ??
    demo?.thesis ??
    "On-chain pool opened via EquiCurve Create. Trade on-curve; graduate to DAMM v2 when ready.";
  const sector = launch?.sector ?? demo?.sector ?? "Other";
  const quote = snapshot?.quoteMint
    ? quoteLabelForMint(snapshot.quoteMint)
    : launch?.quote ?? demo?.quote ?? "SOL";
  const lockPct = snapshot?.lockPct ?? launch?.lockPct ?? demo?.lockPct ?? 10;
  const holderRows = holders.supplyAtoms != null && holders.decimals != null
    ? tokenAccountDistribution({
        supplyAtoms: holders.supplyAtoms,
        decimals: holders.decimals,
        creatorAta: holders.creatorAta,
        accounts: holders.largest,
      })
    : [];
  const holderSupply = holders.supplyAtoms != null && holders.decimals != null
    ? formatTokenSupply(holders.supplyAtoms, holders.decimals, ticker)
    : null;
  const creatorBalance = holders.creatorBalanceAtoms != null && holders.decimals != null
    ? `${formatAtomsExact(holders.creatorBalanceAtoms, holders.decimals)} ${ticker}`
    : null;
  const presetId = launch?.presetId ?? demo?.presetId ?? "short";
  const raiseTarget = launch?.raiseTarget ?? demo?.raiseTarget ?? 0;
  const raisedDemo = demo?.raised ?? 0;
  const mintRetained = launch?.mintRenounce === false;

  // Live pools: progress only from the authoritative on-chain read; null = unknown.
  const progressPct: number | null = snapshot
    ? snapshot.quoteProgress == null
      ? null
      : snapshot.quoteProgress * 100
    : illustrative && raiseTarget > 0
      ? (raisedDemo / raiseTarget) * 100
      : null;

  const destination = useDammDestination(snapshot);
  const gradView = useGraduationView({
    snapshot,
    readFailed: snapReadFailed || (!snapshot && !illustrative),
    destination,
  });
  const curvePhase = snapshot?.curve.phase ?? "unknown";
  // Status comes from chain when read; otherwise it is explicitly unverified.
  const status: string = snapshot
    ? chainStatusFromCurve(snapshot.curve, snapshot.quoteReserve)
    : illustrative
      ? (demo?.status ?? "raising")
      : poolAddress
        ? "unknown"
        : (launch?.status ?? demo?.status ?? "unknown");
  const statusUnverified = !snapshot && !illustrative;
  const migratedOnChain = curvePhase === "migrated";
  const dammLive = migratedOnChain && destination === "exists";
  const lifecycle = marketLifecycle(curvePhase, destination);

  const mint = snapshot?.baseMint ?? launch?.mint ?? demo?.mint;
  const config = snapshot?.config ?? launch?.config;
  const migrationCfg = snapshot ? migrationConfigForSnapshot(snapshot) : null;
  const dammConfig = migrationCfg?.expectedDammConfig ?? null;

  return (
    <EligibilityGate
      requireForAction={eligibility.needGate}
      onAccepted={eligibility.onAccepted}
    >
      <div className="space-y-6">
        <p className="text-xs text-fg-muted">
          <Link href="/explore" className="hover:text-accent">
            Explore
          </Link>
          {" / "}
          <span className="text-fg-secondary">${ticker}</span>
        </p>

        {illustrative && (
          <p className="rounded-input border border-signal-warn/40 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn">
            Illustrative example — not a live pool. Trade disabled. Create a
            real offering to get on-chain markets.
          </p>
        )}

        <header className="flex flex-col gap-6 border-b border-line pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-card border border-line bg-subtle text-xl font-semibold text-accent">
              {ticker.slice(0, 2)}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-fg-primary">{name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-fg-muted">${ticker}</span>
                <span className="ec-chip">{sector}</span>
                <StatusPill status={status} unverified={statusUnverified} />
                {illustrative && (
                  <span className="rounded-pill border border-signal-warn/40 bg-signal-warn/10 px-2 py-0.5 text-xs text-signal-warn">
                    Illustrative · not live
                  </span>
                )}
                {mintRetained && (
                  <span className="rounded-pill border border-signal-warn/40 bg-signal-warn/10 px-2 py-0.5 text-xs text-signal-warn">
                    Mint retained
                  </span>
                )}
                <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-xs text-fg-secondary">
                   {formatPermanentLock(lockPct)}
                </span>
                <span className="ec-chip">Quote: {quote}</span>
                <span className="ec-chip">Active venue: {lifecycle.activeVenue}</span>
              </div>
              {(mint || poolAddress) && (
                <p className="mt-2 font-mono text-xs text-fg-muted">
                  {mint ? (
                    <>
                      Mint:{" "}
                      <a
                        href={explorerAddressUrl(mint)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {short(mint)}
                      </a>
                    </>
                  ) : null}
                  {mint && poolAddress ? " · " : null}
                  {poolAddress ? (
                    <>
                      Pool:{" "}
                      <a
                        href={explorerAddressUrl(poolAddress)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent hover:underline"
                      >
                        {short(poolAddress)}
                      </a>
                    </>
                  ) : null}
                </p>
              )}
            </div>
          </div>
          {!migratedOnChain && (
            <div className="flex flex-col items-center gap-1">
              {progressPct == null ? (
                <div className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-2 border-line font-mono text-xs text-fg-muted">
                  unknown
                </div>
              ) : (
                <ProgressRing value={progressPct} size={72} />
              )}
              <span className="text-xs text-fg-muted">
                {snapshot
                  ? "On-chain quote progress"
                  : illustrative
                    ? "Example raise %"
                    : snapReadFailed
                      ? "Unknown — RPC read failed"
                      : "Reading pool…"}
              </span>
            </div>
          )}
          {migratedOnChain && (
            <div className="text-right text-sm text-signal-grad">
              {dammLive ? "DAMM v2 live · pool verified" : "Migrated on DBC"}
              <div className="text-xs text-fg-muted">
                {dammLive
                  ? "Curve → graduated liquidity"
                  : destination === "checking" || destination === "unchecked"
                    ? "Verifying DAMM v2 pool account…"
                    : "DAMM v2 pool account not verified yet"}
              </div>
            </div>
          )}
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="min-w-0 space-y-5">
            <div className="ec-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-fg-primary">Market / curve</h2>
                {poolAddress && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryNonce((n) => n + 1);
                    }}
                    className="text-xs text-accent hover:underline"
                  >
                    Refresh
                  </button>
                )}
              </div>
              <PriceHistoryChart
                key={`${poolAddress ?? "none"}-${historyNonce}`}
                poolAddress={poolAddress}
                quoteLabel={quote}
                progress={progressPct == null ? null : progressPct / 100}
                illustrative={illustrative}
                priceMultiple={presetPriceMultiple(presetId, quote === "USDC" ? "USDC" : "SOL")}
                historicalOnly={lifecycle.activeVenue === "DAMM v2"}
              />
              <div className="mt-4 flex items-center gap-4 border-t border-line pt-4">
                <div className="space-y-1 text-sm text-fg-secondary">
                  <p>
                    Quote progress{" "}
                    <span className="font-mono text-fg-primary">
                      {formatProgressRatio(snapshot?.quoteProgress ?? null)}
                    </span>
                  </p>
                  {snapshot && (
                    <p>
                      Base progress{" "}
                      <span className="font-mono text-fg-primary">
                        {snapshot.baseProgress == null
                          ? "unknown"
                          : formatProgressRatio(snapshot.baseProgress)}
                      </span>
                    </p>
                  )}
                  {raiseTarget > 0 && !snapshot && illustrative && (
                    <p>
                      Example raised ${raisedDemo.toLocaleString("en-US")} / $
                      {raiseTarget.toLocaleString("en-US")}
                    </p>
                  )}
                  <p className="text-xs text-fg-muted">
                    Graduates → DAMM v2 at migration threshold
                  </p>
                  {snapError && (
                    <p className="text-xs text-signal-warn">{snapError}</p>
                  )}
                  {poolAddress && !illustrative && (
                    <p className="text-xs text-fg-muted">
                      {getCluster()} · last checked{" "}
                      {snapCheckedAt ? formatMarketTimestamp(snapCheckedAt, false) : "never"}
                    </p>
                  )}
                </div>
              </div>
              {poolAddress && !illustrative && (
                <div className="mt-4 space-y-3">
                  <GraduationCard
                    snapshot={snapshot}
                    readFailed={snapReadFailed}
                    destination={destination}
                    quoteLabel={quote}
                  />
                  <GraduationStatusCard view={gradView} snapshot={snapshot} compact />
                </div>
              )}
              {poolAddress &&
                !illustrative &&
                (gradView.state === "eligible" ||
                  gradView.state === "confirmed" ||
                  gradView.state === "failed") && (
                  <Link
                    href={`/o/${poolAddress}/graduate`}
                    className="ec-btn-primary mt-4 inline-flex"
                  >
                    {gradView.state === "eligible"
                      ? "Open graduation ceremony"
                      : "View graduation status"}
                  </Link>
                )}
            </div>

            <div className="ec-card overflow-hidden">
              <div className="flex gap-1 overflow-x-auto border-b border-line p-2" role="group" aria-label="Market information">
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    aria-pressed={tab === t}
                    className={clsx(
                      "min-h-11 whitespace-nowrap rounded-lg px-4 py-2 text-sm transition-colors",
                      tab === t
                        ? "bg-accent/15 text-accent"
                        : "text-fg-secondary hover:text-fg-primary",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="p-5 text-sm text-fg-secondary">
                {tab === "Overview" && (
                  <div className="space-y-3">
                    <p>{thesis}</p>
                    <dl className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <dt className="text-fg-muted">Preset</dt>
                        <dd className="capitalize text-fg-primary">{presetId}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">LP lock</dt>
                        <dd className="text-fg-primary">{formatPermanentLock(lockPct)}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Quote</dt>
                        <dd className="text-fg-primary">{quote}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Issuer-stated raise target</dt>
                        <dd className="font-mono text-fg-primary">
                          {raiseTarget ? `${raiseTarget.toLocaleString("en-US")} (display only)` : "—"}
                        </dd>
                      </div>
                    </dl>
                    <p className="rounded-input border border-signal-warn/30 bg-signal-warn/5 px-3 py-2 text-xs text-signal-warn">
                      Bonding price is discovery, not NAV / fair value. The token does not by itself grant shareholder
                      rights; any equity or asset link depends on the issuer&apos;s own legal framework.
                    </p>
                    {!illustrative && <DesignedVsActual designed={launch?.designed} snapshot={snapshot} quote={quote} />}
                    <IssuerFaq
                      lockPct={snapshot?.lockPct ?? null}
                      creatorPct={snapshot?.creatorFeePct ?? null}
                    />
                    <p className="text-xs text-fg-muted">
                      {snapshot?.lockPct != null
                        ? "Lock and fee split above are read from this pool's on-chain config."
                        : "Pool config not read: lock and fee split shown generically."}
                    </p>
                    {poolAddress && mint && !illustrative && (
                      <MetadataEditor pool={poolAddress} mint={mint} creator={snapshot?.creator ?? null} />
                    )}
                  </div>
                )}

                {tab === "Disclosures" && (
                  <div className="space-y-3">
                    <p className="font-medium text-fg-primary">Risk factors</p>
                    <ul className="list-disc space-y-1 pl-5 text-xs">
                      <li>Smart-contract and RPC dependency risk.</li>
                      <li>
                        Bonding-curve price is discovery mechanics — not a NAV
                        or appraisal.
                      </li>
                      <li>
                        Transfer profile is set at Create time (Open SPL, Token-2022, or
                        transfer-hook when NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM is configured).
                      </li>
                      <li>
                        No separate migration fee in EquiCurve configs; the DAMM v2 pool charges its own trading fee
                        after migration. {formatPermanentLock(lockPct)}.
                      </li>
                    </ul>
                    <p className="pt-2 font-medium text-fg-primary">
                      Issuer attestation (local)
                    </p>
                    <ul className="space-y-2 text-xs">
                      {(
                        [
                          ["Issuer identity summary", launch?.attestations?.issuer],
                          ["Risk disclosure", launch?.attestations?.risk],
                          ["Offering memo", launch?.attestations?.memo],
                          ["Legal / terms (optional)", launch?.attestations?.legal],
                        ] as const
                      ).map(([d, ok]) => (
                        <li
                          key={d}
                          className="flex items-center justify-between rounded-input border border-line bg-subtle px-3 py-2"
                        >
                          <span>{d}</span>
                          <span className="text-fg-muted">
                            {launch
                              ? ok
                                ? "Issuer self-attested (unverified)"
                                : "Not attested"
                              : illustrative
                                ? "Example only"
                                : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-fg-muted">
                      No PDF upload vault — attestations live in browser
                      localStorage from Create.
                    </p>
                  </div>
                )}

                {tab === "Holders" && (
                  <div className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-fg-primary">Holders / token accounts</h3>
                      <p className="mt-1 text-xs text-fg-muted">
                        Verified RPC token-account distribution. Token accounts are not assumed to be unique people.
                        The RPC returns only the largest accounts, so this view is intentionally marked partial.
                      </p>
                    </div>
                    {!mint && (
                      <div className="rounded-input border border-line bg-subtle px-3 py-4 text-xs text-fg-muted">
                        {illustrative
                          ? "Illustrative offering has no mint. Launch via Create for live holder hints."
                          : "Open a live pool address for mint supply."}
                      </div>
                    )}
                    {mint && (
                      <dl className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-input border border-line bg-subtle p-3"><dt className="text-xs text-fg-muted">Total supply</dt><dd className="mt-1 font-mono text-sm text-fg-primary">{holderSupply ?? "Unknown"}</dd></div>
                        <div className="rounded-input border border-line bg-subtle p-3"><dt className="text-xs text-fg-muted">Known top accounts</dt><dd className="mt-1 font-mono text-sm text-fg-primary">{holders.loading ? "Loading…" : holderRows.length ? `${holderRows.length} (partial)` : "Unknown"}</dd></div>
                        <div className="rounded-input border border-line bg-subtle p-3"><dt className="text-xs text-fg-muted">Creator balance</dt><dd className="mt-1 font-mono text-sm text-fg-primary">{creatorBalance ?? "Unknown"}</dd></div>
                      </dl>
                    )}
                    {holderRows.length > 0 && (
                      <div className="overflow-x-auto rounded-input border border-line">
                        <table className="w-full min-w-[520px] text-left text-xs"><thead className="border-b border-line text-fg-muted"><tr><th className="px-3 py-2"># / token account</th><th className="px-3 py-2">Role</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2 text-right">Supply</th></tr></thead><tbody>{holderRows.map((row, index) => <tr key={row.address} className="border-b border-line/60"><td className="px-3 py-2 font-mono"><span className="mr-2 text-fg-muted">{index + 1}</span><a href={explorerAddressUrl(row.address)} target="_blank" rel="noreferrer" className="text-accent hover:underline">{short(row.address, 6)}</a></td><td className="px-3 py-2 text-fg-muted">{row.role}</td><td className="px-3 py-2 text-right font-mono">{row.balance} {ticker}</td><td className="px-3 py-2 text-right font-mono">{row.supplyPct}</td></tr>)}</tbody></table>
                      </div>
                    )}
                    {holders.partial && <p className="text-xs text-signal-warn">Supply is verified, but the largest-account list is unavailable from the current RPC.</p>}
                    {holders.error && (
                      <p className="text-xs text-signal-warn">Holder distribution unavailable — RPC data is degraded: {holders.error}</p>
                    )}
                  </div>
                )}

                {tab === "Activity" && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-fg-primary">
                        Pool signatures (RPC)
                      </p>
                      {rpcActivityError && (
                        <p className="text-xs text-signal-warn">{rpcActivityError}</p>
                      )}
                      {rpcActivity.length === 0 && !rpcActivityError ? (
                        <p className="text-xs text-fg-muted">
                          {poolAddress
                            ? "No recent signatures for this pool on the current RPC."
                            : "Open a live pool to fetch signatures."}
                        </p>
                      ) : (
                        rpcActivity.map((row) => (
                          <div
                            key={row.signature}
                            className="flex items-center justify-between gap-3 rounded-input border border-line bg-subtle px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="font-mono text-fg-primary">
                                {short(row.signature, 6)}
                              </span>
                              <div className="text-xs text-fg-muted">
                                {row.blockTime
                                  ? formatMarketTimestamp(row.blockTime * 1000)
                                  : `slot ${row.slot}`}
                              </div>
                            </div>
                            <a
                              href={explorerTxUrl(row.signature)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:underline"
                            >
                              Explorer
                            </a>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-fg-primary">
                        Local (this browser)
                      </p>
                      {activity.length === 0 ? (
                        <p className="text-xs text-fg-muted">
                          No local swaps/launches stored yet.
                        </p>
                      ) : (
                        activity.map((a) => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between gap-3 rounded-input border border-line bg-subtle px-3 py-2 text-xs"
                          >
                            <div>
                              <span className="capitalize text-fg-primary">
                                {a.kind}
                              </span>
                              {a.amount ? (
                                <span className="ml-2 font-mono text-fg-muted">
                                  {a.amount}
                                </span>
                              ) : null}
                              <div className="text-xs text-fg-muted">
                                {formatMarketTimestamp(a.at)}
                              </div>
                            </div>
                            <a
                              href={explorerTxUrl(a.sig)}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-accent hover:underline"
                            >
                              {short(a.sig, 6)}
                            </a>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {tab === "On-chain" && (
                  <dl className="space-y-3 font-mono text-xs">
                    {[
                      { label: "Pool", value: poolAddress },
                      { label: "Config", value: config },
                      { label: "Mint", value: mint },
                      {
                        label: "Migration status",
                        value: `${gradView.label}${
                          snapshot?.quoteProgress != null && !migratedOnChain
                            ? ` · ${(snapshot.quoteProgress * 100).toFixed(2)}% to threshold`
                            : ""
                        }`,
                        link: false,
                      },
                      {
                        label: "DAMM v2 config (migrationFeeOption)",
                        value: dammConfig ?? (migrationCfg && !migrationCfg.ok ? migrationCfg.reason : "unknown"),
                        link: !!dammConfig,
                      },
                      {
                        label: "DAMM pool (post)",
                        value: dammLive
                          ? (launch?.dammPool ?? "verified (see DAMM ticket)")
                          : migratedOnChain
                            ? "Not verified yet"
                            : "Pending migration",
                        link: dammLive && !!launch?.dammPool,
                      },
                      {
                        label: "DBC program",
                        value: DBC_PROGRAM_ID.toBase58(),
                      },
                      {
                        label: "DAMM v2 program",
                        value: DAMM_V2_PROGRAM.toBase58(),
                      },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4"
                      >
                        <dt className="text-fg-muted">{row.label}</dt>
                        <dd className="break-all text-fg-primary">
                          {row.value &&
                          row.link !== false &&
                          row.value.length >= 32 ? (
                            <a
                              href={explorerAddressUrl(row.value)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:underline"
                            >
                              {row.value}
                            </a>
                          ) : (
                            row.value ?? "—"
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            
            {migratedOnChain && poolAddress && snapshot?.baseMint && snapshot.quoteMint ? (
              <DammTicket
                dbcPool={poolAddress}
                baseMint={snapshot.baseMint}
                quoteMint={snapshot.quoteMint}
                storedDammPool={launch?.dammPool}
                dammConfig={dammConfig}
                onGateRequired={() => eligibility.ensure()}
                gateOk={eligibility.ok || undefined}
                lockPct={snapshot.lockPct}
                onMarketChanged={() => setHistoryNonce((n) => n + 1)}
              />
            ) : null}

            {migratedOnChain && !(poolAddress && snapshot?.baseMint && snapshot.quoteMint) ? (
              <div className="ec-card space-y-3 border-signal-grad/30 p-5 text-sm">
                <h2 className="font-semibold text-signal-grad">
                  Migrated on DBC
                </h2>
                <p className="text-fg-secondary">
                  Base / quote mint could not be read, so the DAMM v2 ticket cannot
                  load yet.
                </p>
              </div>
            ) : null}

            {poolAddress && curvePhase === "raising" ? (
              <TradePanel
                poolAddress={poolAddress}
                compact
                onGateRequired={() => eligibility.ensure()}
                gateOk={eligibility.ok || undefined}
                onSwapComplete={() => setHistoryNonce((n) => n + 1)}
              />
            ) : poolAddress && curvePhase === "complete" ? (
              <div className="ec-card space-y-3 border-gold/30 p-5 text-sm">
                <h2 className="font-semibold text-gold">Curve complete</h2>
                <p className="text-fg-secondary">DBC execution is closed. This market is eligible or preparing to migrate; DAMM v2 becomes the active venue only after its pool is verified.</p>
                <GraduationStatusCard view={gradView} snapshot={snapshot} />
              </div>
            ) : !poolAddress || illustrative ? (
              <div className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
                <h2 className="font-semibold text-fg-primary">Trade ticket</h2>
                <p>
                  {illustrative
                    ? "Illustrative offering — not a live pool. Launch via Create to enable on-curve swaps."
                    : "Open Trade with a live pool pubkey to enable on-curve swaps."}
                </p>
                <Link href="/create" className="ec-btn-primary inline-flex">
                  Create offering
                </Link>
                <Link href="/trade" className="ec-btn-secondary inline-flex">
                  Open Trade
                </Link>
              </div>
            ) : null}
            
            {poolAddress && !illustrative && (
              <FeeClaimsCard
                pool={poolAddress}
                quote={quote === "USDC" ? "USDC" : "SOL"}
              />
            )}
            <div className="ec-card p-4 text-xs text-fg-muted">
              <p className="mb-1 font-medium text-fg-secondary">Trust mini-strip</p>
              <p>
                {formatPermanentLock(lockPct)} · Issuer disclosures are self-attested (not verified) · Program IDs →{" "}
                <Link href="/trust" className="text-accent hover:underline">
                  Trust Center
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </EligibilityGate>
  );
}

function DesignedVsActual({
  designed,
  snapshot,
  quote,
}: {
  designed: DesignedMarket | undefined;
  snapshot: PoolSnapshot | null;
  quote: string;
}) {
  if (!designed) {
    return (
      <p className="text-xs text-fg-muted">
        No market design was stored with this pool, so there is no designed-versus-actual record.
      </p>
    );
  }
  const decimals = snapshot?.quoteDecimals ?? null;
  const chainThreshold = snapshot?.migrationQuoteThreshold ?? null;
  const chainProgress = snapshot?.quoteProgress ?? null;
  if (!snapshot || (chainThreshold == null && chainProgress == null)) {
    return (
      <div className="rounded-input border border-line bg-subtle px-3 py-2 text-xs text-fg-muted">
        <p className="font-medium text-fg-secondary">Designed versus actual</p>
        <p>
          No observed record yet. A chain read has not returned this pool&apos;s migration threshold or quote progress.
        </p>
      </div>
    );
  }
  const thresholdText = (atoms: string) =>
    decimals != null ? `${formatAtomsExact(atoms, decimals)} ${quote}` : `${atoms} atoms (quote decimals unknown)`;
  let thresholdDelta = "unknown";
  if (chainThreshold != null) {
    try {
      const delta = BigInt(chainThreshold) - BigInt(designed.thresholdAtoms);
      const abs = delta < 0n ? -delta : delta;
      const sign = delta > 0n ? "+" : delta < 0n ? "−" : "";
      thresholdDelta = decimals != null ? `${sign}${formatAtomsExact(abs.toString(), decimals)} ${quote}` : `${sign}${abs.toString()} atoms`;
    } catch {
      thresholdDelta = "unreadable";
    }
  }
  return (
    <div className="rounded-input border border-line bg-subtle px-3 py-2 text-xs text-fg-secondary">
      <p className="font-medium text-fg-primary">Designed versus actual</p>
      <p className="mt-1 text-fg-muted">
        Policy {designed.policyId}. Synthetic retail progress and cohort graduation are simulator output. Chain figures
        come from the latest pool read.
      </p>
      <dl className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Graduation threshold</dt>
          <dd>
            Designed {thresholdText(designed.thresholdAtoms)}
            {chainThreshold != null ? ` · chain ${thresholdText(chainThreshold)} · difference ${thresholdDelta}` : " · chain threshold unknown"}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Progress</dt>
          <dd>
            Synthetic retail sample {Math.round(designed.retailProgress * 1000) / 10}%
            {chainProgress != null
              ? ` · chain quote progress ${Math.round(chainProgress * 1000) / 10}%`
              : " · chain progress unknown"}
            . The retail sample is not a forecast.
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Whale impact and slippage</dt>
          <dd>
            Designed whale impact was {designed.whaleImpactBps} bps in the simulator. No chain read of realized whale
            impact or slippage is available, so those are not compared.
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Graduation</dt>
          <dd>
            Chain phase: {snapshot.curve.phase}
            {snapshot.isMigrated ? " · migrated" : ""}. Cohort paths reached graduation in{" "}
            {Math.round(designed.stressGraduationRate * 1000) / 10}% of {designed.stressPaths} synthetic paths. That rate
            is a simulated frequency, not this pool&apos;s result.
            {typeof designed.stressP10Progress === "number" && typeof designed.stressWorstProgress === "number"
              ? ` 10th percentile progress ${Math.round(designed.stressP10Progress * 1000) / 10}%, worst path ${Math.round(designed.stressWorstProgress * 1000) / 10}%.`
              : ""}
          </dd>
        </div>
      </dl>
    </div>
  );
}

"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";
import { TradePanel } from "@/components/TradePanel";
import { EligibilityGate, useEligibilityGate } from "@/components/gate/EligibilityGate";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM,
  explorerAddressUrl,
  explorerTxUrl,
  getDammV2ConfigKey,
  quoteLabelForMint,
} from "@/lib/constants";
import { fetchPoolSnapshot } from "@/lib/dbc/migrate";
import type { PoolSnapshot } from "@/lib/dbc/types";
import type { DemoOffering } from "@/lib/demo/offerings";
import {
  getLaunch,
  listActivity,
  type StoredActivity,
  type StoredLaunch,
} from "@/lib/local/launches";

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
  supply: string | null;
  creatorAta: string | null;
  creatorBalance: string | null;
  largest: { address: string; amount: string }[];
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

/** Simple SVG progress chart from quote progress (0–1). Labeled as progress path. */
function ProgressChart({ progress }: { progress: number }) {
  const p = Math.min(1, Math.max(0, progress));
  const w = 320;
  const h = 120;
  const pts: string[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const eased = Math.pow(t, 0.85) * p;
    const x = 20 + t * (w - 40);
    const y = h - 20 - eased * (h - 40);
    pts.push(`${x},${y}`);
  }
  const nowX = 20 + p * (w - 40);
  const nowY = h - 20 - p * (h - 40);

  return (
    <div className="space-y-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-28 w-full" aria-hidden>
        <path d={`M20 ${h - 20} H${w - 20}`} stroke="#243044" />
        <path d={`M20 20 V${h - 20}`} stroke="#243044" />
        <polyline
          points={pts.join(" ")}
          fill="none"
          stroke="#2DD4BF"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={nowX} cy={nowY} r="4" fill="#E8C547" />
        <text x="22" y="16" fill="#6B7A8F" fontSize="10">
          Approx. bonding path
        </text>
        <text x={w - 70} y="16" fill="#A78BFA" fontSize="10">
          {(p * 100).toFixed(1)}%
        </text>
      </svg>
      <p className="text-[10px] text-fg-muted">
        Approximate path from on-chain quote progress + bonding-curve shape — not a historical price series or oracle.
      </p>
    </div>
  );
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
  const [holders, setHolders] = useState<HolderHint>({
    supply: null,
    creatorAta: null,
    creatorBalance: null,
    largest: [],
    error: null,
  });
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
  }, [id]);

  const refreshSnap = useCallback(async () => {
    if (!poolAddress) {
      setSnapshot(null);
      return;
    }
    try {
      setSnapError(null);
      const s = await fetchPoolSnapshot(
        connection,
        new PublicKey(poolAddress),
      );
      setSnapshot(s);
    } catch (e) {
      setSnapError(e instanceof Error ? e.message : "Pool fetch failed");
      setSnapshot(null);
    }
  }, [connection, poolAddress]);

  useEffect(() => {
    void refreshSnap();
  }, [refreshSnap]);

  useEffect(() => {
    let cancelled = false;
    async function loadRpcActivity() {
      if (!poolAddress) {
        setRpcActivity([]);
        return;
      }
      try {
        setRpcActivityError(null);
        const sigs = await connection.getSignaturesForAddress(
          new PublicKey(poolAddress),
          { limit: 15 },
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
  }, [connection, poolAddress]);


  useEffect(() => {
    let cancelled = false;
    async function loadHolders() {
      const mintStr = snapshot?.baseMint ?? launch?.mint ?? demo?.mint;
      const creatorStr = snapshot?.creator ?? launch?.creator;
      if (!mintStr) {
        setHolders({
          supply: null,
          creatorAta: null,
          creatorBalance: null,
          largest: [],
          error: null,
        });
        return;
      }
      try {
        const mint = new PublicKey(mintStr);
        const supply = await connection.getTokenSupply(mint);
        let creatorAta: string | null = null;
        let creatorBalance: string | null = null;
        if (creatorStr) {
          const ata = getAssociatedTokenAddressSync(
            mint,
            new PublicKey(creatorStr),
          );
          creatorAta = ata.toBase58();
          try {
            const bal = await connection.getTokenAccountBalance(ata);
            creatorBalance = `${bal.value.uiAmountString ?? "0"} (${bal.value.amount} raw)`;
          } catch {
            creatorBalance = "0 (no ATA yet)";
          }
        }
        let largest: { address: string; amount: string }[] = [];
        try {
          const big = await connection.getTokenLargestAccounts(mint);
          largest = big.value.slice(0, 8).map((v) => ({
            address: v.address.toBase58(),
            amount: v.uiAmountString ?? v.amount,
          }));
        } catch {
          /* optional — some RPCs rate-limit this */
        }
        if (!cancelled) {
          setHolders({
            supply: `${supply.value.uiAmountString ?? supply.value.amount} (decimals ${supply.value.decimals})`,
            creatorAta,
            creatorBalance,
            largest,
            error: null,
          });
        }
      } catch (e) {
        if (!cancelled) {
          setHolders({
            supply: null,
            creatorAta: null,
            creatorBalance: null,
            largest: [],
            error: e instanceof Error ? e.message : "Holder fetch failed",
          });
        }
      }
    }
    void loadHolders();
    return () => {
      cancelled = true;
    };
  }, [connection, snapshot, launch, demo]);

  const name = launch?.name ?? demo?.name ?? "Live DBC pool";
  const ticker = launch?.ticker ?? demo?.ticker ?? "POOL";
  const thesis =
    launch?.thesis ??
    demo?.thesis ??
    "On-chain pool opened via EquiCurve Create. Trade on-curve; graduate to DAMM v2 when ready.";
  const sector = launch?.sector ?? demo?.sector ?? "Other";
  const quote = snapshot
    ? quoteLabelForMint(snapshot.quoteMint)
    : launch?.quote ?? demo?.quote ?? "SOL";
  const lockPct = launch?.lockPct ?? demo?.lockPct ?? 10;
  const presetId = launch?.presetId ?? demo?.presetId ?? "short";
  const raiseTarget = launch?.raiseTarget ?? demo?.raiseTarget ?? 0;
  const raisedDemo = demo?.raised ?? 0;
  const mintRetained = launch?.mintRenounce === false;

  const progressPct = snapshot
    ? snapshot.quoteProgress * 100
    : illustrative && raiseTarget > 0
      ? (raisedDemo / raiseTarget) * 100
      : 0;

  const status =
    snapshot?.isMigrated ||
    launch?.status === "graduated" ||
    demo?.status === "graduated"
      ? "graduated"
      : snapshot && snapshot.quoteProgress >= 0.999
        ? "complete"
        : launch?.status ?? demo?.status ?? "raising";

  const mint = snapshot?.baseMint ?? launch?.mint ?? demo?.mint;
  const config = snapshot?.config ?? launch?.config;
  const dammConfig = getDammV2ConfigKey().toBase58();

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

        <header className="ec-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-card border border-line bg-subtle text-xl font-semibold text-accent">
              {ticker.slice(0, 2)}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-fg-primary">{name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-fg-muted">${ticker}</span>
                <span className="ec-chip">{sector}</span>
                <StatusPill status={status} />
                {illustrative && (
                  <span className="rounded-pill border border-signal-warn/40 bg-signal-warn/10 px-2 py-0.5 text-[10px] text-signal-warn">
                    Illustrative · not live
                  </span>
                )}
                {mintRetained && (
                  <span className="rounded-pill border border-signal-warn/40 bg-signal-warn/10 px-2 py-0.5 text-[10px] text-signal-warn">
                    Mint retained
                  </span>
                )}
                <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-[10px] text-fg-secondary">
                  Lock ≥{lockPct}%
                </span>
                <span className="ec-chip">Quote: {quote}</span>
              </div>
              {(mint || poolAddress) && (
                <p className="mt-2 font-mono text-[11px] text-fg-muted">
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
          {status !== "graduated" && (
            <div className="flex flex-col items-center gap-1">
              <ProgressRing value={progressPct} size={72} />
              <span className="text-[10px] text-fg-muted">
                {snapshot
                  ? "On-chain quote progress"
                  : illustrative
                    ? "Example raise %"
                    : "Awaiting pool"}
              </span>
            </div>
          )}
          {status === "graduated" && (
            <div className="text-right text-sm text-signal-grad">
              DAMM v2 live
              <div className="text-xs text-fg-muted">Curve → graduated liquidity</div>
            </div>
          )}
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="ec-card p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-fg-primary">Curve progress</h2>
                {poolAddress && (
                  <button
                    type="button"
                    onClick={() => void refreshSnap()}
                    className="text-xs text-accent hover:underline"
                  >
                    Refresh
                  </button>
                )}
              </div>
              <ProgressChart progress={progressPct / 100} />
              <div className="mt-3 flex items-center gap-4">
                <ProgressRing value={progressPct} size={72} stroke={5} />
                <div className="space-y-1 text-sm text-fg-secondary">
                  <p>
                    Quote progress{" "}
                    <span className="font-mono text-fg-primary">
                      {progressPct.toFixed(2)}%
                    </span>
                  </p>
                  {snapshot && (
                    <p>
                      Base progress{" "}
                      <span className="font-mono text-fg-primary">
                        {(snapshot.baseProgress * 100).toFixed(2)}%
                      </span>
                    </p>
                  )}
                  {raiseTarget > 0 && !snapshot && illustrative && (
                    <p>
                      Example raised ${raisedDemo.toLocaleString()} / $
                      {raiseTarget.toLocaleString()}
                    </p>
                  )}
                  <p className="text-xs text-fg-muted">
                    Graduates → DAMM v2 at migration threshold
                  </p>
                  {snapError && (
                    <p className="text-xs text-signal-warn">{snapError}</p>
                  )}
                </div>
              </div>
              {(status === "complete" ||
                (snapshot &&
                  snapshot.quoteProgress >= 0.999 &&
                  !snapshot.isMigrated)) &&
                poolAddress && (
                  <Link
                    href={`/o/${poolAddress}/graduate`}
                    className="ec-btn-primary mt-4 inline-flex"
                  >
                    Open graduation ceremony
                  </Link>
                )}
            </div>

            <div className="ec-card overflow-hidden">
              <div className="flex flex-wrap gap-1 border-b border-line p-2">
                {TABS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={clsx(
                      "rounded-pill px-3 py-1.5 text-xs transition",
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
                        <dd className="text-fg-primary">≥{lockPct}%</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Quote</dt>
                        <dd className="text-fg-primary">{quote}</dd>
                      </div>
                      <div>
                        <dt className="text-fg-muted">Raise target</dt>
                        <dd className="font-mono text-fg-primary">
                          {raiseTarget
                            ? `$${raiseTarget.toLocaleString()}`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                    <p className="rounded-input border border-signal-warn/30 bg-signal-warn/5 px-3 py-2 text-xs text-signal-warn">
                      Bonding price is discovery, not NAV / fair value.
                    </p>
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
                        Migration fee ~0.2% protocol; LP lock ≥{lockPct}% post
                        DAMM v2.
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
                                ? "Attested locally"
                                : "Not attested"
                              : illustrative
                                ? "Example only"
                                : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-fg-muted">
                      No PDF upload vault — attestations live in browser
                      localStorage from Create.
                    </p>
                  </div>
                )}

                {tab === "Holders" && (
                  <div className="space-y-3">
                    <p className="text-xs text-fg-muted">
                      No top-holder indexer. Best-effort mint supply + creator
                      ATA via RPC.
                    </p>
                    {!mint && (
                      <div className="rounded-input border border-line bg-subtle px-3 py-4 text-xs text-fg-muted">
                        {illustrative
                          ? "Illustrative offering has no mint. Launch via Create for live holder hints."
                          : "Open a live pool address for mint supply."}
                      </div>
                    )}
                    {mint && (
                      <dl className="space-y-2 font-mono text-xs">
                        <div className="flex justify-between gap-4">
                          <dt className="text-fg-muted">Mint supply</dt>
                          <dd className="text-right text-fg-primary">
                            {holders.supply ?? "…"}
                          </dd>
                        </div>
                        {(snapshot?.creator || launch?.creator) && (
                          <div className="flex justify-between gap-4">
                            <dt className="text-fg-muted">Creator</dt>
                            <dd>
                              <a
                                href={explorerAddressUrl(
                                  snapshot?.creator ?? launch!.creator,
                                )}
                                className="text-accent hover:underline"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {short(
                                  snapshot?.creator ?? launch!.creator,
                                  6,
                                )}
                              </a>
                            </dd>
                          </div>
                        )}
                        {holders.creatorAta && (
                          <div className="flex justify-between gap-4">
                            <dt className="text-fg-muted">Creator ATA</dt>
                            <dd>
                              <a
                                href={explorerAddressUrl(holders.creatorAta)}
                                className="text-accent hover:underline"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {short(holders.creatorAta, 6)}
                              </a>
                            </dd>
                          </div>
                        )}
                        {holders.creatorBalance && (
                          <div className="flex justify-between gap-4">
                            <dt className="text-fg-muted">Creator balance</dt>
                            <dd className="text-right text-fg-primary">
                              {holders.creatorBalance}
                            </dd>
                          </div>
                        )}
                        {snapshot && (
                          <div className="flex justify-between gap-4">
                            <dt className="text-fg-muted">Base mint</dt>
                            <dd>
                              <a
                                href={explorerAddressUrl(snapshot.baseMint)}
                                className="text-accent hover:underline"
                                target="_blank"
                                rel="noreferrer"
                              >
                                {short(snapshot.baseMint, 6)}
                              </a>
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}
                    {holders.largest.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <p className="text-xs font-medium text-fg-primary">
                          Largest accounts (RPC)
                        </p>
                        {holders.largest.map((row) => (
                          <div
                            key={row.address}
                            className="flex items-center justify-between gap-3 rounded-input border border-line bg-subtle px-3 py-2 font-mono text-[11px]"
                          >
                            <a
                              href={explorerAddressUrl(row.address)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent hover:underline"
                            >
                              {row.address.slice(0, 4)}…{row.address.slice(-4)}
                            </a>
                            <span className="text-fg-primary">{row.amount}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {holders.error && (
                      <p className="text-xs text-signal-warn">{holders.error}</p>
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
                              <div className="text-[10px] text-fg-muted">
                                {row.blockTime
                                  ? new Date(row.blockTime * 1000).toLocaleString()
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
                              <div className="text-[10px] text-fg-muted">
                                {new Date(a.at).toLocaleString()}
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
                        value: snapshot
                          ? snapshot.isMigrated
                            ? "Migrated"
                            : `${(snapshot.quoteProgress * 100).toFixed(2)}% to threshold`
                          : "—",
                        link: false,
                      },
                      {
                        label: "DAMM v2 fee config",
                        value: dammConfig,
                      },
                      {
                        label: "DAMM pool (post)",
                        value: launch?.dammPool ?? "Pending migration",
                        link: !!launch?.dammPool,
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
            
            {status === "graduated" && (
              <div className="ec-card space-y-3 border-signal-grad/30 p-5 text-sm">
                <h2 className="font-semibold text-signal-grad">
                  Graduated — trade on DAMM v2
                </h2>
                <p className="text-fg-secondary">
                  The bonding curve ticket is inactive after migration. Liquidity
                  lives on Meteora DAMM v2.
                </p>
                <a
                  href="https://app.meteora.ag/"
                  target="_blank"
                  rel="noreferrer"
                  className="ec-btn-primary inline-flex"
                >
                  Open Meteora DAMM v2
                </a>
                {launch?.dammPool && (
                  <a
                    href={explorerAddressUrl(launch.dammPool)}
                    target="_blank"
                    rel="noreferrer"
                    className="block font-mono text-xs text-accent hover:underline"
                  >
                    DAMM pool {short(launch.dammPool, 6)}
                  </a>
                )}
              </div>
            )}

            {poolAddress && status !== "graduated" ? (
              <TradePanel
                poolAddress={poolAddress}
                compact
                onGateRequired={() => eligibility.ensure()}
                gateOk={eligibility.ok || undefined}
              />
            ) : (
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
            )}
            <div className="ec-card p-4 text-xs text-fg-muted">
              <p className="mb-1 font-medium text-fg-secondary">Trust mini-strip</p>
              <p>
                Lock ≥{lockPct}% · Local attestations · Program IDs →{" "}
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

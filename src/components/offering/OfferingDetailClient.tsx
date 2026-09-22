"use client";

import { useConnection } from "@solana/wallet-adapter-react";
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

function short(a: string, n = 4) {
  return a.length > 12 ? `${a.slice(0, n)}…${a.slice(-n)}` : a;
}

export function OfferingDetailClient({ id, demo }: Props) {
  const { connection } = useConnection();
  const [tab, setTab] = useState<TabId>("Overview");
  const [launch, setLaunch] = useState<StoredLaunch | null>(null);
  const [activity, setActivity] = useState<StoredActivity[]>([]);
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [snapError, setSnapError] = useState<string | null>(null);
  const eligibility = useEligibilityGate();

  const poolAddress = useMemo(() => {
    if (launch?.pool) return launch.pool;
    if (demo?.pool) return demo.pool;
    if (id.length >= 32 && !demo) return id;
    return null;
  }, [launch, demo, id]);

  useEffect(() => {
    setLaunch(getLaunch(id) ?? null);
    setActivity(listActivity(getLaunch(id)?.pool ?? (id.length >= 32 ? id : undefined)));
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

  const name = launch?.name ?? demo?.name ?? "Live DBC pool";
  const ticker = launch?.ticker ?? demo?.ticker ?? "POOL";
  const thesis =
    launch?.thesis ??
    demo?.thesis ??
    "On-chain pool opened via EquiCurve Create. Trade on-curve; graduate to DAMM v2 when ready.";
  const sector = launch?.sector ?? demo?.sector ?? "Other";
  const quote = launch?.quote ?? demo?.quote ?? "SOL";
  const lockPct = launch?.lockPct ?? demo?.lockPct ?? 10;
  const presetId = launch?.presetId ?? demo?.presetId ?? "long";
  const raiseTarget = launch?.raiseTarget ?? demo?.raiseTarget ?? 0;
  const raisedDemo = demo?.raised ?? 0;
  const verified = demo?.verified ?? false;

  const progressPct = snapshot
    ? snapshot.quoteProgress * 100
    : raiseTarget > 0
      ? (raisedDemo / raiseTarget) * 100
      : 0;

  const status =
    snapshot?.isMigrated || launch?.status === "graduated" || demo?.status === "graduated"
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
                {verified && (
                  <span className="rounded-pill border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
                    Verified
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
                {snapshot ? "On-chain quote progress" : "Demo raise %"}
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
              <div className="flex items-center gap-4">
                <ProgressRing value={progressPct} size={88} stroke={6} />
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
                  {raiseTarget > 0 && !snapshot && (
                    <p>
                      Raised ${raisedDemo.toLocaleString()} / $
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
                (snapshot && snapshot.quoteProgress >= 0.999 && !snapshot.isMigrated)) &&
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
                    <p className="text-fg-primary font-medium">Risk factors</p>
                    <ul className="list-disc space-y-1 pl-5 text-xs">
                      <li>Smart-contract and oracle / RPC dependency risk.</li>
                      <li>
                        Bonding-curve price is discovery mechanics — not a NAV
                        or appraisal.
                      </li>
                      <li>
                        Transfer restrictions / geo eligibility may apply via
                        Token-2022 hooks.
                      </li>
                      <li>
                        Migration fee ~0.2% protocol; LP lock ≥{lockPct}% post
                        DAMM v2.
                      </li>
                    </ul>
                    <p className="text-fg-primary font-medium pt-2">Documents</p>
                    <ul className="space-y-2 text-xs">
                      {[
                        "Issuer identity summary",
                        "Risk disclosure",
                        "Offering memo",
                        "Legal / terms (optional)",
                      ].map((d) => (
                        <li
                          key={d}
                          className="flex items-center justify-between rounded-input border border-line bg-subtle px-3 py-2"
                        >
                          <span>{d}</span>
                          <span className="text-fg-muted">
                            {launch || demo ? "Attested at create" : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-fg-muted">
                      PDF upload vault ships post-MVP; create wizard checkboxes
                      are the current attestation trail.
                    </p>
                  </div>
                )}

                {tab === "Holders" && (
                  <div className="space-y-3">
                    <p>
                      Top-holder indexer not wired. Best-effort: creator &amp;
                      pool vaults from on-chain snapshot.
                    </p>
                    {snapshot ? (
                      <dl className="space-y-2 font-mono text-xs">
                        <div className="flex justify-between gap-4">
                          <dt className="text-fg-muted">Creator</dt>
                          <dd>
                            <a
                              href={explorerAddressUrl(snapshot.creator)}
                              className="text-accent hover:underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {short(snapshot.creator, 6)}
                            </a>
                          </dd>
                        </div>
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
                      </dl>
                    ) : (
                      <p className="text-xs text-fg-muted">
                        Connect to a live pool address for holder hints.
                      </p>
                    )}
                  </div>
                )}

                {tab === "Activity" && (
                  <div className="space-y-2">
                    {activity.length === 0 ? (
                      <p className="text-xs text-fg-muted">
                        No local activity yet. Swaps and launches from this
                        browser appear here (no indexer).
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
            {poolAddress ? (
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
                  Demo offering — launch via Create or open Trade with a live
                  pool pubkey to enable on-curve swaps.
                </p>
                <Link href="/trade" className="ec-btn-secondary inline-flex">
                  Open Trade
                </Link>
                {status === "graduated" && (
                  <Link
                    href={`/o/${id}/graduate`}
                    className="ec-btn-primary inline-flex"
                  >
                    View graduation
                  </Link>
                )}
              </div>
            )}
            <div className="ec-card p-4 text-xs text-fg-muted">
              <p className="mb-1 font-medium text-fg-secondary">Trust mini-strip</p>
              <p>
                Lock ≥{lockPct}% · Docs checklist · Program IDs →{" "}
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

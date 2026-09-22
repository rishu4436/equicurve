"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DBC_PROGRAM_ID,
  DAMM_V2_PROGRAM,
  explorerAddressUrl,
  explorerTxUrl,
} from "@/lib/constants";
import {
  fetchCreatorFeeBreakdown,
  prepareClaimCreatorFees,
  type FeeBreakdown,
} from "@/lib/dbc/claim";
import { toUserMessage } from "@/lib/errors";
import {
  launchesForWallet,
  listLaunches,
  pushActivity,
  type StoredLaunch,
} from "@/lib/local/launches";
import { signAndSendTransaction } from "@/lib/send";

function lamportsToSol(raw: string): string {
  try {
    const n = Number(raw) / 1e9;
    if (!Number.isFinite(n)) return raw;
    return n.toFixed(6);
  } catch {
    return raw;
  }
}

export function IssuerDashboard() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [launches, setLaunches] = useState<StoredLaunch[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [fees, setFees] = useState<FeeBreakdown | null>(null);
  const [feeError, setFeeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const all = listLaunches();
    if (wallet.publicKey) {
      setLaunches(launchesForWallet(wallet.publicKey.toBase58()));
    } else {
      setLaunches(all);
    }
  }, [wallet.publicKey]);

  useEffect(() => {
    if (launches.length && !selected) setSelected(launches[0].pool);
  }, [launches, selected]);

  const refreshFees = useCallback(async () => {
    if (!selected) {
      setFees(null);
      return;
    }
    try {
      setFeeError(null);
      const b = await fetchCreatorFeeBreakdown(
        connection,
        new PublicKey(selected),
      );
      setFees(b);
    } catch (e) {
      setFeeError(toUserMessage(e));
      setFees(null);
    }
  }, [connection, selected]);

  useEffect(() => {
    void refreshFees();
  }, [refreshFees]);

  async function onClaim() {
    if (!wallet.publicKey) {
      toast.error("Connect the deployer wallet to claim.");
      return;
    }
    if (!selected) return;
    setBusy(true);
    try {
      const { tx } = await prepareClaimCreatorFees({
        connection,
        creator: wallet.publicKey,
        pool: new PublicKey(selected),
      });
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      pushActivity({
        id: `${sig}-claim`,
        pool: selected,
        kind: "claim",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success("Claim submitted — " + sig.slice(0, 8));
      window.open(explorerTxUrl(sig), "_blank");
      await refreshFees();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const current = launches.find((l) => l.pool === selected);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-fg-primary">
          Issuer dashboard
        </h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Deployer wallet = fee claimer. Claims use real{" "}
          <code className="text-accent-soft">claimCreatorTradingFee</code> from
          the DBC SDK — never mocked.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            k: "Unclaimed quote",
            v: fees
              ? `${lamportsToSol(fees.creatorUnclaimedQuote)} SOL`
              : "—",
          },
          {
            k: "Unclaimed base",
            v: fees ? fees.creatorUnclaimedBase : "—",
          },
          {
            k: "Claimed quote",
            v: fees ? `${lamportsToSol(fees.creatorClaimedQuote)} SOL` : "—",
          },
          {
            k: "Your issuances",
            v: String(launches.length),
          },
        ].map((x) => (
          <div key={x.k} className="ec-card p-4">
            <p className="text-xs text-fg-muted">{x.k}</p>
            <p className="mt-1 font-mono text-lg text-fg-primary">{x.v}</p>
          </div>
        ))}
      </div>

      {launches.length === 0 ? (
        <div className="ec-card flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-fg-secondary">
            No local launches yet. Create an offering to populate this dashboard.
          </p>
          <Link href="/create" className="ec-btn-primary">
            Create offering
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="ec-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-fg-primary">
              Your issuances
            </h2>
            <ul className="space-y-2">
              {launches.map((l) => (
                <li key={l.pool}>
                  <button
                    type="button"
                    onClick={() => setSelected(l.pool)}
                    className={
                      selected === l.pool
                        ? "w-full rounded-input border border-accent/40 bg-accent/10 px-3 py-2 text-left text-sm"
                        : "w-full rounded-input border border-line bg-subtle px-3 py-2 text-left text-sm hover:border-accent/30"
                    }
                  >
                    <span className="font-medium text-fg-primary">
                      ${l.ticker}
                    </span>{" "}
                    <span className="text-fg-muted">{l.name}</span>
                    <div className="font-mono text-[10px] text-fg-muted">
                      {l.pool.slice(0, 12)}…
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-4">
            <div className="ec-card space-y-3 p-5">
              <h2 className="font-semibold text-fg-primary">
                Fee claims — {current ? `$${current.ticker}` : "select pool"}
              </h2>
              {feeError && (
                <p className="text-xs text-signal-warn">{feeError}</p>
              )}
              {fees && (
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-fg-muted">Unclaimed quote (SOL)</dt>
                    <dd className="font-mono text-fg-primary">
                      {lamportsToSol(fees.creatorUnclaimedQuote)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Unclaimed base</dt>
                    <dd className="font-mono text-fg-primary">
                      {fees.creatorUnclaimedBase}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">Total quote fees</dt>
                    <dd className="font-mono text-fg-primary">
                      {lamportsToSol(fees.creatorTotalQuote)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-fg-muted">LP lock policy</dt>
                    <dd className="text-fg-primary">
                      ≥{current?.lockPct ?? 10}%
                    </dd>
                  </div>
                </dl>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy || !wallet.publicKey || !selected}
                  onClick={() => void onClaim()}
                  className="ec-btn-primary"
                >
                  {busy ? "Claiming…" : "Claim creator fees"}
                </button>
                <button
                  type="button"
                  className="ec-btn-secondary"
                  onClick={() => void refreshFees()}
                >
                  Refresh
                </button>
                {selected && (
                  <Link
                    href={`/o/${selected}`}
                    className="ec-btn-secondary"
                  >
                    View offering
                  </Link>
                )}
              </div>
            </div>

            <div className="ec-card space-y-2 p-5 text-xs text-fg-secondary">
              <p className="font-medium text-fg-primary">Program IDs</p>
              <p>
                DBC:{" "}
                <a
                  href={explorerAddressUrl(DBC_PROGRAM_ID.toBase58())}
                  className="font-mono text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {DBC_PROGRAM_ID.toBase58()}
                </a>
              </p>
              <p>
                DAMM v2:{" "}
                <a
                  href={explorerAddressUrl(DAMM_V2_PROGRAM.toBase58())}
                  className="font-mono text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  {DAMM_V2_PROGRAM.toBase58()}
                </a>
              </p>
              <p className="text-fg-muted">
                Surplus / migration-fee withdraw paths exist on the SDK
                (creatorWithdrawSurplus) — wire when surplus accrues post-grad.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

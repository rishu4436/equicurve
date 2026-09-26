"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { clsx } from "clsx";
import { ProgressRing } from "@/components/ui/ProgressRing";
import {
  GraduationStatusCard,
  pollDammDestination,
  useGraduationView,
} from "@/components/offering/GraduationStatus";
import { DOCS, explorerAddressUrl, explorerTxUrl } from "@/lib/constants";
import type { DestinationCheck, MigrationTxPhase } from "@/lib/dbc/curveState";
import {
  expectedDammDestination,
  fetchPoolSnapshot,
  migrationConfigForSnapshot,
  prepareDammV2Migration,
} from "@/lib/dbc/migrate";
import { PoolNotFoundError } from "@/lib/dbc/poolAccount";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { tryFormatAtoms } from "@/lib/amounts";
import { toUserMessage } from "@/lib/errors";
import { pushActivity, updateLaunch } from "@/lib/local/launches";
import { refreshLaunchRemote } from "@/lib/registry/client";
import { signAndSendTransaction } from "@/lib/send";

export function GraduatePanel({ poolAddress }: { poolAddress: string }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [txPhase, setTxPhase] = useState<MigrationTxPhase>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [destination, setDestination] = useState<DestinationCheck>("unchecked");
  const [migrateSig, setMigrateSig] = useState<string | null>(null);

  const readSnapshot = useCallback(async (): Promise<PoolSnapshot | null> => {
    try {
      const s = await fetchPoolSnapshot(connection, new PublicKey(poolAddress));
      setError(null);
      setReadFailed(false);
      setSnapshot(s);
      return s;
    } catch (e) {
      setError(
        (e instanceof PoolNotFoundError ? "Pool not found on this cluster. " : "RPC unavailable — state unknown. ") +
          toUserMessage(e),
      );
      setReadFailed(true);
      setSnapshot(null);
      return null;
    }
  }, [connection, poolAddress]);

  const verifyDestination = useCallback(
    async (snap: PoolSnapshot, attempts: number) => {
      const d = await pollDammDestination(connection, snap, {
        attempts,
        onUpdate: setDestination,
      });
      if (d === "exists") {
        const dest = expectedDammDestination(snap);
        // Only now is graduation real: DBC migrated AND DAMM v2 account fetched.
        updateLaunch(poolAddress, {
          status: "graduated",
          ...(dest ? { dammPool: dest.dammPool.toBase58() } : {}),
        });
        // Server re-derives status from chain; it never trusts this client.
        void refreshLaunchRemote(poolAddress);
      }
      return d;
    },
    [connection, poolAddress],
  );

  const refresh = useCallback(async () => {
    const s = await readSnapshot();
    if (s?.curve.phase === "migrated") await verifyDestination(s, 1);
    else setDestination("unchecked");
  }, [readSnapshot, verifyDestination]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = useGraduationView({
    snapshot,
    readFailed,
    tx: txPhase,
    destination,
    txError,
  });

  async function onMigrate() {
    if (!wallet.publicKey) {
      toast.error("Connect a wallet to migrate.");
      return;
    }
    setBusy(true);
    setTxError(null);
    setTxPhase("building");
    let submittedSig: string | null = null;
    try {
      // prepareDammV2Migration re-reads the pool and refuses unless the
      // threshold is reached, not migrated, and the config targets DAMM v2.
      const prepared = await prepareDammV2Migration({
        connection,
        payer: wallet.publicKey,
        pool: new PublicKey(poolAddress),
      });
      const sig = await signAndSendTransaction({
        connection,
        wallet,
        tx: prepared.tx,
        onSubmitted: (s) => {
          submittedSig = s;
          setMigrateSig(s);
          setTxPhase("submitted");
        },
      });
      setMigrateSig(sig);
      setTxPhase("confirmed");
      updateLaunch(poolAddress, { migrateSig: sig });
      pushActivity({
        id: `${sig}-migrate`,
        pool: poolAddress,
        kind: "migrate",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.message("Migration confirmed — verifying the DAMM v2 pool account…");
      const snap = (await readSnapshot()) ?? prepared.snapshot;
      const d = await verifyDestination(snap, 6);
      if (d === "exists") toast.success("DAMM v2 pool verified on-chain.");
      else toast.warning("Migration confirmed, but the DAMM v2 pool is not verified yet. Refresh shortly.");
    } catch (e) {
      const msg = toUserMessage(e);
      if (submittedSig) {
        // Outcome unclear (e.g. confirmation RPC error) — trust chain state only.
        const snap = await readSnapshot();
        if (snap?.curve.phase === "migrated") {
          setTxPhase("confirmed");
          await verifyDestination(snap, 6);
          return;
        }
      }
      setTxPhase("failed");
      setTxError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  const config = snapshot ? migrationConfigForSnapshot(snapshot) : null;
  const dest = snapshot ? expectedDammDestination(snapshot) : null;
  const progressPct =
    snapshot?.quoteProgress == null ? null : snapshot.quoteProgress * 100;
  const morph = view.state === "submitted" || (busy && txPhase === "building");
  const verified = view.state === "destination_verified";
  const migratedOnChain = view.state === "confirmed" || verified;
  const quoteDec = snapshot?.quoteDecimals ?? null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-accent">
          Graduation ceremony
        </p>

      <p className="text-xs text-fg-muted">
        Transfer-hook pools: DBC revokes the base mint&apos;s transfer-hook program
        and authority when the curve completes (
        <code className="text-accent-soft">EvtCurveCompleteWithTransferHook</code>
        ), then the same <code className="text-accent-soft">migrateToDammV2</code>{" "}
        path applies. Graduated DAMM v2 liquidity has no active transfer hook.
      </p>
        <h1 className="mt-1 text-3xl font-semibold text-fg-primary">
          Curve complete → DAMM v2
        </h1>
        <p className="mt-2 text-sm text-fg-secondary">
          When the bonding curve hits its migration quote threshold, DBC
          graduates into Meteora DAMM v2. Mainnet keepers automate this; on
          devnet we build{" "}
          <code className="text-accent-soft">migrateToDammV2</code> for manual
          migrators. See{" "}
          <a
            className="underline hover:text-accent"
            href={DOCS.migration}
            target="_blank"
            rel="noreferrer"
          >
            migration docs
          </a>
          .
        </p>
      </div>

      {/* Morph visual */}
      <div
        className={clsx(
          "ec-card relative overflow-hidden p-8 text-center",
          morph && "ec-grad-morph",
          verified && "border-signal-grad/40 shadow-glow",
        )}
      >
        <div className="flex items-center justify-center gap-6 sm:gap-10">
          <div
            className={clsx(
              "flex flex-col items-center gap-2 transition-all duration-[1200ms]",
              morph || migratedOnChain
                ? "scale-90 opacity-50"
                : "opacity-100",
            )}
          >
            {progressPct == null ? (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-line font-mono text-xs text-fg-muted">
                unknown
              </div>
            ) : (
              <ProgressRing value={Math.min(100, progressPct)} size={80} stroke={6} />
            )}
            <span className="text-xs text-fg-muted">DBC curve</span>
          </div>
          <div
            className={clsx(
              "text-2xl font-light transition-colors duration-[1200ms]",
              verified ? "text-signal-grad" : "text-fg-muted",
            )}
          >
            →
          </div>
          <div
            className={clsx(
              "flex flex-col items-center gap-2 transition-all duration-[1200ms]",
              morph || migratedOnChain
                ? "scale-110 opacity-100"
                : "scale-95 opacity-40",
            )}
          >
            <div
              className={clsx(
                "flex h-20 w-20 items-center justify-center rounded-card border-2",
                verified
                  ? "border-signal-grad bg-signal-grad/15 text-signal-grad"
                  : "border-chart-damm/40 bg-subtle text-fg-muted",
              )}
              style={{ borderColor: verified ? undefined : "#A78BFA66" }}
            >
              <span className="font-mono text-xs font-semibold">DAMM</span>
            </div>
            <span className="text-xs text-fg-muted">DAMM v2 pool</span>
          </div>
        </div>
        {morph && (
          <p className="mt-4 animate-pulse text-sm text-accent">{view.detail}</p>
        )}
        {verified && (
          <p className="mt-4 text-sm text-signal-grad">
            DAMM v2 pool account fetched on-chain — graduated liquidity is live
          </p>
        )}
      </div>

      <GraduationStatusCard view={view} snapshot={snapshot} />

      {/* Migration TX card — success wording only once the destination is verified */}
      {migrateSig && (
        <div
          className={clsx(
            "ec-card space-y-4 p-5",
            verified ? "border-signal-grad/40 shadow-glow" : "border-line",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={clsx("text-lg font-semibold", verified ? "text-signal-grad" : "text-fg-primary")}>
              {view.label}
            </h2>
            <span className="rounded-pill border border-line bg-subtle px-2.5 py-0.5 text-xs text-fg-secondary">
              {txPhase === "submitted"
                ? "Submitted · awaiting confirmation"
                : verified
                  ? "Confirmed · destination verified"
                  : view.state === "confirmed"
                    ? "Confirmed · destination not verified yet"
                    : view.state}
            </span>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-fg-muted">
              Migration signature
            </p>
            <p className="mt-1 break-all font-mono text-sm text-fg-primary">
              {migrateSig}
            </p>
            <a
              href={explorerTxUrl(migrateSig)}
              target="_blank"
              rel="noreferrer"
              className="ec-btn-secondary mt-3 inline-flex"
            >
              Open TX on Solana Explorer →
            </a>
          </div>
          {dest && (
            <div>
              <p className="text-xs uppercase tracking-wider text-fg-muted">
                DAMM v2 pool {verified ? "(account verified)" : "(expected address — not yet verified)"}
              </p>
              <a
                href={explorerAddressUrl(dest.dammPool.toBase58())}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all font-mono text-xs text-accent hover:underline"
              >
                {dest.dammPool.toBase58()}
              </a>
            </div>
          )}
          {view.state === "confirmed" && (
            <button type="button" className="ec-btn-secondary" onClick={() => snapshot && void verifyDestination(snapshot, 3)}>
              Re-check DAMM v2 pool
            </button>
          )}
        </div>
      )}

      <div className="ec-card space-y-3 p-5 text-sm">
        <dl className="space-y-2">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Pool</dt>
            <dd className="font-mono text-xs">
              <a
                href={explorerAddressUrl(poolAddress)}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-accent"
              >
                {poolAddress.slice(0, 16)}…
              </a>
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">DAMM v2 config (from migrationFeeOption)</dt>
            <dd className="font-mono text-xs">
              {config?.expectedDammConfig ? (
                <a
                  href={explorerAddressUrl(config.expectedDammConfig)}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-accent"
                >
                  {config.expectedDammConfig.slice(0, 16)}…
                </a>
              ) : (
                "unknown"
              )}
            </dd>
          </div>
          {config && !config.ok && (
            <p className="text-xs text-signal-danger">{config.reason}</p>
          )}
          {snapshot && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Quote reserve / threshold</dt>
                <dd className="font-mono text-xs">
                  {quoteDec == null || snapshot.migrationQuoteThreshold == null
                    ? "unknown"
                    : `${tryFormatAtoms(snapshot.quoteReserve, quoteDec, 4)} / ${tryFormatAtoms(snapshot.migrationQuoteThreshold, quoteDec, 4)}`}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Curve progress</dt>
                <dd className="font-mono">{progressPct == null ? "unknown" : `${progressPct.toFixed(2)}%`}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Migrated on DBC (isMigrated)</dt>
                <dd>{snapshot.isMigrated == null ? "unknown" : snapshot.isMigrated ? "yes" : "no"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">DAMM v2 pool account</dt>
                <dd>
                  {destination === "exists"
                    ? "fetched ✓"
                    : destination === "missing"
                      ? "not found"
                      : destination === "rpc_unavailable"
                        ? "unknown (RPC)"
                        : destination === "checking"
                          ? "checking…"
                          : "not checked"}
                </dd>
              </div>
              {snapshot.baseMint && (
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">Base mint</dt>
                  <dd className="font-mono text-xs">
                    <a
                      href={explorerAddressUrl(snapshot.baseMint)}
                      target="_blank"
                      rel="noreferrer"
                      className="underline hover:text-accent"
                    >
                      {snapshot.baseMint.slice(0, 12)}…
                    </a>
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>

        <div className="rounded-input border border-line bg-subtle px-3 py-2 text-xs text-fg-secondary">
          <p>
            <strong className="text-fg-primary">LP lock ≥10%</strong> of migrated
            liquidity is permanently locked (exact % read from the pool config). EquiCurve configs set no separate
            migration fee (migrationFee 0%); the DAMM v2 pool then charges its own trading fee.
          </p>
          <p className="mt-1 text-fg-muted">
            Position NFTs are created by the migrate instruction — shown in
            explorer after confirmation.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-input border border-signal-danger/30 bg-signal-danger/10 p-4 text-sm text-signal-danger">
          {error}
        </div>
      )}

      <div className="rounded-input border border-signal-warn/20 bg-signal-warn/5 p-4 text-xs text-signal-warn">
        <strong>Readiness gate:</strong> the migrate transaction is only built
        after re-reading the pool on-chain: quote reserve ≥ migration threshold,
        not already migrated, and the config migrates to DAMM v2 with the
        matching fee config. Success is shown only after the transaction
        confirms <em>and</em> the DAMM v2 pool account is fetched.
      </div>

      <button
        type="button"
        disabled={busy || !wallet.publicKey || !view.canMigrate}
        onClick={() => void onMigrate()}
        className="ec-btn-primary w-full py-3"
      >
        {busy
          ? view.label + "…"
          : view.canMigrate
            ? view.state === "failed"
              ? "Retry migration to DAMM v2"
              : "Migrate to DAMM v2"
            : view.label}
      </button>
      {view.state === "unknown" && (
        <button type="button" className="ec-btn-secondary w-full" onClick={() => void refresh()}>
          Retry reading pool state
        </button>
      )}

      {migratedOnChain && (
        <div className="flex flex-wrap justify-center gap-3">
          <Link href={`/o/${poolAddress}`} className="ec-btn-secondary">
            Back to offering
          </Link>
          <Link href="/issuer" className="ec-btn-secondary">
            Issuer claims
          </Link>
          <Link href="/trust" className="ec-btn-secondary">
            Trust Center
          </Link>
          {migrateSig ? (
            <a
              href={explorerTxUrl(migrateSig)}
              target="_blank"
              rel="noreferrer"
              className="ec-btn-primary"
            >
              Explorer TX
            </a>
          ) : (
            <Link href={`/trade/${poolAddress}`} className="ec-btn-primary">
              Trade (post-grad path)
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

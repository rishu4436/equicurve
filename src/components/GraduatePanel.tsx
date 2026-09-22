"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { clsx } from "clsx";
import { ProgressRing } from "@/components/ui/ProgressRing";
import {
  DOCS,
  explorerAddressUrl,
  explorerTxUrl,
  getDammV2ConfigKey,
} from "@/lib/constants";
import {
  fetchPoolSnapshot,
  prepareDammV2Migration,
} from "@/lib/dbc/migrate";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { toUserMessage } from "@/lib/errors";
import { pushActivity, updateLaunch } from "@/lib/local/launches";
import { signAndSendTransaction } from "@/lib/send";

export function GraduatePanel({ poolAddress }: { poolAddress: string }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "morph" | "success">("idle");
  const [migrateSig, setMigrateSig] = useState<string | null>(null);
  const [dammPool, setDammPool] = useState<string | null>(null);
  const [dammDerived, setDammDerived] = useState(false);
  const dammConfig = getDammV2ConfigKey().toBase58();

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setSnapshot(
        await fetchPoolSnapshot(connection, new PublicKey(poolAddress)),
      );
    } catch (e) {
      setError(toUserMessage(e));
      setSnapshot(null);
    }
  }, [connection, poolAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onMigrate() {
    if (!wallet.publicKey) {
      toast.error("Connect a wallet to migrate.");
      return;
    }
    setBusy(true);
    setPhase("morph");
    try {
      const { tx, progress, dammPoolAddress } = await prepareDammV2Migration({
        connection,
        payer: wallet.publicKey,
        pool: new PublicKey(poolAddress),
      });
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      setMigrateSig(sig);
      if (dammPoolAddress) {
        setDammPool(dammPoolAddress);
        setDammDerived(true);
      } else {
        setDammPool(null);
        setDammDerived(false);
      }
      updateLaunch(poolAddress, {
        status: "graduated",
        migrateSig: sig,
        ...(dammPoolAddress ? { dammPool: dammPoolAddress } : {}),
      });
      pushActivity({
        id: `${sig}-migrate`,
        pool: poolAddress,
        kind: "migrate",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success(
        `Migrated at ${(progress * 100).toFixed(2)}% — open explorer for TX`,
      );
      setPhase("success");
      await refresh();
    } catch (e) {
      setPhase("idle");
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    !!snapshot && (snapshot.quoteProgress >= 0.999 || snapshot.isMigrated);
  const progressPct = snapshot ? snapshot.quoteProgress * 100 : 0;
  const already = snapshot?.isMigrated || phase === "success";

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
          phase === "morph" && "ec-grad-morph",
          already && "border-signal-grad/40 shadow-glow",
        )}
      >
        <div className="flex items-center justify-center gap-6 sm:gap-10">
          <div
            className={clsx(
              "flex flex-col items-center gap-2 transition-all duration-[1200ms]",
              phase === "morph" || already
                ? "scale-90 opacity-50"
                : "opacity-100",
            )}
          >
            <ProgressRing value={Math.min(100, progressPct)} size={80} stroke={6} />
            <span className="text-xs text-fg-muted">DBC curve</span>
          </div>
          <div
            className={clsx(
              "text-2xl font-light transition-colors duration-[1200ms]",
              already ? "text-signal-grad" : "text-fg-muted",
            )}
          >
            →
          </div>
          <div
            className={clsx(
              "flex flex-col items-center gap-2 transition-all duration-[1200ms]",
              phase === "morph" || already
                ? "scale-110 opacity-100"
                : "scale-95 opacity-40",
            )}
          >
            <div
              className={clsx(
                "flex h-20 w-20 items-center justify-center rounded-card border-2",
                already
                  ? "border-signal-grad bg-signal-grad/15 text-signal-grad"
                  : "border-chart-damm/40 bg-subtle text-fg-muted",
              )}
              style={{ borderColor: already ? undefined : "#A78BFA66" }}
            >
              <span className="font-mono text-xs font-semibold">DAMM</span>
            </div>
            <span className="text-xs text-fg-muted">DAMM v2 pool</span>
          </div>
        </div>
        {phase === "morph" && (
          <p className="mt-4 animate-pulse text-sm text-accent">
            Building migrateToDammV2…
          </p>
        )}
        {already && (
          <p className="mt-4 text-sm text-signal-grad">
            Graduated liquidity live on DAMM v2
          </p>
        )}
      </div>

      {/* Prominent success card after migrate TX */}
      {migrateSig && (
        <div className="ec-card space-y-4 border-signal-grad/40 p-5 shadow-glow">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-signal-grad">
              Migration confirmed
            </h2>
            <span className="rounded-pill border border-signal-grad/40 bg-signal-grad/10 px-2.5 py-0.5 text-xs text-signal-grad">
              On-chain
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
              className="ec-btn-primary mt-3 inline-flex"
            >
              Open TX on Solana Explorer →
            </a>
          </div>
          {dammPool ? (
            <div>
              <p className="text-xs uppercase tracking-wider text-fg-muted">
                DAMM v2 pool (best-effort derive)
              </p>
              <a
                href={explorerAddressUrl(dammPool)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block break-all font-mono text-xs text-accent hover:underline"
              >
                {dammPool}
              </a>
              {dammDerived && (
                <p className="mt-1 text-xs text-fg-muted">
                  Derived from fee config + mints. Confirm the account exists on
                  Explorer after confirmation settles.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-input border border-signal-warn/25 bg-signal-warn/5 px-3 py-2 text-xs text-signal-warn">
              DAMM pool address could not be derived client-side. Use the
              migration TX on Explorer to inspect created accounts (position
              NFTs + DAMM pool). This is honest best-effort — we never invent an
              address.
            </div>
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
            <dt className="text-fg-muted">DAMM v2 fee config</dt>
            <dd className="font-mono text-xs">
              <a
                href={explorerAddressUrl(dammConfig)}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-accent"
              >
                {dammConfig.slice(0, 16)}…
              </a>
            </dd>
          </div>
          {snapshot && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Curve progress</dt>
                <dd className="font-mono">{progressPct.toFixed(2)}%</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Already migrated?</dt>
                <dd>{snapshot.isMigrated || phase === "success" ? "yes" : "no"}</dd>
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
            liquidity (≥1 day vesting policy). Protocol migration fee ~0.2%.
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
        <strong>Readiness gate:</strong> migrate builds a real SDK transaction
        only when quote progress ≥ ~100%. Until then this panel shows live
        progress — never fakes success.
      </div>

      <button
        type="button"
        disabled={busy || !wallet.publicKey || !ready || already}
        onClick={() => void onMigrate()}
        className="ec-btn-primary w-full py-3"
      >
        {busy
          ? "Building migration…"
          : already
            ? "Already graduated"
            : ready
              ? "Migrate to DAMM v2"
              : "Waiting for curve completion"}
      </button>

      {already && (
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

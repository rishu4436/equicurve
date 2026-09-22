"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { clsx } from "clsx";
import {
  EligibilityGate,
  useEligibilityGate,
} from "@/components/gate/EligibilityGate";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/constants";
import { fetchPoolSnapshot } from "@/lib/dbc/migrate";
import { quoteAndBuildSwap, type SwapDirection } from "@/lib/dbc/swap";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { toUserMessage } from "@/lib/errors";
import { pushActivity } from "@/lib/local/launches";
import { isEligible } from "@/lib/local/eligibility";
import { signAndSendTransaction } from "@/lib/send";

type Props = {
  poolAddress: string;
  /** Embed in offering detail without page chrome */
  compact?: boolean;
  /** Parent-controlled gate (optional) */
  onGateRequired?: () => boolean;
  gateOk?: boolean;
};

export function TradePanel({
  poolAddress,
  compact = false,
  onGateRequired,
  gateOk,
}: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const localGate = useEligibilityGate();
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] = useState<SwapDirection>("buy");
  const [amount, setAmount] = useState("0.1");
  const [quoteOut, setQuoteOut] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  function checkGate(): boolean {
    if (gateOk === true || isEligible()) return true;
    if (onGateRequired) return onGateRequired();
    return localGate.ensure();
  }

  async function onQuote() {
    if (!checkGate()) return;
    if (!wallet.publicKey) {
      toast.error("Connect a wallet to quote.");
      return;
    }
    setBusy(true);
    try {
      const { minimumAmountOut } = await quoteAndBuildSwap({
        connection,
        owner: wallet.publicKey,
        pool: new PublicKey(poolAddress),
        direction,
        amount: Number(amount),
      });
      setQuoteOut(minimumAmountOut);
      toast.message(`Min out: ${minimumAmountOut}`);
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function onSwap() {
    if (!checkGate()) return;
    if (!wallet.publicKey) {
      toast.error("Connect a wallet to swap.");
      return;
    }
    setBusy(true);
    try {
      const { tx, minimumAmountOut } = await quoteAndBuildSwap({
        connection,
        owner: wallet.publicKey,
        pool: new PublicKey(poolAddress),
        direction,
        amount: Number(amount),
      });
      setQuoteOut(minimumAmountOut);
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      pushActivity({
        id: `${sig}-${Date.now()}`,
        pool: poolAddress,
        mint: snapshot?.baseMint,
        kind: direction,
        amount,
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success("Swap landed — " + sig.slice(0, 8));
      window.open(explorerTxUrl(sig), "_blank");
      await refresh();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const progressPct = snapshot ? snapshot.quoteProgress * 100 : 0;
  const showLocalGate = !onGateRequired;

  const body = (
    <div className={clsx("space-y-4", !compact && "space-y-6")}>
      {!compact && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-fg-primary">
              Trade on curve
            </h1>
            <p className="mt-1 font-mono text-xs text-fg-secondary">
              <a
                href={explorerAddressUrl(poolAddress)}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-accent"
              >
                {poolAddress}
              </a>
            </p>
          </div>
          <Link
            href={`/o/${poolAddress}/graduate`}
            className="rounded-pill border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold"
          >
            Graduation →
          </Link>
        </div>
      )}

      {error && (
        <div className="rounded-input border border-signal-danger/30 bg-signal-danger/10 p-4 text-sm text-signal-danger">
          {error}
          <p className="mt-1 text-xs opacity-80">
            Pool may not exist on this cluster, or RPC is unavailable. Set
            NEXT_PUBLIC_RPC_URL.
          </p>
        </div>
      )}

      {snapshot && (
        <div
          className={clsx(
            "grid gap-3",
            compact ? "grid-cols-2" : "sm:grid-cols-4",
          )}
        >
          <div className="ec-card flex items-center gap-3 p-3">
            <ProgressRing value={progressPct} size={compact ? 40 : 48} stroke={4} />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-fg-muted">
                Curve
              </div>
              <div className="font-mono text-sm text-fg-primary">
                {progressPct.toFixed(2)}%
              </div>
            </div>
          </div>
          {!compact && (
            <>
              <div className="ec-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-fg-muted">
                  Base progress
                </div>
                <div className="mt-1 font-mono text-sm text-fg-primary">
                  {(snapshot.baseProgress * 100).toFixed(2)}%
                </div>
              </div>
              <div className="ec-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-fg-muted">
                  Migrated
                </div>
                <div className="mt-1 font-mono text-sm text-fg-primary">
                  {snapshot.isMigrated ? "yes" : "no"}
                </div>
              </div>
              <div className="ec-card p-3">
                <div className="text-[10px] uppercase tracking-wider text-fg-muted">
                  Threshold
                </div>
                <div className="mt-1 font-mono text-sm text-fg-primary">
                  {snapshot.migrationThreshold
                    ? snapshot.migrationThreshold.slice(0, 12) + "…"
                    : "—"}
                </div>
              </div>
            </>
          )}
          {compact && (
            <div className="ec-card p-3">
              <div className="text-[10px] uppercase tracking-wider text-fg-muted">
                Status
              </div>
              <div className="mt-1 text-sm text-fg-primary">
                {snapshot.isMigrated
                  ? "Graduated"
                  : snapshot.quoteProgress >= 0.999
                    ? "Ready to migrate"
                    : "Raising"}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="ec-card p-5">
        {compact && (
          <h2 className="mb-3 font-semibold text-fg-primary">Trade ticket</h2>
        )}
        <div className="mb-4 flex gap-2">
          {(["buy", "sell"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => {
                setDirection(d);
                setQuoteOut(null);
              }}
              className={clsx(
                "flex-1 rounded-pill px-4 py-2 text-sm capitalize transition",
                direction === d
                  ? d === "buy"
                    ? "bg-accent text-base font-semibold"
                    : "bg-signal-danger/90 text-base font-semibold"
                  : "bg-subtle text-fg-secondary hover:text-fg-primary",
              )}
            >
              {d === "buy" ? "Buy on curve" : "Sell on curve"}
            </button>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="ec-label">
            Amount ({direction === "buy" ? "SOL" : "base tokens"})
          </span>
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setQuoteOut(null);
            }}
            className="ec-input font-mono"
          />
        </label>

        {quoteOut && (
          <div className="mt-3 rounded-input border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
            <p className="text-fg-muted">Quote · min amount out</p>
            <p className="font-mono text-sm text-accent-soft">{quoteOut}</p>
            <p className="mt-1 text-[10px] text-fg-muted">
              Includes slippage buffer · anti-sniper fee schedule may apply on
              first swaps
            </p>
          </div>
        )}

        <p className="mt-3 text-[11px] text-signal-warn">
          Bonding price ≠ NAV. Review disclosures before trading.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onQuote()}
            className="ec-btn-secondary flex-1"
          >
            Quote
          </button>
          <button
            type="button"
            disabled={busy || !wallet.publicKey}
            onClick={() => void onSwap()}
            className="ec-btn-primary flex-1"
          >
            {busy ? "Working…" : direction === "buy" ? "Buy" : "Sell"}
          </button>
        </div>
      </div>
    </div>
  );

  if (!showLocalGate) return body;

  return (
    <EligibilityGate
      requireForAction={localGate.needGate}
      onAccepted={localGate.onAccepted}
    >
      {body}
    </EligibilityGate>
  );
}

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
import {
  explorerAddressUrl,
  explorerTxUrl,
  quoteLabelForMint,
} from "@/lib/constants";
import { tryFormatAtoms } from "@/lib/amounts";
import { fetchPoolSnapshot } from "@/lib/dbc/migrate";
import { PoolNotFoundError } from "@/lib/dbc/poolAccount";
import { quoteAndBuildSwap, type SwapDirection, type SwapQuoteView } from "@/lib/dbc/swap";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { toUserMessage } from "@/lib/errors";
import { pushActivity } from "@/lib/local/launches";
import { hasSelfAttested } from "@/lib/local/eligibility";
import { signAndSendTransaction } from "@/lib/send";

type Props = {
  poolAddress: string;
  /** Embed in offering detail without page chrome */
  compact?: boolean;
  /** Parent-controlled gate (optional) */
  onGateRequired?: () => boolean;
  gateOk?: boolean;
  /** Called after a confirmed swap so parent can refresh price history. */
  onSwapComplete?: () => void;
};

export function TradePanel({
  poolAddress,
  compact = false,
  onGateRequired,
  gateOk,
  onSwapComplete,
}: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const localGate = useEligibilityGate();
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readState, setReadState] = useState<"loading" | "ok" | "not_found" | "rpc_unavailable">("loading");
  const [direction, setDirection] = useState<SwapDirection>("buy");
  const [amount, setAmount] = useState("0.1");
  const [quoteOut, setQuoteOut] = useState<SwapQuoteView | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      setSnapshot(
        await fetchPoolSnapshot(connection, new PublicKey(poolAddress)),
      );
      setReadState("ok");
    } catch (e) {
      setReadState(e instanceof PoolNotFoundError ? "not_found" : "rpc_unavailable");
      setError(toUserMessage(e));
      setSnapshot(null);
    }
  }, [connection, poolAddress]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function checkGate(): boolean {
    if (gateOk === true || hasSelfAttested()) return true;
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
      const q = await quoteAndBuildSwap({
        connection,
        owner: wallet.publicKey,
        pool: new PublicKey(poolAddress),
        direction,
        amountUi: amount,
      });
      setQuoteOut(q);
      toast.message(`Min out: ${tryFormatAtoms(q.minimumAmountOut, q.outputDecimals)}`);
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
      const q = await quoteAndBuildSwap({
        connection,
        owner: wallet.publicKey,
        pool: new PublicKey(poolAddress),
        direction,
        amountUi: amount,
      });
      setQuoteOut(q);
      const tx = q.tx;
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
      onSwapComplete?.();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // Unknown progress stays unknown — never rendered as 0%.
  const progressPct =
    snapshot?.quoteProgress == null ? null : snapshot.quoteProgress * 100;
  const quoteSymbol = snapshot?.quoteMint
    ? quoteLabelForMint(snapshot.quoteMint)
    : "quote";
  const curvePhase = snapshot?.curve.phase ?? "unknown";
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
          {readState === "not_found" ? "Pool not found on this cluster." : "RPC unavailable — pool state unknown."}{" "}
          <span className="opacity-80">{error}</span>
          <p className="mt-1 text-xs opacity-80">
            {readState === "not_found"
              ? "Check the address and that your app/wallet cluster match."
              : "Nothing is shown as 0% or complete while RPC is down. Retry, or configure a dedicated RPC."}
          </p>
          <button type="button" onClick={() => void refresh()} className="mt-2 text-xs underline">
            Retry
          </button>
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
            {progressPct != null && (
              <ProgressRing value={progressPct} size={compact ? 40 : 48} stroke={4} />
            )}
            <div>
              <div className="text-[10px] uppercase tracking-wider text-fg-muted">
                Curve
              </div>
              <div className="font-mono text-sm text-fg-primary">
                {progressPct == null ? "unknown" : `${progressPct.toFixed(2)}%`}
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
                  {snapshot.baseProgress == null ? "unknown" : `${(snapshot.baseProgress * 100).toFixed(2)}%`}
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
                  {snapshot.migrationQuoteThreshold && snapshot.quoteDecimals != null
                    ? `${tryFormatAtoms(snapshot.quoteReserve, snapshot.quoteDecimals, 4)} / ${tryFormatAtoms(snapshot.migrationQuoteThreshold, snapshot.quoteDecimals, 4)} ${quoteSymbol}`
                    : "unknown"}
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
                {curvePhase === "migrated"
                  ? "Graduated"
                  : curvePhase === "complete"
                    ? "Curve complete"
                    : curvePhase === "raising"
                      ? "Raising"
                      : "Unknown"}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="ec-card p-5">
        {compact && (
          <h2 className="mb-3 font-semibold text-fg-primary">
            Trade ticket
            <span className="ml-2 text-xs font-normal text-fg-muted">
              Quote · {quoteSymbol}
            </span>
          </h2>
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
            Amount ({direction === "buy" ? quoteSymbol : "base tokens"})
          </span>
          <input
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setQuoteOut(null);
            }}
            inputMode="decimal"
            className="ec-input font-mono"
          />
        </label>

        {quoteOut && (
          <div className="mt-3 rounded-input border border-accent/30 bg-accent/5 px-3 py-2 text-xs">
            <p className="text-fg-muted">
              Quote · expected out{" "}
              <span className="font-mono text-fg-primary">
                {tryFormatAtoms(quoteOut.expectedOut, quoteOut.outputDecimals)}{" "}
                {direction === "buy" ? "tokens" : quoteSymbol}
              </span>
            </p>
            <p className="text-fg-muted">Min amount out (after {quoteOut.slippageBps / 100}% slippage)</p>
            <p className="font-mono text-sm text-accent-soft">
              {tryFormatAtoms(quoteOut.minimumAmountOut, quoteOut.outputDecimals)}{" "}
              {direction === "buy" ? "tokens" : quoteSymbol}
            </p>
            <p className="mt-1 text-[10px] text-fg-muted">
              Exact input: {tryFormatAtoms(quoteOut.amountIn, quoteOut.inputDecimals, quoteOut.inputDecimals)} ·
              anti-sniper fee schedule may apply on first swaps
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
            disabled={busy || !wallet.publicKey || curvePhase !== "raising"}
            title={curvePhase !== "raising" ? "Trading is only enabled when the curve is verified as raising" : undefined}
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

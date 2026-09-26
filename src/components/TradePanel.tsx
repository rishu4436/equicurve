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
import {
  fetchDbcPoolStateKey,
  quoteAndBuildSwap,
  type SwapDirection,
  type SwapQuoteView,
} from "@/lib/dbc/swap";
import { freshnessMessage, quoteFreshness } from "@/lib/trade/quoteFreshness";
import { SwapReview, type SwapReviewRow } from "@/components/trade/SwapReview";
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
  const [notice, setNotice] = useState<string | null>(null);

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

  async function buildQuote(): Promise<SwapQuoteView> {
    return quoteAndBuildSwap({
      connection,
      owner: wallet.publicKey!,
      pool: new PublicKey(poolAddress),
      direction,
      amountUi: amount,
    });
  }

  /** Step 1: quote + build, then show the pre-sign summary. */
  async function onReview() {
    if (!checkGate()) return;
    if (!wallet.publicKey) {
      toast.error("Connect a wallet to quote.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      setQuoteOut(await buildQuote());
    } catch (e) {
      setQuoteOut(null);
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Step 2: re-check freshness right before signing. A quote older than 15s or
   * computed against a pool state that has since changed is rebuilt and must
   * be confirmed again — the user always signs exactly what they reviewed.
   */
  async function onConfirm() {
    if (!checkGate() || !quoteOut) return;
    if (!wallet.publicKey) {
      toast.error("Connect a wallet to swap.");
      return;
    }
    setBusy(true);
    try {
      const key = await fetchDbcPoolStateKey(connection, new PublicKey(poolAddress));
      const f = quoteFreshness(quoteOut, key, Date.now());
      if (!f.fresh) {
        const fresh = await buildQuote();
        setQuoteOut(fresh);
        setNotice(freshnessMessage(f));
        return;
      }
      const sig = await signAndSendTransaction({ connection, wallet, tx: quoteOut.tx });
      pushActivity({
        id: `${sig}-${Date.now()}`,
        pool: poolAddress,
        mint: snapshot?.baseMint,
        kind: direction,
        amount:
          quoteOut.mode === "partial_fill"
            ? tryFormatAtoms(quoteOut.fillableIn, quoteOut.inputDecimals, quoteOut.inputDecimals)
            : amount,
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success("Swap landed — " + sig.slice(0, 8));
      window.open(explorerTxUrl(sig), "_blank");
      setQuoteOut(null);
      setNotice(null);
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
  const outSymbol = direction === "buy" ? "tokens" : quoteSymbol;
  const inSymbol = direction === "buy" ? quoteSymbol : "tokens";

  function reviewRows(q: SwapQuoteView): SwapReviewRow[] {
    const rows: SwapReviewRow[] = [
      {
        label: "Exact input",
        value: `${tryFormatAtoms(q.amountIn, q.inputDecimals, q.inputDecimals)} ${inSymbol}`,
        hint: `${q.amountIn} atoms`,
      },
    ];
    if (q.mode === "partial_fill") {
      rows.push({
        label: "Filled by curve",
        value: `${tryFormatAtoms(q.fillableIn, q.inputDecimals, q.inputDecimals)} ${inSymbol}`,
        hint: `unused ${tryFormatAtoms(q.unusedIn, q.inputDecimals, q.inputDecimals)} ${inSymbol} stays in your wallet`,
      });
    }
    rows.push(
      { label: "Estimated output", value: `${tryFormatAtoms(q.expectedOut, q.outputDecimals)} ${outSymbol}` },
      {
        label: "Minimum output",
        value: `${tryFormatAtoms(q.minimumAmountOut, q.outputDecimals)} ${outSymbol}`,
        strong: true,
      },
      {
        label: "Trading fee",
        value: `${tryFormatAtoms(q.feeAtoms, q.feeDecimals, q.feeDecimals)} ${quoteSymbol}`,
        hint: direction === "buy" ? "taken from input" : "taken from output",
      },
      { label: "Slippage tolerance", value: `${q.slippageBps / 100}%` },
    );
    return rows;
  }

  function reviewNotices(q: SwapQuoteView): { tone: "info" | "warn"; text: string }[] {
    const out: { tone: "info" | "warn"; text: string }[] = [];
    if (notice) out.push({ tone: "warn", text: notice });
    if (q.mode === "partial_fill") {
      out.push({
        tone: "warn",
        text: q.completesCurve
          ? `Your buy is larger than what is left on the curve. It is capped to the fillable amount (${tryFormatAtoms(q.fillableIn, q.inputDecimals, q.inputDecimals)} ${quoteSymbol}); this buy completes the curve and trading closes until migration to DAMM v2.`
          : "This buy lands at the very end of the curve, so it is sent as a partial fill: the program takes only what the curve can fill and never fails with DBC 6033.",
      });
    }
    out.push({ tone: "info", text: "Anti-sniper fee schedule may apply on early swaps; the fee above already reflects it." });
    return out;
  }
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

        {quoteOut ? (
          <SwapReview
            title={direction === "buy" ? "Review buy on curve" : "Review sell on curve"}
            rows={reviewRows(quoteOut)}
            notices={reviewNotices(quoteOut)}
            quotedAt={quoteOut.quotedAt}
            busy={busy}
            onCancel={() => {
              setQuoteOut(null);
              setNotice(null);
            }}
            onConfirm={() => void onConfirm()}
            confirmLabel={direction === "buy" ? "Confirm & sign buy" : "Confirm & sign sell"}
          />
        ) : (
          <>
            <p className="mt-3 text-[11px] text-signal-warn">
              Bonding price ≠ NAV. Review disclosures before trading.
            </p>
            <div className="mt-4">
              <button
                type="button"
                disabled={busy || !wallet.publicKey || curvePhase !== "raising"}
                title={curvePhase !== "raising" ? "Trading is only enabled when the curve is verified as raising" : undefined}
                onClick={() => void onReview()}
                className="ec-btn-primary w-full"
              >
                {busy ? "Quoting…" : direction === "buy" ? "Review buy" : "Review sell"}
              </button>
            </div>
          </>
        )}
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

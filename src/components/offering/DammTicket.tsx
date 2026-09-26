"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { clsx } from "clsx";
import {
  DOCS,
  explorerAddressUrl,
  explorerTxUrl,
  quoteLabelForMint,
} from "@/lib/constants";
import {
  buildClaimPositionFeeTx,
  buildDammSwapTx,
  fetchDammPoolSnapshot,
  fetchUserDammPositions,
  meteoraDammPoolUrl,
  quoteDammSwap,
  resolveDammPoolAddress,
  type DammPoolSnapshot,
  type DammPositionView,
  type DammQuoteResult,
  type DammSwapDirection,
} from "@/lib/damm";
import { tryFormatAtoms } from "@/lib/amounts";
import { toUserMessage } from "@/lib/errors";
import { pushActivity, updateLaunch } from "@/lib/local/launches";
import { signAndSendTransaction } from "@/lib/send";

type Props = {
  dbcPool: string;
  baseMint: string;
  quoteMint: string;
  storedDammPool?: string | null;
  /** DAMM v2 config required by the DBC pool's migrationFeeOption (from chain). */
  dammConfig?: string | null;
  onGateRequired?: () => boolean;
  gateOk?: boolean;
};

function shortAddr(value: string, n = 4) {
  return value.length > 12 ? `${value.slice(0, n)}…${value.slice(-n)}` : value;
}

function formatRaw(raw: string, decimals: number, maxFrac = 6): string {
  return tryFormatAtoms(raw, decimals, maxFrac, raw);
}

export function DammTicket({
  dbcPool,
  baseMint,
  quoteMint,
  storedDammPool,
  dammConfig: dammConfigProp,
  onGateRequired,
  gateOk,
}: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [snap, setSnap] = useState<DammPoolSnapshot | null>(null);
  const [positions, setPositions] = useState<DammPositionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [direction, setDirection] =
    useState<DammSwapDirection>("quote_to_base");
  const [amount, setAmount] = useState("0.1");
  const [quote, setQuote] = useState<DammQuoteResult | null>(null);
  const [busy, setBusy] = useState(false);

  const dammConfig = dammConfigProp ?? null;
  const quoteLabel = quoteLabelForMint(quoteMint);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const resolved = await resolveDammPoolAddress({
        connection,
        baseMint,
        quoteMint,
        storedDammPool,
        dammConfig,
      });
      if (!resolved.address) {
        setSnap(null);
        setPositions([]);
        setError(
          "DAMM v2 pool address could not be derived yet. Confirm migration on Explorer — we never invent an address.",
        );
        return;
      }
      const next = await fetchDammPoolSnapshot({
        connection,
        pool: new PublicKey(resolved.address),
        baseMint,
        quoteMint,
        source: resolved.source,
      });
      setSnap(next);
      // Persist only after the pool account was actually fetched + mint-checked.
      if (next.exists && next.address !== storedDammPool) {
        updateLaunch(dbcPool, { dammPool: next.address });
      }
      if (next.exists && wallet.publicKey) {
        setPositions(
          await fetchUserDammPositions({
            connection,
            pool: new PublicKey(next.address),
            user: wallet.publicKey,
          }),
        );
      } else {
        setPositions([]);
      }
    } catch (e) {
      setError(toUserMessage(e));
      setSnap(null);
      setPositions([]);
    }
  }, [
    connection,
    baseMint,
    quoteMint,
    storedDammPool,
    dammConfig,
    dbcPool,
    wallet.publicKey,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function ensureGate(): boolean {
    if (gateOk === true) return true;
    if (onGateRequired) return onGateRequired();
    return true;
  }

  async function handleQuote() {
    if (!ensureGate()) return;
    if (!snap?.exists || !snap.address) {
      toast.error("DAMM pool not available on-chain yet.");
      return;
    }
    setBusy(true);
    try {
      const q = await quoteDammSwap({
        connection,
        pool: new PublicKey(snap.address),
        snap,
        direction,
        amountUi: amount,
      });
      setQuote(q);
      toast.message(
        `Min out: ${formatRaw(q.minimumAmountOut, q.outputDecimals)}`,
      );
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSwap() {
    if (!ensureGate()) return;
    if (!wallet.publicKey) {
      toast.error("Connect a wallet to swap on DAMM v2.");
      return;
    }
    if (!snap?.exists || !snap.address) {
      toast.error("DAMM pool not available on-chain yet.");
      return;
    }
    setBusy(true);
    try {
      const { tx, quote: q } = await buildDammSwapTx({
        connection,
        payer: wallet.publicKey,
        pool: new PublicKey(snap.address),
        snap,
        direction,
        amountUi: amount,
      });
      setQuote(q);
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      pushActivity({
        id: `${sig}-damm-swap`,
        pool: dbcPool,
        mint: baseMint,
        kind: direction === "quote_to_base" ? "buy" : "sell",
        amount,
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success(`DAMM swap confirmed — ${sig.slice(0, 8)}…`);
      window.open(explorerTxUrl(sig), "_blank");
      await refresh();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClaimFees(pos: DammPositionView) {
    if (!ensureGate()) return;
    if (!wallet.publicKey || !snap?.exists || !snap.address) {
      toast.error("Connect wallet / wait for DAMM pool.");
      return;
    }
    setBusy(true);
    try {
      const tx = await buildClaimPositionFeeTx({
        connection,
        owner: wallet.publicKey,
        pool: new PublicKey(snap.address),
        snap,
        position: new PublicKey(pos.position),
        positionNftAccount: new PublicKey(pos.positionNftAccount),
      });
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      pushActivity({
        id: `${sig}-damm-claim`,
        pool: dbcPool,
        mint: baseMint,
        kind: "claim",
        sig,
        wallet: wallet.publicKey.toBase58(),
        at: new Date().toISOString(),
      });
      toast.success(`Position fees claimed — ${sig.slice(0, 8)}…`);
      window.open(explorerTxUrl(sig), "_blank");
      await refresh();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const statusLabel = useMemo(() => {
    if (!snap) return error ? "Unknown · not verified" : "Resolving…";
    if (!snap.exists) return "Derived address · account not found";
    // Live only after the pool account was fetched and matched this offering's mints.
    return snap.poolStatus === 0
      ? "Live on DAMM v2 · account verified"
      : `Account verified · status code ${snap.poolStatus}`;
  }, [snap, error]);

  return (
    <div className="ec-card space-y-4 border-signal-grad/30 p-5 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-signal-grad">
            Post-grad ticket
          </p>
          <h2 className="mt-0.5 text-lg font-semibold text-signal-grad">
            DAMM v2 pool
          </h2>
          <p className="mt-1 text-xs text-fg-secondary">
            Bonding-curve trading is inactive after migration. This ticket quotes
            and builds real DAMM v2 SDK txs (
            <code className="text-accent-soft">getQuote2</code> /{" "}
            <code className="text-accent-soft">swap2</code>). No fabricated TVL
            or volume.
          </p>
        </div>
        <span
          className={clsx(
            "rounded-pill border px-2.5 py-0.5 text-xs",
            snap?.exists
              ? "border-signal-grad/40 bg-signal-grad/10 text-signal-grad"
              : "border-line bg-subtle text-fg-muted",
          )}
        >
          {statusLabel}
        </span>
      </div>

      {error && (
        <div className="rounded-input border border-signal-warn/30 bg-signal-warn/10 px-3 py-2 text-xs text-signal-warn">
          {error}
        </div>
      )}

      <dl className="space-y-2 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">DAMM pool</dt>
          <dd className="font-mono text-fg-primary">
            {snap?.address ? (
              <a
                href={explorerAddressUrl(snap.address)}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {shortAddr(snap.address, 6)}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Source</dt>
          <dd className="text-fg-secondary">
            {snap?.source === "launch"
              ? "Stored address"
              : snap?.source === "derived"
                ? "Derived from migrationFeeOption config + mints"
                : "Unresolved"}
            {snap && (snap.exists ? " · account fetched" : " · not proof of existence")}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Quote mint</dt>
          <dd className="font-mono">
            {quoteLabel} ·{" "}
            <a
              href={explorerAddressUrl(quoteMint)}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {shortAddr(quoteMint, 4)}
            </a>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Base mint</dt>
          <dd className="font-mono">
            <a
              href={explorerAddressUrl(baseMint)}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              {shortAddr(baseMint, 4)}
            </a>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">DAMM fee config</dt>
          <dd className="font-mono">
            {dammConfig ? (
              <a
                href={explorerAddressUrl(dammConfig)}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:underline"
              >
                {shortAddr(dammConfig, 4)}
              </a>
            ) : (
              "unknown"
            )}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {snap?.address && (
          <>
            <a
              href={explorerAddressUrl(snap.address)}
              target="_blank"
              rel="noreferrer"
              className="ec-btn-secondary text-xs"
            >
              Explorer
            </a>
            <a
              href={meteoraDammPoolUrl(snap.address)}
              target="_blank"
              rel="noreferrer"
              className="ec-btn-secondary text-xs"
            >
              Meteora app
            </a>
          </>
        )}
        <a
          href={DOCS.migration}
          target="_blank"
          rel="noreferrer"
          className="ec-btn-secondary text-xs"
        >
          Migration docs
        </a>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ec-btn-secondary text-xs"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-fg-primary">
          Swap on DAMM v2
        </h3>
        {!snap?.exists ? (
          <p className="text-xs text-fg-muted">
            Swap disabled until the DAMM pool account exists on this cluster.
            After a successful migrate, wait for confirmation then refresh.
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <button
                type="button"
                className={clsx(
                  "ec-btn-secondary flex-1 text-xs",
                  direction === "quote_to_base" && "border-accent text-accent",
                )}
                onClick={() => setDirection("quote_to_base")}
              >
                Buy base with {quoteLabel}
              </button>
              <button
                type="button"
                className={clsx(
                  "ec-btn-secondary flex-1 text-xs",
                  direction === "base_to_quote" && "border-accent text-accent",
                )}
                onClick={() => setDirection("base_to_quote")}
              >
                Sell base for {quoteLabel}
              </button>
            </div>
            <label className="block text-xs text-fg-muted">
              Amount (
              {direction === "quote_to_base" ? quoteLabel : "base tokens"})
              <input
                className="ec-input mt-1 w-full"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </label>
            {quote && (
              <div className="rounded-input border border-line bg-subtle px-3 py-2 text-xs text-fg-secondary">
                <p>
                  Est. out:{" "}
                  <span className="font-mono text-fg-primary">
                    {formatRaw(quote.amountOut, quote.outputDecimals)}
                  </span>
                </p>
                <p>
                  Min out:{" "}
                  <span className="font-mono text-fg-primary">
                    {formatRaw(quote.minimumAmountOut, quote.outputDecimals)}
                  </span>
                </p>
                {quote.priceImpactPct != null && (
                  <p>Price impact: {quote.priceImpactPct}%</p>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy || !wallet.publicKey}
                onClick={() => void handleQuote()}
                className="ec-btn-secondary flex-1"
              >
                {busy ? "Working…" : "Quote"}
              </button>
              <button
                type="button"
                disabled={busy || !wallet.publicKey}
                onClick={() => void handleSwap()}
                className="ec-btn-primary flex-1"
              >
                {busy ? "Working…" : "Swap"}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-fg-primary">
          Your LP positions
        </h3>
        {!wallet.publicKey ? (
          <p className="text-xs text-fg-muted">
            Connect a wallet to load positions.
          </p>
        ) : positions.length === 0 ? (
          <p className="text-xs text-fg-muted">
            No DAMM v2 positions for this wallet on this pool. Add-liquidity UI
            is not wired yet — migration creates position NFTs for the migrator;
            claim fees below when you hold one.
          </p>
        ) : (
          <ul className="space-y-2">
            {positions.map((p) => {
              const claimable =
                p.feeAPending !== "0" || p.feeBPending !== "0";
              return (
                <li
                  key={p.position}
                  className="rounded-input border border-line bg-subtle px-3 py-2 text-xs"
                >
                  <p className="font-mono text-fg-primary">
                    <a
                      href={explorerAddressUrl(p.position)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      {shortAddr(p.position, 6)}
                    </a>
                  </p>
                  <p className="mt-1 text-fg-muted">
                    Unlocked liquidity:{" "}
                    <span className="font-mono text-fg-secondary">
                      {p.unlockedLiquidity}
                    </span>
                  </p>
                  <p className="text-fg-muted">
                    Pending fees A/B:{" "}
                    <span className="font-mono text-fg-secondary">
                      {snap?.exists
                        ? `${formatRaw(p.feeAPending, snap.tokenADecimals)} / ${formatRaw(p.feeBPending, snap.tokenBDecimals)}`
                        : `${p.feeAPending} / ${p.feeBPending} (atoms)`}
                    </span>
                  </p>
                  <button
                    type="button"
                    disabled={busy || !claimable}
                    onClick={() => void handleClaimFees(p)}
                    className="ec-btn-secondary mt-2 text-xs"
                  >
                    {claimable ? "Claim position fees" : "No fees to claim"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-fg-muted">
          Deferred: in-app add/remove liquidity builders. Use Meteora or the SDK
          directly for LP deposits beyond migration-created positions.
        </p>
      </div>
    </div>
  );
}

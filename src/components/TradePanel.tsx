"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/constants";
import { fetchPoolSnapshot } from "@/lib/dbc/migrate";
import { quoteAndBuildSwap, type SwapDirection } from "@/lib/dbc/swap";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { toUserMessage } from "@/lib/errors";
import { signAndSendTransaction } from "@/lib/send";

export function TradePanel({ poolAddress }: { poolAddress: string }) {
  const { connection } = useConnection();
  const wallet = useWallet();
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

  async function onQuote() {
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
      toast.success("Swap landed — " + sig.slice(0, 8));
      window.open(explorerTxUrl(sig), "_blank");
      await refresh();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-fg-primary">Trade on curve</h1>
          <p className="mt-1 font-mono text-xs text-fg-secondary">
            <a
              href={explorerAddressUrl(poolAddress)}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {poolAddress}
            </a>
          </p>
        </div>
        <Link
          href={`/graduate/${poolAddress}`}
          className="rounded-input border rounded-pill border border-gold/30 bg-gold/10 px-3 py-1.5 text-sm text-gold-soft"
        >
          Graduation panel →
        </Link>
      </div>

      {error && (
        <div className="rounded-input border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
          <p className="mt-1 text-xs text-red-300/80">
            Pool may not exist on this cluster, or RPC is unavailable. Set
            NEXT_PUBLIC_RPC_URL.
          </p>
        </div>
      )}

      {snapshot && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            {
              label: "Quote progress",
              value: `${(snapshot.quoteProgress * 100).toFixed(2)}%`,
            },
            {
              label: "Base progress",
              value: `${(snapshot.baseProgress * 100).toFixed(2)}%`,
            },
            {
              label: "Migrated",
              value: snapshot.isMigrated ? "yes" : "no",
            },
            {
              label: "Threshold",
              value: snapshot.migrationThreshold
                ? snapshot.migrationThreshold.slice(0, 12) + "…"
                : "—",
            },
          ].map((m) => (
            <div
              key={m.label}
              className="rounded-input border border-line bg-elevated p-3"
            >
              <div className="text-[10px] uppercase tracking-wider text-fg-muted">
                {m.label}
              </div>
              <div className="mt-1 font-mono text-sm text-fg-primary">{m.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-card border border-line bg-elevated p-5">
        <div className="mb-4 flex gap-2">
          {(["buy", "sell"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`rounded-input px-4 py-1.5 text-sm capitalize ${
                direction === d
                  ? "bg-accent text-ink-950"
                  : "bg-subtle text-fg-secondary"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs uppercase tracking-wider text-fg-muted">
            Amount ({direction === "buy" ? "SOL" : "base tokens"})
          </span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-input border border-line bg-subtle px-3 py-2.5 text-sm outline-none ring-accent/40 focus:ring-2"
          />
        </label>
        {quoteOut && (
          <p className="mt-2 font-mono text-xs text-fg-secondary">
            min out: {quoteOut}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void onQuote()}
            className="flex-1 rounded-input border border-line px-4 py-2.5 text-sm"
          >
            Quote
          </button>
          <button
            type="button"
            disabled={busy || !wallet.publicKey}
            onClick={() => void onSwap()}
            className="flex-1 rounded-input bg-accent px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
          >
            {busy ? "Working…" : "Swap"}
          </button>
        </div>
      </div>
    </div>
  );
}

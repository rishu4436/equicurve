"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { getCluster, getRpcHost } from "@/lib/constants";

/**
 * Always-visible network honesty strip. Wallet adapters do not reliably expose
 * the wallet's selected cluster, so we surface the app RPC cluster and tip users
 * to match it (wrong-network txs fail at simulation / send).
 */
export function ClusterBanner() {
  const wallet = useWallet();
  const cluster = getCluster();
  const host = getRpcHost();
  const warn = cluster === "devnet" || cluster === "testnet";

  return (
    <div
      role="status"
      className={
        warn
          ? "border-b border-signal-warn/30 bg-signal-warn/10 text-signal-warn"
          : "border-b border-line bg-elevated/80 text-fg-muted"
      }
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-1.5 text-[11px] sm:text-xs">
        <p>
          App RPC: <span className="font-mono font-medium">{cluster}</span>
          <span className="text-fg-muted"> · {host}</span>
          {wallet.connected && (
            <span className="text-fg-muted">
              {" "}
              · wallet connected — set it to <strong>{cluster}</strong> or
              transactions will fail
            </span>
          )}
        </p>
        <Link
          href="/settings"
          className="shrink-0 underline decoration-transparent hover:decoration-current"
        >
          Settings
        </Link>
      </div>
    </div>
  );
}

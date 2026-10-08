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
          ? "border-b border-line/60 bg-elevated/50 text-fg-secondary"
          : "border-b border-line bg-elevated/80 text-fg-muted"
      }
    >
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-2 px-5 py-2 text-xs sm:px-8">
        <p>
          <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${warn ? "bg-signal-warn" : "bg-accent"}`} aria-hidden="true" />
          <span className="font-medium capitalize">{cluster}</span>{warn && " · Test network"}
          <span className="hidden text-fg-muted sm:inline"> · {host}</span>
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
          Network settings ↗
        </Link>
      </div>
    </div>
  );
}

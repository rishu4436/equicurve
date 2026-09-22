"use client";

import Link from "next/link";
import { DBC_PROGRAM_ID, DAMM_V2_PROGRAM, getCluster } from "@/lib/constants";

export function AppFooter() {
  const cluster = getCluster();
  return (
    <footer className="border-t border-line bg-elevated/80">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 text-xs text-fg-muted sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className={
              cluster === "devnet"
                ? "rounded-pill border border-signal-warn/40 bg-signal-warn/10 px-2 py-0.5 text-signal-warn"
                : "rounded-pill border border-line px-2 py-0.5"
            }
          >
            Network: {cluster}
          </span>
          <span>Powered by Meteora DBC → DAMM v2</span>
          <Link href="/trust" className="text-accent hover:underline">
            Trust Center
          </Link>
        </div>
        <div className="flex flex-wrap gap-3 font-mono text-[10px]">
          <span title={DBC_PROGRAM_ID.toBase58()}>
            DBC {DBC_PROGRAM_ID.toBase58().slice(0, 6)}…
          </span>
          <span title={DAMM_V2_PROGRAM.toBase58()}>
            DAMM {DAMM_V2_PROGRAM.toBase58().slice(0, 6)}…
          </span>
        </div>
      </div>
    </footer>
  );
}

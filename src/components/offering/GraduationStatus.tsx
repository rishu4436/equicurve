"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import type { Connection } from "@solana/web3.js";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";
import {
  deriveGraduationView,
  type DestinationCheck,
  type GraduationState,
  type GraduationView,
  type MigrationTxPhase,
} from "@/lib/dbc/curveState";
import {
  expectedDammDestination,
  migrationConfigForSnapshot,
  verifyDammV2Pool,
} from "@/lib/dbc/migrate";
import type { PoolSnapshot } from "@/lib/dbc/types";
import { explorerAddressUrl } from "@/lib/constants";

const STYLES: Record<GraduationState, string> = {
  unknown: "border-line bg-subtle text-fg-muted",
  not_eligible: "border-line bg-subtle text-fg-secondary",
  eligible: "border-gold/40 bg-gold/10 text-gold",
  submitted: "border-accent/40 bg-accent/10 text-accent-soft",
  confirmed: "border-signal-warn/40 bg-signal-warn/10 text-signal-warn",
  destination_verified: "border-signal-grad/40 bg-signal-grad/10 text-signal-grad",
  failed: "border-signal-danger/40 bg-signal-danger/10 text-signal-danger",
};

/** Poll the expected DAMM v2 pool account until it exists (or attempts run out). */
export async function pollDammDestination(
  connection: Connection,
  snap: PoolSnapshot,
  opts: { attempts?: number; delayMs?: number; onUpdate?: (d: DestinationCheck) => void } = {},
): Promise<DestinationCheck> {
  const dest = expectedDammDestination(snap);
  if (!dest) return "missing";
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 2000;
  let last: DestinationCheck = "checking";
  for (let i = 0; i < attempts; i++) {
    opts.onUpdate?.("checking");
    last = await verifyDammV2Pool(connection, dest.dammPool);
    if (last === "exists") break;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  opts.onUpdate?.(last);
  return last;
}

/**
 * Destination check for already-migrated pools (read-only views).
 * Returns "unchecked" until the pool is migrated on-chain.
 */
export function useDammDestination(snapshot: PoolSnapshot | null): DestinationCheck {
  const { connection } = useConnection();
  const [dest, setDest] = useState<DestinationCheck>("unchecked");
  const migrated = snapshot?.curve.phase === "migrated";
  useEffect(() => {
    if (!snapshot || !migrated) {
      setDest("unchecked");
      return;
    }
    let cancelled = false;
    void pollDammDestination(connection, snapshot, {
      attempts: 1,
      onUpdate: (d) => !cancelled && setDest(d),
    });
    return () => {
      cancelled = true;
    };
  }, [connection, snapshot, migrated]);
  return dest;
}

export function useGraduationView(args: {
  snapshot: PoolSnapshot | null;
  readFailed?: boolean;
  tx?: MigrationTxPhase;
  destination: DestinationCheck;
  txError?: string | null;
}): GraduationView {
  const { snapshot, readFailed, tx = "idle", destination, txError } = args;
  return useMemo(
    () =>
      deriveGraduationView({
        curve: readFailed || !snapshot ? null : snapshot.curve,
        tx,
        destination,
        config: snapshot ? migrationConfigForSnapshot(snapshot) : null,
        txError,
      }),
    [snapshot, readFailed, tx, destination, txError],
  );
}

export function GraduationStatusCard({
  view,
  snapshot,
  compact = false,
}: {
  view: GraduationView;
  snapshot: PoolSnapshot | null;
  compact?: boolean;
}) {
  const dest = snapshot ? expectedDammDestination(snapshot) : null;
  return (
    <div className={clsx("rounded-input border px-3 py-2 text-xs", STYLES[view.state])}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">{view.label}</span>
        <span className="font-mono text-[10px] opacity-80">{view.state.replace("_", " ")}</span>
      </div>
      {!compact && <p className="mt-1 opacity-90">{view.detail}</p>}
      {!compact && dest && (
        <p className="mt-1 break-all text-[10px] opacity-80">
          Expected DAMM v2 pool{" "}
          <a
            className="underline"
            href={explorerAddressUrl(dest.dammPool.toBase58())}
            target="_blank"
            rel="noreferrer"
          >
            {dest.dammPool.toBase58()}
          </a>{" "}
          (derived address — live only once the account is fetched)
        </p>
      )}
    </div>
  );
}

"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { signAndSendTransaction } from "@/lib/send";

export function GraduatePanel({ poolAddress }: { poolAddress: string }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
    try {
      const { tx, progress } = await prepareDammV2Migration({
        connection,
        payer: wallet.publicKey,
        pool: new PublicKey(poolAddress),
      });
      const sig = await signAndSendTransaction({ connection, wallet, tx });
      toast.success(
        `Migrated at ${(progress * 100).toFixed(2)}% — ${sig.slice(0, 8)}…`,
      );
      window.open(explorerTxUrl(sig), "_blank");
      await refresh();
    } catch (e) {
      toast.error(toUserMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    !!snapshot && (snapshot.quoteProgress >= 0.999 || snapshot.isMigrated);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-semibold text-fg-primary">Graduate → DAMM v2</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          When the bonding curve hits its migration quote threshold, DBC can
          graduate into Meteora DAMM v2. Mainnet keepers automate this; on
          devnet we build{" "}
          <code className="text-accent-soft">migrateToDammV2</code> for manual
          migrators. See{" "}
          <a
            className="underline"
            href={DOCS.migration}
            target="_blank"
            rel="noreferrer"
          >
            migration docs
          </a>
          .
        </p>
      </div>

      <div className="rounded-card border border-line bg-elevated p-5 text-sm">
        <dl className="space-y-2">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Pool</dt>
            <dd className="font-mono text-xs">
              <a
                href={explorerAddressUrl(poolAddress)}
                target="_blank"
                rel="noreferrer"
                className="underline"
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
                className="underline"
              >
                {dammConfig.slice(0, 16)}…
              </a>
            </dd>
          </div>
          {snapshot && (
            <>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Curve progress</dt>
                <dd className="font-mono">
                  {(snapshot.quoteProgress * 100).toFixed(2)}%
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Already migrated?</dt>
                <dd>{snapshot.isMigrated ? "yes" : "no"}</dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {error && (
        <div className="rounded-input border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="rounded-input border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-100/90">
        <strong className="text-amber-200">Readiness gate:</strong> migrate
        builds a real SDK transaction only when quote progress ≥ ~100%. Until
        then this panel shows live progress so judges can see the graduation
        path.
      </div>

      <button
        type="button"
        disabled={busy || !wallet.publicKey || !ready}
        onClick={() => void onMigrate()}
        className="w-full rounded-input bg-accent px-4 py-3 text-sm font-semibold text-ink-950 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy
          ? "Building migration…"
          : ready
            ? "Migrate to DAMM v2"
            : "Waiting for curve completion"}
      </button>
    </div>
  );
}

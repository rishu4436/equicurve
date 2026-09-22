"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getCluster, getRpcHost } from "@/lib/constants";
import { clearEligibility } from "@/lib/local/eligibility";
import {
  clearLocalLaunchData,
  listActivity,
  listLaunches,
} from "@/lib/local/launches";

type Health = {
  ok: boolean;
  cluster?: string;
  rpcHost?: string;
  slot?: number | null;
  error?: string | null;
};

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [launchCount, setLaunchCount] = useState(0);
  const [activityCount, setActivityCount] = useState(0);

  const refreshLocal = useCallback(() => {
    setLaunchCount(listLaunches().length);
    setActivityCount(listActivity().length);
  }, []);

  useEffect(() => {
    refreshLocal();
    void fetch("/api/health")
      .then((r) => r.json())
      .then((j: Health) => setHealth(j))
      .catch(() =>
        setHealth({ ok: false, error: "Health endpoint unreachable" }),
      );
  }, [refreshLocal]);

  const cluster = getCluster();
  const rpcHost = health?.rpcHost ?? getRpcHost();

  return (
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <header>
        <p className="text-xs text-fg-muted">
          <Link href="/" className="hover:text-accent">
            Home
          </Link>
          {" / "}
          Settings
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-fg-primary">Settings</h1>
        <p className="mt-1 text-sm text-fg-secondary">
          Network display, RPC host (env-based), and local browser storage.
        </p>
      </header>

      <section className="ec-card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-fg-primary">Network</h2>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Cluster</dt>
            <dd className="font-mono text-fg-primary">{cluster}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">RPC host</dt>
            <dd className="break-all font-mono text-xs text-fg-primary">
              {rpcHost}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Health</dt>
            <dd className="text-fg-primary">
              {health == null
                ? "…"
                : health.ok
                  ? `ok · slot ${health.slot ?? "—"}`
                  : health.error ?? "down"}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-fg-muted">
          RPC URL is set via{" "}
          <code className="text-accent-soft">NEXT_PUBLIC_RPC_URL</code> at build /
          start time — there is no in-browser override (avoids leaking keys into
          localStorage). Restart the app after changing{" "}
          <code className="text-accent-soft">.env.local</code>.
        </p>
        <Link href="/trust" className="text-sm text-accent hover:underline">
          Trust Center →
        </Link>
      </section>

      <section className="ec-card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-fg-primary">
          Local browser data
        </h2>
        <p className="text-xs text-fg-muted">
          Launches and activity live in this browser only (no indexer). Clearing
          does not affect on-chain pools.
        </p>
        <p className="font-mono text-xs text-fg-secondary">
          {launchCount} launches · {activityCount} activity rows
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="ec-btn-secondary"
            onClick={() => {
              clearLocalLaunchData();
              refreshLocal();
              toast.message("Cleared local launches & activity");
            }}
          >
            Clear launches / activity
          </button>
          <button
            type="button"
            className="ec-btn-secondary"
            onClick={() => {
              clearEligibility();
              toast.message("Cleared eligibility attestation");
            }}
          >
            Clear eligibility
          </button>
        </div>
      </section>
    </main>
  );
}

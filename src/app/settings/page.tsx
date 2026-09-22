"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getCluster, getRpcHost, getOptionalPoolConfigKey } from "@/lib/constants";
import { clearEligibility } from "@/lib/local/eligibility";
import {
  clearLocalLaunchData,
  listActivity,
  listLaunches,
} from "@/lib/local/launches";
import type { RegistryBackend } from "@/lib/registry/types";

type Health = {
  ok: boolean;
  cluster?: string;
  rpcHost?: string;
  slot?: number | null;
  error?: string | null;
  registry?: { backend?: RegistryBackend };
};

type RegistryInfo = {
  ok?: boolean;
  count?: number;
  label?: string;
  error?: string;
  registry?: { backend?: RegistryBackend };
};

export default function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [launchCount, setLaunchCount] = useState(0);
  const [activityCount, setActivityCount] = useState(0);
  const [registry, setRegistry] = useState<RegistryInfo | null>(null);

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
    void fetch("/api/launches")
      .then((r) => r.json())
      .then((j: RegistryInfo) => setRegistry(j))
      .catch(() => setRegistry({ ok: false, error: "Registry unreachable" }));
  }, [refreshLocal]);

  const cluster = getCluster();
  const rpcHost = health?.rpcHost ?? getRpcHost();
  const sharedConfig = getOptionalPoolConfigKey()?.toBase58() ?? null;
  const backend =
    registry?.registry?.backend ?? health?.registry?.backend ?? null;

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
          Network display, RPC host (env-based), discovery source, and local
          browser storage.
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
          Explore discovery
        </h2>
        <p className="text-xs text-fg-muted">
          <strong className="text-fg-secondary">
            EquiCurve registry (not a full chain indexer).
          </strong>{" "}
          Successful Create calls{" "}
          <code className="text-accent-soft">POST /api/launches</code>; Explore
          reads{" "}
          <code className="text-accent-soft">GET /api/explore</code> (registry +
          best-effort on-chain progress, ~45s cache). Meteora’s DBC Data API
          lists all DBC pools but cannot filter EquiCurve offerings — we do not
          dump unlabeled meme markets onto the board. Full-program GPA is
          avoided on public RPC.
        </p>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Registry backend</dt>
            <dd className="font-mono text-fg-primary">
              {backend == null
                ? "…"
                : backend === "upstash"
                  ? "upstash (durable)"
                  : "file (local JSON)"}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Registry entries</dt>
            <dd className="font-mono text-fg-primary">
              {registry == null
                ? "…"
                : registry.error
                  ? registry.error
                  : String(registry.count ?? 0)}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-fg-muted">Shared PoolConfig</dt>
            <dd className="break-all font-mono text-xs text-fg-primary">
              {sharedConfig ?? "not set (create-per-launch config)"}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-fg-muted">
          Default for <code className="text-accent-soft">next dev</code> is the
          local file under{" "}
          <code className="text-accent-soft">data/launches/</code>. On Vercel /
          serverless, set{" "}
          <code className="text-accent-soft">UPSTASH_REDIS_REST_URL</code> +{" "}
          <code className="text-accent-soft">UPSTASH_REDIS_REST_TOKEN</code> for
          durable storage across deploys. Tokens are never exposed in the UI —
          only the backend name.
        </p>
        {sharedConfig && (
          <p className="text-xs text-fg-muted">
            When{" "}
            <code className="text-accent-soft">NEXT_PUBLIC_POOL_CONFIG_KEY</code>{" "}
            is set, Explore also runs a filtered{" "}
            <code className="text-accent-soft">getPoolsByConfig</code> GPA
            (memcmp) as supplemental discovery.
          </p>
        )}
        <Link href="/explore" className="text-sm text-accent hover:underline">
          Open Explore →
        </Link>
      </section>

      <section className="ec-card space-y-3 p-5">
        <h2 className="text-sm font-semibold text-fg-primary">
          Local browser data
        </h2>
        <p className="text-xs text-fg-muted">
          Launches and activity in this browser (localStorage). Clearing does
          not remove shared registry entries or on-chain pools.
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

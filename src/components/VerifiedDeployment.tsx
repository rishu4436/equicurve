"use client";

import { useEffect, useState } from "react";
import type { PublicDeployment } from "@/lib/registry/publicDeployments";

function devnetUrl(kind: "tx" | "address", value: string): string {
  return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
}

/**
 * Recorded public-devnet readback. Shown only when every recorded check passed.
 * This is the deploy proof, not a fresh chain read on this page view.
 */
export function VerifiedDeployment({ pool }: { pool: string }) {
  const [row, setRow] = useState<PublicDeployment | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/deployments/${encodeURIComponent(pool)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { ok?: boolean; deployment?: PublicDeployment } | null) => {
        if (!cancel && json?.ok && json.deployment) setRow(json.deployment);
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  }, [pool]);

  if (!row) return null;
  const checks = [
    ["Design fingerprint matches", row.checks.fingerprint],
    ["Pool configuration matches", row.checks.poolConfiguration],
    ["Migration threshold matches", row.checks.migrationThreshold],
    ["On-chain readback passed", row.checks.readback],
  ] as const;
  if (!row.readbackPassed || checks.some(([, ok]) => !ok)) return null;

  return (
    <section
      role="status"
      data-testid="verified-deployment"
      className="ec-card space-y-3 border-accent/40 p-4"
    >
      <div>
        <p className="text-sm font-semibold text-fg-primary">Deployment verified</p>
        <p className="text-xs text-fg-secondary">Solana Devnet</p>
      </div>
      <ul className="space-y-1 text-xs text-fg-secondary">
        {checks.map(([label]) => (
          <li key={label}>✓ {label}</li>
        ))}
      </ul>
      <p className="font-mono text-[10px] text-fg-muted">Fingerprint {row.fingerprint}</p>
      {row.constraintsPassed === false && (
        <p className="text-xs text-fg-secondary">
          This design did not meet every issuer constraint. The checks above are the on-chain match.
        </p>
      )}
      <div className="flex flex-wrap gap-3 text-xs">
        <a
          href={devnetUrl("tx", row.transaction)}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-accent"
        >
          View transaction
        </a>
        <a
          href={devnetUrl("address", row.pool)}
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-accent"
        >
          View pool
        </a>
      </div>
    </section>
  );
}

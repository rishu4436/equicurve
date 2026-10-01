"use client";

import { useEffect, useState } from "react";
import {
  verifiedPanelVisible,
  type DeploymentCheckFlags,
} from "@/lib/dbc/deploymentReadback";
import type { ResolvedDeployment } from "@/lib/registry/design";

function devnetUrl(kind: "tx" | "address", value: string): string {
  return `https://explorer.solana.com/${kind}/${value}?cluster=devnet`;
}

type DeploymentResponse = {
  ok?: boolean;
  verified?: boolean;
  reason?: string | null;
  checks?: DeploymentCheckFlags | null;
  source?: "registry" | "catalog";
  deployment?: ResolvedDeployment;
};

/**
 * Live public-devnet readback. The verified heading is rendered only when the
 * server comparison of fingerprint, config, threshold, and readback all passed.
 */
export function VerifiedDeployment({ pool }: { pool: string }) {
  const [body, setBody] = useState<DeploymentResponse | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/deployments/${encodeURIComponent(pool)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json: DeploymentResponse | null) => {
        if (!cancel) setBody(json);
      })
      .catch(() => {
        if (!cancel) setBody({ ok: false, verified: false, reason: "rpc_unavailable" });
      });
    return () => {
      cancel = true;
    };
  }, [pool]);

  if (!body) return null;
  const row = body.deployment;
  if (verifiedPanelVisible(body) && row) {
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
          <li>✓ Design fingerprint matches</li>
          <li>✓ Pool configuration matches</li>
          <li>✓ Migration threshold matches</li>
          <li>✓ On-chain readback passed</li>
        </ul>
        <p className="font-mono text-[10px] text-fg-muted">Fingerprint {row.fingerprint}</p>
        {row.constraintsPassed === false && (
          <p className="text-xs text-fg-secondary">
            This design did not meet every issuer constraint. The checks above are the on-chain match.
          </p>
        )}
        <div className="flex flex-wrap gap-3 text-xs">
          {row.transaction ? (
            <a
              href={devnetUrl("tx", row.transaction)}
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-accent"
            >
              View transaction
            </a>
          ) : null}
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

  if (!row) return null;
  const message =
    body.reason === "rpc_unavailable"
      ? "On-chain check unavailable. This market is not marked deployment verified."
      : "On-chain readback did not match the recorded design.";
  return (
    <section role="status" data-testid="deployment-check" className="ec-card p-4">
      <p className="text-xs text-fg-secondary">{message}</p>
    </section>
  );
}

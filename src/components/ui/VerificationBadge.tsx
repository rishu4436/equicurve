import { clsx } from "clsx";
import type { OfferingVerification } from "@/lib/explore/types";
import { verificationLabel } from "@/lib/explore/verification";

const STYLES: Record<OfferingVerification["state"], string> = {
  verified: "border-accent/40 bg-accent/10 text-accent-soft",
  not_found: "border-signal-danger/40 bg-signal-danger/10 text-signal-danger",
  rpc_unavailable: "border-signal-warn/40 bg-signal-warn/10 text-signal-warn",
  not_checked: "border-line bg-subtle text-fg-muted",
};

/** Relative "Last checked" label from an ISO time (null → "never"). */
export function formatLastChecked(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return new Date(t).toLocaleDateString();
}

export function VerificationBadge({
  verification,
  compact = false,
}: {
  verification: OfferingVerification;
  compact?: boolean;
}) {
  const title = [
    verificationLabel(verification.state),
    `cluster: ${verification.cluster}`,
    `last checked: ${verification.checkedAt ?? "never"}`,
    verification.error ? `error: ${verification.error}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
      className={clsx(
        "inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[10px]",
        STYLES[verification.state],
      )}
    >
      {verificationLabel(verification.state)}
      {!compact && (
        <span className="opacity-80">
          · {verification.cluster} · checked {formatLastChecked(verification.checkedAt)}
        </span>
      )}
    </span>
  );
}

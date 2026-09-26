import { clsx } from "clsx";

const STYLES = {
  raising: "border-signal-raise/40 bg-signal-raise/10 text-signal-raise",
  graduated: "border-signal-grad/40 bg-signal-grad/10 text-signal-grad",
  new: "border-accent/40 bg-accent/10 text-accent-soft",
  draft: "border-line bg-subtle text-fg-muted",
  complete: "border-gold/40 bg-gold/10 text-gold",
  unknown: "border-line bg-subtle text-fg-muted",
} as const;

/**
 * Status chip. `unverified` marks a status that was NOT read on-chain in this
 * view (registry / browser value) so it is never presented as verified.
 */
export function StatusPill({
  status,
  unverified = false,
}: {
  status: keyof typeof STYLES | string;
  unverified?: boolean;
}) {
  const key = (status in STYLES ? status : "draft") as keyof typeof STYLES;
  const label =
    status === "raising"
      ? "Raising"
      : status === "graduated"
        ? "Graduated · DAMM v2"
        : status === "new"
          ? "New"
          : status === "complete"
            ? "Curve complete"
            : status === "unknown"
              ? "Status unknown"
              : String(status);

  return (
    <span
      className={clsx("ec-chip border", STYLES[key], unverified && "border-dashed opacity-80")}
      title={unverified ? "Last known status — not verified on-chain in this view" : undefined}
    >
      {label}
      {unverified && status !== "unknown" && <span className="ml-1 text-[9px] opacity-80">(unverified)</span>}
    </span>
  );
}

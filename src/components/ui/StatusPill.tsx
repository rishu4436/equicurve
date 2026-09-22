import { clsx } from "clsx";

const STYLES = {
  raising: "border-signal-raise/40 bg-signal-raise/10 text-signal-raise",
  graduated: "border-signal-grad/40 bg-signal-grad/10 text-signal-grad",
  new: "border-accent/40 bg-accent/10 text-accent-soft",
  draft: "border-line bg-subtle text-fg-muted",
  complete: "border-gold/40 bg-gold/10 text-gold",
} as const;

export function StatusPill({
  status,
}: {
  status: keyof typeof STYLES | string;
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
            : String(status);

  return (
    <span className={clsx("ec-chip border capitalize", STYLES[key])}>
      {label}
    </span>
  );
}

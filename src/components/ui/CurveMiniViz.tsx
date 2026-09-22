/** Simple SVG bonding-curve shapes for presets. */
export function CurveMiniViz({
  preset,
  className = "",
}: {
  preset: "flat" | "exponential" | "long" | "equity" | "short";
  className?: string;
}) {
  const paths: Record<string, string> = {
    short: "M4 40 C 20 36, 35 22, 76 8",
    flat: "M4 40 C 30 36, 50 28, 76 12",
    exponential: "M4 44 C 18 42, 28 38, 40 28 S 60 8, 76 4",
    long: "M4 42 C 40 40, 55 34, 76 10",
    equity: "M4 40 C 25 38, 45 30, 76 14",
  };
  const d = paths[preset] ?? paths.flat;

  return (
    <svg viewBox="0 0 80 48" className={className} aria-hidden fill="none">
      <path d="M4 44 H76" stroke="#243044" strokeWidth="1" />
      <path d="M4 4 V44" stroke="#243044" strokeWidth="1" />
      <path
        d={d}
        stroke="url(#curveGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="64"
        y1="4"
        x2="76"
        y2="4"
        stroke="#A78BFA"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id="curveGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#2DD4BF" />
          <stop offset="100%" stopColor="#38BDF8" />
        </linearGradient>
      </defs>
    </svg>
  );
}

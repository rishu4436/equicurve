"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { reconstructPoolPriceHistory } from "@/lib/dbc/priceHistory";
import {
  loadPriceHistory,
  mergePricePoints,
  type PricePoint,
} from "@/lib/local/priceHistory";

type Props = {
  poolAddress: string | null;
  quoteLabel: string;
  /** 0–1 on-chain quote progress for the theoretical curve overlay. */
  progress: number;
  /** Demo / empty — show curve shape only, no fake history. */
  illustrative?: boolean;
  /** Graduation price ÷ start price for the theoretical shape (preset). */
  priceMultiple?: number;
};

function formatPrice(p: number, quote: string): string {
  if (!(p > 0) || !Number.isFinite(p)) return "—";
  if (p >= 1) return `${p.toPrecision(4)} ${quote}`;
  if (p >= 0.0001) return `${p.toFixed(6)} ${quote}`;
  return `${p.toExponential(2)} ${quote}`;
}

function formatTime(t: number): string {
  try {
    return new Date(t).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/**
 * Theoretical price vs raise progress for a single constant-liquidity DBC
 * segment: √P moves linearly with quote raised, so
 * P(x) / P0 = (1 + x(√m − 1))², x ∈ [0,1] = share of the threshold raised,
 * m = graduation / start price. Returned normalized to 0–1 (shape only).
 */
export function curveShapeYs(priceMultiple: number, n = 32): number[] {
  const m = Math.max(priceMultiple, 1.0001);
  const r = Math.sqrt(m) - 1;
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = i / n;
    ys.push(((1 + x * r) ** 2 - 1) / (m - 1));
  }
  return ys;
}

function ChartSvg({
  history,
  spot,
  quoteLabel,
  progress,
  priceMultiple,
  mode,
}: {
  history: PricePoint[];
  spot: number | null;
  quoteLabel: string;
  progress: number;
  priceMultiple: number;
  mode: "live" | "illustrative" | "thin";
}) {
  const w = 360;
  const h = 160;
  const padL = 48;
  const padR = 16;
  const padT = 28;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;

  // Only chain-derived swap prices form the history line.
  const swapPts = history.filter((p) => p.source === "swap");
  const series =
    swapPts.length > 0
      ? swapPts
      : spot != null
        ? [{ t: Date.now(), price: spot, source: "spot" as const }]
        : [];

  const prices = series.map((p) => p.price);
  if (spot != null) prices.push(spot);
  const minP = prices.length ? Math.min(...prices) : 0;
  const maxP = prices.length ? Math.max(...prices) : 1;
  const span = Math.max(maxP - minP, maxP * 0.05, 1e-12);
  const yMin = Math.max(0, minP - span * 0.12);
  const yMax = maxP + span * 0.12;

  const tMin = series.length ? series[0].t : Date.now() - 3_600_000;
  const tMax = series.length ? series[series.length - 1].t : Date.now();
  const tSpan = Math.max(tMax - tMin, 60_000);

  const xOf = (t: number) => padL + ((t - tMin) / tSpan) * innerW;
  const yOf = (price: number) =>
    padT + innerH - ((price - yMin) / (yMax - yMin || 1)) * innerH;

  const histLine =
    series.length >= 2
      ? series.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t)},${yOf(p.price)}`).join(" ")
      : null;

  // Theoretical overlay: x = raise progress (0→100% of threshold), NOT time;
  // y normalized into chart height, NOT on the price axis scale.
  const shapeYs = curveShapeYs(priceMultiple);
  const pClamped = Math.min(1, Math.max(0, progress));
  const shapeNowX = padL + pClamped * innerW;
  const shapeNowY = padT + innerH - (((1 + pClamped * (Math.sqrt(Math.max(priceMultiple, 1.0001)) - 1)) ** 2 - 1) / (Math.max(priceMultiple, 1.0001) - 1)) * innerH;
  const shapePts = shapeYs
    .map((ny, i) => {
      const x = padL + (i / (shapeYs.length - 1)) * innerW;
      const y = padT + innerH - ny * innerH;
      return `${i === 0 ? "M" : "L"}${x},${y}`;
    })
    .join(" ");

  const spotY = spot != null ? yOf(spot) : null;
  const spotX = padL + innerW;

  const yTicks = [yMin, (yMin + yMax) / 2, yMax];

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-40 w-full"
      role="img"
      aria-label={
        mode === "illustrative"
          ? "Illustrative bonding curve shape, not price history"
          : "Historical swap-implied price chart"
      }
    >
      {/* axes */}
      <path d={`M${padL} ${padT} V${h - padB} H${w - padR}`} stroke="#243044" fill="none" />
      {yTicks.map((yv, i) => {
        const y = yOf(yv);
        return (
          <g key={i}>
            <line
              x1={padL}
              x2={w - padR}
              y1={y}
              y2={y}
              stroke="#243044"
              strokeDasharray="2 4"
              opacity={0.6}
            />
            {mode !== "illustrative" && series.length > 0 && (
              <text x={4} y={y + 3} fill="#6B7A8F" fontSize="8" fontFamily="monospace">
                {yv >= 1 ? yv.toPrecision(3) : yv.toExponential(1)}
              </text>
            )}
          </g>
        );
      })}

      {/* theoretical curve shape */}
      <path
        d={shapePts}
        fill="none"
        stroke="#A78BFA"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity={0.85}
      />
      {mode !== "illustrative" && (
        <circle cx={shapeNowX} cy={shapeNowY} r="3" fill="none" stroke="#A78BFA" strokeWidth="1.5" />
      )}

      {/* historical series */}
      {histLine && (
        <path
          d={histLine}
          fill="none"
          stroke="#2DD4BF"
          strokeWidth="2.25"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* swap markers */}
      {series
        .filter((p) => p.source === "swap")
        .map((p) => (
          <circle
            key={p.sig ?? `${p.t}-${p.price}`}
            cx={xOf(p.t)}
            cy={yOf(p.price)}
            r="2.5"
            fill="#2DD4BF"
          />
        ))}

      {/* live spot */}
      {spot != null && spotY != null && mode !== "illustrative" && (
        <g>
          <circle cx={spotX} cy={spotY} r="4.5" fill="#E8C547" />
          <circle
            cx={spotX}
            cy={spotY}
            r="7"
            fill="none"
            stroke="#E8C547"
            strokeOpacity="0.35"
          />
        </g>
      )}

      <text x={padL} y={14} fill="#6B7A8F" fontSize="9">
        {mode === "illustrative"
          ? "Theoretical curve shape (not history)"
          : series.filter((p) => p.source === "swap").length > 0
            ? `Swap-derived · ${quoteLabel}/token`
            : spot != null
              ? `Live spot only · ${quoteLabel}/token`
              : "No swaps parsed yet"}
      </text>
      <text x={w - padR} y={14} fill="#A78BFA" fontSize="8" textAnchor="end">
        dashed: price vs % raised (x ≠ time)
      </text>
      {series.length >= 1 && mode !== "illustrative" && (
        <>
          <text x={padL} y={h - 8} fill="#6B7A8F" fontSize="8">
            {formatTime(tMin)}
          </text>
          <text x={w - padR - 70} y={h - 8} fill="#6B7A8F" fontSize="8" textAnchor="end">
            {formatTime(tMax)}
          </text>
        </>
      )}
      <text
        x={12}
        y={padT + innerH / 2}
        fill="#6B7A8F"
        fontSize="8"
        transform={`rotate(-90 12 ${padT + innerH / 2})`}
      >
        {quoteLabel}
      </text>
    </svg>
  );
}

export function PriceHistoryChart({
  poolAddress,
  quoteLabel,
  progress,
  illustrative = false,
  priceMultiple = 15,
}: Props) {
  const { connection } = useConnection();
  const [spotAt, setSpotAt] = useState<number | null>(null);
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [spot, setSpot] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState({ scanned: 0, parsedSwaps: 0 });

  const refresh = useCallback(async () => {
    if (!poolAddress || illustrative) {
      setPoints([]);
      setSpot(null);
      setStatus(null);
      return;
    }
    setLoading(true);
    try {
      const cached = loadPriceHistory(poolAddress);
      setPoints(cached);

      const result = await reconstructPoolPriceHistory(
        connection,
        new PublicKey(poolAddress),
        { limit: 40 },
      );
      setSpot(result.spot);
      setSpotAt(result.spot != null ? Date.now() : null);
      setMeta({ scanned: result.scanned, parsedSwaps: result.parsedSwaps });
      if (result.error) setStatus(result.error);
      else setStatus(null);

      const merged = mergePricePoints(poolAddress, result.points);
      setPoints(merged);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Price history fetch failed");
    } finally {
      setLoading(false);
    }
  }, [connection, poolAddress, illustrative]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const swapCount = useMemo(
    () => points.filter((p) => p.source === "swap").length,
    [points],
  );

  const mode: "live" | "illustrative" | "thin" = illustrative
    ? "illustrative"
    : swapCount > 0
      ? "live"
      : "thin";

  const displaySpot =
    spot ??
    points.filter((p) => p.source === "spot").slice(-1)[0]?.price ??
    null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg-primary">Price</h3>
          <p className="text-[10px] text-fg-muted">
            {illustrative
              ? "Illustrative offering — curve shape only; no invented price history."
              : "Three separate series, labelled below. Swap points are cached in this browser between visits."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {displaySpot != null && !illustrative && (
            <span className="font-mono text-sm text-gold">
              {formatPrice(displaySpot, quoteLabel)}
              <span className="ml-1 text-[10px] text-fg-muted">spot</span>
            </span>
          )}
          {poolAddress && !illustrative && (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="text-xs text-accent hover:underline disabled:opacity-50"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          )}
        </div>
      </div>

      <ChartSvg
        history={illustrative ? [] : points}
        spot={illustrative ? null : displaySpot}
        quoteLabel={quoteLabel}
        progress={progress}
        priceMultiple={priceMultiple}
        mode={mode}
      />

      <ul className="grid gap-1 text-[10px] text-fg-muted sm:grid-cols-3" data-testid="price-legend">
        <li className="flex items-start gap-1.5">
          <span className="mt-1 inline-block h-0.5 w-3 shrink-0 bg-accent" />
          <span>
            <strong className="text-fg-secondary">Swap-derived history</strong> · execution price (incl. fees) of
            confirmed swaps in the last {meta.scanned || 40} pool signatures. Partial, not a full chart.
          </span>
        </li>
        <li className="flex items-start gap-1.5">
          <span className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-gold" />
          <span>
            <strong className="text-fg-secondary">Live spot</strong> · marginal price from the pool&apos;s √price
            {spotAt ? `, read ${new Date(spotAt).toLocaleTimeString()}` : ""}. No fee, no size.
          </span>
        </li>
        <li className="flex items-start gap-1.5">
          <span
            className="mt-1 inline-block h-0.5 w-3 shrink-0"
            style={{ background: "repeating-linear-gradient(90deg,#A78BFA 0 3px,transparent 3px 6px)" }}
          />
          <span>
            <strong className="text-fg-secondary">Theoretical curve</strong> · price vs share of the threshold raised
            ({priceMultiple}× range, ring = now). Not time, not to price scale.
          </span>
        </li>
      </ul>

      {!illustrative && poolAddress && (
        <p className="text-[10px] text-fg-muted">
          {swapCount > 0
            ? `${swapCount} swap point${swapCount === 1 ? "" : "s"} from ${meta.scanned || "…"} recent pool signatures (parsed ${meta.parsedSwaps}).`
            : meta.scanned > 0
              ? `Scanned ${meta.scanned} signatures — no parseable swaps yet.`
              : "Open a live pool to reconstruct history from RPC."}{" "}
          Axis: {quoteLabel} per base token, computed from exact on-chain amounts and mint decimals. Not an oracle, not
          NAV.
        </p>
      )}
      {status && (
        <p className="text-[10px] text-signal-warn">{status}</p>
      )}
    </div>
  );
}

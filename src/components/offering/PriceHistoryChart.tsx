"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LineChart } from "@/components/ui/LineChart";
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
  progress: number | null;
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
  history, spot, quoteLabel, progress, priceMultiple, mode,
}: {
  history: PricePoint[]; spot: number | null; quoteLabel: string; progress: number | null;
  priceMultiple: number; mode: "live" | "illustrative" | "thin";
}) {
  const swaps = history.filter(point => point.source === "swap");
  const shape = curveShapeYs(priceMultiple);
  return (
    <div className="space-y-5">
      {mode !== "illustrative" && <div className="ec-chart-frame p-4 sm:p-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium">Swap price history</h4><span className="ec-chip">Partial on-chain history</span></div>
        <LineChart label="Confirmed swap execution prices over time"
          series={[{ name: "Confirmed swaps", color: "#6DE0C5", points: swaps.map(point => ({ x: point.t, y: point.price })) }]}
          xLabel="Time" yLabel={`${quoteLabel} / token`}
          formatX={value => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          formatDetailX={formatTime} formatDetailY={value => formatPrice(value, quoteLabel)}
          formatY={value => value >= 1 ? value.toPrecision(3) : value.toExponential(1)} />
        {swaps.length > 0 && <p className="mt-3 text-xs text-fg-muted">{formatTime(swaps[0].t)} — {formatTime(swaps[swaps.length - 1].t)}</p>}
        {swaps.length === 0 && <p className="mt-3 text-xs leading-relaxed text-fg-muted">{spot != null ? "A spot observation is available above. No confirmed swap history is available to plot yet." : "Refresh to look for parseable swaps. Missing history is never filled with simulated prices."}</p>}
      </div>}
      <details className="rounded-xl border border-line p-4 sm:p-5" open={mode === "illustrative" ? true : undefined}>
        <summary className="text-sm font-medium text-fg-secondary">Theoretical curve shape <span className="ml-2 text-xs font-normal text-fg-muted">Illustrative · separate scale</span></summary>
        <div className="mt-5">
          <LineChart label="Theoretical relative price versus share of graduation threshold"
            series={[{ name: "Theoretical shape", color: "#89BCEB", dashed: true, points: shape.map((value, i) => ({ x: i / (shape.length - 1) * 100, y: value })) }]}
            floor={0} ceiling={1} xLabel="Threshold raised (%)" yLabel="Normalized price shape"
            formatX={value => `${Math.round(value)}%`} formatY={value => value.toFixed(2)} height={190} />
          <p className="mt-3 text-xs leading-relaxed text-fg-muted">{priceMultiple}× graduation / start price range. The vertical axis is normalized from 0 to 1; it is not a token price or price forecast.{mode !== "illustrative" && ` Current on-chain threshold progress: ${progress == null ? "unknown" : `${(Math.min(1, Math.max(0, progress)) * 100).toFixed(1)}%`}.`}</p>
        </div>
      </details>
    </div>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-fg-primary">Price</h3>
          <p className="text-xs text-fg-muted">
            {illustrative
              ? "Illustrative offering — curve shape only; no invented price history."
              : "Confirmed swaps over time. Spot observations and theoretical shapes are shown separately."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {displaySpot != null && !illustrative && (
            <span className="font-mono text-sm text-gold">
              {formatPrice(displaySpot, quoteLabel)}
              <span className="ml-1 text-xs text-fg-muted">{spotAt ? "live spot" : "cached spot"}</span>
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

      <ul className="grid gap-1 text-xs text-fg-muted sm:grid-cols-3" data-testid="price-legend">
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
            <strong className="text-fg-secondary">{displaySpot == null ? "Spot observation" : spotAt ? "Live spot" : "Cached spot"}</strong> · marginal price from the pool&apos;s √price
            {spotAt ? `, read ${new Date(spotAt).toLocaleTimeString()}` : displaySpot != null ? ", cached in this browser; observation time unavailable" : ""}. No fee, no size.
          </span>
        </li>
        <li className="flex items-start gap-1.5">
          <span
            className="mt-1 inline-block h-0.5 w-3 shrink-0"
            style={{ background: "repeating-linear-gradient(90deg,#A78BFA 0 3px,transparent 3px 6px)" }}
          />
          <span>
            <strong className="text-fg-secondary">Theoretical curve</strong> · price vs share of the threshold raised
            ({priceMultiple}× range). Expand the separate normalized chart above.
          </span>
        </li>
      </ul>

      {!illustrative && poolAddress && (
        <p className="text-xs text-fg-muted">
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
        <p className="text-xs text-signal-warn">{status}</p>
      )}
    </div>
  );
}

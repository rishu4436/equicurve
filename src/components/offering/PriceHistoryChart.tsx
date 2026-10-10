"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatMarketTimestamp, formatPriceAxis, formatTokenPrice } from "@/lib/marketDisplay";
import type { HistoryCandle, HistoryTimeframe, HistoricalTrade, MarketHistory } from "@/lib/market/history";

type Props = {
  poolAddress: string | null;
  quoteLabel: string;
  progress: number | null;
  illustrative?: boolean;
  priceMultiple?: number;
  historicalOnly?: boolean;
  metricMode?: "price" | "mcap";
  denomination?: "SOL" | "USD";
  currentPrice?: string | null;
  currentPriceVenue?: string | null;
  onSummary?: (summary: { volume24h: string | null; change24hPct: string | null; quoteMint: string | null; complete24h: boolean }) => void;
};

const TIMEFRAMES: { value: HistoryTimeframe; label: string }[] = [
  { value: "5m", label: "5m" }, { value: "15m", label: "15m" }, { value: "1h", label: "1h" },
  { value: "4h", label: "4h" }, { value: "1D", label: "1D" }, { value: "ALL", label: "ALL" },
];

export function curveShapeYs(priceMultiple: number, n = 32): number[] {
  const m = Math.max(priceMultiple, 1.0001);
  const r = Math.sqrt(m) - 1;
  const ys: number[] = [];
  for (let i = 0; i <= n; i += 1) {
    const x = i / n;
    ys.push(((1 + x * r) ** 2 - 1) / (m - 1));
  }
  return ys;
}

export function liveSpotPoint(
  history: { t: number; price: number; source: "swap" | "spot" | "local" }[],
  spot: number | null,
  historicalOnly = false,
): Array<{ x: number; y: number }> {
  if (spot == null || historicalOnly) return [];
  const observed = history.filter((point) => point.source === "spot").at(-1);
  const swap = history.filter((point) => point.source === "swap").at(-1);
  return [{ x: observed?.t ?? swap?.t ?? 0, y: spot }];
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTradePrice(value: string, quoteLabel: string): string {
  const parsed = numberValue(value);
  return parsed > 0 ? formatTokenPrice(parsed, quoteLabel).secondary : `${value} ${quoteLabel}`;
}

function HistoryVisual({
  trades, candles, mode, quoteLabel, currentPrice, currentPriceVenue, boundary, intervalSeconds,
}: {
  trades: HistoricalTrade[];
  candles: HistoryCandle[];
  mode: "line" | "candles";
  quoteLabel: string;
  currentPrice: string | null;
  currentPriceVenue: string | null;
  boundary: MarketHistory["migrationBoundary"];
  intervalSeconds: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const plot = mode === "candles" ? candles : trades;
  const values = mode === "candles" ? candles.flatMap((candle) => [numberValue(candle.high), numberValue(candle.low)]) : trades.map((trade) => numberValue(trade.priceQuotePerToken));
  if (plot.length === 0) return <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-line px-6 text-center text-sm text-fg-muted">No confirmed swaps in this range. Empty periods are left blank.</div>;
  const width = 760;
  const priceHeight = 260;
  const volumeHeight = 72;
  const left = 62;
  const right = 18;
  const top = 16;
  const bottom = 22;
  const minX = mode === "candles" ? candles[0].startTime : trades[0].blockTime;
  const maxX = mode === "candles" ? candles.at(-1)!.startTime + intervalSeconds * 1000 : trades.at(-1)!.blockTime;
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const pad = Math.max((maxValue - minValue) * 0.08, Math.abs(maxValue) * 0.03, 1e-12);
  const low = Math.max(0, minValue - pad);
  const high = maxValue + pad;
  const x = (value: number) => maxX === minX ? left + (width - left - right) / 2 : left + ((value - minX) / (maxX - minX)) * (width - left - right);
  const y = (value: number) => top + (1 - (value - low) / (high - low || 1)) * (priceHeight - top - bottom);
  const maxVolume = Math.max(...candles.map((candle) => numberValue(candle.quoteVolume)), 1e-12);
  const volumeY = (value: number) => priceHeight + volumeHeight - (value / maxVolume) * (volumeHeight - 10);
  const boundaryStart = boundary.transitionStartTime ?? boundary.blockTime;
  const boundaryEnd = boundary.transitionEndTime ?? boundary.blockTime;
  const markerX = boundaryStart != null ? x(boundaryStart) : null;
  const markerEndX = boundaryEnd != null ? x(boundaryEnd) : null;
  const activeX = selected == null ? null : x(mode === "candles" ? candles[selected].startTime : trades[selected].blockTime);
  const current = currentPrice ? numberValue(currentPrice) : null;
  const linePoints = trades.map((trade) => `${x(trade.blockTime)},${y(numberValue(trade.priceQuotePerToken))}`).join(" ");
  const activeTrade = mode === "line" && selected != null ? trades[selected] : null;
  const activeCandle = mode === "candles" && selected != null ? candles[selected] : null;
  return <div className="min-w-0">
    <svg viewBox={`0 0 ${width} ${priceHeight + volumeHeight}`} className="block h-auto w-full rounded-lg" role="img" aria-label={`${mode === "candles" ? "Confirmed OHLC candles" : "Confirmed swap prices"} with quote volume`}>
      {[0, 1, 2, 3].map((step) => { const value = low + ((high - low) * step) / 3; return <g key={step}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#2C393E" strokeDasharray="3 5" /><text x={left - 8} y={y(value) + 4} textAnchor="end" fill="#899B9F" fontSize="11">{formatPriceAxis(value, quoteLabel)}</text></g>; })}
      <text x={left} y={priceHeight + 14} fill="#899B9F" fontSize="11">Volume · quote</text>
      {boundaryStart != null && boundaryEnd != null && boundaryEnd >= boundaryStart && <rect x={x(boundaryStart)} y={top} width={Math.max(3, x(boundaryEnd) - x(boundaryStart))} height={priceHeight - top - bottom} fill="#F3C969" opacity="0.08"><title>Migration transition region</title></rect>}
      {markerX != null && markerEndX == null && <line x1={markerX} x2={markerX} y1={top} y2={priceHeight - bottom} stroke="#F3C969" strokeDasharray="4 4"><title>{boundary.known ? "Migration → DAMM v2" : "Migration boundary"}</title></line>}
      {mode === "line" && <polyline points={linePoints} fill="none" stroke="#6DE0C5" strokeWidth="2.5" strokeLinejoin="round" />}
      {mode === "line" && trades.length <= 80 && trades.map((trade, index) => <circle key={`${trade.signature}-${index}`} cx={x(trade.blockTime)} cy={y(numberValue(trade.priceQuotePerToken))} r="2.5" fill={trade.venue === "damm-v2" ? "#89BCEB" : "#6DE0C5"} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} tabIndex={0}><title>{`${formatMarketTimestamp(trade.blockTime)} · ${trade.venue === "damm-v2" ? "DAMM v2" : "DBC"} · ${formatTradePrice(trade.priceQuotePerToken, quoteLabel)}`}</title></circle>)}
      {mode === "candles" && candles.map((candle, index) => { const candleWidth = Math.max(3, Math.min(16, ((width - left - right) / Math.max(1, candles.length)) * 0.62)); const open = y(numberValue(candle.open)); const close = y(numberValue(candle.close)); const highY = y(numberValue(candle.high)); const lowY = y(numberValue(candle.low)); const positive = numberValue(candle.close) >= numberValue(candle.open); return <g key={candle.startTime} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} tabIndex={0} role="img" aria-label={`Candle ${formatMarketTimestamp(candle.startTime)} ${candle.venues.join(" and ")}`}><line x1={x(candle.startTime)} x2={x(candle.startTime)} y1={highY} y2={lowY} stroke={positive ? "#6DE0C5" : "#F18B8B"} /><rect x={x(candle.startTime) - candleWidth / 2} y={Math.min(open, close)} width={candleWidth} height={Math.max(2, Math.abs(close - open))} fill={positive ? "#6DE0C5" : "#F18B8B"} opacity="0.85"><title>{`${formatMarketTimestamp(candle.startTime)} · O ${candle.open} H ${candle.high} L ${candle.low} C ${candle.close} · ${candle.quoteVolume} quote volume`}</title></rect></g>; })}
      {candles.map((candle) => <rect key={`volume-${candle.startTime}`} x={x(candle.startTime) - 3} y={volumeY(numberValue(candle.quoteVolume))} width="6" height={Math.max(1, priceHeight + volumeHeight - volumeY(numberValue(candle.quoteVolume)))} fill={candle.venues.includes("damm-v2") ? "#89BCEB" : "#6DE0C5"} opacity="0.7"><title>{`${formatMarketTimestamp(candle.startTime)} · ${candle.quoteVolume} quote volume · ${candle.tradeCount} trades`}</title></rect>)}
      {current != null && current > 0 && current >= low && current <= high && <line x1={left} x2={width - right} y1={y(current)} y2={y(current)} stroke="#F3C969" strokeDasharray="5 4"><title>{`Current ${currentPriceVenue ?? "active venue"} spot: ${currentPrice}`}</title></line>}
      {activeX != null && <line x1={activeX} x2={activeX} y1={top} y2={priceHeight - bottom} stroke="#ACB8BC" strokeDasharray="3 4" />}
    </svg>
    <div className="min-h-10 border-t border-line/70 pt-3 text-xs" aria-live="polite">
      {activeTrade && <span>{formatMarketTimestamp(activeTrade.blockTime)} · {activeTrade.venue === "damm-v2" ? "DAMM v2" : "DBC"} · {formatTradePrice(activeTrade.priceQuotePerToken, quoteLabel)} · {activeTrade.quoteAmount} quote · 1 trade</span>}
      {activeCandle && <span>{formatMarketTimestamp(activeCandle.startTime)} · O {activeCandle.open} · H {activeCandle.high} · L {activeCandle.low} · C {activeCandle.close} · {activeCandle.quoteVolume} quote · {activeCandle.tradeCount} trades · {activeCandle.venues.join(" + ")}</span>}
      {!activeTrade && !activeCandle && <span className="text-fg-muted">Hover a confirmed observation for price, venue, and quote volume.</span>}
    </div>
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-accent" />DBC confirmed swaps</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#89BCEB]" />DAMM v2 confirmed swaps</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-gold" />Current active spot</span></div>
  </div>;
}

function TheoreticalCurve({ progress, priceMultiple, mode }: { progress: number | null; priceMultiple: number; mode: "live" | "illustrative" | "thin" }) {
  const shape = curveShapeYs(priceMultiple);
  return <details className="rounded-xl border border-line p-4 sm:p-5" open={mode === "illustrative" ? true : undefined}><summary className="text-sm font-medium text-fg-secondary">Theoretical curve shape <span className="ml-2 text-xs font-normal text-fg-muted">Illustrative · separate scale</span></summary><div className="mt-5"><svg viewBox="0 0 640 160" className="block h-40 w-full" role="img" aria-label="Theoretical normalized curve shape"><polyline points={shape.map((value, index) => `${24 + index * 592 / (shape.length - 1)},${138 - value * 112}`).join(" ")} fill="none" stroke="#89BCEB" strokeWidth="2.5" strokeDasharray="5 4" /><text x="24" y="156" fill="#899B9F" fontSize="11">0%</text><text x="616" y="156" fill="#899B9F" fontSize="11" textAnchor="end">100%</text></svg><p className="mt-3 text-xs leading-relaxed text-fg-muted">{priceMultiple}× graduation / start price range. The vertical axis is normalized from 0 to 1; it is not a token price or forecast.{mode !== "illustrative" && ` Current threshold progress: ${progress == null ? "unknown" : `${(Math.min(1, Math.max(0, progress)) * 100).toFixed(1)}%`}.`}</p></div></details>;
}

export function PriceHistoryChart({ poolAddress, quoteLabel, progress, illustrative = false, priceMultiple = 15, historicalOnly = false, metricMode = "price", denomination = "SOL", currentPrice = null, currentPriceVenue = null, onSummary }: Props) {
  const [timeframe, setTimeframe] = useState<HistoryTimeframe>("1D");
  const [chartMode, setChartMode] = useState<"line" | "candles">("line");
  const [result, setResult] = useState<MarketHistory | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!poolAddress || illustrative) { setResult(null); setStatus(null); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/markets/${encodeURIComponent(poolAddress)}/history?mode=candles&timeframe=${timeframe}`, { headers: { Accept: "application/json" } });
      const body = (await response.json()) as MarketHistory & { error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "History fetch failed");
      setResult(body);
      setStatus(body.unavailableReasons.length ? body.unavailableReasons.join(" ") : body.partial ? "History is partial because the bounded RPC scan did not reach the full requested range." : null);
      onSummary?.({ volume24h: body.volume24h, change24hPct: body.change24hPct, quoteMint: body.market.quoteMint, complete24h: body.coverage.reaches24hBoundary });
    } catch (error) {
      setResult(null); setStatus(error instanceof Error ? error.message : "History fetch failed");
      onSummary?.({ volume24h: null, change24hPct: null, quoteMint: null, complete24h: false });
    } finally { setLoading(false); }
  }, [illustrative, onSummary, poolAddress, timeframe]);
  useEffect(() => { void refresh(); }, [refresh]);
  const chartTrades = result?.trades ?? [];
  const mode = illustrative ? "illustrative" : chartTrades.length > 0 ? "live" : "thin";
  const historicalUsdUnavailable = denomination === "USD" && quoteLabel === "SOL";
  const chartQuoteLabel = denomination === "USD" ? "USD" : quoteLabel;
  const volumeText = result?.volume24h == null ? "—" : `${result.volume24h} ${quoteLabel}`;
  const span = useMemo(() => result?.trades.length ? `${formatMarketTimestamp(result.trades[0].blockTime)} — ${formatMarketTimestamp(result.trades.at(-1)!.blockTime)}` : null, [result]);
  return <div className="space-y-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="text-sm font-semibold text-fg-primary">{metricMode === "mcap" ? "Price history" : "Market history"}</h3><p className="text-xs text-fg-muted">{illustrative ? "Illustrative offering — curve shape only; no invented price history." : "Confirmed swap history across the verified market lifecycle. Current price stays sourced from the active venue."}</p></div><div className="flex flex-wrap items-center gap-2" aria-label="History chart controls"><div className="flex shrink-0 rounded-input border border-line bg-subtle p-1" role="group" aria-label="Chart mode">{(["line", "candles"] as const).map((value) => <button key={value} type="button" aria-pressed={chartMode === value} onClick={() => setChartMode(value)} className={`min-h-9 rounded-md px-3 text-xs font-medium ${chartMode === value ? "bg-accent/15 text-accent" : "text-fg-secondary hover:text-fg-primary"}`}>{value === "line" ? "Line" : "Candles"}</button>)}</div><div className="flex max-w-full gap-1 overflow-x-auto rounded-input border border-line bg-subtle p-1" role="group" aria-label="History timeframe">{TIMEFRAMES.map((item) => <button key={item.value} type="button" aria-pressed={timeframe === item.value} onClick={() => setTimeframe(item.value)} className={`min-h-9 shrink-0 rounded-md px-2.5 text-xs font-medium ${timeframe === item.value ? "bg-accent/15 text-accent" : "text-fg-secondary hover:text-fg-primary"}`}>{item.label}</button>)}</div>{poolAddress && !illustrative && <button type="button" onClick={() => void refresh()} disabled={loading} className="min-h-9 px-1 text-xs text-accent hover:underline disabled:opacity-50">{loading ? "Loading…" : "Refresh"}</button>}</div></div>
    {historicalUsdUnavailable && !illustrative && <div className="rounded-lg border border-gold/30 bg-gold/5 px-3 py-2 text-xs text-fg-secondary">Historical USD conversion is unavailable for SOL quotes. Switch to SOL to view exact quote-denominated history; no current SOL/USD rate is applied to old trades.</div>}
    {!illustrative && result && !historicalUsdUnavailable && <div className="ec-chart-frame p-4 sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs text-fg-muted"><span className="ec-chip">{result.coverage.reaches24hBoundary ? "24h covered" : "Partial range"}</span><span>Volume · {volumeText}</span></div><span className="text-xs text-fg-muted">{result.market.activeVenue === "DAMM v2" ? "DBC → verified DAMM v2" : result.market.activeVenue === "DBC" ? "Verified DBC" : "Active venue unknown"}</span></div><HistoryVisual trades={chartTrades} candles={result.candles} mode={chartMode} quoteLabel={chartQuoteLabel} currentPrice={currentPrice} currentPriceVenue={currentPriceVenue} boundary={result.migrationBoundary} intervalSeconds={result.candleIntervalSeconds} />{span && <p className="mt-3 text-xs text-fg-muted">{span} · {chartTrades.length} confirmed swap{chartTrades.length === 1 ? "" : "s"} · quote volume bars use the same candle buckets.</p>}<p className="mt-3 text-xs leading-relaxed text-fg-muted">Historical prices: confirmed parsed swaps. DBC uses Meteora DBC events; post-migration history uses balance-attributed swaps from the verified Meteora DAMM v2 pool. Current {currentPriceVenue ?? "active venue"} spot is independent of chart history.</p></div>}
    {!illustrative && !result && <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-line text-sm text-fg-muted">{loading ? "Reading confirmed market history…" : "History unavailable; current market metrics remain available."}</div>}
    {illustrative && <TheoreticalCurve progress={progress} priceMultiple={priceMultiple} mode={mode} />}{!illustrative && result && <TheoreticalCurve progress={progress} priceMultiple={priceMultiple} mode={mode} />}
    {!illustrative && status && <p className="text-xs text-signal-warn">{status}</p>}
    {!illustrative && result && <ul className="grid gap-1 text-xs text-fg-muted sm:grid-cols-3"><li>DBC: {result.coverage.dbc.swapsParsed} parsed / {result.coverage.dbc.signaturesScanned} signatures</li><li>DAMM v2: {result.coverage.dammV2.swapsParsed} parsed / {result.coverage.dammV2.signaturesScanned} signatures</li><li>{result.migrationBoundary.known ? "Migration marker is verified from migration evidence." : result.migrationBoundary.source === "first-verified-damm-trade" ? "Migration boundary is a transition region around the first verified DAMM trade." : "Migration evidence is unavailable; no exact marker is claimed."}</li></ul>}
    {historicalOnly && <p className="text-xs text-fg-muted">DBC swaps remain visible as historical context after migration; the active price and current reserves come from verified DAMM v2.</p>}
  </div>;
}

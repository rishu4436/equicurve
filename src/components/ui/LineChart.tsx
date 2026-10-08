"use client";

import { useEffect, useRef, useState } from "react";

export type ChartSeries = { name: string; color: string; points: { x: number; y: number }[]; dashed?: boolean };

/** Presentation only: plots supplied observations without smoothing or inventing samples. */
export function LineChart({ series, label, xLabel, yLabel, formatX = String, formatY = String, formatDetailX = formatX, formatDetailY = formatY, floor, ceiling, height = 230 }: {
  series: ChartSeries[];
  label: string;
  xLabel: string;
  yLabel: string;
  formatX?: (value: number) => string;
  formatY?: (value: number) => string;
  formatDetailX?: (value: number) => string;
  formatDetailY?: (value: number) => string;
  floor?: number;
  ceiling?: number;
  height?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setWidth(Math.max(240, entries[0].contentRect.width)));
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const clean = series.map(item => ({ ...item, points: item.points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)) }));
  const points = clean.flatMap(item => item.points);
  const xs = [...new Set(points.map(point => point.x))].sort((a, b) => a - b);
  const left = 70, right = 16, top = 18, bottom = 34;
  const minX = xs[0] ?? 0, maxX = xs.at(-1) ?? 1;
  const low = Math.min(...points.map(point => point.y), floor ?? Infinity);
  const high = Math.max(...points.map(point => point.y), ceiling ?? -Infinity);
  const padding = Math.max((high - low) * .08, Math.abs(high) * .025, 1e-12);
  const minY = floor != null ? Math.min(floor, low) : low - padding;
  const maxY = ceiling != null ? Math.max(ceiling, high) : high + padding;
  const x = (value: number) => maxX === minX ? left + (width - left - right) / 2 : left + ((value - minX) / (maxX - minX)) * (width - left - right);
  const y = (value: number) => top + (1 - (value - minY) / (maxY - minY || 1)) * (height - top - bottom);
  const selectedX = selected == null ? null : xs[Math.min(selected, xs.length - 1)];
  const active = clean.flatMap(item => { const point = item.points.find(p => p.x === selectedX); return point ? [{ name: item.name, color: item.color, ...point }] : []; });
  const xTicks = [...new Set([minX, ...(width > 460 ? [(minX + maxX) / 2] : []), maxX])];

  return (
    <div ref={container} className="min-w-0">
      <div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-fg-muted"><span>{yLabel}</span><span>{xLabel}</span></div>
      {points.length === 0 ? <div className="flex h-52 items-center justify-center rounded-xl border border-dashed border-line px-6 text-center text-sm text-fg-muted">No observations available yet.</div> : <>
        <svg viewBox={`0 0 ${width} ${height}`} className="block w-full rounded-lg outline-offset-2" style={{ height }} role="group" aria-label={`${label}. Use left and right arrow keys to inspect observations, or expand the data table.`} tabIndex={0}
          onPointerMove={event => { const bounds = event.currentTarget.getBoundingClientRect(); const position = (event.clientX - bounds.left) * width / bounds.width; let nearest = 0; xs.forEach((value, i) => { if (Math.abs(x(value) - position) < Math.abs(x(xs[nearest]) - position)) nearest = i; }); setSelected(nearest); }}
          onPointerLeave={() => setSelected(null)}
          onKeyDown={event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); setSelected(event.key === "Home" ? 0 : event.key === "End" ? xs.length - 1 : Math.max(0, Math.min(xs.length - 1, (selected ?? 0) + (event.key === "ArrowRight" ? 1 : -1)))); } }}>
          {[0, 1, 2, 3].map(i => { const value = minY + (maxY - minY) * i / 3; return <g key={i}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#2C393E" strokeDasharray="3 5" /><text x={left - 10} y={y(value) + 4} textAnchor="end" fill="#899B9F" fontSize="12">{formatY(value)}</text></g>; })}
          {xTicks.map((value, i) => <text key={value} x={x(value)} y={height - 9} textAnchor={maxX === minX ? "middle" : i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} fill="#899B9F" fontSize="12">{formatX(value)}</text>)}
          {clean.map((item, i) => <g key={`${item.name}-${i}`}><polyline points={item.points.map(point => `${x(point.x)},${y(point.y)}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2.5" strokeDasharray={item.dashed ? "5 4" : undefined} strokeLinejoin="round" />{item.points.length <= 40 && item.points.map((point, j) => <circle key={j} cx={x(point.x)} cy={y(point.y)} r={item.points.length === 1 ? 4 : 2} fill={item.color} />)}</g>)}
          {selectedX != null && <g><line x1={x(selectedX)} x2={x(selectedX)} y1={top} y2={height - bottom} stroke="#ACB8BC" strokeDasharray="3 4" />{active.map((point, i) => <circle key={i} cx={x(point.x)} cy={y(point.y)} r="4" fill={point.color} stroke="#0D1215" strokeWidth="2" />)}</g>}
        </svg>
        <div className="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 pt-3 text-xs" aria-live="polite">
          {selectedX != null ? <><span className="text-fg-muted">{formatDetailX(selectedX)}</span>{active.map((point, i) => <span key={i}><span style={{ color: point.color }}>{point.name}</span> <span className="tabular-nums text-fg-primary">{formatDetailY(point.y)}</span></span>)}</> : clean.map((item, i) => <span key={i} className="flex items-center gap-2 text-fg-secondary"><span className="h-0.5 w-4" style={{ backgroundColor: item.color }} />{item.name}</span>)}
        </div>
        <details className="mt-3 text-xs text-fg-muted"><summary className="w-fit py-2 hover:text-accent">View chart data</summary><div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line"><table className="w-full text-left"><caption className="sr-only">{label}</caption><thead className="sticky top-0 bg-elevated"><tr><th className="px-3">Series</th><th className="px-3">{xLabel}</th><th className="px-3">{yLabel}</th></tr></thead><tbody>{clean.flatMap((item, i) => item.points.map((point, j) => <tr key={`${i}-${j}`} className="border-t border-line"><td className="px-3">{item.name}</td><td className="px-3">{formatDetailX(point.x)}</td><td className="px-3 tabular-nums">{formatDetailY(point.y)}</td></tr>))}</tbody></table></div></details>
      </>}
    </div>
  );
}

"use client";

import { useId, useState } from "react";
import Link from "next/link";

const PROFILES = [
  { name: "Balanced", path: "M0 166 C75 160 130 137 205 99 S310 44 380 25", description: "A measured path from the first order to graduation." },
  { name: "Early momentum", path: "M0 166 C60 155 90 86 155 60 S290 27 380 25", description: "An illustrative shape with stronger early price movement." },
  { name: "Patient growth", path: "M0 166 C160 166 235 150 278 100 S340 42 380 25", description: "An illustrative shape that becomes steeper later." },
];

/** Marketing illustration only. These shapes are not simulation or price data. */
export function MarketStudioPreview() {
  const [selected, setSelected] = useState(0);
  const id = useId();
  return (
    <div className="ec-enter relative rounded-[22px] border border-line bg-elevated p-1.5 shadow-[0_24px_100px_-30px_#000]">
      <div className="flex items-center justify-between gap-3 px-5 py-4 text-xs"><span className="flex items-center gap-2 font-medium"><span className="h-2 w-2 rounded-full bg-accent" />Market studio</span><span className="text-fg-muted">Interactive illustration</span></div>
      <div className="rounded-2xl border border-line bg-base/80 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><p className="text-xs text-fg-muted">Your market, by design</p><h2 className="mt-1 text-xl font-medium tracking-tight">Explore the shape</h2></div><span className="rounded-lg border border-line px-2 py-1 font-mono text-xs text-accent">0{selected + 1} / 03</span></div>
        <div className="mt-6 flex flex-wrap gap-1.5" role="group" aria-label="Illustrative curve shape">{PROFILES.map((profile, index) => <button key={profile.name} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)} className={`rounded-lg px-3 py-2 text-xs transition-colors ${selected === index ? "bg-accent/15 text-accent" : "text-fg-muted hover:bg-subtle hover:text-fg-primary"}`}>{profile.name}</button>)}</div>
        <div className="mt-6"><div className="mb-2 flex justify-between text-xs text-fg-muted"><span>Relative price</span><span>Curve shape</span></div>
          <svg viewBox="0 0 400 200" className="w-full overflow-visible" role="img" aria-label={`${PROFILES[selected].name}: illustrative curve, not market data`}>
            <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#6DE0C5" stopOpacity=".2" /><stop offset="100%" stopColor="#6DE0C5" stopOpacity="0" /></linearGradient></defs>
            {[25, 72, 119, 166].map(y => <line key={y} x1="10" x2="390" y1={y} y2={y} stroke="#2C393E" strokeDasharray="3 5" />)}
            <g transform="translate(10 0)"><path d={`${PROFILES[selected].path} L380 180 L0 180 Z`} fill={`url(#${id})`} /><path d={PROFILES[selected].path} fill="none" stroke="#6DE0C5" strokeWidth="3" strokeLinecap="round" /><circle cx="380" cy="25" r="5" fill="#6DE0C5" stroke="#151C20" strokeWidth="3" /></g>
            <text x="10" y="198" fill="#899B9F" fontSize="11">Launch</text><text x="390" y="198" textAnchor="end" fill="#899B9F" fontSize="11">Graduation</text>
          </svg>
        </div>
        <p aria-live="polite" className="mt-4 min-h-10 text-xs leading-relaxed text-fg-secondary">{PROFILES[selected].description} Run a simulation to evaluate a real configuration.</p>
        <div className="mt-5 grid grid-cols-3 divide-x divide-line border-t border-line pt-5 text-center"><div><span className="text-accent">01</span><p className="mt-1 text-xs text-fg-muted">Set goals</p></div><div><span className="text-accent">02</span><p className="mt-1 text-xs text-fg-muted">Simulate</p></div><div><span className="text-accent">03</span><p className="mt-1 text-xs text-fg-muted">Review & deploy</p></div></div>
      </div>
      <Link href="/create" className="flex items-center justify-between rounded-xl px-5 py-4 text-sm text-fg-secondary transition-colors hover:text-accent"><span>Turn your brief into a market</span><span aria-hidden="true">↗</span></Link>
    </div>
  );
}

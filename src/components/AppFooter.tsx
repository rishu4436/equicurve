"use client";

import Link from "next/link";
import { DBC_PROGRAM_ID, DAMM_V2_PROGRAM, getCluster } from "@/lib/constants";

export function AppFooter() {
  const cluster = getCluster();
  return (
    <footer className="mt-12 border-t border-line bg-elevated/40">
      <div className="mx-auto max-w-[1400px] px-5 py-10 sm:px-8">
        <div className="flex flex-col justify-between gap-8 sm:flex-row">
          <div className="max-w-sm"><Link href="/" className="text-xl font-semibold tracking-tight">EquiCurve<span className="text-accent">.</span></Link><p className="mt-3 text-sm leading-relaxed text-fg-muted">Thoughtful market design. Transparent execution.<br />Built on Solana with Meteora DBC → DAMM v2.</p></div>
          <nav aria-label="Footer navigation" className="grid grid-cols-2 gap-x-12 gap-y-3 text-sm text-fg-secondary">
            {[["Explore", "/explore"], ["Trust Center", "/trust"], ["Create a market", "/create"], ["Documentation", "/docs"], ["Curve library", "/presets"], ["Network settings", "/settings"]].map(([label, href]) => <Link key={href} href={href} className="py-1 hover:text-accent">{label}</Link>)}
          </nav>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5 text-xs text-fg-muted">
          <p>Network: <span className="text-fg-secondary">{cluster}</span> · EquiCurve does not create shareholder rights.</p>
          <div className="flex gap-4 font-mono"><span title={DBC_PROGRAM_ID.toBase58()}>DBC {DBC_PROGRAM_ID.toBase58().slice(0, 6)}…</span><span title={DAMM_V2_PROGRAM.toBase58()}>DAMM {DAMM_V2_PROGRAM.toBase58().slice(0, 6)}…</span></div>
        </div>
      </div>
    </footer>
  );
}

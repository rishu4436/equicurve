"use client";

import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { getPreset } from "@/lib/dbc/presets";
import type { WizardState } from "./wizardTypes";

export function OfferingPreviewCard({ state }: { state: WizardState }) {
  const preset = getPreset(state.presetId);
  const docsDone = [state.docMemo, state.docRisk, state.docIssuer].filter(
    Boolean,
  ).length;
  const feePlatform = 100 - state.feeIssuer;

  return (
    <div className="ec-card sticky top-24 space-y-4 p-5 shadow-glow">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-card border border-line bg-subtle text-lg font-semibold text-accent">
          {(state.ticker || "??").slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg-primary">
            {state.name || "Offering name"}
          </p>
          <p className="font-mono text-xs text-fg-muted">
            ${state.ticker || "TICKER"}
          </p>
          <span className="ec-chip mt-1">{state.sector}</span>
        </div>
      </div>

      <p className="line-clamp-2 text-sm text-fg-secondary">
        {state.thesis || "One-line thesis appears here as you type…"}
      </p>

      <div className="rounded-input border border-line bg-subtle/60 p-3">
        <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
          <span>{preset.name} curve</span>
          <span className="text-signal-grad">→ DAMM v2</span>
        </div>
        <CurveMiniViz preset={state.presetId} className="h-14 w-full" />
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-fg-muted">Raise target</dt>
          <dd className="font-mono text-fg-primary">
            ${state.raiseTarget.toLocaleString()} SOL
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">LP lock (on-chain)</dt>
          <dd className="text-fg-primary">≥{state.lpLockPct}%</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Fee split</dt>
          <dd className="text-fg-primary">
            Creator {state.feeIssuer}% / partner {feePlatform}%
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Attestations</dt>
          <dd className="text-fg-primary">{docsDone}/3 required</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-[10px] text-fg-secondary">
          Quote: SOL
        </span>
        <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-[10px] text-fg-secondary">
          {state.investorType}
        </span>
        <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-[10px] text-fg-secondary">
          Open SPL
        </span>
        {state.mintRenounce ? (
          <span className="rounded-pill border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
            Mint renounce
          </span>
        ) : (
          <span className="rounded-pill border border-signal-warn/40 bg-signal-warn/10 px-2 py-0.5 text-[10px] text-signal-warn">
            Mint retained
          </span>
        )}
      </div>
    </div>
  );
}

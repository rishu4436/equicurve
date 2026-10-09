"use client";

import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { getPreset } from "@/lib/dbc/presets";
import type { WizardState } from "./wizardTypes";
import { isLocalTokenImageUrl, normalizeHttpsUrl, normalizeXProfile } from "@/lib/validation";

export function OfferingPreviewCard({ state }: { state: WizardState }) {
  const preset = getPreset(state.presetId);
  const docsDone = [state.docMemo, state.docRisk, state.docIssuer].filter(
    Boolean,
  ).length;
  const feePlatform = 100 - state.feeIssuer;
  const website = normalizeHttpsUrl(state.website);
  const xProfile = normalizeXProfile(state.xProfile);
  const image = state.image && (isLocalTokenImageUrl(state.image) || normalizeHttpsUrl(state.image)) ? state.image : "";

  return (
    <aside className="ec-card space-y-5 self-start p-5 lg:sticky lg:top-28">
      <div className="flex justify-between border-b border-line pb-4 text-xs"><span className="font-medium text-fg-secondary">Your market brief</span><span className="text-fg-muted">Draft preview</span></div>
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-card border border-line bg-subtle text-lg font-semibold text-accent">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="Project image preview" className="h-full w-full object-cover" />
          ) : (state.ticker || "??").slice(0, 2)}
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

      {(website || xProfile) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {website && <a href={website} target="_blank" rel="noopener noreferrer" className="ec-chip text-accent hover:underline">Website ↗</a>}
          {xProfile && <a href={xProfile} target="_blank" rel="noopener noreferrer" className="ec-chip text-accent hover:underline">X ↗</a>}
        </div>
      )}

      <p className="line-clamp-2 text-sm text-fg-secondary">
        {state.thesis || "One-line thesis appears here as you type…"}
      </p>

      <div className="rounded-input border border-line bg-subtle/60 p-3">
        <div className="mb-1 flex items-center justify-between text-xs text-fg-muted">
          <span>{preset.name} curve</span>
          <span className="text-signal-grad">→ DAMM v2</span>
        </div>
        <CurveMiniViz preset={state.presetId} className="my-3 h-20 w-full" />
        <p className="text-xs text-fg-muted">Illustrative shape · simulate to compare designs</p>
      </div>

      <dl className="grid grid-cols-2 gap-5 text-xs [&_dd]:mt-1.5">
        <div>
          <dt className="text-fg-muted">Target raise</dt>
          <dd className="font-mono text-fg-primary">
            {state.targetRaise || "—"} {state.quote}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">LP lock (on-chain)</dt>
          <dd className="text-fg-primary">≥{state.lpLockPct}%</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Non-protocol fee split</dt>
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
        <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-xs text-fg-secondary">
          Quote: {state.quote}
        </span>
        <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-xs text-fg-secondary">
          {state.investorType}
        </span>
        <span className="rounded-pill border border-line bg-subtle px-2 py-0.5 text-xs text-fg-secondary">
          {state.transferProfile === "open-spl" ? "Open SPL" : state.transferProfile === "token-2022" ? "Token-2022" : "Transfer hook"}
        </span>
        {state.mintRenounce ? (
          <span className="rounded-pill border border-gold/40 bg-gold/10 px-2 py-0.5 text-xs text-gold">
            Mint renounce
          </span>
        ) : (
          <span className="rounded-pill border border-signal-warn/40 bg-signal-warn/10 px-2 py-0.5 text-xs text-signal-warn">
            Mint retained
          </span>
        )}
      </div>
    </aside>
  );
}

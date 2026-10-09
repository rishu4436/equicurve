"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from "react";
import type { PassportCheck, PassportResponse } from "@/lib/passport/types";
import { normalizeHttpsUrl, normalizeXProfile, isLocalTokenImageUrl } from "@/lib/validation";

function short(value: string | null): string {
  if (!value) return "Unknown";
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-6)}` : value;
}

function value(value: string | number | boolean | null | undefined): string {
  if (value == null) return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function stateClass(state: PassportCheck["state"]): string {
  if (state === "matched" || state === "inside") return "border-accent/30 bg-accent/10 text-accent";
  if (state === "near") return "border-signal-warn/30 bg-signal-warn/10 text-signal-warn";
  if (state === "mismatch" || state === "outside") return "border-signal-danger/30 bg-signal-danger/10 text-signal-danger";
  return "border-line bg-subtle text-fg-muted";
}

function stateLabel(state: PassportCheck["state"]): string {
  return state === "matched" ? "Configuration matched" : state === "mismatch" ? "Configuration mismatch" : state === "inside" ? "Within design envelope" : state === "near" ? "Near selected limit" : state === "outside" ? "Outside selected limit" : state === "informational" ? "Informational only" : "Observation unavailable";
}

function PassportRow({ label, value: rowValue }: { label: string; value: string | number | boolean | null | undefined }) {
  return <div className="flex flex-col gap-1 rounded-input border border-line bg-subtle px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4"><dt className="text-xs text-fg-muted">{label}</dt><dd className="break-all text-sm text-fg-primary">{value(rowValue)}</dd></div>;
}

function CheckRow({ check }: { check: PassportCheck }) {
  return <div className="rounded-input border border-line bg-subtle p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-fg-primary">{check.label}</p><span className={`rounded-pill border px-2 py-1 text-[11px] ${stateClass(check.state)}`}>{stateLabel(check.state)}</span></div><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-fg-muted">Designed</dt><dd className="mt-1 break-all font-mono text-fg-primary">{value(check.designed)}</dd></div><div><dt className="text-fg-muted">Observed</dt><dd className="mt-1 break-all font-mono text-fg-primary">{value(check.observed)}</dd></div></dl>{check.note && <p className="mt-2 text-xs leading-relaxed text-fg-muted">{check.note}</p>}</div>;
}

function budgetLabel(field: string): string {
  return field.replace(/^max/, "Max ").replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
}

export function PassportPanel({ id, kind = "live" }: { id: string; kind?: "live" | "scheduled" }) {
  const [body, setBody] = useState<PassportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/markets/${encodeURIComponent(id)}/passport`, { cache: "no-store" });
      const json = (await response.json()) as PassportResponse & { error?: string };
      if (!response.ok || !json.ok) throw new Error(json.error ?? "Passport is unavailable.");
      setBody(json);
    } catch (loadError) {
      setBody(null);
      setError(loadError instanceof Error ? loadError.message : "Passport is unavailable.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href.split("?")[0]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  if (loading) return <div className="rounded-input border border-line bg-subtle p-6 text-sm text-fg-muted">Loading Market Passport…</div>;
  if (error || !body) return <div className="space-y-3 rounded-input border border-line bg-subtle p-6"><p className="text-sm text-fg-muted">{error ?? "Passport is unavailable."}</p><button type="button" className="ec-btn-secondary text-xs" onClick={() => void load()}>Retry</button></div>;

  const { market, design, deployment, observed, monitor } = body;
  const marketImage = market.imageUrl && (isLocalTokenImageUrl(market.imageUrl) || normalizeHttpsUrl(market.imageUrl)) ? market.imageUrl : null;
  const website = normalizeHttpsUrl(market.website);
  const xProfile = normalizeXProfile(market.xProfile);
  return <div className="space-y-5" data-testid="market-passport">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="ec-eyebrow">Permanent read-only record</p><h2 className="mt-1 text-2xl font-semibold text-fg-primary">Market Passport</h2><p className="mt-2 text-sm text-fg-secondary">Design intent, deployment evidence, and observable live conditions in one view.</p></div><div className="flex gap-2"><button type="button" className="ec-btn-secondary text-xs" onClick={() => void load()}>Refresh</button><button type="button" className="ec-btn-secondary text-xs" onClick={() => void copyLink()}>{copied ? "Copied" : "Copy Passport link"}</button></div></div>

    <section className="ec-card space-y-3 p-4" aria-label="Market identity"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-3">{marketImage ? <img src={marketImage} alt="" className="h-12 w-12 shrink-0 rounded-xl border border-line object-cover" referrerPolicy="no-referrer" /> : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-accent/20 bg-accent/10 font-semibold text-accent">{market.ticker.slice(0, 2)}</div>}<div className="min-w-0"><h3 className="truncate font-semibold text-fg-primary">{market.name}</h3><p className="font-mono text-xs text-fg-muted">${market.ticker}</p></div></div><span className="ec-chip">{market.lifecycle}</span></div><div className="flex flex-wrap gap-2">{website && <a href={website} target="_blank" rel="noopener noreferrer" className="ec-chip text-accent hover:underline">Website ↗</a>}{xProfile && <a href={xProfile} target="_blank" rel="noopener noreferrer" className="ec-chip text-accent hover:underline">X ↗</a>}</div><dl className="grid gap-2"><PassportRow label="Fingerprint" value={design.fingerprint} /><PassportRow label="Creator" value={short(market.creator)} /><PassportRow label="Mint" value={short(market.mint)} /><PassportRow label="Pool" value={short(market.pool)} /><PassportRow label="Config" value={short(market.config)} /><PassportRow label="Quote" value={market.quote} /><PassportRow label="Active venue" value={market.activeVenue} /></dl><p className="text-xs leading-relaxed text-fg-muted">The design fingerprint deterministically identifies the canonical EquiCurve market configuration represented by this design. It is not a fingerprint stored on-chain.</p></section>

    <section className="ec-card space-y-3 p-4" aria-label="Original design"><h3 className="font-semibold text-fg-primary">Original design</h3><p className="text-xs text-fg-muted">Issuer design assumptions</p><dl className="grid gap-2"><PassportRow label="Objective" value={design.objective} /><PassportRow label="Asset profile" value={design.asset} /><PassportRow label="Profile" value={design.profileName} /><PassportRow label="Preset" value={design.presetId} /><PassportRow label="Target raise" value={design.originalIntent.targetRaise == null ? null : `${design.originalIntent.targetRaise} ${design.originalIntent.quote ?? ""}`} /><PassportRow label="Typical trade" value={design.originalIntent.typicalTrade} /><PassportRow label="Expected participants" value={design.originalIntent.expectedParticipants} /><PassportRow label="Total supply" value={design.originalIntent.totalSupply} /></dl></section>

    <section className="ec-card space-y-3 p-4" aria-label="Constraint negotiation"><h3 className="font-semibold text-fg-primary">Constraint negotiation</h3>{design.acceptedRelaxations.length === 0 ? <p className="text-sm text-fg-secondary">No constraint relaxations accepted.</p> : <div className="space-y-2">{design.acceptedRelaxations.map((change) => <div key={change.field} className="rounded-input border border-signal-warn/30 bg-signal-warn/5 p-3 text-sm"><p className="font-medium text-fg-primary">{budgetLabel(change.field)}</p><p className="mt-1 text-xs text-fg-secondary">Requested {change.from} → Accepted {change.to}</p><p className="mt-1 text-xs text-signal-warn">Explicitly widened before launch</p></div>)}</div>}{design.requestedConstraints && <div className="overflow-x-auto rounded-input border border-line"><table className="w-full min-w-[520px] text-left text-xs"><thead className="border-b border-line text-fg-muted"><tr><th className="px-3 py-2">Constraint</th><th className="px-3 py-2">Requested</th><th className="px-3 py-2">Accepted</th></tr></thead><tbody>{Object.keys(design.requestedConstraints).map((field) => <tr key={field} className="border-b border-line/60"><td className="px-3 py-2 text-fg-secondary">{budgetLabel(field)}</td><td className="px-3 py-2 font-mono text-fg-primary">{value(design.requestedConstraints?.[field as keyof typeof design.requestedConstraints])}</td><td className="px-3 py-2 font-mono text-fg-primary">{value(design.appliedConstraints?.[field as keyof typeof design.appliedConstraints])}</td></tr>)}</tbody></table></div>}</section>

    <section className="ec-card space-y-3 p-4" aria-label="Robustness"><h3 className="font-semibold text-fg-primary">Robustness</h3>{design.robustness ? <><p className="text-2xl font-semibold text-fg-primary">{design.robustness.insideCount == null ? "Unknown" : `${design.robustness.insideCount} / ${design.robustness.scenarioCount}`} <span className="text-sm font-normal text-fg-muted">synthetic scenarios</span></p><p className="text-xs text-fg-muted">{design.robustness.note}</p></> : <p className="text-sm text-fg-muted">Observation unavailable in the stored design record.</p>}</section>

    <section className="ec-card space-y-3 p-4" aria-label="Deployment verification"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-fg-primary">Deployment verification</h3><span className={`rounded-pill border px-2 py-1 text-[11px] ${stateClass(deployment.status === "verified" ? "matched" : deployment.status === "mismatch" ? "mismatch" : "unknown")}`}>{deployment.status === "not_applicable" ? "Not applicable yet" : deployment.status === "verified" ? "Verified" : deployment.status === "mismatch" ? "Mismatch" : "Unknown"}</span></div><dl className="grid gap-2"><PassportRow label="Pool found" value={deployment.poolFound} /><PassportRow label="Config match" value={deployment.configMatch} /><PassportRow label="Fingerprint-derived config match" value={deployment.fingerprintMatch} /><PassportRow label="Mint match" value={deployment.mintMatch} /><PassportRow label="Migration threshold match" value={deployment.thresholdMatch} /><PassportRow label="Quote mint match" value={deployment.quoteMintMatch} /><PassportRow label="Creator match" value={deployment.creatorMatch} /></dl>{deployment.verified === true && <p className="text-xs text-fg-secondary">The on-chain DBC configuration matches the canonical configuration represented by this fingerprint.</p>}{deployment.checkedAt && <p className="text-xs text-fg-muted">Last checked {new Date(deployment.checkedAt).toLocaleString()}</p>}</section>

    <section className="ec-card space-y-3 p-4" aria-label="Live design monitor"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-fg-primary">Live design monitor</h3><span className="ec-chip">{monitor.status === "not_applicable" ? "Not available until launch" : monitor.status}</span></div>{monitor.checks.length === 0 ? <p className="text-sm text-fg-muted">{monitor.note ?? "Live monitor is not available until launch."}</p> : <div className="space-y-2">{monitor.checks.map((check) => <CheckRow key={check.id} check={check} />)}</div>}{observed.checkedAt && <p className="text-xs text-fg-muted">Last checked {new Date(observed.checkedAt).toLocaleString()}</p>}<p className="text-xs leading-relaxed text-fg-muted">Live Design Monitor compares observable state with selected design parameters. It is not a prediction, credit rating, investment recommendation, or fair-value assessment.</p></section>

    {kind === "scheduled" && body.schedule && <section className="rounded-input border border-accent/20 bg-accent/5 p-4 text-sm text-fg-secondary"><p className="font-medium text-fg-primary">Scheduled</p><p className="mt-1">Launch scheduled {new Date(body.schedule.scheduledForUtc).toLocaleString()}</p><p className="mt-2">{body.schedule.note} Deployment and live observations are not available yet.</p></section>}
  </div>;
}

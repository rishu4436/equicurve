"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { toast } from "sonner";
import { signSchedulePayload } from "@/lib/auth/scheduleAuth";
import { getScheduledLaunch } from "@/lib/schedule/client";
import { updateScheduledLaunch } from "@/lib/schedule/client";
import type { PublicScheduledLaunch, ScheduleStatus, ScheduledLaunchDraft } from "@/lib/schedule/types";
import { getCluster } from "@/lib/constants";
import { isLocalTokenImageUrl, normalizeHttpsUrl, normalizeXProfile } from "@/lib/validation";
import { UpdatesPanel } from "@/components/community/UpdatesPanel";

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(new Date(iso));
}

function statusLabel(status: ScheduleStatus): string {
  return status === "ready" ? "Ready to launch" : status[0].toUpperCase() + status.slice(1);
}

function countdown(iso: string, nowMs: number): string {
  const remaining = Math.max(0, new Date(iso).getTime() - nowMs);
  const seconds = Math.floor(remaining / 1000);
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const secs = seconds % 60;
  return days > 0 ? `${days}d ${hours}h ${minutes}m` : `${hours}h ${minutes}m ${secs}s`;
}

function linkValue(value: string, kind: "website" | "x"): string | null {
  return kind === "website" ? normalizeHttpsUrl(value) : normalizeXProfile(value);
}

export function UpcomingDetailClient({ id }: { id: string }) {
  const wallet = useWallet();
  const searchParams = useSearchParams();
  const [schedule, setSchedule] = useState<PublicScheduledLaunch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [localTime, setLocalTime] = useState("");

  useEffect(() => {
    let active = true;
    void getScheduledLaunch(id).then((result) => {
      if (!active) return;
      if (result.ok) setSchedule(result.schedule);
      else setError(result.error);
    });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    if (!schedule) return;
    const date = new Date(schedule.scheduledForUtc);
    setLocalTime(new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  }, [schedule?.scheduledForUtc, schedule]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const image = useMemo(() => schedule && (isLocalTokenImageUrl(schedule.image) || normalizeHttpsUrl(schedule.image) ? schedule.image : null), [schedule]);
  const website = schedule ? linkValue(schedule.website, "website") : null;
  const xProfile = schedule ? linkValue(schedule.xProfile, "x") : null;
  const status = schedule?.effectiveStatus ?? schedule?.status;

  async function signAction(payload: Parameters<typeof signSchedulePayload>[0]["payload"]): Promise<void> {
    if (!schedule || !wallet.publicKey || !wallet.signMessage) {
      toast.error("Connect the creator wallet with free message signing enabled.");
      return;
    }
    setBusy(true);
    try {
      const body = await signSchedulePayload({ payload, signer: wallet.publicKey.toBase58(), signMessage: wallet.signMessage });
      const result = await updateScheduledLaunch(body);
      if (!result.ok) throw new Error(result.error);
      setSchedule(result.schedule);
      toast.success(payload.action === "schedule_cancel" ? "Scheduled launch cancelled" : "Launch rescheduled");
    } catch (actionError) {
      toast.error(actionError instanceof Error ? actionError.message : "Schedule update failed");
    } finally {
      setBusy(false);
    }
  }

  function draftFromPublic(value: PublicScheduledLaunch): ScheduledLaunchDraft {
    return {
      name: value.name,
      ticker: value.ticker,
      thesis: value.thesis,
      sector: value.sector,
      website: value.website,
      xProfile: value.xProfile,
      image: value.image,
      presetId: value.presetId,
      raiseTarget: value.raiseTarget,
      quote: value.quote,
      totalSupply: value.totalSupply,
      seedBuy: value.seedBuy,
      feeIssuerPct: value.feeIssuerPct,
      lpLockPct: value.lpLockPct,
      antiSniper: value.antiSniper,
      mintRenounce: value.mintRenounce,
      feeClaimer: value.feeClaimer,
      transferProfile: value.transferProfile,
      designFingerprint: value.designFingerprint,
      design: value.design,
      scheduledForUtc: value.scheduledForUtc,
      marketCaps: value.marketCaps,
      designed: value.designed,
    };
  }

  if (error) return <div className="ec-card p-6 text-sm text-signal-danger">{error}</div>;
  if (!schedule) return <div className="ec-card p-6 text-sm text-fg-muted">Loading upcoming launch…</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/explore?tab=upcoming" className="text-sm text-accent hover:underline">← Upcoming launches</Link>
      <section className="ec-card overflow-hidden p-6 sm:p-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="h-20 w-20 shrink-0 rounded-2xl border border-line object-cover" />
            ) : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-2xl font-semibold text-accent">{schedule.ticker.slice(0, 2)}</div>}
            <div className="min-w-0"><p className="ec-eyebrow mb-2">Upcoming</p><h1 className="text-3xl font-semibold tracking-tight text-fg-primary">{schedule.name}</h1><p className="mt-1 font-mono text-sm text-fg-muted">${schedule.ticker}</p></div>
          </div>
          <span className="ec-chip shrink-0 border-accent/30 text-accent">{statusLabel(status ?? "scheduled")}</span>
        </div>
        <p className="mt-6 max-w-3xl text-sm leading-relaxed text-fg-secondary">{schedule.thesis}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {website && <a href={website} target="_blank" rel="noopener noreferrer" className="ec-btn-secondary text-xs">Website ↗</a>}
          {xProfile && <a href={xProfile} target="_blank" rel="noopener noreferrer" className="ec-btn-secondary text-xs">X ↗</a>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
        <section className="ec-card space-y-4 p-6">
          <div><p className="text-xs uppercase tracking-widest text-fg-muted">Scheduled time</p><p className="mt-2 text-xl font-semibold text-fg-primary">{formatTime(schedule.scheduledForUtc)}</p><p className="mt-1 text-sm text-fg-muted">Server time determines readiness. Your countdown is presentation only.</p></div>
          {status === "scheduled" && <div className="rounded-input border border-accent/20 bg-accent/5 p-4"><p className="text-xs uppercase tracking-widest text-accent">Countdown</p><p className="mt-2 font-mono text-2xl tabular-nums text-fg-primary">{countdown(schedule.scheduledForUtc, now)}</p></div>}
          {status === "ready" && <div className="rounded-input border border-signal-warn/30 bg-signal-warn/5 p-4 text-sm text-signal-warn">This launch is ready for the creator to reconnect, review, and sign the normal transaction.</div>}
          {status === "cancelled" && <div className="rounded-input border border-line bg-subtle p-4 text-sm text-fg-secondary">This schedule was cancelled. It remains auditable and cannot launch.</div>}
          {status === "invalidated" && <div className="rounded-input border border-signal-danger/30 bg-signal-danger/5 p-4 text-sm text-signal-danger">{schedule.invalidatedReason ?? "The scheduled design changed and must be reviewed again."}</div>}
          <p className="text-sm font-medium text-fg-primary">No market exists on-chain yet.</p>
          {status === "ready" && <Link href={`/create?scheduledId=${encodeURIComponent(schedule.id)}`} className="ec-btn-primary inline-flex">Connect wallet to launch</Link>}
          {(status === "scheduled" || status === "ready") && <div className="space-y-3 border-t border-line pt-4"><p className="text-xs uppercase tracking-widest text-fg-muted">Creator controls</p>{wallet.publicKey && wallet.publicKey.toBase58() !== schedule.creatorWallet && <p className="text-xs text-signal-danger">Connected wallet does not own this schedule.</p>}{wallet.publicKey?.toBase58() === schedule.creatorWallet && <><label className="block space-y-1.5"><span className="ec-label">Reschedule</span><input type="datetime-local" className="ec-input" value={localTime} onChange={(event) => setLocalTime(event.target.value)} /></label><div className="flex flex-wrap gap-2"><button type="button" className="ec-btn-secondary text-xs" disabled={busy || !wallet.signMessage || !localTime} onClick={() => { const next = new Date(localTime); if (!Number.isFinite(next.getTime())) { toast.error("Choose a valid launch time."); return; } void signAction({ v: 1, action: "schedule_update", cluster: getCluster(), scheduleId: schedule.id, schedule: { ...draftFromPublic(schedule), scheduledForUtc: next.toISOString() } }); }}>Save new time</button><button type="button" className="ec-btn-secondary text-xs text-signal-danger" disabled={busy || !wallet.signMessage} onClick={() => void signAction({ v: 1, action: "schedule_cancel", cluster: getCluster(), scheduleId: schedule.id })}>Cancel schedule</button></div></>}</div>}
        </section>
        <section className="ec-card space-y-4 p-6">
          <div><p className="text-xs uppercase tracking-widest text-fg-muted">Design</p><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-fg-muted">Raise target</dt><dd className="text-fg-primary">{schedule.raiseTarget.toLocaleString()} {schedule.quote}</dd></div><div className="flex justify-between gap-3"><dt className="text-fg-muted">LP lock</dt><dd className="text-fg-primary">{schedule.lpLockPct}%</dd></div><div className="flex justify-between gap-3"><dt className="text-fg-muted">Preset</dt><dd className="text-fg-primary">{schedule.presetId}</dd></div></dl></div>
          <div className="rounded-input border border-line bg-subtle p-3"><p className="text-xs text-fg-muted">Fingerprint</p><code className="mt-1 block break-all font-mono text-xs text-accent-soft">{schedule.designFingerprint}</code></div>
          <div><p className="text-xs uppercase tracking-widest text-fg-muted">Creator wallet</p><code className="mt-2 block break-all font-mono text-xs text-fg-secondary">{schedule.creatorWallet}</code></div>
        </section>
      </div>
      {(status === "scheduled" || status === "ready") && (
        <section className="ec-card p-6 sm:p-8">
          <div className="mb-5"><p className="ec-eyebrow">Communication</p><h2 className="mt-1 text-2xl font-semibold text-fg-primary">Updates</h2><p className="mt-2 text-sm text-fg-muted">Upcoming creator updates are tied to this schedule identity until a market exists on-chain.</p></div>
          <UpdatesPanel marketId={schedule.id} marketKind="scheduled" creatorWallet={schedule.creatorWallet} focusPostId={searchParams.get("post")} />
        </section>
      )}
    </div>
  );
}

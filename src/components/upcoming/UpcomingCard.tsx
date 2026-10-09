import Link from "next/link";
import type { PublicScheduledLaunch } from "@/lib/schedule/types";
import { isLocalTokenImageUrl, normalizeHttpsUrl, normalizeXProfile } from "@/lib/validation";

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZoneName: "short" }).format(new Date(iso));
}

export function UpcomingCard({ schedule }: { schedule: PublicScheduledLaunch }) {
  const image = isLocalTokenImageUrl(schedule.image) || normalizeHttpsUrl(schedule.image) ? schedule.image : null;
  const website = normalizeHttpsUrl(schedule.website);
  const xProfile = normalizeXProfile(schedule.xProfile);
  return (
    <Link href={`/upcoming/${schedule.id}`} className="ec-surface-link group flex min-w-0 flex-col p-6">
      <div className="flex items-start gap-3"><div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-accent/20 bg-accent/10 text-lg font-medium text-accent">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : schedule.ticker.slice(0, 2)}
      </div><div className="min-w-0"><h2 className="truncate text-lg font-medium tracking-tight">{schedule.name}</h2><p className="mt-0.5 font-mono text-xs text-fg-muted">${schedule.ticker}</p></div></div>
      <p className="mb-5 mt-4 line-clamp-2 min-h-10 text-sm leading-relaxed text-fg-secondary">{schedule.thesis}</p>
      <div className="mb-5 flex flex-wrap gap-2"><span className="ec-chip border-accent/30 text-accent">{schedule.effectiveStatus === "ready" ? "Ready to launch" : "Upcoming"}</span><span className="ec-chip">Not live yet</span><span className="ec-chip">{schedule.quote}</span></div>
      <div className="mt-auto rounded-xl border border-line bg-base/40 p-4"><p className="text-xs text-fg-muted">Scheduled for</p><p className="mt-1 text-sm font-medium text-fg-primary">{timeLabel(schedule.scheduledForUtc)}</p><p className="mt-3 break-all font-mono text-[11px] text-fg-muted">{schedule.designFingerprint}</p></div>
      {(website || xProfile) && <div className="mt-4 flex gap-3 text-xs text-fg-muted">{website && <span>Website ↗</span>}{xProfile && <span>X ↗</span>}</div>}
    </Link>
  );
}

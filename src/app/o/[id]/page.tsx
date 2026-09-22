import Link from "next/link";
import { notFound } from "next/navigation";
import { TradePanel } from "@/components/TradePanel";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { StatusPill } from "@/components/ui/StatusPill";
import { getOffering } from "@/lib/demo/offerings";

export default async function OfferingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const offering = getOffering(id);

  // Live pool address from Create redirect — show trade panel stub chrome
  const isPoolAddress = id.length >= 32 && !offering;

  if (!offering && !isPoolAddress) notFound();

  const pct = offering
    ? offering.raiseTarget > 0
      ? (offering.raised / offering.raiseTarget) * 100
      : 0
    : 0;

  return (
    <div className="space-y-6">
      <p className="text-xs text-fg-muted">
        <Link href="/explore" className="hover:text-accent">
          Explore
        </Link>
        {" / "}
        <span className="text-fg-secondary">
          {offering ? `$${offering.ticker}` : id.slice(0, 8) + "…"}
        </span>
      </p>

      <header className="ec-card flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-card border border-line bg-subtle text-xl font-semibold text-accent">
            {offering ? offering.ticker.slice(0, 2) : "TX"}
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-fg-primary">
              {offering?.name ?? "Live DBC pool"}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {offering && (
                <>
                  <span className="font-mono text-sm text-fg-muted">
                    ${offering.ticker}
                  </span>
                  <span className="ec-chip">{offering.sector}</span>
                  <StatusPill status={offering.status} />
                  {offering.verified && (
                    <span className="rounded-pill border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] text-gold">
                      Verified
                    </span>
                  )}
                </>
              )}
              {!offering && (
                <span className="font-mono text-xs text-fg-muted">{id}</span>
              )}
            </div>
          </div>
        </div>
        {offering && !offering.status.includes("grad") && (
          <ProgressRing value={pct} size={64} />
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <div className="ec-card p-5">
            <h2 className="mb-2 font-semibold text-fg-primary">Overview</h2>
            <p className="text-sm text-fg-secondary">
              {offering?.thesis ??
                "On-chain pool opened via EquiCurve Create. Use the trade ticket for real DBC swaps; graduation lives under Graduate."}
            </p>
            {offering && (
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-fg-muted">Raise</dt>
                  <dd className="font-mono text-fg-primary">
                    ${offering.raised.toLocaleString()} / $
                    {offering.raiseTarget.toLocaleString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Preset</dt>
                  <dd className="capitalize text-fg-primary">
                    {offering.presetId}
                  </dd>
                </div>
                <div>
                  <dt className="text-fg-muted">Quote</dt>
                  <dd className="text-fg-primary">{offering.quote}</dd>
                </div>
                <div>
                  <dt className="text-fg-muted">LP lock</dt>
                  <dd className="text-fg-primary">≥{offering.lockPct}%</dd>
                </div>
              </dl>
            )}
            <p className="mt-4 rounded-input border border-signal-warn/30 bg-signal-warn/5 px-3 py-2 text-xs text-signal-warn">
              Bonding price is discovery, not NAV / fair value.
            </p>
          </div>

          <div className="ec-card p-5">
            <h2 className="mb-3 font-semibold text-fg-primary">Tabs (Slice A)</h2>
            <div className="flex flex-wrap gap-2 text-xs">
              {[
                "Overview",
                "Disclosures",
                "Holders",
                "Activity",
                "Pool / On-chain",
              ].map((t) => (
                <span key={t} className="ec-chip">
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-3 text-sm text-fg-muted">
              Disclosures / holders / activity polish continues in Slice B.
              On-chain IDs appear after a real Create launch.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {isPoolAddress ? (
            <TradePanel poolAddress={id} />
          ) : (
            <div className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
              <h2 className="font-semibold text-fg-primary">Trade ticket</h2>
              <p>
                Demo offering — connect a live pool address from Create to trade
                on-curve. Or open Trade with a pool pubkey.
              </p>
              <Link href="/trade" className="ec-btn-secondary inline-flex">
                Open Trade
              </Link>
              {offering?.status === "graduated" && (
                <Link
                  href={`/o/${offering.id}/graduate`}
                  className="ec-btn-primary inline-flex"
                >
                  View graduation
                </Link>
              )}
            </div>
          )}
          <div className="ec-card p-4 text-xs text-fg-muted">
            <p className="mb-1 font-medium text-fg-secondary">Trust mini-strip</p>
            <p>Lock ≥10% · Docs checklist · Program IDs →{" "}
              <Link href="/trust" className="text-accent hover:underline">
                Trust Center
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

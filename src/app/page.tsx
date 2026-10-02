import Link from "next/link";
import { JourneyProofCard } from "@/components/home/JourneyProofCard";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { HomeLocalStrip } from "@/components/home/HomeLocalStrip";
import { CURVE_PRESETS } from "@/lib/dbc/presets";
import { PositioningExplainer } from "@/components/trust/PositioningExplainer";
import { POSITIONING } from "@/lib/positioning";

export default function HomePage() {
  const official = CURVE_PRESETS.filter((p) =>
    ["short", "flat", "exponential", "long"].includes(p.id),
  );

  return (
    <div className="space-y-16">
      <section
        id="hero"
        className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]"
      >
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Market design for programmable launches · Meteora DBC → DAMM v2
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-fg-primary sm:text-5xl">
            Design the market, then deploy that curve
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-fg-secondary sm:text-lg">
            {POSITIONING} Issuers set the curve, fee split, LP lock and mint authority; every setting is written
            on-chain and shown before signing. The token&apos;s link to any company or asset comes from the
            issuer&apos;s own legal framework, not from EquiCurve.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/create" className="ec-btn-primary">
              Create offering
            </Link>
            <Link href="/explore" className="ec-btn-secondary">
              Explore
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap gap-2">
            {["LP lock ≥10% on-chain", "Every setting reviewed before signing", "No shareholder rights created"].map((t) => (
              <span
                key={t}
                className="rounded-pill border border-line bg-elevated px-3 py-1 text-xs text-fg-secondary"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <JourneyProofCard />
      </section>

      <PositioningExplainer compact />

      {/* Real local stats + featured — no fake capital strip */}
      <HomeLocalStrip />

      {/* How it works */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-fg-primary">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              n: "1",
              title: "Write the brief",
              body: "Set the raise, the typical order, the participant count, and the constraint budget. Asset kind is a design assumption, not a legal claim.",
              href: "/create",
            },
            {
              n: "2",
              title: "Negotiate the conflict",
              body: "If no curve passes, EquiCurve does not widen a limit for you. You edit each limit, then recalculate. Deploy stays blocked until a budget you accept admits a curve.",
              href: "/create",
            },
            {
              n: "3",
              title: "Deploy that fingerprint",
              body: "The wallet signs the config you reviewed. Readback says Deployment verified only when the fingerprint, configuration, threshold, and on-chain read all match. A passed readback does not mean every constraint was met.",
              href: "/o/Eq57sdFYg5UFg4rtV7W3mPWYGFi97ovWAYiLYLX8hejF",
            },
          ].map((c) => (
            <Link
              key={c.n}
              href={c.href}
              className="ec-card p-5 transition hover:border-accent/40"
            >
              <span className="font-mono text-accent">{c.n}</span>
              <h3 className="mt-2 font-semibold text-fg-primary">{c.title}</h3>
              <p className="mt-2 text-sm text-fg-secondary">{c.body}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Preset teaser */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold text-fg-primary">
            Fee-schedule seeds
          </h2>
          <Link href="/presets" className="text-sm text-accent hover:underline">
            Market designs
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {official.map((p) => (
            <Link
              key={p.id}
              href={`/create?step=design&preset=${p.id}`}
              className="ec-card p-5 transition hover:border-accent/40"
            >
              <CurveMiniViz preset={p.id} className="mb-3 h-12 w-full" />
              <h3 className="font-semibold text-fg-primary">{p.name}</h3>
              <p className="text-sm text-accent-soft">{p.tagline}</p>
              <p className="mt-2 text-xs text-fg-muted">{p.bestFor}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Trust band */}
      <section className="ec-card flex flex-col items-start justify-between gap-4 p-6 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-fg-primary">Trust Center</h2>
          <p className="mt-1 text-sm text-fg-secondary">
            Meteora program IDs, LP lock policy, mint authority rules, and risk
            education — always one click away.
          </p>
        </div>
        <Link href="/trust" className="ec-btn-secondary shrink-0">
          Open Trust Center
        </Link>
      </section>
    </div>
  );
}

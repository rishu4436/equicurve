import Link from "next/link";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { OfferingCard } from "@/components/ui/OfferingCard";
import { DEMO_OFFERINGS } from "@/lib/demo/offerings";
import { CURVE_PRESETS } from "@/lib/dbc/presets";

const DEMO_STRIP = [
  {
    t: "0:00",
    title: "Home",
    body: "Equity positioning · DBC → DAMM",
    href: "/#hero",
    cta: "Start here",
  },
  {
    t: "0:20",
    title: "Create",
    body: "Long preset · fees · LP ≥10%",
    href: "/create?step=curve&preset=long",
    cta: "Open wizard",
  },
  {
    t: "1:10",
    title: "Trade",
    body: "Buy on curve · watch progress",
    href: "/explore?tab=raising",
    cta: "Explore raising",
  },
  {
    t: "1:50",
    title: "Graduate",
    body: "Migrate TX · DAMM v2",
    href: "/docs#graduate",
    cta: "How graduate works",
  },
  {
    t: "2:35",
    title: "Trust",
    body: "Program IDs for judges",
    href: "/trust",
    cta: "Trust Center",
  },
];

export default function HomePage() {
  const featured = DEMO_OFFERINGS.slice(0, 3);
  const official = CURVE_PRESETS.filter((p) =>
    ["flat", "exponential", "long"].includes(p.id),
  );

  return (
    <div className="space-y-16">
      {/* Hero */}
      <section
        id="hero"
        className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]"
      >
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Equity / RWA · Meteora DBC → DAMM v2
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-fg-primary sm:text-5xl">
            Fair discovery for tokenized equity on Solana
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-fg-secondary sm:text-lg">
            Launch on Meteora Dynamic Bonding Curve. Graduate into DAMM v2.
            Studio-class create wizard, Bags-grade fee economics, xStocks-grade
            trust — not a meme pad with compliance bolted on.
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
            {["LP lock ≥10%", "Program IDs", "Disclosures"].map((t) => (
              <span
                key={t}
                className="rounded-pill border border-line bg-elevated px-3 py-1 text-xs text-fg-secondary"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="ec-card relative overflow-hidden p-6 shadow-glow">
          <p className="mb-4 text-xs uppercase tracking-wider text-fg-muted">
            Bonding curve → DAMM bar
          </p>
          <svg viewBox="0 0 320 160" className="h-40 w-full" aria-hidden>
            <defs>
              <linearGradient id="heroCurve" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#2DD4BF" />
                <stop offset="100%" stopColor="#38BDF8" />
              </linearGradient>
            </defs>
            <path d="M20 140 H300" stroke="#243044" />
            <path d="M20 20 V140" stroke="#243044" />
            <path
              d="M20 130 C 80 125, 140 100, 200 60 S 260 28, 280 24"
              fill="none"
              stroke="url(#heroCurve)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <line
              x1="280"
              y1="24"
              x2="310"
              y2="24"
              stroke="#A78BFA"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <text x="20" y="18" fill="#6B7A8F" fontSize="10">
              Discovery
            </text>
            <text x="250" y="16" fill="#A78BFA" fontSize="10">
              DAMM v2
            </text>
          </svg>
          <p className="mt-2 text-xs text-fg-muted">
            Price discovery on DBC, then permanent depth on DAMM v2.
          </p>
        </div>
      </section>

      {/* Demo strip — ≤3 min path matching design script */}
      <section className="space-y-4" aria-labelledby="demo-path">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="demo-path"
              className="text-2xl font-semibold text-fg-primary"
            >
              Demo path ≤3 min
            </h2>
            <p className="mt-1 text-sm text-fg-secondary">
              Film in this order: Home → Create → Trade → Graduate → Trust.
            </p>
          </div>
          <Link href="/docs" className="text-sm text-accent hover:underline">
            Full docs →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {DEMO_STRIP.map((step, i) => (
            <Link
              key={step.title}
              href={step.href}
              className="ec-card group flex flex-col p-4 transition hover:border-accent/40"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-accent">
                  {step.t}
                </span>
                <span className="font-mono text-[10px] text-fg-muted">
                  {i + 1}/5
                </span>
              </div>
              <h3 className="mt-2 font-semibold text-fg-primary">
                {step.title}
              </h3>
              <p className="mt-1 flex-1 text-xs text-fg-secondary">
                {step.body}
              </p>
              <span className="mt-3 text-xs font-medium text-accent group-hover:underline">
                {step.cta} →
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Stat strip */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Capital in discovery", value: "$216k" },
          { label: "Graduated pools", value: "2" },
          { label: "Avg raise time", value: "6.4d" },
          { label: "Official presets", value: "3" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-pill border border-line bg-elevated px-5 py-3 text-center sm:text-left"
          >
            <p className="font-mono text-lg text-fg-primary">{s.value}</p>
            <p className="text-xs text-fg-muted">{s.label}</p>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold text-fg-primary">How it works</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              n: "1",
              title: "Configure curve",
              body: "Pick Flat, Exponential, or Long. Set fees, locks ≥10%, and disclosures.",
              href: "/create",
            },
            {
              n: "2",
              title: "Discover on DBC",
              body: "Investors trade the bonding curve. Progress rings track real raise toward graduation.",
              href: "/explore",
            },
            {
              n: "3",
              title: "Graduate DAMM v2",
              body: "When the threshold hits, migrate into Meteora DAMM v2 with locked LP.",
              href: "/docs#graduate",
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

      {/* Featured */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold text-fg-primary">
            Featured offerings
          </h2>
          <Link href="/explore" className="text-sm text-accent hover:underline">
            View all
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((o) => (
            <OfferingCard key={o.id} offering={o} />
          ))}
        </div>
      </section>

      {/* Preset teaser */}
      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold text-fg-primary">
            Curve presets
          </h2>
          <Link href="/presets" className="text-sm text-accent hover:underline">
            Preset gallery
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {official.map((p) => (
            <Link
              key={p.id}
              href={`/create?step=curve&preset=${p.id}`}
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

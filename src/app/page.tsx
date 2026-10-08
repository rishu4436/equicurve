import Link from "next/link";
import { JourneyProofCard } from "@/components/home/JourneyProofCard";
import { MarketStudioPreview } from "@/components/home/MarketStudioPreview";
import { CurveMiniViz } from "@/components/ui/CurveMiniViz";
import { HomeLocalStrip } from "@/components/home/HomeLocalStrip";
import { CURVE_PRESETS } from "@/lib/dbc/presets";
import { PositioningExplainer } from "@/components/trust/PositioningExplainer";

export default function HomePage() {
  const official = CURVE_PRESETS.filter((p) => ["short", "flat", "exponential", "long"].includes(p.id));
  return (
    <div className="space-y-20 pb-8 sm:space-y-28">
      <section id="hero" className="ec-hero-glow relative grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[1.08fr_1fr] lg:gap-16">
        <div className="ec-enter">
          <p className="ec-eyebrow mb-6 flex items-center gap-3"><span className="h-px w-8 bg-accent" />The market design studio</p>
          <h1 className="max-w-2xl text-[44px] font-medium leading-[1.06] tracking-[-0.055em] sm:text-[64px] xl:text-[72px]">Shape the market.<br /><span className="text-accent">Then launch it.</span></h1>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-fg-secondary sm:text-lg">Design your bonding curve, test the tradeoffs, and deploy the configuration you reviewed. One clear workspace, from first idea to on-chain launch.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link href="/create" className="ec-btn-primary">Design a market <span aria-hidden="true">↗</span></Link><Link href="/explore" className="ec-btn-secondary">Explore markets <span aria-hidden="true">→</span></Link></div>
          <p className="mt-6 text-xs leading-relaxed text-fg-muted">Built on Solana · Powered by Meteora<br className="sm:hidden" /><span className="hidden sm:inline"> · </span>Every setting reviewed before signing</p>
        </div>
        <MarketStudioPreview />
      </section>

      <section className="space-y-8">
        <div className="grid gap-5 md:grid-cols-2"><div><p className="ec-eyebrow">From intention to execution</p><h2 className="ec-section-title mt-3">Good markets start<br />with deliberate choices.</h2></div><p className="max-w-lg self-end text-sm leading-relaxed text-fg-secondary">Define what matters. Compare what is possible. Keep control of every constraint, from the first simulation to the wallet signature.</p></div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            { n: "01", title: "Write the brief", body: "Set your raise, typical order, and participant count. Choose the limits your market needs to respect.", tag: "Your goals, made explicit" },
            { n: "02", title: "Explore the tradeoffs", body: "Compare simulated designs. If none passes, review the conflict and explicitly adjust your constraint budget.", tag: "No silent compromises" },
            { n: "03", title: "Review. Sign. Verify.", body: "Deploy the configuration you reviewed. Check its fingerprint and on-chain readback after the transaction.", tag: "A traceable configuration" },
          ].map(c => <Link key={c.n} href="/create" className="ec-surface-link group flex flex-col p-6 sm:p-8"><div className="flex justify-between font-mono text-xs text-fg-muted"><span>{c.n}</span><span className="text-accent transition-transform group-hover:translate-x-1" aria-hidden="true">↗</span></div><h3 className="mt-8 text-xl font-medium tracking-tight">{c.title}</h3><p className="mb-8 mt-3 text-sm leading-relaxed text-fg-secondary">{c.body}</p><p className="mt-auto border-t border-line pt-4 text-xs text-fg-muted">{c.tag}</p></Link>)}
        </div>
      </section>

      <HomeLocalStrip />

      <section className="grid items-start gap-8 lg:grid-cols-[.72fr_1.28fr] lg:gap-16">
        <div className="lg:sticky lg:top-28"><p className="ec-eyebrow">See the evidence</p><h2 className="ec-section-title mt-3">A launch you can<br />look inside.</h2><p className="mt-5 text-sm leading-relaxed text-fg-secondary">Follow Journey from its market brief to a verified devnet deployment. The record shows both the configuration that was deployed and the constraints it did not meet.</p><p className="mt-4 text-sm leading-relaxed text-fg-muted">Deployment verification confirms an on-chain match. It does not mean every market constraint passed.</p><Link href="/trust" className="mt-6 inline-flex min-h-11 items-center gap-3 text-sm text-accent hover:underline">How verification works <span aria-hidden="true">→</span></Link></div>
        <JourneyProofCard />
      </section>

      <section className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="ec-eyebrow">A starting point for every brief</p><h2 className="ec-section-title mt-3">Find your curve.</h2></div><Link href="/presets" className="ec-btn-secondary">Explore the curve library <span aria-hidden="true">→</span></Link></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{official.map((p, i) => <Link key={p.id} href={`/create?step=design&preset=${p.id}`} className="ec-surface-link p-6"><div className="flex justify-between text-xs text-fg-muted"><span>0{i + 1}</span><span aria-hidden="true">↗</span></div><CurveMiniViz preset={p.id} className="my-6 h-24 w-full" /><h3 className="text-lg font-medium">{p.name}</h3><p className="mt-1 text-sm text-accent-soft">{p.tagline}</p><p className="mt-4 text-xs leading-relaxed text-fg-muted">{p.bestFor}</p></Link>)}</div>
        <p className="text-xs text-fg-muted">Curve illustrations show the shape only. Simulate your own brief to compare actual configurations.</p>
      </section>

      <PositioningExplainer compact />

      <section className="ec-hero-grid relative overflow-hidden rounded-[24px] border border-accent/20 bg-elevated px-6 py-12 text-center sm:px-12 sm:py-16"><p className="ec-eyebrow">Make the next move</p><h2 className="mx-auto mt-4 max-w-xl text-3xl font-medium tracking-[-0.04em] sm:text-5xl">Your market deserves<br />a thoughtful beginning.</h2><p className="mx-auto mt-5 max-w-lg text-sm leading-relaxed text-fg-secondary">Start with a brief. Refine it with evidence. Review every setting before you deploy.</p><div className="mt-8 flex flex-wrap justify-center gap-3"><Link href="/create" className="ec-btn-primary">Open the studio <span aria-hidden="true">↗</span></Link><Link href="/docs" className="ec-btn-secondary">Read the guide</Link></div></section>
    </div>
  );
}

import Link from "next/link";
import { DOCS } from "@/lib/constants";
import { CURVE_PRESETS } from "@/lib/dbc/presets";

const STEPS = [
  {
    n: "1",
    title: "Create",
    href: "/create",
    body: "Issuer runs the 6-step wizard: Basics → Offering (self-attest docs) → Curve preset → Fees & locks (≥10% LP) → Review → Launch. Launch signs a real DBC createConfigAndPool / createPool transaction — no mock success.",
  },
  {
    n: "2",
    title: "Trade",
    href: "/explore",
    body: "Investors open the offering, pass the eligibility gate if required, then buy/sell on the bonding curve. Progress rings track on-chain quote reserves toward the migration threshold.",
  },
  {
    n: "3",
    title: "Graduate",
    href: "/docs#graduate",
    body: "When quote progress ≈ 100%, migrateToDammV2 moves liquidity into a DAMM v2 pool with locked LP. Graduation surfaces the migrate TX signature + explorer link; DAMM pool address is best-effort derived when possible.",
  },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-fg-primary">Docs</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Short how-it-works for Create → Trade → Graduate, preset glossary, and
          local env setup. For program IDs and risk posture see{" "}
          <Link href="/trust" className="text-accent hover:underline">
            Trust Center
          </Link>
          .
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-fg-primary">
          How it works: Create → Trade → Graduate
        </h2>
        <div className="grid gap-3">
          {STEPS.map((s) => (
            <Link
              key={s.n}
              href={s.href}
              className="ec-card block p-5 transition hover:border-accent/40"
            >
              <div className="flex items-start gap-3">
                <span className="font-mono text-lg text-accent">{s.n}</span>
                <div>
                  <h3 className="font-semibold text-fg-primary">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-fg-secondary">
                    {s.body}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <div
          id="graduate"
          className="rounded-input border border-line bg-subtle px-4 py-3 text-xs text-fg-muted"
        >
          Lifecycle evidence for judges: Launch TX → pool/mint/config on On-chain
          tab → swap TX in Activity → migrate TX on Graduation → DAMM v2 program
          ID in Trust Center.
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-fg-primary">
          Preset glossary
        </h2>
        <p className="text-sm text-fg-secondary">
          All official presets call{" "}
          <code className="text-accent-soft">buildCurveWithMarketCap</code> with
          different initial / migration market caps and fee schedulers.
        </p>
        <div className="space-y-3">
          {CURVE_PRESETS.map((p) => (
            <div key={p.id} className="ec-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-semibold text-fg-primary">
                  {p.name}{" "}
                  <span className="text-sm font-normal text-accent-soft">
                    ({p.tagline})
                  </span>
                </h3>
                <span className="font-mono text-[10px] text-fg-muted">
                  {p.initialMarketCap.toLocaleString()} →{" "}
                  {p.migrationMarketCap.toLocaleString()} MC
                </span>
              </div>
              <p className="mt-2 text-sm text-fg-secondary">{p.description}</p>
              <p className="mt-1 text-xs text-fg-muted">
                Best for: {p.bestFor} · Fees: {p.feeLabel}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="ec-card space-y-3 p-5">
        <h2 className="font-semibold text-fg-primary">Environment setup</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-fg-secondary">
          <li>
            Copy <code className="text-accent-soft">.env.example</code> →{" "}
            <code className="text-accent-soft">.env.local</code>
          </li>
          <li>
            Set <code className="text-accent-soft">NEXT_PUBLIC_RPC_URL</code> to a
            dedicated <strong className="text-fg-primary">devnet</strong> RPC
            (Helius / Triton / QuickNode). Public{" "}
            <code className="text-accent-soft">api.devnet.solana.com</code> is
            rate-limited and will flake during demos.
          </li>
          <li>
            Keep <code className="text-accent-soft">NEXT_PUBLIC_CLUSTER=devnet</code>{" "}
            unless you intentionally film mainnet.
          </li>
          <li>
            Optional:{" "}
            <code className="text-accent-soft">NEXT_PUBLIC_POOL_CONFIG_KEY</code>{" "}
            to reuse a partner PoolConfig;{" "}
            <code className="text-accent-soft">NEXT_PUBLIC_DAMM_V2_CONFIG</code>{" "}
            for a custom migration fee config.
          </li>
          <li>
            <code className="text-accent-soft">npm install && npm run dev</code>{" "}
            — open{" "}
            <Link href="/api/health" className="text-accent hover:underline">
              /api/health
            </Link>{" "}
            to confirm cluster + RPC host (no secrets).
          </li>
        </ol>
        <p className="text-xs text-fg-muted">
          Never commit private keys. The app never invents keys or spends funds
          without a wallet signature.
        </p>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Investor risk (short)</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Bonding price is discovery, not NAV of any underlying asset.</li>
          <li>Smart contracts and RPCs can fail; always verify Explorer links.</li>
          <li>
            Read Disclosures and confirm program IDs in{" "}
            <Link href="/trust" className="text-accent hover:underline">
              Trust Center
            </Link>{" "}
            before signing.
          </li>
          <li>
            MVP eligibility is self-attest + docs — not a regulated KYC vendor.
          </li>
        </ul>
      </section>

      <section className="ec-card space-y-2 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">FAQ</h2>
        <p>
          <strong className="text-fg-primary">Is this a pump.fun clone?</strong>{" "}
          No — equity/RWA positioning, eligibility, disclosures, and teal
          fintech chrome — same Meteora DBC → DAMM v2 infra as serious launchpads.
        </p>
        <p>
          <strong className="text-fg-primary">Mainnet?</strong> Devnet by default
          for the hackathon demo. Mainnet is env-toggle only when you choose it.
        </p>
        <p>
          <strong className="text-fg-primary">Where is the demo script?</strong>{" "}
          See README § Demo script (≤3 min) mirroring Home → Create → Trade →
          Graduate → Trust.
        </p>
      </section>

      <section className="space-y-2 text-sm">
        <p className="text-fg-muted">External references</p>
        <ul className="space-y-1">
          <li>
            <a
              className="text-accent hover:underline"
              href={DOCS.dbc}
              target="_blank"
              rel="noreferrer"
            >
              Meteora DBC developer guide
            </a>
          </li>
          <li>
            <a
              className="text-accent hover:underline"
              href={DOCS.migration}
              target="_blank"
              rel="noreferrer"
            >
              Migration &amp; liquidity
            </a>
          </li>
          <li>
            <a
              className="text-accent hover:underline"
              href={DOCS.earnListing}
              target="_blank"
              rel="noreferrer"
            >
              Superteam Earn · Meteora DBC listing
            </a>
          </li>
          <li>
            <Link href="/trust" className="text-accent hover:underline">
              Trust Center
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}

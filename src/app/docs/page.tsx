import Link from "next/link";
import { DOCS } from "@/lib/constants";

const SECTIONS = [
  {
    title: "What is EquiCurve?",
    body: "EquiCurve is a launchpad for tokenized equity / RWA / stock-style pairs on Solana. Issuers configure a Meteora Dynamic Bonding Curve, raise against it, then graduate liquidity into DAMM v2.",
  },
  {
    title: "How DBC → DAMM v2 works",
    body: "1) Create a DBC config + virtual pool. 2) Traders buy/sell on the curve; quote reserves fill. 3) At the migration market-cap threshold, migrateToDammV2 moves liquidity into a DAMM v2 pool with locked LP ≥10%.",
  },
  {
    title: "Curve presets explained",
    body: "Flat = steady discovery. Exponential = steeper early price + higher early fees to deter sniping. Long = longer runway / higher migration target for patient capital. All three call buildCurveWithMarketCap.",
  },
  {
    title: "Issuer guide",
    body: "Use Create → 6-step wizard. Attest disclosures, pick a preset, set fee split (default 70/20/10), lock ≥10%, review, then sign the real DBC create transaction on devnet.",
  },
  {
    title: "Investor risk guide",
    body: "Bonding price is discovery, not NAV. Smart contracts can fail. Offerings may geo-restrict or use transfer hooks. Always read Disclosures and verify program IDs in Trust Center.",
  },
  {
    title: "FAQ",
    body: "Is this a pump.fun clone? No — equity/RWA positioning and trust chrome. Mainnet? Devnet by default for the hackathon demo. KYC? Self-attest + docs for MVP.",
  },
];

export default function DocsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-fg-primary">Docs</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Skeleton docs for Slice A. Full issuer / investor guides continue in
          later slices.
        </p>
      </header>

      {SECTIONS.map((s) => (
        <section key={s.title} className="ec-card space-y-2 p-5">
          <h2 className="font-semibold text-fg-primary">{s.title}</h2>
          <p className="text-sm leading-relaxed text-fg-secondary">{s.body}</p>
        </section>
      ))}

      <section className="space-y-2 text-sm">
        <p className="text-fg-muted">External references</p>
        <ul className="space-y-1">
          <li>
            <a className="text-accent hover:underline" href={DOCS.dbc} target="_blank" rel="noreferrer">
              Meteora DBC developer guide
            </a>
          </li>
          <li>
            <a className="text-accent hover:underline" href={DOCS.migration} target="_blank" rel="noreferrer">
              Migration & liquidity
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

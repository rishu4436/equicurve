import Link from "next/link";
import {
  DAMM_V2_PROGRAM,
  DBC_PROGRAM_ID,
  DOCS,
  explorerAddressUrl,
} from "@/lib/constants";

export default function TrustPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-fg-primary">Trust Center</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Program IDs, lock policy, and risk posture for EquiCurve issuers and
          investors. Always verify on Solana Explorer.
        </p>
      </header>

      <section className="ec-card space-y-4 p-5">
        <h2 className="font-semibold text-fg-primary">Meteora programs</h2>
        <div className="space-y-3 font-mono text-xs">
          <div>
            <p className="text-fg-muted">DBC program</p>
            <a
              className="break-all text-accent hover:underline"
              href={explorerAddressUrl(DBC_PROGRAM_ID.toBase58())}
              target="_blank"
              rel="noreferrer"
            >
              {DBC_PROGRAM_ID.toBase58()}
            </a>
          </div>
          <div>
            <p className="text-fg-muted">DAMM v2 program</p>
            <a
              className="break-all text-accent hover:underline"
              href={explorerAddressUrl(DAMM_V2_PROGRAM.toBase58())}
              target="_blank"
              rel="noreferrer"
            >
              {DAMM_V2_PROGRAM.toBase58()}
            </a>
          </div>
        </div>
        <a
          href={DOCS.dbc}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-accent hover:underline"
        >
          Meteora DBC docs →
        </a>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Default LP lock policy</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>≥10% of migrated liquidity locked (≥1 day vesting)</li>
          <li>Max vesting window 2 years</li>
          <li>Create wizard blocks Continue if lock &lt; 10%</li>
        </ul>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Mint authority policy</h2>
        <p>
          Default: renounce on launch. Retaining mint authority requires an
          explicit disclosure checkbox and a warning badge on the offering.
        </p>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Audits / reviews</h2>
        <p>
          EquiCurve is a hackathon MVP UI over audited Meteora DBC / DAMM v2
          programs. EquiCurve itself has no separate audit yet — treat as
          experimental software.
        </p>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Contact / bug reports</h2>
        <p>
          Open an issue on the GitHub repo or contact the issuer wallet shown on
          each offering&apos;s On-chain tab. Do not send funds to EquiCurve.
        </p>
        <Link href="/docs" className="text-accent hover:underline">
          Risk education in Docs →
        </Link>
      </section>
    </div>
  );
}

import Link from "next/link";
import {
  DAMM_V2_PROGRAM,
  DBC_PROGRAM_ID,
  DOCS,
  explorerAddressUrl,
  getCluster,
} from "@/lib/constants";

const DBC_ID = DBC_PROGRAM_ID.toBase58();
const DAMM_ID = DAMM_V2_PROGRAM.toBase58();

export default function TrustPage() {
  const cluster = getCluster();

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold text-fg-primary">Trust Center</h1>
        <p className="mt-2 text-sm text-fg-secondary">
          Program IDs, LP lock policy, mint authority rules, and risk posture
          for EquiCurve issuers and investors. Always verify addresses on Solana
          Explorer — never trust UI copy alone.
        </p>
        <p className="mt-2 text-xs text-fg-muted">
          Active cluster:{" "}
          <span className="font-mono text-signal-warn">{cluster}</span>
        </p>
      </header>

      <section className="ec-card space-y-4 p-5">
        <h2 className="font-semibold text-fg-primary">Meteora programs</h2>
        <p className="text-sm text-fg-secondary">
          EquiCurve is a UI over audited Meteora on-chain programs. Create,
          trade, and graduate call these program IDs exclusively.
        </p>
        <div className="space-y-4">
          <div className="rounded-input border border-line bg-subtle p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                Dynamic Bonding Curve (DBC)
              </p>
              <a
                href={DOCS.dbc}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                Docs →
              </a>
            </div>
            <a
              className="mt-2 block break-all font-mono text-xs text-accent hover:underline"
              href={explorerAddressUrl(DBC_ID)}
              target="_blank"
              rel="noreferrer"
            >
              {DBC_ID}
            </a>
            <p className="mt-2 text-xs text-fg-muted">
              Config + virtual pool create, curve swaps, graduation threshold.
            </p>
          </div>
          <div className="rounded-input border border-line bg-subtle p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium uppercase tracking-wider text-fg-muted">
                DAMM v2 (post-graduation AMM)
              </p>
              <a
                href={DOCS.migration}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                Migration docs →
              </a>
            </div>
            <a
              className="mt-2 block break-all font-mono text-xs text-accent hover:underline"
              href={explorerAddressUrl(DAMM_ID)}
              target="_blank"
              rel="noreferrer"
            >
              {DAMM_ID}
            </a>
            <p className="mt-2 text-xs text-fg-muted">
              Permanent depth after{" "}
              <code className="text-accent-soft">migrateToDammV2</code>.
            </p>
          </div>
        </div>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">
          Default LP lock policy (≥10%)
        </h2>
        <p>
          When a curve graduates, a minimum share of migrated liquidity is
          locked so early dump of the full AMM inventory is harder. EquiCurve
          defaults enforce protocol minimums in the Create wizard.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-fg-primary">≥10%</strong> of migrated
            liquidity locked (Meteora{" "}
            <code className="text-accent-soft">MIN_LOCKED_LIQUIDITY_BPS</code>)
          </li>
          <li>
            Vesting window <strong className="text-fg-primary">≥1 day</strong>{" "}
            and <strong className="text-fg-primary">≤2 years</strong>
          </li>
          <li>
            Create wizard <strong className="text-fg-primary">blocks Continue</strong>{" "}
            if lock % is below 10%
          </li>
          <li>
            Protocol migration fee ~0.2% — shown on Graduation before you sign
          </li>
        </ul>
        <p className="text-xs text-fg-muted">
          Lock ≠ “safe.” Locks reduce one rug vector; they do not eliminate
          market, smart-contract, or issuer risk.
        </p>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Mint authority policy</h2>
        <p>
          <strong className="text-fg-primary">Default: renounce on launch.</strong>{" "}
          EquiCurve Create defaults to no retained mint authority so issuers
          cannot inflate supply after the offering goes live.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Retaining mint authority requires an explicit disclosure checkbox on
            Fees &amp; locks
          </li>
          <li>
            Offerings that keep mint authority show a warning badge on cards and
            detail
          </li>
          <li>
            Freeze / transfer-hook profiles (if used) must be disclosed in the
            offering Disclosures tab
          </li>
        </ul>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Audits &amp; reviews</h2>
        <p>
          EquiCurve is a hackathon MVP front-end. The on-chain programs it calls
          are Meteora DBC and DAMM v2 — review their published docs and audits
          before mainnet use.
        </p>
        <ul className="space-y-2">
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
              href={DOCS.dbcSdk}
              target="_blank"
              rel="noreferrer"
            >
              TypeScript SDK getting started
            </a>
          </li>
          <li>
            <a
              className="text-accent hover:underline"
              href="https://docs.meteora.ag/"
              target="_blank"
              rel="noreferrer"
            >
              Meteora docs hub (audits / security pages)
            </a>
          </li>
        </ul>
        <p className="rounded-input border border-signal-warn/25 bg-signal-warn/5 px-3 py-2 text-xs text-signal-warn">
          EquiCurve itself has <strong>no separate audit</strong> yet. Treat the
          UI and any helper scripts as experimental software.
        </p>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Risk copy (read before trading)</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-fg-primary">Bonding price ≠ NAV.</strong>{" "}
            Curve price is discovery mechanics, not a mark-to-market of
            underlying equity or RWA.
          </li>
          <li>
            Smart contracts can fail; RPCs can lag; migrations can be delayed on
            congested networks.
          </li>
          <li>
            Eligibility / geo self-attestations are MVP controls — not full KYC.
            Blocked or restricted offerings may refuse your trade.
          </li>
          <li>
            Demo offerings on the Explore board may be illustrative; live pools
            require real wallet signatures and real SOL/USDC.
          </li>
          <li>
            Never send funds to EquiCurve. Interact only via your wallet with
            verified program IDs above.
          </li>
        </ul>
        <Link href="/docs" className="inline-block text-accent hover:underline">
          Full investor risk guide in Docs →
        </Link>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">Contact / bug reports</h2>
        <p>
          Open an issue on{" "}
          <a
            className="text-accent hover:underline"
            href="https://github.com/rishu4436/equicurve"
            target="_blank"
            rel="noreferrer"
          >
            github.com/rishu4436/equicurve
          </a>{" "}
          or contact the issuer wallet shown on each offering&apos;s On-chain
          tab.
        </p>
        <p className="text-xs text-fg-muted">
          Asset recovery / maintenance: EquiCurve does not custody funds. If a
          pool is stuck mid-migration, verify the migrate TX on Explorer and
          retry from the Graduation page with the pool address — never share
          seed phrases.
        </p>
      </section>
    </div>
  );
}

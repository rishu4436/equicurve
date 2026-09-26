import Link from "next/link";
import {
  DAMM_V2_PROGRAM,
  DBC_PROGRAM_ID,
  DOCS,
  explorerAddressUrl,
  getCluster,
} from "@/lib/constants";
import { MIN_LP_LOCK_PCT } from "@/lib/dbc/presets";

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
          What Create actually sets on-chain
        </h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-fg-primary">Quote mint:</strong> SOL (WSOL)
            by default, or USDC when selected on Create (cluster must have a known
            USDC mint).
          </li>
          <li>
            <strong className="text-fg-primary">Creator fee share:</strong>{" "}
            <code className="text-accent-soft">creatorTradingFeePercentage</code>{" "}
            from the Fees step (partner gets the remainder via feeClaimer).
          </li>
          <li>
            <strong className="text-fg-primary">LP lock:</strong>{" "}
            <code className="text-accent-soft">
              partnerPermanentLockedLiquidityPercentage
            </code>{" "}
            from the lock slider, clamped to ≥{MIN_LP_LOCK_PCT}% (
            <code className="text-accent-soft">MIN_LOCKED_LIQUIDITY_BPS</code>).
          </li>
          <li>
            <strong className="text-fg-primary">Mint authority:</strong>{" "}
            Renounce →{" "}
            <code className="text-accent-soft">CreatorUpdateAuthority</code>{" "}
            (no mint). Retain →{" "}
            <code className="text-accent-soft">
              CreatorUpdateAndMintAuthority
            </code>
            .
          </li>
          <li>
            <strong className="text-fg-primary">Seed buy:</strong> optional via{" "}
            <code className="text-accent-soft">
              createConfigAndPoolWithFirstBuy
            </code>{" "}
            when quote amount &gt; 0 (SOL or USDC).
          </li>
          <li>
            <strong className="text-fg-primary">Token type:</strong> Open SPL, Token-2022 (no hook), and Token-2022 transfer-hook when
            <code className="text-accent-soft">NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM</code>{" "}
            is set to an executable hook program. No fake hook IDs.
          </li>
          <li>
            <strong className="text-fg-primary">Docs checklist:</strong> issuer
            attestation stored in browser localStorage — not an upload vault.
          </li>
        </ul>
      </section>

      <section className="ec-card space-y-3 p-5 text-sm text-fg-secondary">
        <h2 className="font-semibold text-fg-primary">
          Default LP lock policy (≥{MIN_LP_LOCK_PCT}%)
        </h2>
        <p>
          When a curve graduates, a minimum share of migrated liquidity is
          permanently locked as partner LP so early dump of the full AMM
          inventory is harder. EquiCurve Create maps the lock slider into the
          config and clamps below {MIN_LP_LOCK_PCT}% at build time.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong className="text-fg-primary">≥{MIN_LP_LOCK_PCT}%</strong> of
            migrated liquidity locked (Meteora{" "}
            <code className="text-accent-soft">MIN_LOCKED_LIQUIDITY_BPS</code>)
          </li>
          <li>
            Create wizard <strong className="text-fg-primary">blocks Continue</strong>{" "}
            if lock % is below {MIN_LP_LOCK_PCT}%
          </li>
          <li>
            Default wizard value is <strong className="text-fg-primary">100%</strong>{" "}
            partner permanent lock (safest demo default)
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
          Maps to{" "}
          <code className="text-accent-soft">
            TokenAuthorityOption.CreatorUpdateAuthority
          </code>{" "}
          — no mint authority after launch.
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Retaining mint authority uses{" "}
            <code className="text-accent-soft">
              CreatorUpdateAndMintAuthority
            </code>{" "}
            and shows a warning badge on the preview
          </li>
          <li>
            Token-2022 without a hook uses the standard create path with{" "}
            <code className="text-accent-soft">TokenType.Token2022</code>. Transfer-hook
            launches use <code className="text-accent-soft">createConfigAndPoolWithTransferHook</code>{" "}
            and require a real executable program via env. Mint+update authority is{" "}
            <strong className="text-fg-primary">only</strong> valid on transfer-hook configs
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
            The self-attestation &amp; risk disclosure is stored only in this
            browser. It is not KYC, does not verify identity or location, and
            does not enforce jurisdictional eligibility.
          </li>
          <li>
            Explore defaults to <strong className="text-fg-primary">your local launches only</strong>.
            “Show examples” reveals illustrative UI cards that are{" "}
            <strong className="text-fg-primary">not live pools</strong>.
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
      </section>
    </div>
  );
}

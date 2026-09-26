import { formatAtoms } from "@/lib/amounts";
import {
  DBC_PROTOCOL_FEE_PCT,
  FEE_BY_PRESET,
  getPreset,
  MIN_LP_LOCK_PCT,
  POOL_CREATION_FEE_SOL,
  presetMarketCaps,
  presetMigrationThresholdAtoms,
  presetPriceMultiple,
  tradingFeeSplit,
  type PresetQuote,
} from "@/lib/dbc/presets";
import type { PresetId } from "@/lib/dbc/types";

const QUOTE_DECIMALS: Record<PresetQuote, number> = { SOL: 9, USDC: 6 };

export function presetThresholdLabel(id: PresetId, quote: PresetQuote, maxFrac = 2): string {
  return `${formatAtoms(presetMigrationThresholdAtoms(id, quote), QUOTE_DECIMALS[quote], maxFrac)} ${quote}`;
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 text-xs">
      <dt className="text-fg-muted">{k}</dt>
      <dd className="text-fg-secondary">{v}</dd>
    </div>
  );
}

/**
 * Issuer-facing facts for one preset, computed from the exact config builder
 * used by Create (thresholds are the real migrationQuoteThreshold).
 */
export function PresetFacts({ id, quote }: { id: PresetId; quote: PresetQuote }) {
  const p = getPreset(id);
  const caps = presetMarketCaps(id, quote);
  const fee = FEE_BY_PRESET[id];
  const split = tradingFeeSplit(fee.creatorTradingFeePercentage);
  return (
    <dl className="space-y-1.5">
      <Fact k="Why for equity-style" v={p.equityFit} />
      <Fact k="Price path" v={p.pricePath} />
      <Fact
        k="Raised before graduation"
        v={
          <>
            <span className="font-mono text-fg-primary">{presetThresholdLabel(id, quote)}</span> of quote must be in the
            curve (migrationQuoteThreshold). Market cap {caps.initial.toLocaleString()} → {caps.migration.toLocaleString()}{" "}
            {quote} (quote units, not USD).
          </>
        }
      />
      <Fact
        k="Early-buyer advantage"
        v={
          <>
            The first buyer pays about <span className="font-mono text-fg-primary">1/{presetPriceMultiple(id, quote)}</span>{" "}
            of the graduation price ({presetPriceMultiple(id, quote)}× price range).
          </>
        }
      />
      <Fact
        k="Fees on curve"
        v={`${p.feeLabel}${fee.dynamicFeeEnabled ? " (+ volatility-based dynamic fee)" : ""}${fee.enableFirstSwapWithMinFee ? " · first swap at min fee" : ""}. Default split: creator ${split.creatorPct}% / partner ${split.partnerPct}% / Meteora ${split.protocolPct}%.`}
      />
      <Fact k="Tradeoffs" v={p.tradeoffs} />
    </dl>
  );
}

/** Honest note on how presets differ (they share one builder / curve shape). */
export function PresetShapeNote() {
  return (
    <p className="text-[11px] text-fg-muted">
      All presets use Meteora&apos;s <code>buildCurveWithMarketCap</code>: a single constant-liquidity segment between the
      start and graduation market caps. They differ in price range (5× / 15× / 100×), raise size and fee schedule —
      &quot;Flat&quot; and &quot;Exponential&quot; have the same 15× price path; Exponential refers to its fee decay.
    </p>
  );
}

export function LpLockAnswer({ lockPct }: { lockPct: number | null }) {
  const pct = lockPct ?? null;
  return (
    <div className="space-y-1 text-xs text-fg-secondary">
      <p className="font-semibold text-fg-primary">What does the LP lock mean?</p>
      <p>
        When the curve graduates, its quote reserve and remaining tokens seed a Meteora DAMM v2 pool. The LP position is
        assigned to the <strong>partner (fee claimer)</strong> wallet set at launch; the creator gets 0% of the LP in
        EquiCurve configs.{" "}
        {pct != null ? (
          <>
            <span className="font-mono text-fg-primary">{pct}%</span> of that LP is <strong>permanently locked</strong>{" "}
            (fees remain claimable; the liquidity can never be withdrawn) and{" "}
            <span className="font-mono text-fg-primary">{100 - pct}%</span> is an unlocked partner position.
          </>
        ) : (
          <>The locked share is chosen at launch and read from the pool config on-chain.</>
        )}{" "}
        Meteora requires at least {MIN_LP_LOCK_PCT}% permanently locked.
      </p>
    </div>
  );
}

export function FeeSplitAnswer({ creatorPct, feeLabel }: { creatorPct: number | null; feeLabel?: string }) {
  const s = creatorPct == null ? null : tradingFeeSplit(creatorPct);
  return (
    <div className="space-y-1 text-xs text-fg-secondary">
      <p className="font-semibold text-fg-primary">Who receives fees?</p>
      <p>
        Every curve trade pays a trading fee{feeLabel ? ` (${feeLabel})` : ""} in the quote token. Meteora keeps{" "}
        {DBC_PROTOCOL_FEE_PCT}% of it as the protocol fee; the rest is split by the config&apos;s creator trading fee
        percentage.{" "}
        {s ? (
          <>
            Here: creator <span className="font-mono text-fg-primary">{s.creatorPct}%</span>, partner / fee claimer{" "}
            <span className="font-mono text-fg-primary">{s.partnerPct}%</span>, Meteora{" "}
            <span className="font-mono text-fg-primary">{s.protocolPct}%</span> of each fee.
          </>
        ) : (
          <>The creator / partner percentage is read from the pool config.</>
        )}{" "}
        Fees accrue in the pool and are claimed by the creator and fee claimer. The {POOL_CREATION_FEE_SOL} SOL pool
        creation fee goes 90% to the partner and 10% to Meteora. After graduation, DAMM v2 LP fees go to the LP position
        holders.
      </p>
    </div>
  );
}

export function AfterGraduationAnswer() {
  return (
    <div className="space-y-1 text-xs text-fg-secondary">
      <p className="font-semibold text-fg-primary">What happens to holders after graduation?</p>
      <p>
        Once the quote reserve reaches the migration threshold, the bonding curve stops trading. Anyone can then run
        migration: the curve closes, its liquidity moves into a Meteora DAMM v2 pool, and the same tokens keep trading
        there (no claim or swap of tokens is needed). Holders keep their tokens in their wallets; prices then come from
        the AMM, not the curve.
      </p>
    </div>
  );
}

export function IssuerFaq({ lockPct, creatorPct, feeLabel }: { lockPct: number | null; creatorPct: number | null; feeLabel?: string }) {
  return (
    <div className="space-y-4">
      <LpLockAnswer lockPct={lockPct} />
      <FeeSplitAnswer creatorPct={creatorPct} feeLabel={feeLabel} />
      <AfterGraduationAnswer />
    </div>
  );
}

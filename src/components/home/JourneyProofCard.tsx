import Link from "next/link";
import { JOURNEY_PROOF, JOURNEY_READBACK } from "@/lib/home/journeyProof";

const LIMITS = [
  ["Whale impact", JOURNEY_PROOF.whaleLimit],
  ["Retail fill", JOURNEY_PROOF.retailMinimum],
  ["Concentration", JOURNEY_PROOF.concentrationLimit],
] as const;

export function JourneyProofCard() {
  return (
    <aside className="ec-card overflow-hidden shadow-glow" data-testid="journey-proof">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">
          Public devnet · Journey
        </p>
        <p className="font-mono text-xs text-accent">{JOURNEY_PROOF.policyId}</p>
      </div>

      <div className="grid sm:grid-cols-2">
        <div className="space-y-4 border-b border-line p-5 sm:border-b-0 sm:border-r">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">Market design</p>
            <dl className="mt-3 space-y-2 font-mono text-sm text-fg-primary">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-fg-muted">Raise</dt>
                <dd>{JOURNEY_PROOF.raise}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-fg-muted">Typical trade</dt>
                <dd>{JOURNEY_PROOF.typical}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-fg-muted">Participants</dt>
                <dd>{JOURNEY_PROOF.participants}</dd>
              </div>
            </dl>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">Constraints</p>
            <ul className="mt-3 space-y-2 font-mono text-xs text-fg-secondary">
              {LIMITS.map(([label, value]) => (
                <li key={label} className="flex items-baseline justify-between gap-3">
                  <span>{label}</span>
                  <span className="shrink-0 whitespace-nowrap text-fg-primary">{value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-3 p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">Search</p>
          <p className="font-mono text-3xl text-fg-primary">{JOURNEY_PROOF.evaluated}</p>
          <p className="text-xs text-fg-muted">configurations evaluated</p>
          <p className="text-sm text-fg-secondary">
            <span className="font-mono text-signal-warn">{JOURNEY_PROOF.feasible}</span> met every constraint
          </p>
          <p className="pt-1 font-semibold text-fg-primary">{JOURNEY_PROOF.profile}</p>
          <p className="text-xs leading-relaxed text-fg-secondary">
            Selected for comparison. Retail fill {JOURNEY_PROOF.retailFill} against a 25% minimum. Opening{" "}
            {JOURNEY_PROOF.openingBps} and the whale sample {JOURNEY_PROOF.whaleSampleBps} stayed inside their caps.
          </p>
        </div>
      </div>

      <div className="space-y-3 border-t border-line px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-fg-muted">Fingerprint</p>
          <p className="mt-1 font-mono text-sm text-accent">{JOURNEY_PROOF.fingerprint}</p>
        </div>
        <ul className="grid grid-cols-2 gap-y-1 text-xs text-fg-secondary">
          {JOURNEY_READBACK.map((item) => (
            <li key={item}>✓ {item}</li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-signal-warn">
          Constraints not met. The four checks are the on-chain match. The limit editor rounds {JOURNEY_PROOF.retailFill}{" "}
          to {JOURNEY_PROOF.retailEditor}.
        </p>
        <div className="flex flex-wrap gap-3 pt-1">
          <Link href={`/o/${JOURNEY_PROOF.pool}`} className="text-xs text-accent hover:underline">
            Open the verified deployment
          </Link>
          <a
            href="https://github.com/rishu4436/equicurve/blob/main/docs/canonical-evidence.md"
            className="text-xs text-fg-muted hover:text-fg-secondary hover:underline"
          >
            Canonical evidence
          </a>
        </div>
      </div>
    </aside>
  );
}

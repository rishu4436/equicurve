import Link from "next/link";
import { GraduatePanel } from "@/components/GraduatePanel";
import { getOffering } from "@/lib/demo/offerings";

export default async function GraduatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const offering = getOffering(id);
  const isPool = id.length >= 32;

  return (
    <div className="space-y-6">
      <p className="text-xs text-fg-muted">
        <Link href={`/o/${id}`} className="hover:text-accent">
          Offering
        </Link>
        {" / Graduation"}
      </p>
      {isPool ? (
        <GraduatePanel poolAddress={id} />
      ) : (
        <div className="ec-card mx-auto max-w-xl space-y-6 p-8 text-center">
          <p className="text-xs uppercase tracking-wider text-accent">
            Graduation ceremony
          </p>
          <h1 className="text-2xl font-semibold text-fg-primary">
            Curve complete → DAMM v2
          </h1>
          <div className="flex items-center justify-center gap-8 py-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-accent/40 text-xs text-accent">
              Curve
            </div>
            <span className="text-2xl text-signal-grad">→</span>
            <div className="flex h-16 w-16 items-center justify-center rounded-card border-2 border-signal-grad/50 bg-signal-grad/10 text-xs text-signal-grad">
              DAMM
            </div>
          </div>
          <p className="text-sm text-fg-secondary">
            {offering
              ? `${offering.name} is an illustrative example (not a live pool). Open a live pool address to run migrateToDammV2 (real SDK tx). LP lock ≥${offering.lockPct}%.`
              : "Pass a DBC pool address to run the real migrator."}
          </p>
          <div className="rounded-input border border-line bg-subtle px-3 py-2 text-xs text-fg-muted">
            No separate migration fee (EquiCurve configs) · ≥10% of LP permanently locked · Position NFTs
            minted on migrate
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/graduate" className="ec-btn-primary">
              Open migrator
            </Link>
            <Link href={`/o/${id}`} className="ec-btn-secondary">
              Back to offering
            </Link>
            <Link href="/issuer" className="ec-btn-secondary">
              Issuer claims
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

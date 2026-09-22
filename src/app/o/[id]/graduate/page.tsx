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
  const isPool = id.length >= 32 && !offering;

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
        <div className="ec-card mx-auto max-w-xl space-y-4 p-8 text-center">
          <h1 className="text-2xl font-semibold text-fg-primary">
            Curve complete → DAMM v2
          </h1>
          <p className="text-sm text-fg-secondary">
            {offering
              ? `${offering.name} is marked graduated in the demo board. Wire a live pool address to run migrateToDammV2 on devnet.`
              : "Pass a DBC pool address to run the real migrator."}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href="/graduate" className="ec-btn-primary">
              Open migrator
            </Link>
            <Link href={`/o/${id}`} className="ec-btn-secondary">
              Back to offering
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

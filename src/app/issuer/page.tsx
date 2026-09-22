import Link from "next/link";

export default function IssuerPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-fg-primary">Issuer dashboard</h1>
      <p className="text-sm text-fg-secondary">
        Fee claims, lock schedules, and IR notes — Slice C. Deployer wallet =
        fee claimer.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["Fees accrued", "Claimable", "Locked LP", "Holders"].map((k) => (
          <div key={k} className="ec-card p-4">
            <p className="text-xs text-fg-muted">{k}</p>
            <p className="mt-1 font-mono text-lg text-fg-primary">—</p>
          </div>
        ))}
      </div>
      <Link href="/create" className="ec-btn-primary inline-flex">
        Create offering
      </Link>
    </div>
  );
}

import Link from "next/link";

export default function PortfolioPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold text-fg-primary">Portfolio</h1>
      <p className="text-sm text-fg-secondary">
        Positions, history, and disclosures vault — Slice B. Connect a wallet
        and trade a live curve to populate holdings.
      </p>
      <div className="ec-card flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-fg-secondary">No positions yet.</p>
        <Link href="/explore?tab=raising" className="ec-btn-primary">
          Explore raising offerings
        </Link>
      </div>
    </div>
  );
}

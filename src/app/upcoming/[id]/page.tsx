import { Suspense } from "react";
import { UpcomingDetailClient } from "@/components/upcoming/UpcomingDetailClient";

export default async function UpcomingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="text-sm text-fg-muted">Loading upcoming launch…</div>}>
      <UpcomingDetailClient id={id} />
    </Suspense>
  );
}

import { OfferingDetailClient } from "@/components/offering/OfferingDetailClient";
import { getOffering } from "@/lib/demo/offerings";

export default async function OfferingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const demo = getOffering(id);
  // Live pool addresses (from Create) and demo ids both render; client merges localStorage.
  return <OfferingDetailClient id={id} demo={demo} />;
}

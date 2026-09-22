import { TradePanel } from "@/components/TradePanel";

export default async function TradePoolPage({
  params,
}: {
  params: Promise<{ pool: string }>;
}) {
  const { pool } = await params;
  return <TradePanel poolAddress={pool} />;
}

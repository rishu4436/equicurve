import { GraduatePanel } from "@/components/GraduatePanel";

export default async function GraduatePoolPage({
  params,
}: {
  params: Promise<{ pool: string }>;
}) {
  const { pool } = await params;
  return <GraduatePanel poolAddress={pool} />;
}

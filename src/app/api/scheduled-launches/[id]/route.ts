import { NextResponse } from "next/server";
import { getScheduledLaunchStore, ScheduleStorageConfigError } from "@/lib/schedule/store";
import { toPublicScheduledLaunch } from "@/lib/schedule/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err(404, "Scheduled launch not found", "schedule_not_found");
  try {
    const schedule = await getScheduledLaunchStore().get(id);
    if (!schedule) return err(404, "Scheduled launch not found", "schedule_not_found");
    return NextResponse.json({ ok: true, schedule: toPublicScheduledLaunch(schedule) });
  } catch (error) {
    if (error instanceof ScheduleStorageConfigError) return err(503, error.message, "storage_unconfigured");
    return err(503, "Scheduled launch storage is unavailable.", "storage_unavailable");
  }
}

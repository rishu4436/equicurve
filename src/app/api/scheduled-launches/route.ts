import { NextResponse } from "next/server";
import { authorizeScheduleAction } from "@/lib/schedule/authorize";
import { MAX_SIGNED_SCHEDULE_BODY_BYTES } from "@/lib/auth/scheduleAuth";
import { getCluster } from "@/lib/constants";
import { getScheduledLaunchStore, ScheduleStorageConfigError } from "@/lib/schedule/store";
import { ScheduleConflictError } from "@/lib/schedule/upstashStore";
import { toPublicScheduledLaunch } from "@/lib/schedule/types";
import { clientKey, readJsonBody } from "@/lib/server/http";
import { limitRequest } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function err(status: number, error: string, code?: string) {
  return NextResponse.json({ ok: false, error, code }, { status });
}

export async function GET() {
  try {
    const schedules = await getScheduledLaunchStore().list();
    const active = schedules
      .filter((schedule) => schedule.status !== "cancelled" && schedule.status !== "launched" && schedule.status !== "invalidated")
      .map((schedule) => toPublicScheduledLaunch(schedule));
    return NextResponse.json({ ok: true, schedules: active, count: active.length });
  } catch (error) {
    if (error instanceof ScheduleStorageConfigError) return err(503, error.message, "storage_unconfigured");
    if (error instanceof ScheduleConflictError) return err(409, error.message, "schedule_conflict");
    return err(503, "Scheduled launch storage is unavailable.", "storage_unavailable");
  }
}

export async function POST(req: Request) {
  const rl = await limitRequest(clientKey(req, "scheduled-launches:write"), 20, 10 * 60 * 1000);
  if (!rl.ok) return err(429, "Too many schedule changes — slow down.", "rate_limited");
  const body = await readJsonBody(req, MAX_SIGNED_SCHEDULE_BODY_BYTES);
  if (!body.ok) return err(body.status, body.error, "invalid_body");
  try {
    const store = getScheduledLaunchStore();
    const result = await authorizeScheduleAction({
      body: body.value,
      serverCluster: getCluster(),
      nowMs: Date.now(),
      getExisting: (id) => store.get(id),
      list: () => store.list(),
    });
    if (!result.ok) {
      if (result.entry) await store.put(result.entry);
      return err(result.status, result.error, result.code);
    }
    await store.put(result.entry);
    return NextResponse.json({ ok: true, action: result.action, schedule: toPublicScheduledLaunch(result.entry) });
  } catch (error) {
    if (error instanceof ScheduleStorageConfigError) return err(503, error.message, "storage_unconfigured");
    return err(503, "Scheduled launch storage is unavailable.", "storage_unavailable");
  }
}

import type { SignedScheduleBody } from "@/lib/auth/scheduleAuth";
import type { PublicScheduledLaunch } from "./types";

export type ScheduleClientResult =
  | { ok: true; action: string; schedule: PublicScheduledLaunch }
  | { ok: false; error: string; code?: string };

export async function createScheduledLaunch(body: SignedScheduleBody): Promise<ScheduleClientResult> {
  return writeSchedule(body);
}

export async function updateScheduledLaunch(body: SignedScheduleBody): Promise<ScheduleClientResult> {
  return writeSchedule(body);
}

export async function validateScheduledLaunch(body: SignedScheduleBody): Promise<ScheduleClientResult> {
  return writeSchedule(body);
}

async function writeSchedule(body: SignedScheduleBody): Promise<ScheduleClientResult> {
  try {
    const response = await fetch("/api/scheduled-launches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Partial<ScheduleClientResult> & { error?: string; code?: string };
    if (!response.ok || json.ok !== true) return { ok: false, error: json.error ?? `HTTP ${response.status}`, code: json.code };
    return json as ScheduleClientResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "network error" };
  }
}

export async function getScheduledLaunch(id: string): Promise<{ ok: true; schedule: PublicScheduledLaunch } | { ok: false; error: string }> {
  try {
    const response = await fetch(`/api/scheduled-launches/${encodeURIComponent(id)}`, { cache: "no-store" });
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; schedule?: PublicScheduledLaunch; error?: string };
    if (!response.ok || !json.ok || !json.schedule) return { ok: false, error: json.error ?? `HTTP ${response.status}` };
    return { ok: true, schedule: json.schedule };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "network error" };
  }
}

export async function listScheduledLaunches(): Promise<{ ok: true; schedules: PublicScheduledLaunch[] } | { ok: false; error: string }> {
  try {
    const response = await fetch("/api/scheduled-launches", { cache: "no-store" });
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; schedules?: PublicScheduledLaunch[]; error?: string };
    if (!response.ok || !json.ok) return { ok: false, error: json.error ?? `HTTP ${response.status}` };
    return { ok: true, schedules: json.schedules ?? [] };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "network error" };
  }
}

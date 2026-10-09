import { randomUUID } from "node:crypto";
import { firstIssue } from "@/lib/validation";
import { verifyScheduleAuth, signedScheduleBodySchema, type SignedScheduleBody } from "@/lib/auth/scheduleAuth";
import {
  effectiveScheduleStatus,
  normalizeScheduledForUtc,
  normalizeScheduledLaunchDraft,
  scheduleCriticalFields,
  scheduleTimeError,
  scheduledLaunchDraftSchema,
  type ScheduledLaunch,
} from "./types";

export type ScheduleWriteResult =
  | { ok: true; action: "created" | "updated" | "cancelled" | "validated" | "launched"; entry: ScheduledLaunch }
  | { ok: false; status: number; code: string; error: string; entry?: ScheduledLaunch };

function fail(status: number, code: string, error: string, entry?: ScheduledLaunch): ScheduleWriteResult {
  return { ok: false, status, code, error, ...(entry ? { entry } : {}) };
}

function withAuth(entry: ScheduledLaunch, body: SignedScheduleBody): ScheduledLaunch {
  return {
    ...entry,
    revision: (entry.revision ?? 0) + 1,
    authIssuedAt: body.auth.issuedAt,
    authSignature: body.auth.signature,
    updatedAt: new Date().toISOString(),
  };
}

export async function authorizeScheduleAction(args: {
  body: unknown;
  serverCluster: string;
  nowMs: number;
  getExisting: (id: string) => Promise<ScheduledLaunch | null>;
  list: () => Promise<ScheduledLaunch[]>;
}): Promise<ScheduleWriteResult> {
  const parsed = signedScheduleBodySchema.safeParse(args.body);
  if (!parsed.success) return fail(400, "invalid_body", firstIssue(parsed.error));
  const body = parsed.data;
  if (body.payload.cluster !== args.serverCluster) return fail(400, "cluster_mismatch", `This server indexes ${args.serverCluster}, not ${body.payload.cluster}`);
  const verified = verifyScheduleAuth(body, args.nowMs);
  if (!verified.ok) return fail(verified.status, verified.code, verified.error);

  if (body.payload.action === "schedule_create") {
    if (body.payload.scheduleId || !body.payload.schedule) return fail(400, "invalid_create", "A new schedule requires schedule details and no scheduleId");
    const draft = scheduledLaunchDraftSchema.safeParse(body.payload.schedule);
    if (!draft.success) return fail(400, "invalid_schedule", firstIssue(draft.error));
    const canonicalDraft = normalizeScheduledLaunchDraft(draft.data);
    const normalizedTime = normalizeScheduledForUtc(canonicalDraft.scheduledForUtc);
    if (!normalizedTime) return fail(400, "invalid_time", "Choose a valid UTC launch time.");
    const timeError = scheduleTimeError(normalizedTime, args.nowMs);
    if (timeError) return fail(400, "invalid_time", timeError);
    const duplicate = (await args.list()).some((schedule) => schedule.authSignature === body.auth.signature);
    if (duplicate) return fail(409, "replayed_authorization", "This schedule authorization has already been used.");
    const now = new Date(args.nowMs).toISOString();
    const entry: ScheduledLaunch = {
      ...canonicalDraft,
      scheduledForUtc: normalizedTime,
      id: randomUUID(),
      creatorWallet: verified.signer,
      cluster: args.serverCluster,
      status: "scheduled",
      createdAt: now,
      updatedAt: now,
      authIssuedAt: body.auth.issuedAt,
      authSignature: body.auth.signature,
      revision: 1,
    };
    return { ok: true, action: "created", entry };
  }

  if (!body.payload.scheduleId) return fail(400, "missing_schedule_id", "This scheduled launch action requires scheduleId");
  const existing = await args.getExisting(body.payload.scheduleId);
  if (!existing) return fail(404, "schedule_not_found", "Scheduled launch not found");
  if (existing.cluster !== args.serverCluster) return fail(400, "cluster_mismatch", "Scheduled launch belongs to another cluster");
  if (existing.creatorWallet !== verified.signer) return fail(403, "not_creator", "Only the wallet that created this schedule may change it");
  if (Date.parse(existing.authIssuedAt) >= verified.issuedAtMs) return fail(409, "replayed_authorization", "A newer authorization for this schedule is already stored");

  const currentStatus = effectiveScheduleStatus(existing, args.nowMs);
  if (body.payload.action === "schedule_validate") {
    if (currentStatus === "cancelled" || currentStatus === "launched" || currentStatus === "invalidated") return fail(409, "terminal_schedule", `Schedule is already ${currentStatus}`);
    if (currentStatus !== "ready") return fail(409, "not_ready", "Launch time has not arrived yet.");
    if (!body.payload.designFingerprint || body.payload.designFingerprint !== existing.designFingerprint) {
      const invalidated = withAuth({ ...existing, status: "invalidated", invalidatedReason: "Market design changed after scheduling. Review and schedule again." }, body);
      return fail(409, "schedule_invalidated", invalidated.invalidatedReason!, invalidated);
    }
    return { ok: true, action: "validated", entry: withAuth(existing, body) };
  }
  if (body.payload.action === "schedule_cancel") {
    if (currentStatus === "cancelled" || currentStatus === "launched" || currentStatus === "invalidated") return fail(409, "terminal_schedule", `Schedule is already ${currentStatus}`);
    return { ok: true, action: "cancelled", entry: withAuth({ ...existing, status: "cancelled" }, body) };
  }

  if (body.payload.action === "schedule_update") {
    if (currentStatus !== "scheduled" && currentStatus !== "ready") return fail(409, "terminal_schedule", `Schedule is already ${currentStatus}`);
    if (!body.payload.schedule) return fail(400, "invalid_update", "Schedule details are required for an update");
    const draft = scheduledLaunchDraftSchema.safeParse(body.payload.schedule);
    if (!draft.success) return fail(400, "invalid_schedule", firstIssue(draft.error));
    const canonicalDraft = normalizeScheduledLaunchDraft(draft.data);
    const normalizedTime = normalizeScheduledForUtc(canonicalDraft.scheduledForUtc);
    if (!normalizedTime) return fail(400, "invalid_time", "Choose a valid UTC launch time.");
    const timeError = scheduleTimeError(normalizedTime, args.nowMs);
    if (timeError) return fail(400, "invalid_time", timeError);
    if (scheduleCriticalFields(existing) !== scheduleCriticalFields(canonicalDraft)) {
      const invalidated = withAuth({ ...existing, status: "invalidated", invalidatedReason: "Market design changed after scheduling. Review and schedule again." }, body);
      return fail(409, "schedule_invalidated", invalidated.invalidatedReason!, invalidated);
    }
    return { ok: true, action: "updated", entry: withAuth({ ...existing, ...canonicalDraft, scheduledForUtc: normalizedTime }, body) };
  }

  if (body.payload.action === "schedule_launch") {
    if (currentStatus === "cancelled" || currentStatus === "launched" || currentStatus === "invalidated") return fail(409, "terminal_schedule", `Schedule is already ${currentStatus}`);
    if (currentStatus !== "ready") return fail(409, "not_ready", "Launch time has not arrived yet.");
    if (!body.payload.designFingerprint || body.payload.designFingerprint !== existing.designFingerprint) {
      const invalidated = withAuth({ ...existing, status: "invalidated", invalidatedReason: "Market design changed after scheduling. Review and schedule again." }, body);
      return fail(409, "schedule_invalidated", invalidated.invalidatedReason!, invalidated);
    }
    if (!body.payload.launchedPool || !body.payload.launchSignature) return fail(400, "missing_launch_receipt", "A confirmed launch pool and signature are required to close this schedule");
    return {
      ok: true,
      action: "launched",
      entry: withAuth({ ...existing, status: "launched", launchedPool: body.payload.launchedPool, launchSignature: body.payload.launchSignature }, body),
    };
  }

  return fail(400, "unsupported_action", "Unsupported scheduled launch action");
}

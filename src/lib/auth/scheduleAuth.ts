/** Domain-separated wallet authorization for scheduled launch intents. */
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";
import { canonicalJson } from "./launchAuth";
import { addressSchema, clusterSchema, walletSchema } from "@/lib/validation";
import { scheduledLaunchDraftSchema } from "@/lib/schedule/types";

export const SCHEDULE_AUTH_MAX_AGE_MS = 20 * 60 * 1000;
export const SCHEDULE_AUTH_MAX_FUTURE_MS = 2 * 60 * 1000;
export const MAX_SIGNED_SCHEDULE_BODY_BYTES = 16 * 1024;

export const scheduleAuthPayloadSchema = z
  .object({
    v: z.literal(1),
    action: z.enum(["schedule_create", "schedule_update", "schedule_cancel", "schedule_validate", "schedule_launch"]),
    cluster: clusterSchema,
    scheduleId: z.string().uuid().optional(),
    schedule: scheduledLaunchDraftSchema.optional(),
    designFingerprint: z.string().regex(/^[0-9a-f]{32}$/).optional(),
    launchedPool: addressSchema.optional(),
    launchSignature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/).optional(),
  })
  .strict();

export type ScheduleAuthPayload = z.infer<typeof scheduleAuthPayloadSchema>;

export const scheduleAuthSchema = z
  .object({
    signer: walletSchema,
    signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,100}$/),
    issuedAt: z.string().datetime({ message: "issuedAt must be an ISO timestamp" }),
  })
  .strict();

export type ScheduleAuth = z.infer<typeof scheduleAuthSchema>;

export const signedScheduleBodySchema = z
  .object({ payload: scheduleAuthPayloadSchema, auth: scheduleAuthSchema })
  .strict();

export type SignedScheduleBody = z.infer<typeof signedScheduleBodySchema>;

export function buildScheduleAuthMessage(payload: ScheduleAuthPayload, signer: string, issuedAt: string): string {
  return [
    "EquiCurve scheduled launch authorization",
    "Signing reserves a launch intent only. It is not a transaction and costs nothing.",
    "",
    `action: ${payload.action}`,
    `cluster: ${payload.cluster}`,
    `wallet: ${signer}`,
    `schedule: ${payload.scheduleId ?? "new"}`,
    `payload-sha512: ${payloadDigest(payload)}`,
    `issued-at: ${issuedAt}`,
  ].join("\n");
}

function payloadDigest(payload: ScheduleAuthPayload): string {
  const hash = nacl.hash(new TextEncoder().encode(canonicalJson(payload)));
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type ScheduleVerifyResult =
  | { ok: true; signer: string; issuedAtMs: number }
  | { ok: false; status: 400 | 401; code: string; error: string };

export function verifyScheduleAuth(body: SignedScheduleBody, nowMs: number): ScheduleVerifyResult {
  const issuedAtMs = Date.parse(body.auth.issuedAt);
  if (!Number.isFinite(issuedAtMs)) return { ok: false, status: 400, code: "bad_issued_at", error: "Authorization issuedAt is not a valid time" };
  if (issuedAtMs > nowMs + SCHEDULE_AUTH_MAX_FUTURE_MS) return { ok: false, status: 401, code: "issued_in_future", error: "Authorization issuedAt is in the future" };
  if (nowMs - issuedAtMs > SCHEDULE_AUTH_MAX_AGE_MS) return { ok: false, status: 401, code: "expired", error: "Authorization expired — sign again" };
  try {
    const signature = bs58.decode(body.auth.signature);
    const signer = bs58.decode(body.auth.signer);
    const message = new TextEncoder().encode(buildScheduleAuthMessage(body.payload, body.auth.signer, body.auth.issuedAt));
    if (signature.length !== 64 || signer.length !== 32 || !nacl.sign.detached.verify(message, signature, signer)) {
      return { ok: false, status: 401, code: "bad_signature", error: "Signature does not match this scheduled launch action" };
    }
  } catch {
    return { ok: false, status: 400, code: "bad_encoding", error: "Signature or signer is not base58" };
  }
  return { ok: true, signer: body.auth.signer, issuedAtMs };
}

export async function signSchedulePayload(args: {
  payload: ScheduleAuthPayload;
  signer: string;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
  now?: Date;
}): Promise<SignedScheduleBody> {
  const issuedAt = (args.now ?? new Date()).toISOString();
  const signature = await args.signMessage(new TextEncoder().encode(buildScheduleAuthMessage(args.payload, args.signer, issuedAt)));
  return { payload: args.payload, auth: { signer: args.signer, signature: bs58.encode(signature), issuedAt } };
}

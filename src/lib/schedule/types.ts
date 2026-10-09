import { z } from "zod";
import type { DesignedMarket } from "@/lib/market/types";
import {
  addressSchema,
  isLocalTokenImageUrl,
  launchProfileSchema,
  nameSchema,
  normalizeHttpsUrl,
  normalizeXProfile,
  optionalImageUrlSchema,
  optionalXProfileSchema,
  QUOTES,
  raiseTargetSchema,
  sectorSchema,
  symbolSchema,
  thesisSchema,
  type LaunchProfile,
} from "@/lib/validation";
import { registryDesignSchema } from "@/lib/registry/design";

export const SCHEDULE_MIN_LEAD_MS = 5 * 60 * 1000;
export const SCHEDULE_MAX_HORIZON_MS = 90 * 24 * 60 * 60 * 1000;

export const SCHEDULE_STATUSES = [
  "scheduled",
  "ready",
  "cancelled",
  "launched",
  "invalidated",
] as const;

export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

const utcDateSchema = z.string().datetime({ offset: true });
const PRESETS = ["flat", "exponential", "long", "equity", "short"] as const;
const optionalFeeClaimerSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || addressSchema.safeParse(value).success, "Fee claimer must be a Solana address");

/** The signed, launch-ready intent. No private material or transaction bytes. */
export const scheduledLaunchDraftSchema = z
  .object({
    name: nameSchema,
    ticker: symbolSchema,
    thesis: thesisSchema,
    sector: sectorSchema,
    website: z.string().trim().max(200).refine((value) => value === "" || normalizeHttpsUrl(value) !== null, "Website must be an HTTPS URL"),
    xProfile: optionalXProfileSchema,
    image: optionalImageUrlSchema,
    presetId: z.enum(PRESETS),
    raiseTarget: raiseTargetSchema,
    quote: z.enum(QUOTES),
    totalSupply: z.number().int().min(1).max(10_000_000_000),
    seedBuy: z.string().trim().max(80),
    feeIssuerPct: z.number().int().min(0).max(100),
    lpLockPct: z.number().int().min(10).max(100),
    antiSniper: z.boolean(),
    mintRenounce: z.boolean(),
    feeClaimer: optionalFeeClaimerSchema,
    transferProfile: z.enum(["open-spl", "token-2022", "transfer-hook"]),
    designFingerprint: z.string().regex(/^[0-9a-f]{32}$/),
    design: registryDesignSchema,
    scheduledForUtc: utcDateSchema,
    /** Used only to restore the selected UI design; launch revalidates the fingerprint. */
    marketCaps: z.object({ initial: z.number().finite(), migration: z.number().finite() }).strict(),
    designed: z.custom<DesignedMarket>((value) => !!value && typeof value === "object"),
  })
  .strict()
  .superRefine((draft, ctx) => {
    if (draft.design.fingerprint !== draft.designFingerprint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designFingerprint"], message: "designFingerprint must match the signed design" });
    }
    if (draft.designed.configFingerprint !== draft.designFingerprint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["designed", "configFingerprint"], message: "selected design must match the signed fingerprint" });
    }
    if (draft.marketCaps.migration <= draft.marketCaps.initial) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["marketCaps"], message: "migration market cap must exceed initial market cap" });
    }
  });

export type ScheduledLaunchDraft = z.infer<typeof scheduledLaunchDraftSchema>;

export type ScheduledLaunch = ScheduledLaunchDraft & {
  id: string;
  creatorWallet: string;
  cluster: string;
  status: ScheduleStatus;
  createdAt: string;
  updatedAt: string;
  authIssuedAt: string;
  authSignature: string;
  launchedPool?: string;
  launchSignature?: string;
  invalidatedReason?: string;
};

export type PublicScheduledLaunch = Omit<ScheduledLaunch, "authSignature"> & {
  effectiveStatus: ScheduleStatus;
};

export function normalizeScheduledForUtc(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function normalizeScheduledLaunchDraft(draft: ScheduledLaunchDraft): ScheduledLaunchDraft {
  return {
    ...draft,
    website: draft.website ? normalizeHttpsUrl(draft.website) ?? "" : "",
    xProfile: draft.xProfile ? normalizeXProfile(draft.xProfile) ?? "" : "",
    scheduledForUtc: normalizeScheduledForUtc(draft.scheduledForUtc) ?? draft.scheduledForUtc,
  };
}

export function scheduleTimeError(value: string, nowMs = Date.now()): string | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "Choose a valid launch date and time.";
  if (ms < nowMs + SCHEDULE_MIN_LEAD_MS) return "Launch must be scheduled at least 5 minutes in the future.";
  if (ms > nowMs + SCHEDULE_MAX_HORIZON_MS) return "Launch can be scheduled at most 90 days ahead.";
  return null;
}

export function effectiveScheduleStatus(schedule: Pick<ScheduledLaunch, "status" | "scheduledForUtc">, nowMs = Date.now()): ScheduleStatus {
  if (schedule.status === "cancelled" || schedule.status === "launched" || schedule.status === "invalidated") return schedule.status;
  return Date.parse(schedule.scheduledForUtc) <= nowMs ? "ready" : "scheduled";
}

export function toPublicScheduledLaunch(schedule: ScheduledLaunch, nowMs = Date.now()): PublicScheduledLaunch {
  const { authSignature: _authSignature, ...publicSchedule } = schedule;
  return { ...publicSchedule, effectiveStatus: effectiveScheduleStatus(schedule, nowMs) };
}

export function scheduleCriticalFields(schedule: Pick<ScheduledLaunchDraft, "name" | "ticker" | "presetId" | "raiseTarget" | "quote" | "totalSupply" | "seedBuy" | "feeIssuerPct" | "lpLockPct" | "antiSniper" | "mintRenounce" | "feeClaimer" | "transferProfile" | "designFingerprint">): string {
  return JSON.stringify({
    name: schedule.name,
    ticker: schedule.ticker,
    presetId: schedule.presetId,
    raiseTarget: schedule.raiseTarget,
    quote: schedule.quote,
    totalSupply: schedule.totalSupply,
    seedBuy: schedule.seedBuy,
    feeIssuerPct: schedule.feeIssuerPct,
    lpLockPct: schedule.lpLockPct,
    antiSniper: schedule.antiSniper,
    mintRenounce: schedule.mintRenounce,
    feeClaimer: schedule.feeClaimer,
    transferProfile: schedule.transferProfile,
    designFingerprint: schedule.designFingerprint,
  });
}

export function isSafeScheduleImage(value: string): boolean {
  return value === "" || isLocalTokenImageUrl(value) || normalizeHttpsUrl(value) !== null;
}

/** Preserve the launch profile shape for future Phase 3 update/news work. */
export function scheduleProfile(schedule: Pick<ScheduledLaunchDraft, "name" | "ticker" | "thesis" | "sector" | "presetId" | "raiseTarget" | "website" | "xProfile">): LaunchProfile {
  return launchProfileSchema.parse({
    name: schedule.name,
    ticker: schedule.ticker,
    thesis: schedule.thesis,
    sector: schedule.sector,
    presetId: schedule.presetId,
    raiseTarget: schedule.raiseTarget,
    ...(schedule.website ? { website: schedule.website } : {}),
    ...(schedule.xProfile ? { xProfile: schedule.xProfile } : {}),
  });
}

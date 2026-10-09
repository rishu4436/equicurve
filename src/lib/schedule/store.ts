import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { scheduledLaunchDraftSchema, type ScheduledLaunch, type ScheduleStatus } from "./types";
import { walletSchema } from "@/lib/validation";
import { createUpstashClient, isUpstashConfigured } from "@/lib/registry/upstashStore";
import { createUpstashScheduledLaunchStore } from "./upstashStore";

export const SCHEDULE_DIR = path.join(process.cwd(), "data", "scheduled-launches");
export const SCHEDULE_FILE = path.join(SCHEDULE_DIR, "registry.json");

export class ScheduleStorageConfigError extends Error {
  constructor() {
    super("Scheduled launches are not configured for this production environment.");
    this.name = "ScheduleStorageConfigError";
  }
}

export interface ScheduledLaunchStore {
  list(): Promise<ScheduledLaunch[]>;
  get(id: string): Promise<ScheduledLaunch | null>;
  put(entry: ScheduledLaunch): Promise<ScheduledLaunch>;
}

type FilePayload = { version: 1; updatedAt: string; schedules: ScheduledLaunch[] };

function emptyPayload(): FilePayload {
  return { version: 1, updatedAt: new Date().toISOString(), schedules: [] };
}

function parseStored(raw: unknown): ScheduledLaunch | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^[0-9a-f-]{36}$/i.test(r.id)) return null;
  if (typeof r.creatorWallet !== "string" || !walletSchema.safeParse(r.creatorWallet).success) return null;
  if (typeof r.cluster !== "string" || typeof r.status !== "string") return null;
  const draft = scheduledLaunchDraftSchema.safeParse({
    name: r.name,
    ticker: r.ticker,
    thesis: r.thesis,
    sector: r.sector,
    website: r.website ?? "",
    xProfile: r.xProfile ?? "",
    image: r.image ?? "",
    presetId: r.presetId,
    raiseTarget: r.raiseTarget,
    quote: r.quote,
    totalSupply: r.totalSupply,
    seedBuy: r.seedBuy,
    feeIssuerPct: r.feeIssuerPct,
    lpLockPct: r.lpLockPct,
    antiSniper: r.antiSniper,
    mintRenounce: r.mintRenounce,
    feeClaimer: r.feeClaimer ?? "",
    transferProfile: r.transferProfile,
    designFingerprint: r.designFingerprint,
    design: r.design,
    scheduledForUtc: r.scheduledForUtc,
    marketCaps: r.marketCaps,
    designed: r.designed,
  });
  if (!draft.success || !["scheduled", "ready", "cancelled", "launched", "invalidated"].includes(r.status as string)) return null;
  if (typeof r.createdAt !== "string" || typeof r.updatedAt !== "string" || typeof r.authIssuedAt !== "string" || typeof r.authSignature !== "string") return null;
  return {
    id: r.id,
    creatorWallet: r.creatorWallet,
    cluster: r.cluster,
    status: r.status as ScheduleStatus,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    authIssuedAt: r.authIssuedAt,
    authSignature: r.authSignature,
    ...(typeof r.revision === "number" ? { revision: r.revision } : {}),
    ...(typeof r.launchedPool === "string" ? { launchedPool: r.launchedPool } : {}),
    ...(typeof r.launchSignature === "string" ? { launchSignature: r.launchSignature } : {}),
    ...(typeof r.invalidatedReason === "string" ? { invalidatedReason: r.invalidatedReason } : {}),
    ...draft.data,
  };
}

async function readPayload(): Promise<FilePayload> {
  try {
    const parsed = JSON.parse(await readFile(SCHEDULE_FILE, "utf8")) as { schedules?: unknown };
    return {
      ...emptyPayload(),
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules.map(parseStored).filter((x): x is ScheduledLaunch => !!x) : [],
    };
  } catch {
    return emptyPayload();
  }
}

async function writePayload(payload: FilePayload): Promise<void> {
  await mkdir(SCHEDULE_DIR, { recursive: true });
  const tmp = `${SCHEDULE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify({ ...payload, updatedAt: new Date().toISOString() }, null, 2), "utf8");
  await rename(tmp, SCHEDULE_FILE);
}

let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

function localStore(): ScheduledLaunchStore {
  return {
    async list() {
      return (await readPayload()).schedules;
    },
    async get(id) {
      return (await readPayload()).schedules.find((schedule) => schedule.id === id) ?? null;
    },
    put(entry) {
      return serialized(async () => {
        const current = await readPayload();
        const schedules = [entry, ...current.schedules.filter((schedule) => schedule.id !== entry.id)];
        await writePayload({ ...current, schedules: schedules.slice(0, 500) });
        return entry;
      });
    },
  };
}

export function getScheduledLaunchStore(): ScheduledLaunchStore {
  if (process.env.NODE_ENV === "production") {
    if (!isUpstashConfigured()) throw new ScheduleStorageConfigError();
    return createUpstashScheduledLaunchStore(createUpstashClient());
  }
  return localStore();
}

export function getScheduleBackend(): "file" | "upstash" | "unconfigured" {
  if (process.env.NODE_ENV === "production") return isUpstashConfigured() ? "upstash" : "unconfigured";
  return "file";
}

export function newScheduleId(): string {
  return randomUUID();
}

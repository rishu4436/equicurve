import type { Redis } from "@upstash/redis";
import { scheduledLaunchDraftSchema, type ScheduledLaunch } from "./types";
import type { ScheduledLaunchStore } from "./store";
import { walletSchema } from "@/lib/validation";

export const SCHEDULE_INDEX_KEY = "equicurve:schedules:index";

export class ScheduleConflictError extends Error {
  constructor() {
    super("Scheduled launch changed concurrently; reload and retry.");
    this.name = "ScheduleConflictError";
  }
}

export type ScheduleRedis = Pick<Redis, "get" | "lrange" | "eval">;

function validId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function key(id: string): string {
  if (!validId(id)) throw new Error("Invalid scheduled launch id");
  return `equicurve:schedule:${id}`;
}

function parse(raw: unknown): ScheduledLaunch | null {
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw) as unknown; } catch { return null; }
  }
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !validId(r.id) || typeof r.creatorWallet !== "string" || !walletSchema.safeParse(r.creatorWallet).success) return null;
  const draft = scheduledLaunchDraftSchema.safeParse({
    name: r.name, ticker: r.ticker, thesis: r.thesis, sector: r.sector, website: r.website ?? "", xProfile: r.xProfile ?? "", image: r.image ?? "",
    presetId: r.presetId, raiseTarget: r.raiseTarget, quote: r.quote, totalSupply: r.totalSupply, seedBuy: r.seedBuy, feeIssuerPct: r.feeIssuerPct,
    lpLockPct: r.lpLockPct, antiSniper: r.antiSniper, mintRenounce: r.mintRenounce, feeClaimer: r.feeClaimer ?? "", transferProfile: r.transferProfile,
    designFingerprint: r.designFingerprint, design: r.design, scheduledForUtc: r.scheduledForUtc, marketCaps: r.marketCaps, designed: r.designed,
  });
  if (!draft.success || typeof r.cluster !== "string" || typeof r.status !== "string" || typeof r.createdAt !== "string" || typeof r.updatedAt !== "string" || typeof r.authIssuedAt !== "string" || typeof r.authSignature !== "string") return null;
  if (!["scheduled", "ready", "cancelled", "launched", "invalidated"].includes(r.status)) return null;
  return {
    ...draft.data,
    id: r.id, creatorWallet: r.creatorWallet, cluster: r.cluster, status: r.status as ScheduledLaunch["status"],
    createdAt: r.createdAt, updatedAt: r.updatedAt, authIssuedAt: r.authIssuedAt, authSignature: r.authSignature,
    ...(typeof r.revision === "number" ? { revision: r.revision } : {}),
    ...(typeof r.launchedPool === "string" ? { launchedPool: r.launchedPool } : {}),
    ...(typeof r.launchSignature === "string" ? { launchSignature: r.launchSignature } : {}),
    ...(typeof r.invalidatedReason === "string" ? { invalidatedReason: r.invalidatedReason } : {}),
  };
}

function accepted(value: unknown): boolean { return value === 1 || value === "1" || (Array.isArray(value) && (value[0] === 1 || value[0] === "1")); }

const PUT_LUA = `
local raw = redis.call('GET', KEYS[1])
local expected = tonumber(ARGV[1])
local current = 0
if raw then local ok, decoded = pcall(cjson.decode, raw); if ok and type(decoded) == 'table' then current = tonumber(decoded.revision) or 0 end end
if current ~= expected then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('LPUSH', KEYS[2], ARGV[3])
redis.call('LTRIM', KEYS[2], 0, 499)
return 1
`;

export function scheduleRedisKey(id: string): string { return key(id); }

export function createUpstashScheduledLaunchStore(redis: ScheduleRedis): ScheduledLaunchStore {
  return {
    async get(id) { return validId(id) ? parse(await redis.get(key(id))) : null; },
    async list() {
      const ids = await redis.lrange<string>(SCHEDULE_INDEX_KEY, 0, 499);
      const seen = new Set<string>();
      const rows: ScheduledLaunch[] = [];
      for (const id of ids) {
        if (seen.has(id) || !validId(id)) continue;
        seen.add(id);
        const row = parse(await redis.get(key(id)));
        if (row) rows.push(row);
      }
      return rows;
    },
    async put(entry) {
      const id = entry.id;
      if (!validId(id)) throw new Error("Invalid scheduled launch id");
      const current = parse(await redis.get(key(id)));
      const expected = current?.revision ?? 0;
      const next = { ...entry, revision: entry.revision ?? expected + 1 };
      if (next.revision !== expected + 1) throw new ScheduleConflictError();
      const won = await redis.eval(PUT_LUA, [key(id), SCHEDULE_INDEX_KEY], [String(expected), JSON.stringify(next), id]);
      if (!accepted(won)) throw new ScheduleConflictError();
      return next;
    },
  };
}

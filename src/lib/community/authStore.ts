import type { Redis } from "@upstash/redis";
import type { WalletChallenge, WalletSession } from "./auth";

export type AuthRedis = Pick<Redis, "get" | "set" | "eval">;
export class AuthStorageConfigError extends Error {
  constructor() { super("Wallet authentication storage is not configured for this production environment."); this.name = "AuthStorageConfigError"; }
}

function challengeKey(nonce: string): string { if (!/^[a-f0-9-]{32,80}$/i.test(nonce)) throw new Error("Invalid challenge nonce"); return `equicurve:auth:challenge:${nonce}`; }
function sessionKey(hash: string): string { if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error("Invalid session hash"); return `equicurve:auth:session:${hash}`; }
function decode<T>(value: unknown): T | null { if (typeof value === "string") { try { return JSON.parse(value) as T; } catch { return null; } } return value && typeof value === "object" ? value as T : null; }
function accepted(value: unknown): boolean { return value === 1 || value === "1" || (Array.isArray(value) && (value[0] === 1 || value[0] === "1")); }

const CONSUME_LUA = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local ok, decoded = pcall(cjson.decode, raw)
if not ok or type(decoded) ~= 'table' or decoded.consumedAt ~= nil then return 0 end
if decoded.wallet ~= ARGV[1] or decoded.cluster ~= ARGV[2] or decoded.expiresAt <= ARGV[3] then return 0 end
decoded.consumedAt = ARGV[4]
redis.call('SET', KEYS[1], cjson.encode(decoded), 'KEEPTTL')
return 1
`;

export interface AuthStore {
  putChallenge(challenge: WalletChallenge): Promise<void>;
  getChallenge(nonce: string): Promise<WalletChallenge | null>;
  consumeChallenge(challenge: WalletChallenge, consumedAt: string, nowIso: string): Promise<boolean>;
  putSession(session: WalletSession, ttlSeconds: number): Promise<void>;
  getSession(tokenHash: string): Promise<WalletSession | null>;
}

export function createUpstashAuthStore(redis: AuthRedis): AuthStore {
  return {
    async putChallenge(challenge) {
      const ttl = Math.max(1, Math.ceil((Date.parse(challenge.expiresAt) - Date.parse(challenge.issuedAt)) / 1000));
      await redis.set(challengeKey(challenge.nonce), JSON.stringify(challenge), { ex: ttl });
    },
    async getChallenge(nonce) { return decode<WalletChallenge>(await redis.get(challengeKey(nonce))); },
    async consumeChallenge(challenge, consumedAt, nowIso) {
      const result = await redis.eval(CONSUME_LUA, [challengeKey(challenge.nonce)], [challenge.wallet, challenge.cluster, nowIso, consumedAt]);
      return accepted(result);
    },
    async putSession(session, ttlSeconds) { await redis.set(sessionKey(session.tokenHash), JSON.stringify(session), { ex: Math.max(1, ttlSeconds) }); },
    async getSession(tokenHash) { return decode<WalletSession>(await redis.get(sessionKey(tokenHash))); },
  };
}

export const authKeyHelpers = { challengeKey, sessionKey };

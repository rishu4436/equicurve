import {
  decodeStoredJson,
  isValidMetadataId,
  metadataCasToken,
  metadataIssuedAtMs,
  metadataWriteIsNewer,
  observedIssuedAtMs,
  parseMetadataRecord,
  StaleMetadataWrite,
} from "./record";
import type { MetadataStore } from "./fileStore";

/** One Redis string per mint. Not a collection blob. */
export function metadataRedisKey(id: string): string {
  if (!isValidMetadataId(id)) throw new Error("Invalid metadata id");
  return `equicurve:metadata:${id}`;
}

/**
 * Set the key only when its issuedAt token still matches the value we read.
 * "*" = absent, "?" = present but unprotected, otherwise the stored issuedAt.
 * Returns 1 on write and 0 when another writer won.
 */
export const METADATA_CAS_LUA = `
local expected = ARGV[1]
local next_payload = ARGV[2]
local raw = redis.call("GET", KEYS[1])

local function is_null(value)
  return value == nil or value == cjson.null
end

local function readable(decoded)
  if type(decoded) ~= "table" or decoded.v ~= 2 or type(decoded.meta) ~= "table" then
    return false
  end
  local meta = decoded.meta
  if type(meta.name) ~= "string" or type(meta.symbol) ~= "string" then return false end
  if type(meta.description) ~= "string" or type(meta.image) ~= "string" then return false end
  if not (is_null(decoded.owner) or type(decoded.owner) == "string") then return false end
  if not (is_null(decoded.pool) or type(decoded.pool) == "string") then return false end
  if not (is_null(decoded.issuedAt) or type(decoded.issuedAt) == "string") then return false end
  if type(decoded.updatedAt) ~= "string" then return false end
  return true
end

local function issued_token(decoded)
  if is_null(decoded.issuedAt) then return "" end
  return decoded.issuedAt
end

if expected == "*" then
  if raw and raw ~= false then return 0 end
elseif expected == "?" then
  if not raw or raw == false then return 0 end
  local ok, decoded = pcall(cjson.decode, raw)
  if ok and type(decoded) == "table" then
    local issued = decoded.issuedAt
    if type(issued) == "string" then return 0 end
    if readable(decoded) and is_null(issued) then return 0 end
  end
else
  if not raw or raw == false then return 0 end
  local ok, decoded = pcall(cjson.decode, raw)
  if not ok or type(decoded) ~= "table" then return 0 end
  if issued_token(decoded) ~= expected then return 0 end
end

redis.call("SET", KEYS[1], next_payload)
return 1
`;

function casAccepted(result: unknown): boolean {
  if (result === 1 || result === "1") return true;
  return Array.isArray(result) && (result[0] === 1 || result[0] === "1");
}

export type MetadataRedis = {
  get(key: string): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

export function createUpstashMetadataStore(redis: MetadataRedis): MetadataStore {
  return {
    async read(id) {
      if (!isValidMetadataId(id)) return null;
      return parseMetadataRecord(decodeStoredJson(await redis.get(metadataRedisKey(id))));
    },
    async write(id, record) {
      const next = parseMetadataRecord(record);
      if (!next) throw new Error("Refusing to store a metadata record that failed validation");
      const key = metadataRedisKey(id);
      const nextMs = metadataIssuedAtMs(next);
      for (let attempt = 0; attempt < 5; attempt++) {
        const raw = decodeStoredJson(await redis.get(key));
        const current = parseMetadataRecord(raw);
        const observed = observedIssuedAtMs(raw);
        if (observed != null && nextMs <= observed) throw new StaleMetadataWrite();
        if (current && !metadataWriteIsNewer(current, next)) throw new StaleMetadataWrite();
        const won = await redis.eval(METADATA_CAS_LUA, [key], [metadataCasToken(raw), JSON.stringify(next)]);
        if (casAccepted(won)) return;
      }
      throw new Error("Metadata write lost a concurrent update");
    },
  };
}

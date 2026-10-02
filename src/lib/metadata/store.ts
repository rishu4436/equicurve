import { createUpstashClient, isUpstashConfigured } from "@/lib/registry/upstashStore";
import { createFileMetadataStore, type MetadataStore } from "./fileStore";
import {
  isValidMetadataId,
  type MetadataRecord,
  type TokenMetadataJson,
} from "./record";
import { createUpstashMetadataStore, type MetadataRedis } from "./upstashStore";

export type { MetadataRecord, TokenMetadataJson } from "./record";
export { isValidMetadataId, StaleMetadataWrite } from "./record";

let cached: MetadataStore | null = null;

function activeStore(): MetadataStore {
  if (cached) return cached;
  cached = isUpstashConfigured()
    ? createUpstashMetadataStore(createUpstashClient() as MetadataRedis)
    : createFileMetadataStore();
  return cached;
}

/** Which backend current env would select. No I/O. */
export function getMetadataBackend(): "file" | "upstash" {
  return isUpstashConfigured() ? "upstash" : "file";
}

/** Test helper — drop the cached store so env changes take effect. */
export function resetMetadataStoreCache(): void {
  cached = null;
}

export async function readMetadataRecord(id: string): Promise<MetadataRecord | null> {
  if (!isValidMetadataId(id)) return null;
  return activeStore().read(id);
}

export async function readMetadata(id: string): Promise<TokenMetadataJson | null> {
  return (await readMetadataRecord(id))?.meta ?? null;
}

export async function writeMetadataRecord(id: string, record: MetadataRecord): Promise<void> {
  await activeStore().write(id, record);
}

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { isValidPublicKey } from "@/lib/validation";

export type TokenMetadataJson = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url?: string;
};

/** Stored record: public JSON + who is allowed to change it. */
export type MetadataRecord = {
  v: 2;
  meta: TokenMetadataJson;
  /** Wallet that signed the write (pre-launch = future pool creator). null = legacy. */
  owner: string | null;
  pool: string | null;
  issuedAt: string | null;
  updatedAt: string;
};

const DIR = path.join(process.cwd(), "data", "metadata");

/** Metadata ids are mint addresses (base58 public keys). */
export function isValidMetadataId(id: string): boolean {
  return isValidPublicKey(id);
}

function fileFor(id: string): string {
  if (!isValidMetadataId(id)) throw new Error("Invalid metadata id");
  return path.join(DIR, `${id}.json`);
}

export async function readMetadataRecord(id: string): Promise<MetadataRecord | null> {
  if (!isValidMetadataId(id)) return null;
  try {
    const raw = JSON.parse(await readFile(fileFor(id), "utf8")) as unknown;
    if (raw && typeof raw === "object" && (raw as { v?: unknown }).v === 2) {
      return raw as MetadataRecord;
    }
    // Legacy v1 file: bare metadata JSON, no owner.
    return {
      v: 2,
      meta: raw as TokenMetadataJson,
      owner: null,
      pool: null,
      issuedAt: null,
      updatedAt: new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

export async function readMetadata(id: string): Promise<TokenMetadataJson | null> {
  return (await readMetadataRecord(id))?.meta ?? null;
}

export async function writeMetadataRecord(id: string, record: MetadataRecord): Promise<void> {
  const file = fileFor(id);
  await mkdir(DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2), "utf8");
  await rename(tmp, file);
}

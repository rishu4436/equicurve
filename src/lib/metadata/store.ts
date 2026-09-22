import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type TokenMetadataJson = {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url?: string;
};

const DIR = path.join(process.cwd(), "data", "metadata");

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

export async function writeMetadata(
  id: string,
  meta: TokenMetadataJson,
): Promise<string> {
  const safe = safeId(id);
  if (!safe) throw new Error("Invalid metadata id");
  await mkdir(DIR, { recursive: true });
  await writeFile(
    path.join(DIR, `${safe}.json`),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
  return safe;
}

export async function readMetadata(
  id: string,
): Promise<TokenMetadataJson | null> {
  const safe = safeId(id);
  if (!safe) return null;
  try {
    const raw = await readFile(path.join(DIR, `${safe}.json`), "utf8");
    return JSON.parse(raw) as TokenMetadataJson;
  } catch {
    return null;
  }
}

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  isValidMetadataId,
  metadataWriteIsNewer,
  parseLegacyMetadata,
  parseMetadataRecord,
  StaleMetadataWrite,
  type MetadataRecord,
} from "./record";

const DEFAULT_DIR = path.join(process.cwd(), "data", "metadata");

export type MetadataStore = {
  read(id: string): Promise<MetadataRecord | null>;
  write(id: string, record: MetadataRecord): Promise<void>;
};

function fileFor(dir: string, id: string): string {
  if (!isValidMetadataId(id)) throw new Error("Invalid metadata id");
  return path.join(dir, `${id}.json`);
}

async function readFileRecord(dir: string, id: string): Promise<MetadataRecord | null> {
  if (!isValidMetadataId(id)) return null;
  try {
    const raw = JSON.parse(await readFile(fileFor(dir, id), "utf8")) as unknown;
    if (raw && typeof raw === "object" && (raw as { v?: unknown }).v === 2) {
      return parseMetadataRecord(raw);
    }
    return parseLegacyMetadata(raw);
  } catch {
    return null;
  }
}

/** Local development store. One JSON file per mint. Writes are serialized in-process. */
export function createFileMetadataStore(dir = DEFAULT_DIR): MetadataStore {
  let chain: Promise<unknown> = Promise.resolve();
  const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };

  return {
    read: (id) => readFileRecord(dir, id),
    write(id, record) {
      const next = parseMetadataRecord(record);
      if (!next) return Promise.reject(new Error("Refusing to store a metadata record that failed validation"));
      return serialized(async () => {
        const current = await readFileRecord(dir, id);
        if (current && !metadataWriteIsNewer(current, next)) throw new StaleMetadataWrite();
        await mkdir(dir, { recursive: true });
        const file = fileFor(dir, id);
        const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
        await rename(tmp, file);
      });
    },
  };
}

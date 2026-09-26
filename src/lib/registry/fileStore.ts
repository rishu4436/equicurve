import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { emptyRegistryPayload, mergeEntry, parseRegistryPayload, sortLaunchesNewestFirst } from "./normalize";
import type { LaunchRegistryStore, RegistryFilePayload, RegistryLaunch } from "./types";

const DIR = path.join(process.cwd(), "data", "launches");
const FILE = path.join(DIR, "registry.json");

async function readFileSafe(): Promise<RegistryFilePayload> {
  try {
    return parseRegistryPayload(await readFile(FILE, "utf8"));
  } catch {
    return emptyRegistryPayload();
  }
}

/** Atomic-ish write: temp file + rename (no torn JSON on crash). */
async function writeFileSafe(data: RegistryFilePayload): Promise<void> {
  await mkdir(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, FILE);
}

// Serialize writes within this process to avoid lost updates.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

export function createFileStore(): LaunchRegistryStore {
  return {
    backend: "file",
    async list(): Promise<RegistryLaunch[]> {
      return sortLaunchesNewestFirst((await readFileSafe()).launches);
    },
    async get(pool: string): Promise<RegistryLaunch | null> {
      return (await readFileSafe()).launches.find((l) => l.pool === pool) ?? null;
    },
    put(entry: RegistryLaunch): Promise<RegistryLaunch> {
      return serialized(async () => {
        await writeFileSafe(mergeEntry(await readFileSafe(), entry));
        return entry;
      });
    },
  };
}

/** Read local file payload without going through the active store (seed helper). */
export async function readLocalRegistryFile(): Promise<RegistryFilePayload> {
  return readFileSafe();
}

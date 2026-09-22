import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import {
  emptyRegistryPayload,
  MAX_REGISTRY_ENTRIES,
  normalizeLaunchInput,
  sortLaunchesNewestFirst,
} from "./normalize";
import type {
  LaunchRegistryStore,
  RegistryFilePayload,
  RegistryLaunch,
  RegistryLaunchInput,
} from "./types";

const DIR = path.join(process.cwd(), "data", "launches");
const FILE = path.join(DIR, "registry.json");

async function readFileSafe(): Promise<RegistryFilePayload> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as RegistryFilePayload;
    if (!parsed || !Array.isArray(parsed.launches)) return emptyRegistryPayload();
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      launches: parsed.launches,
    };
  } catch {
    return emptyRegistryPayload();
  }
}

async function writeFileSafe(data: RegistryFilePayload): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export function createFileStore(): LaunchRegistryStore {
  return {
    backend: "file",

    async list(): Promise<RegistryLaunch[]> {
      const file = await readFileSafe();
      return sortLaunchesNewestFirst(file.launches);
    },

    async get(pool: string): Promise<RegistryLaunch | null> {
      const file = await readFileSafe();
      return file.launches.find((l) => l.pool === pool) ?? null;
    },

    async upsert(input: RegistryLaunchInput): Promise<RegistryLaunch> {
      const entry = normalizeLaunchInput(input);
      const now = new Date().toISOString();
      const file = await readFileSafe();
      const prev = file.launches.filter((l) => l.pool !== entry.pool);
      const merged: RegistryFilePayload = {
        version: 1,
        updatedAt: now,
        launches: [entry, ...prev].slice(0, MAX_REGISTRY_ENTRIES),
      };
      await writeFileSafe(merged);
      return entry;
    },

    async patch(
      pool: string,
      patch: Partial<RegistryLaunchInput>,
    ): Promise<RegistryLaunch | null> {
      const file = await readFileSafe();
      const current = file.launches.find((l) => l.pool === pool);
      if (!current) return null;
      return this.upsert({
        ...current,
        ...patch,
        pool: current.pool,
        registeredAt: current.registeredAt,
      });
    },
  };
}

/** Read local file payload without going through the active store (seed helper). */
export async function readLocalRegistryFile(): Promise<RegistryFilePayload> {
  return readFileSafe();
}

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import type { RegistryLaunch, RegistryLaunchInput } from "./types";

const DIR = path.join(process.cwd(), "data", "launches");
const FILE = path.join(DIR, "registry.json");
const MAX_ENTRIES = 500;

type RegistryFile = {
  version: 1;
  updatedAt: string;
  launches: RegistryLaunch[];
};

function empty(): RegistryFile {
  return { version: 1, updatedAt: new Date().toISOString(), launches: [] };
}

async function readFileSafe(): Promise<RegistryFile> {
  try {
    const raw = await readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as RegistryFile;
    if (!parsed || !Array.isArray(parsed.launches)) return empty();
    return {
      version: 1,
      updatedAt: parsed.updatedAt || new Date().toISOString(),
      launches: parsed.launches,
    };
  } catch {
    return empty();
  }
}

async function writeFileSafe(data: RegistryFile): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(data, null, 2), "utf8");
}

export async function listRegistryLaunches(): Promise<RegistryLaunch[]> {
  const file = await readFileSafe();
  return [...file.launches].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export async function upsertRegistryLaunch(
  input: RegistryLaunchInput,
): Promise<RegistryLaunch> {
  const pool = input.pool?.trim();
  const mint = input.mint?.trim();
  const config = input.config?.trim();
  const name = input.name?.trim();
  const ticker = input.ticker?.trim().toUpperCase();
  if (!pool || !mint || !config || !name || !ticker) {
    throw new Error("pool, mint, config, name, and ticker are required");
  }

  const now = new Date().toISOString();
  const entry: RegistryLaunch = {
    pool,
    mint,
    config,
    name,
    ticker,
    thesis: (input.thesis ?? "").trim(),
    sector: input.sector ?? "Other",
    quote: input.quote === "USDC" ? "USDC" : "SOL",
    raiseTarget: Math.max(0, Number(input.raiseTarget) || 0),
    presetId: input.presetId ?? "flat",
    feeBps: Math.max(0, Number(input.feeBps) || 0),
    feeIssuerPct:
      input.feeIssuerPct != null ? Number(input.feeIssuerPct) : undefined,
    lockPct: Math.max(0, Number(input.lockPct) || 0),
    creator: (input.creator ?? "").trim(),
    createdAt: input.createdAt || now,
    cluster: input.cluster || "devnet",
    status: input.status === "graduated" ? "graduated" : input.status === "new" ? "new" : "raising",
    sig: (input.sig ?? "").trim(),
    dammPool: input.dammPool?.trim() || undefined,
    migrateSig: input.migrateSig?.trim() || undefined,
    registeredAt: input.registeredAt || now,
  };

  const file = await readFileSafe();
  const prev = file.launches.filter((l) => l.pool !== entry.pool);
  const merged: RegistryFile = {
    version: 1,
    updatedAt: now,
    launches: [entry, ...prev].slice(0, MAX_ENTRIES),
  };
  await writeFileSafe(merged);
  return entry;
}

export async function patchRegistryLaunch(
  pool: string,
  patch: Partial<RegistryLaunchInput>,
): Promise<RegistryLaunch | null> {
  const file = await readFileSafe();
  const idx = file.launches.findIndex((l) => l.pool === pool);
  if (idx < 0) return null;
  const current = file.launches[idx];
  const next = await upsertRegistryLaunch({
    ...current,
    ...patch,
    pool: current.pool,
    registeredAt: current.registeredAt,
  });
  return next;
}

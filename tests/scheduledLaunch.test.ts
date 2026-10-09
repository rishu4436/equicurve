import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { launchCurveConfig } from "@/lib/dbc/create";
import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { canonicalConfigText, expectedFromConfig } from "@/lib/dbc/deploymentReadback";
import { signSchedulePayload, type ScheduleAuthPayload } from "@/lib/auth/scheduleAuth";
import { authorizeScheduleAction } from "@/lib/schedule/authorize";
import { effectiveScheduleStatus, scheduleTimeError, type ScheduledLaunch, type ScheduledLaunchDraft } from "@/lib/schedule/types";
import { getScheduledLaunchStore, ScheduleStorageConfigError } from "@/lib/schedule/store";
import { signerFor } from "./helpers";

function design(presetId: "flat" | "exponential" = "flat") {
  const cfg = launchCurveConfig({ presetId, totalSupply: 1_000_000_000, creatorTradingFeePercentage: 70, lpLockPct: 100, mintRenounce: true, antiSniper: true, quoteDecimals: 9, transferProfile: "open-spl", marketCaps: { initial: 100, migration: 200 } });
  const expected = expectedFromConfig(cfg);
  return {
    fingerprint: marketConfigFingerprint(cfg),
    migrationQuoteThresholdAtoms: expected.migrationQuoteThreshold,
    canonicalConfig: canonicalConfigText(cfg),
    expected,
    profileName: `${presetId} trial`,
    constraintsPassed: true,
  };
}

function draft(nowMs: number, over: Partial<ScheduledLaunchDraft> = {}): ScheduledLaunchDraft {
  const attestation = design();
  return {
    name: "Acme Robotics",
    ticker: "ACME",
    thesis: "Tokenized exposure to a robotics issuer.",
    sector: "Equity",
    website: "https://example.com/acme",
    xProfile: "https://x.com/acme",
    image: "",
    presetId: "flat",
    raiseTarget: 100,
    quote: "SOL",
    totalSupply: 1_000_000_000,
    seedBuy: "0",
    feeIssuerPct: 70,
    lpLockPct: 100,
    antiSniper: true,
    mintRenounce: true,
    feeClaimer: "",
    transferProfile: "open-spl",
    designFingerprint: attestation.fingerprint,
    design: attestation,
    scheduledForUtc: new Date(nowMs + 10 * 60_000).toISOString(),
    marketCaps: { initial: 100, migration: 200 },
    designed: { configFingerprint: attestation.fingerprint, asset: "private-company", objective: "controlled-discovery", presetId: "flat" } as ScheduledLaunchDraft["designed"],
    ...over,
  };
}

function memory() {
  const map = new Map<string, ScheduledLaunch>();
  return {
    get: async (id: string) => map.get(id) ?? null,
    getExisting: async (id: string) => map.get(id) ?? null,
    list: async () => [...map.values()],
    put: async (entry: ScheduledLaunch) => { map.set(entry.id, entry); return entry; },
  };
}

function asDraft(entry: ScheduledLaunch): ScheduledLaunchDraft {
  return {
    name: entry.name,
    ticker: entry.ticker,
    thesis: entry.thesis,
    sector: entry.sector,
    website: entry.website,
    xProfile: entry.xProfile,
    image: entry.image,
    presetId: entry.presetId,
    raiseTarget: entry.raiseTarget,
    quote: entry.quote,
    totalSupply: entry.totalSupply,
    seedBuy: entry.seedBuy,
    feeIssuerPct: entry.feeIssuerPct,
    lpLockPct: entry.lpLockPct,
    antiSniper: entry.antiSniper,
    mintRenounce: entry.mintRenounce,
    feeClaimer: entry.feeClaimer,
    transferProfile: entry.transferProfile,
    designFingerprint: entry.designFingerprint,
    design: entry.design,
    scheduledForUtc: entry.scheduledForUtc,
    marketCaps: entry.marketCaps,
    designed: entry.designed,
  };
}

async function signedCreate(kp: Keypair, nowMs: number, over: Partial<ScheduledLaunchDraft> = {}) {
  const payload: ScheduleAuthPayload = { v: 1, action: "schedule_create", cluster: "devnet", schedule: draft(nowMs, over) };
  return signSchedulePayload({ payload, signer: kp.publicKey.toBase58(), signMessage: signerFor(kp), now: new Date(nowMs) });
}

describe("scheduled launch model", () => {
  it("accepts a valid future record and canonicalizes UTC", async () => {
    const now = Date.now();
    const kp = Keypair.generate();
    const db = memory();
    const result = await authorizeScheduleAction({ body: await signedCreate(kp, now), serverCluster: "devnet", nowMs: now, ...db });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.status).toBe("scheduled");
    expect(result.entry.creatorWallet).toBe(kp.publicKey.toBase58());
    expect(result.entry.scheduledForUtc.endsWith("Z")).toBe(true);
  });

  it("canonicalizes a signed twitter.com profile before persistence", async () => {
    const now = Date.now();
    const kp = Keypair.generate();
    const db = memory();
    const result = await authorizeScheduleAction({ body: await signedCreate(kp, now, { xProfile: "https://twitter.com/acme" }), serverCluster: "devnet", nowMs: now, ...db });
    expect(result.ok && result.entry.xProfile).toBe("https://x.com/acme");
  });

  it("derives scheduled and ready without a cron job", () => {
    const scheduled = { status: "scheduled" as const, scheduledForUtc: new Date(Date.now() + 1_000).toISOString() };
    expect(effectiveScheduleStatus(scheduled, Date.now())).toBe("scheduled");
    expect(effectiveScheduleStatus(scheduled, Date.now() + 2_000)).toBe("ready");
    expect(effectiveScheduleStatus({ ...scheduled, status: "cancelled" }, Date.now() + 2_000)).toBe("cancelled");
  });

  it("rejects past, too-near, and distant times", () => {
    const now = Date.now();
    expect(scheduleTimeError(new Date(now - 1).toISOString(), now)).toContain("5 minutes");
    expect(scheduleTimeError(new Date(now + 60_000).toISOString(), now)).toContain("5 minutes");
    expect(scheduleTimeError(new Date(now + 91 * 24 * 60 * 60_000).toISOString(), now)).toContain("90 days");
  });

  it("rejects a malformed schedule payload before persistence", async () => {
    const now = Date.now();
    const kp = Keypair.generate();
    const body = await signedCreate(kp, now, { ticker: "bad ticker" as ScheduledLaunchDraft["ticker"] });
    const result = await authorizeScheduleAction({ body, serverCluster: "devnet", nowMs: now, ...memory() });
    expect(result).toMatchObject({ ok: false, status: 400, code: "invalid_body" });
  });
});

describe("scheduled launch authorization and lifecycle", () => {
  async function create(nowMs: number, db: ReturnType<typeof memory>) {
    const owner = Keypair.generate();
    const result = await authorizeScheduleAction({ body: await signedCreate(owner, nowMs), serverCluster: "devnet", nowMs, ...db });
    if (!result.ok) throw new Error(result.error);
    await db.put(result.entry);
    return { owner, entry: result.entry };
  }

  it("allows the creator to reschedule and blocks another wallet", async () => {
    const now = Date.now();
    const db = memory();
    const { owner, entry } = await create(now, db);
    const attacker = Keypair.generate();
    const updatePayload: ScheduleAuthPayload = { v: 1, action: "schedule_update", cluster: "devnet", scheduleId: entry.id, schedule: { ...asDraft(entry), scheduledForUtc: new Date(now + 30 * 60_000).toISOString() } };
    expect(await authorizeScheduleAction({ body: await signSchedulePayload({ payload: updatePayload, signer: attacker.publicKey.toBase58(), signMessage: signerFor(attacker), now: new Date(now + 1_000) }), serverCluster: "devnet", nowMs: now + 1_000, ...db })).toMatchObject({ ok: false, status: 403, code: "not_creator" });
    const updated = await authorizeScheduleAction({ body: await signSchedulePayload({ payload: updatePayload, signer: owner.publicKey.toBase58(), signMessage: signerFor(owner), now: new Date(now + 1_000) }), serverCluster: "devnet", nowMs: now + 1_000, ...db });
    expect(updated).toMatchObject({ ok: true, action: "updated" });
  });

  it("rejects tampering and replayed authorization", async () => {
    const now = Date.now();
    const db = memory();
    const { owner, entry } = await create(now, db);
    const body = await signSchedulePayload({ payload: { v: 1, action: "schedule_cancel", cluster: "devnet", scheduleId: entry.id }, signer: owner.publicKey.toBase58(), signMessage: signerFor(owner), now: new Date(now + 1_000) });
    const tampered = { ...body, payload: { ...body.payload, scheduleId: Keypair.generate().publicKey.toBase58() } };
    expect(await authorizeScheduleAction({ body: tampered, serverCluster: "devnet", nowMs: now + 1_000, ...db })).toMatchObject({ ok: false, status: 400 });
    const first = await authorizeScheduleAction({ body, serverCluster: "devnet", nowMs: now + 1_000, ...db });
    expect(first).toMatchObject({ ok: true, action: "cancelled" });
    if (first.ok) await db.put(first.entry);
    expect(await authorizeScheduleAction({ body, serverCluster: "devnet", nowMs: now + 1_000, ...db })).toMatchObject({ ok: false, status: 409, code: "replayed_authorization" });
  });

  it("cancels own schedules and refuses cancellation by another wallet", async () => {
    const now = Date.now();
    const db = memory();
    const { owner, entry } = await create(now, db);
    const other = Keypair.generate();
    const payload: ScheduleAuthPayload = { v: 1, action: "schedule_cancel", cluster: "devnet", scheduleId: entry.id };
    expect(await authorizeScheduleAction({ body: await signSchedulePayload({ payload, signer: other.publicKey.toBase58(), signMessage: signerFor(other), now: new Date(now + 1_000) }), serverCluster: "devnet", nowMs: now + 1_000, ...db })).toMatchObject({ ok: false, status: 403 });
    const cancelled = await authorizeScheduleAction({ body: await signSchedulePayload({ payload, signer: owner.publicKey.toBase58(), signMessage: signerFor(owner), now: new Date(now + 1_000) }), serverCluster: "devnet", nowMs: now + 1_000, ...db });
    expect(cancelled).toMatchObject({ ok: true, action: "cancelled" });
    if (cancelled.ok) await db.put(cancelled.entry);
    expect(await authorizeScheduleAction({ body: await signSchedulePayload({ payload: { ...payload, action: "schedule_launch", designFingerprint: entry.designFingerprint, launchedPool: entry.creatorWallet, launchSignature: "1111111111111111111111111111111111111111111111111111111111111111" }, signer: owner.publicKey.toBase58(), signMessage: signerFor(owner), now: new Date(now + 2_000) }), serverCluster: "devnet", nowMs: now + 20 * 60_000, ...db })).toMatchObject({ ok: false, status: 409, code: "terminal_schedule" });
  });

  it("invalidates a changed design at update or launch and prevents relaunch", async () => {
    const now = Date.now();
    const db = memory();
    const { owner, entry } = await create(now, db);
    const nextDesign = design("exponential");
    const changed = { ...asDraft(entry), presetId: "exponential" as const, designFingerprint: nextDesign.fingerprint, design: nextDesign, designed: { ...entry.designed, presetId: "exponential", configFingerprint: nextDesign.fingerprint } as ScheduledLaunchDraft["designed"] };
    const updatePayload: ScheduleAuthPayload = { v: 1, action: "schedule_update", cluster: "devnet", scheduleId: entry.id, schedule: changed };
    const invalidated = await authorizeScheduleAction({ body: await signSchedulePayload({ payload: updatePayload, signer: owner.publicKey.toBase58(), signMessage: signerFor(owner), now: new Date(now + 1_000) }), serverCluster: "devnet", nowMs: now + 1_000, ...db });
    expect(invalidated).toMatchObject({ ok: false, status: 409, code: "schedule_invalidated" });
  });

  it("allows one ready launch close and refuses relaunch", async () => {
    const now = Date.now();
    const db = memory();
    const { owner, entry } = await create(now, db);
    const launch: ScheduleAuthPayload = { v: 1, action: "schedule_launch", cluster: "devnet", scheduleId: entry.id, designFingerprint: entry.designFingerprint, launchedPool: entry.creatorWallet, launchSignature: "1111111111111111111111111111111111111111111111111111111111111111" };
    const body = await signSchedulePayload({ payload: launch, signer: owner.publicKey.toBase58(), signMessage: signerFor(owner), now: new Date(now + 11 * 60_000) });
    const first = await authorizeScheduleAction({ body, serverCluster: "devnet", nowMs: now + 11 * 60_000, ...db });
    expect(first).toMatchObject({ ok: true, action: "launched" });
    if (first.ok) await db.put(first.entry);
    expect(await authorizeScheduleAction({ body, serverCluster: "devnet", nowMs: now + 11 * 60_000, ...db })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("scheduled launch storage", () => {
  it("fails closed in production without a durable backend", () => {
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    try { expect(() => getScheduledLaunchStore()).toThrow(ScheduleStorageConfigError); }
    finally { if (before === undefined) delete env.NODE_ENV; else env.NODE_ENV = before; }
  });

  it("keeps Upcoming copy separate from live market stats", () => {
    const detail = readFileSync(resolve(process.cwd(), "src/components/upcoming/UpcomingDetailClient.tsx"), "utf8");
    const card = readFileSync(resolve(process.cwd(), "src/components/upcoming/UpcomingCard.tsx"), "utf8");
    expect(detail).toContain("No market exists on-chain yet.");
    expect(detail).not.toContain("price");
    expect(detail).not.toContain("holders");
    expect(card).toContain("Not live yet");
    expect(card).toContain("Scheduled for");
  });
});

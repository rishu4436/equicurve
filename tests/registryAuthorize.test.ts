import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  authorizeRegistration,
  refreshFromChain,
  type ChainLookupResult,
} from "@/lib/registry/authorize";
import type { RegistryLaunch } from "@/lib/registry/types";
import { MINT, POOL, signed, snapshot } from "./helpers";

const USDC = ["4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"];

function deps(kp: Keypair, over: Partial<Parameters<typeof authorizeRegistration>[0]> = {}) {
  const snap = snapshot({ creator: kp.publicKey.toBase58() });
  return {
    serverCluster: "devnet",
    nowMs: Date.now(),
    lookup: async (): Promise<ChainLookupResult> => ({ status: "verified", snapshot: snap }),
    getExisting: async (): Promise<RegistryLaunch | null> => null,
    usdcMints: USDC,
    ...over,
  };
}

describe("authorizeRegistration", () => {
  it("accepts a creator-signed payload and derives every chain field from chain", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp);
    const r = await authorizeRegistration({ body, ...deps(kp) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.creator).toBe(kp.publicKey.toBase58());
    expect(r.entry.status).toBe("raising");
    expect(r.entry.pool).toBe(POOL);
    expect(r.entry.mint).toBe(MINT);
    expect(r.entry.authSigner).toBe(kp.publicKey.toBase58());
  });

  it("rejects spoofed status / creator keys (strict schema) with 400", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp);
    const r = await authorizeRegistration({
      body: { ...body, payload: { ...body.payload, status: "graduated" } },
      ...deps(kp),
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
    const r2 = await authorizeRegistration({ body: { ...body, creator: "x" }, ...deps(kp) });
    expect(r2).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects unsigned legacy bodies", async () => {
    const r = await authorizeRegistration({
      body: { pool: POOL, mint: MINT, name: "X", status: "graduated" },
      ...deps(Keypair.generate()),
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects invalid pubkeys", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp);
    const r = await authorizeRegistration({
      body: { ...body, payload: { ...body.payload, pool: "not-a-key" } },
      ...deps(kp),
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("403 when the signer is not the on-chain creator", async () => {
    const creator = Keypair.generate();
    const attacker = Keypair.generate();
    const body = await signed(attacker);
    const r = await authorizeRegistration({ body, ...deps(creator) });
    expect(r).toMatchObject({ ok: false, status: 403, code: "not_creator" });
  });

  it("401 on bad signature / expired", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp);
    body.payload.profile!.thesis = "Tampered after signing, oh no.";
    expect(await authorizeRegistration({ body, ...deps(kp) })).toMatchObject({ ok: false, status: 401 });
    const old = await signed(kp, {}, new Date(Date.now() - 60 * 60_000));
    expect(await authorizeRegistration({ body: old, ...deps(kp) })).toMatchObject({ ok: false, status: 401 });
  });

  it("400 on cluster mismatch", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp, { cluster: "mainnet-beta" });
    expect(await authorizeRegistration({ body, ...deps(kp) })).toMatchObject({ ok: false, status: 400, code: "cluster_mismatch" });
  });

  it("404 when the pool is not on-chain; 503 when RPC is down", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp);
    expect(
      await authorizeRegistration({ body, ...deps(kp, { lookup: async () => ({ status: "not_found", error: "x" }) }) }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await authorizeRegistration({ body, ...deps(kp, { lookup: async () => ({ status: "rpc_unavailable", error: "x" }) }) }),
    ).toMatchObject({ ok: false, status: 503 });
  });

  it("400 when payload.mint differs from the on-chain base mint", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp, { mint: Keypair.generate().publicKey.toBase58() });
    expect(await authorizeRegistration({ body, ...deps(kp) })).toMatchObject({ ok: false, code: "mint_mismatch" });
  });

  it("409 on a stale (replayed older) authorization; idempotent for identical", async () => {
    const kp = Keypair.generate();
    const now = Date.now();
    const older = await signed(kp, {}, new Date(now - 60_000));
    const first = await authorizeRegistration({ body: older, ...deps(kp, { nowMs: now }) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const stored = first.entry;
    // same body replayed → unchanged
    const replay = await authorizeRegistration({
      body: older,
      ...deps(kp, { nowMs: now, getExisting: async () => stored }),
    });
    expect(replay).toMatchObject({ ok: true, unchanged: true });
    // older auth with different profile → 409
    const olderEdit = await signed(
      kp,
      { profile: { ...older.payload.profile!, name: "Different Name" } },
      new Date(now - 120_000),
    );
    const r = await authorizeRegistration({
      body: olderEdit,
      ...deps(kp, { nowMs: now, getExisting: async () => stored }),
    });
    expect(r).toMatchObject({ ok: false, status: 409 });
  });
});

describe("refreshFromChain", () => {
  const existing = { pool: POOL, status: "raising" } as unknown as RegistryLaunch;

  it("accepts only { pool }", async () => {
    const r = await refreshFromChain({
      body: { pool: POOL, status: "graduated" },
      serverCluster: "devnet",
      nowMs: Date.now(),
      lookup: async () => ({ status: "verified", snapshot: snapshot() }),
      getExisting: async () => existing,
      usdcMints: USDC,
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("status comes from chain; DAMM pool only when verified", async () => {
    const migrated = snapshot({ isMigrated: true, migrationProgress: 3 });
    const r = await refreshFromChain({
      body: { pool: POOL },
      serverCluster: "devnet",
      nowMs: Date.now(),
      lookup: async () => ({ status: "verified", snapshot: migrated }),
      getExisting: async () => existing,
      usdcMints: USDC,
      verifyDamm: async () => null,
    });
    expect(r.ok && r.entry.status).toBe("graduated");
    expect(r.ok && r.entry.dammPool).toBeNull();
  });

  it("404 when not registered, 503 when RPC down", async () => {
    const base = {
      body: { pool: POOL },
      serverCluster: "devnet",
      nowMs: Date.now(),
      usdcMints: USDC,
    };
    expect(
      await refreshFromChain({ ...base, lookup: async () => ({ status: "verified", snapshot: snapshot() }), getExisting: async () => null }),
    ).toMatchObject({ ok: false, status: 404 });
    expect(
      await refreshFromChain({ ...base, lookup: async () => ({ status: "rpc_unavailable", error: "x" }), getExisting: async () => existing }),
    ).toMatchObject({ ok: false, status: 503 });
  });
});

import { coerceStoredLaunch, toPublicLaunch } from "@/lib/registry/normalize";

describe("registry verified flag", () => {
  it("chain-verified, creator-signed entries are verified: true", async () => {
    const kp = Keypair.generate();
    const r = await authorizeRegistration({ body: await signed(kp), ...deps(kp) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(toPublicLaunch(r.entry).verified).toBe(true);
  });

  it("legacy / unverified rows are verified: false", () => {
    const legacy = coerceStoredLaunch({
      pool: POOL,
      mint: MINT,
      config: Keypair.generate().publicKey.toBase58(),
      creator: Keypair.generate().publicKey.toBase58(),
      name: "Legacy",
      ticker: "LEG",
      status: "graduated",
    });
    expect(legacy).not.toBeNull();
    const pub = toPublicLaunch(legacy!);
    expect(pub.verified).toBe(false);
    expect(pub.status).toBe("unknown");
  });

  it("signer ≠ creator is never verified", async () => {
    const kp = Keypair.generate();
    const r = await authorizeRegistration({ body: await signed(kp), ...deps(kp) });
    if (!r.ok) throw new Error("setup");
    expect(toPublicLaunch({ ...r.entry, creator: Keypair.generate().publicKey.toBase58() }).verified).toBe(false);
  });
});

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildLaunchAuthMessage,
  canonicalJson,
  LAUNCH_AUTH_MAX_AGE_MS,
  signedLaunchBodySchema,
  verifyLaunchAuth,
} from "@/lib/auth/launchAuth";
import { payload, signed } from "./helpers";

describe("launch auth (ed25519 signMessage)", () => {
  it("canonicalJson is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { f: 1, e: 0 }] } })).toBe(
      canonicalJson({ a: { c: [1, { e: 0, f: 1 }], d: 2 }, b: 1 }),
    );
  });

  it("message binds cluster, pool, mint, signer and digest", () => {
    const kp = Keypair.generate();
    const msg = buildLaunchAuthMessage(payload(), kp.publicKey.toBase58(), "2026-09-26T00:00:00.000Z");
    expect(msg).toContain(payload().pool);
    expect(msg).toContain(payload().mint);
    expect(msg).toContain("devnet");
    expect(msg).toContain(kp.publicKey.toBase58());
  });

  it("verifies a genuine signature", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp);
    expect(signedLaunchBodySchema.safeParse(body).success).toBe(true);
    const r = verifyLaunchAuth(body, Date.now());
    expect(r.ok).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp);
    body.payload.profile!.name = "Evil Corp";
    const r = verifyLaunchAuth(body, Date.now());
    expect(r).toMatchObject({ ok: false, status: 401, code: "bad_signature" });
  });

  it("rejects a signature from a different wallet", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    const body = await signed(a);
    body.auth.signer = b.publicKey.toBase58();
    expect(verifyLaunchAuth(body, Date.now())).toMatchObject({ ok: false, code: "bad_signature" });
  });

  it("rejects expired and future-dated authorizations", async () => {
    const kp = Keypair.generate();
    const old = await signed(kp, {}, new Date(Date.now() - LAUNCH_AUTH_MAX_AGE_MS - 1000));
    expect(verifyLaunchAuth(old, Date.now())).toMatchObject({ ok: false, code: "expired" });
    const future = await signed(kp, {}, new Date(Date.now() + 10 * 60_000));
    expect(verifyLaunchAuth(future, Date.now())).toMatchObject({ ok: false, code: "issued_in_future" });
  });

  it("strict schema rejects smuggled fields (status, creator)", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp);
    expect(
      signedLaunchBodySchema.safeParse({ ...body, payload: { ...body.payload, status: "graduated" } }).success,
    ).toBe(false);
    expect(signedLaunchBodySchema.safeParse({ ...body, status: "graduated" }).success).toBe(false);
    expect(
      signedLaunchBodySchema.safeParse({
        ...body,
        payload: { ...body.payload, profile: { ...body.payload.profile, creator: "x" } },
      }).success,
    ).toBe(false);
  });
});

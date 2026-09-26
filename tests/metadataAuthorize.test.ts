import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { authorizeMetadataWrite } from "@/lib/metadata/authorize";
import type { ChainLookupResult } from "@/lib/registry/authorize";
import { MINT, signed, snapshot } from "./helpers";

function base(kp: Keypair) {
  return {
    id: MINT,
    serverCluster: "devnet",
    nowMs: Date.now(),
    existing: null,
    mintExists: async () => "missing" as const,
    lookup: async (): Promise<ChainLookupResult> => ({
      status: "verified",
      snapshot: snapshot({ creator: kp.publicKey.toBase58() }),
    }),
  };
}

describe("authorizeMetadataWrite", () => {
  it("pre-launch (mint not on chain): signer becomes owner", async () => {
    const kp = Keypair.generate();
    const r = await authorizeMetadataWrite({ ...base(kp), body: await signed(kp) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.record.owner).toBe(kp.publicKey.toBase58());
  });

  it("URL id must equal payload.mint", async () => {
    const kp = Keypair.generate();
    const r = await authorizeMetadataWrite({
      ...base(kp),
      id: Keypair.generate().publicKey.toBase58(),
      body: await signed(kp),
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });

  it("existing record owned by someone else → 403", async () => {
    const owner = Keypair.generate();
    const attacker = Keypair.generate();
    const first = await authorizeMetadataWrite({ ...base(owner), body: await signed(owner) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const r = await authorizeMetadataWrite({
      ...base(owner),
      existing: first.record,
      body: await signed(attacker, {
        metadata: { name: "Evil", symbol: "EVIL", description: "rug", image: "" },
      }),
    });
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("mint exists on-chain → only the on-chain creator may write", async () => {
    const creator = Keypair.generate();
    const other = Keypair.generate();
    const deps = { ...base(creator), mintExists: async () => "exists" as const };
    expect((await authorizeMetadataWrite({ ...deps, body: await signed(creator) })).ok).toBe(true);
    expect(await authorizeMetadataWrite({ ...deps, body: await signed(other) })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("RPC unknown → 503 (never silently allowed)", async () => {
    const kp = Keypair.generate();
    const r = await authorizeMetadataWrite({
      ...base(kp),
      mintExists: async () => "unknown" as const,
      body: await signed(kp),
    });
    expect(r).toMatchObject({ ok: false, status: 503 });
  });

  it("rejects non-https image URLs", async () => {
    const kp = Keypair.generate();
    const r = await authorizeMetadataWrite({
      ...base(kp),
      body: await signed(kp, {
        metadata: { name: "Acme", symbol: "ACME", description: "x", image: "javascript:alert(1)" },
      }),
    });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

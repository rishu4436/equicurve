import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { authorizeMetadataWrite } from "@/lib/metadata/authorize";
import { checkImageUrl, isPrivateHost, precheckImageUrl } from "@/lib/metadata/imageCheck";
import type { ChainLookupResult } from "@/lib/registry/authorize";
import { MINT, signed, snapshot } from "./helpers";

function deps(kp: Keypair) {
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

const later = (ms: number) => new Date(Date.now() + ms);

describe("metadata edit policy", () => {
  it("identity (name/symbol) is immutable; description/image/links are editable via signed update", async () => {
    const kp = Keypair.generate();
    const first = await authorizeMetadataWrite({ ...deps(kp), body: await signed(kp) });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const rename = await authorizeMetadataWrite({
      ...deps(kp),
      existing: first.record,
      nowMs: Date.now() + 2000,
      body: await signed(
        kp,
        { action: "update", metadata: { name: "Renamed", symbol: "ACME", description: "x", image: "" } },
        later(1000),
      ),
    });
    expect(rename).toMatchObject({ ok: false, status: 409, code: "identity_immutable" });

    const edit = await authorizeMetadataWrite({
      ...deps(kp),
      existing: first.record,
      nowMs: Date.now() + 2000,
      checkImage: async () => ({ ok: true, contentType: "image/png", bytes: 1000, finalUrl: "https://x.test/a.png" }),
      body: await signed(
        kp,
        {
          action: "update",
          metadata: {
            name: "Acme Robotics",
            symbol: "ACME",
            description: "Updated description",
            image: "https://cdn.example.com/logo.png",
            external_url: "https://acme.example.com",
          },
        },
        later(1000),
      ),
    });
    expect(edit.ok).toBe(true);
    if (edit.ok) expect(edit.record.meta.description).toBe("Updated description");
  });

  it("update without an existing record is rejected", async () => {
    const kp = Keypair.generate();
    const r = await authorizeMetadataWrite({ ...deps(kp), body: await signed(kp, { action: "update" }) });
    expect(r).toMatchObject({ ok: false, code: "no_record" });
  });

  it("failed image check → 422", async () => {
    const kp = Keypair.generate();
    const r = await authorizeMetadataWrite({
      ...deps(kp),
      checkImage: async () => ({ ok: false, code: "bad_type", error: "Image must be png" }),
      body: await signed(kp, {
        metadata: { name: "Acme Robotics", symbol: "ACME", description: "x", image: "https://example.com/a.html" },
      }),
    });
    expect(r).toMatchObject({ ok: false, status: 422, code: "image_bad_type" });
  });
});

describe("image URL check", () => {
  const res = (status: number, headers: Record<string, string>) => new Response(null, { status, headers });

  it("static guards: https only, no private hosts, no credentials", () => {
    expect(precheckImageUrl("http://example.com/a.png")).toMatchObject({ code: "not_https" });
    expect(precheckImageUrl("https://127.0.0.1/a.png")).toMatchObject({ code: "private_host" });
    expect(precheckImageUrl("https://localhost/a.png")).toMatchObject({ code: "private_host" });
    expect(precheckImageUrl("https://u:p@example.com/a.png")).toMatchObject({ code: "invalid_url" });
    expect(precheckImageUrl("https://example.com/a.png")).toBeNull();
    expect(isPrivateHost("192.168.1.2")).toBe(true);
    expect(isPrivateHost("172.20.0.1")).toBe(true);
    expect(isPrivateHost("8.8.8.8")).toBe(false);
  });

  it("accepts png under 2 MB via HEAD", async () => {
    const r = await checkImageUrl("https://cdn.example.com/a.png", {
      fetchImpl: async () => res(200, { "content-type": "image/png", "content-length": "12345" }),
    });
    expect(r).toMatchObject({ ok: true, contentType: "image/png", bytes: 12345 });
  });

  it("rejects wrong type, too large, bad status", async () => {
    expect(
      await checkImageUrl("https://e.com/a", { fetchImpl: async () => res(200, { "content-type": "text/html" }) }),
    ).toMatchObject({ ok: false, code: "bad_type" });
    expect(
      await checkImageUrl("https://e.com/a", {
        fetchImpl: async () => res(200, { "content-type": "image/jpeg", "content-length": String(5 * 1024 * 1024) }),
      }),
    ).toMatchObject({ ok: false, code: "too_large" });
    expect(await checkImageUrl("https://e.com/a", { fetchImpl: async () => res(404, {}) })).toMatchObject({
      ok: false,
      code: "bad_status",
    });
  });

  it("falls back to ranged GET when HEAD is refused and reads size from Content-Range", async () => {
    const calls: string[] = [];
    const r = await checkImageUrl("https://e.com/a.webp", {
      fetchImpl: async (_u, init) => {
        calls.push(String(init.method));
        return init.method === "HEAD"
          ? res(405, {})
          : res(206, { "content-type": "image/webp", "content-range": "bytes 0-0/2048" });
      },
    });
    expect(calls).toEqual(["HEAD", "GET"]);
    expect(r).toMatchObject({ ok: true, bytes: 2048 });
  });

  it("does not follow redirects to private hosts; DNS rebinding guard", async () => {
    expect(
      await checkImageUrl("https://e.com/a.png", {
        fetchImpl: async () => res(302, { location: "https://10.0.0.5/x.png" }),
      }),
    ).toMatchObject({ ok: false, code: "private_host" });
    expect(
      await checkImageUrl("https://evil.example/a.png", {
        resolveHost: async () => ["127.0.0.1"],
        fetchImpl: async () => res(200, { "content-type": "image/png" }),
      }),
    ).toMatchObject({ ok: false, code: "private_host" });
  });
});

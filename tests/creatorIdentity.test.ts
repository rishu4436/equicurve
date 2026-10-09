import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { launchProfileSchema, normalizeXProfile, optionalHttpsUrlSchema, optionalXProfileSchema, validateWizard } from "@/lib/validation";
import { authorizeRegistration, type ChainLookupResult } from "@/lib/registry/authorize";
import { getTokenImageStore, isTokenImageKey, TokenImageStorageConfigError } from "@/lib/uploads/tokenImageStore";
import { signed, snapshot } from "./helpers";

describe("creator X profile validation", () => {
  it("accepts x.com and canonicalizes twitter.com", () => {
    expect(normalizeXProfile("https://x.com/equi_curve")).toBe("https://x.com/equi_curve");
    expect(normalizeXProfile("https://twitter.com/equi_curve")).toBe("https://x.com/equi_curve");
    expect(optionalXProfileSchema.safeParse("https://x.com/equi_curve").success).toBe(true);
  });

  it.each([
    "http://x.com/equicurve",
    "https://x.com.example.com/equicurve",
    "https://x.com/equicurve/status/1",
    "https://x.com/equicurve?ref=spam",
    "https://x.com/a-user",
    "https://x.com/this_handle_is_too_long",
    "https://user:pass@x.com/equicurve",
    "javascript:alert(1)",
    "data:text/plain,x",
  ])("rejects unsafe or unsupported profile URL %s", (value) => {
    expect(normalizeXProfile(value)).toBeNull();
    expect(optionalXProfileSchema.safeParse(value).success).toBe(false);
  });

  it("validates X through the same wizard schema as the server", () => {
    const errors = validateWizard({
      name: "Acme Robotics",
      ticker: "ACME",
      thesis: "Tokenized exposure to a robotics issuer.",
      sector: "Equity",
      website: "",
      xProfile: "https://x.com/example",
      uri: "",
      image: "",
      raiseTarget: 100,
      quote: "SOL",
      seedBuy: "0",
      presetId: "short",
      feeIssuer: 70,
      lpLockPct: 100,
      feeClaimer: "",
      totalSupply: 1_000_000,
    });
    expect(errors.xProfile).toBeUndefined();
  });

  it("keeps legacy profiles valid while rejecting unknown or unsafe fields", () => {
    const legacy = launchProfileSchema.safeParse({
      name: "Acme Robotics",
      ticker: "ACME",
      thesis: "Tokenized exposure to a robotics issuer.",
      sector: "Equity",
      presetId: "short",
      raiseTarget: 100,
    });
    expect(legacy.success).toBe(true);
    expect(launchProfileSchema.safeParse({
      name: "Acme Robotics",
      ticker: "ACME",
      thesis: "Tokenized exposure to a robotics issuer.",
      sector: "Equity",
      presetId: "short",
      raiseTarget: 100,
      xProfile: "javascript:alert(1)",
    }).success).toBe(false);
    expect(launchProfileSchema.safeParse({
      name: "Acme Robotics",
      ticker: "ACME",
      thesis: "Tokenized exposure to a robotics issuer.",
      sector: "Equity",
      presetId: "short",
      raiseTarget: 100,
      unexpected: "injected",
    }).success).toBe(false);
  });

  it("keeps website links HTTPS-only and rejects script-like schemes", () => {
    expect(optionalHttpsUrlSchema.safeParse("https://example.com/project").success).toBe(true);
    expect(optionalHttpsUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(optionalHttpsUrlSchema.safeParse("data:text/html,<script>alert(1)</script>").success).toBe(false);
    expect(optionalHttpsUrlSchema.safeParse("https://user:pass@example.com/project").success).toBe(false);
  });
});

describe("signed X profile binding", () => {
  function deps(kp: Keypair) {
    const lookup = async (): Promise<ChainLookupResult> => ({
      status: "verified",
      snapshot: snapshot({ creator: kp.publicKey.toBase58() }),
    });
    return { serverCluster: "devnet", nowMs: Date.now(), lookup, getExisting: async () => null, usdcMints: [] };
  }

  it("persists the canonical X URL only from the signed profile", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp, { profile: { ...((await signed(kp)).payload.profile!), xProfile: "https://twitter.com/equicurve" } });
    const result = await authorizeRegistration({ body, ...deps(kp) });
    expect(result.ok && result.entry.xProfile).toBe("https://x.com/equicurve");
  });

  it("rejects profile tampering after signing", async () => {
    const kp = Keypair.generate();
    const body = await signed(kp, { profile: { ...((await signed(kp)).payload.profile!), xProfile: "https://x.com/equicurve" } });
    body.payload.profile!.xProfile = "https://x.com/attacker";
    await expect(authorizeRegistration({ body, ...deps(kp) })).resolves.toMatchObject({ ok: false, status: 401 });
  });
});

describe("direct token image upload", () => {
  async function post(bytes: Buffer, type: string, name = "token.png", ip = Math.random().toString()) {
    const form = new FormData();
    form.append("file", new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], name, { type }));
    return (await import("@/app/api/uploads/token-image/route")).POST(
      new Request("https://equicurve.test/api/uploads/token-image", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
        body: form,
      }),
    );
  }

  it("accepts a valid square PNG and returns a bounded public URL", async () => {
    const bytes = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#1b263b" } }).png().toBuffer();
    const response = await post(bytes, "image/png");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, width: 512, height: 512, contentType: "image/png" });
    expect(body.url).toMatch(/^\/uploads\/token-images\/[a-f0-9-]{36}\.png$/);
  });

  it.each([
    ["jpeg", "image/jpeg"],
    ["webp", "image/webp"],
    ["avif", "image/avif"],
  ] as const)("accepts %s", async (format, contentType) => {
    const bytes = await sharp({ create: { width: 256, height: 256, channels: 4, background: "#1b263b" } })[format]().toBuffer();
    const response = await post(bytes, contentType, `token.${format}`);
    expect(response.status).toBe(200);
  });

  it("rejects fake MIME, malformed bytes, SVG and non-square images", async () => {
    const square = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#1b263b" } }).png().toBuffer();
    const wide = await sharp({ create: { width: 512, height: 256, channels: 4, background: "#1b263b" } }).png().toBuffer();
    expect((await post(square, "image/jpeg")).status).toBe(415);
    expect((await post(Buffer.from("not an image"), "image/png")).status).toBe(422);
    expect((await post(Buffer.from("<svg></svg>"), "image/svg+xml")).status).toBe(415);
    expect((await post(wide, "image/png")).status).toBe(422);
  });

  it("rejects empty and oversized-dimension payloads", async () => {
    expect((await post(Buffer.alloc(0), "image/png")).status).toBe(400);
    const tooLarge = await sharp({ create: { width: 2_049, height: 2_049, channels: 4, background: "#1b263b" } }).png().toBuffer();
    expect((await post(tooLarge, "image/png", "too-large.png")).status).toBe(422);
  });

  it("does not use the client filename as a storage path", async () => {
    const bytes = await sharp({ create: { width: 256, height: 256, channels: 4, background: "#1b263b" } }).png().toBuffer();
    const response = await post(bytes, "image/png", "../../../../private-key.png");
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.url).toMatch(/^\/uploads\/token-images\/[a-f0-9-]{36}\.png$/);
    expect(isTokenImageKey(body.url.split("/").at(-1))).toBe(true);
  });

  it("requires exactly one file in multipart form data", async () => {
    const bytes = await sharp({ create: { width: 256, height: 256, channels: 4, background: "#1b263b" } }).png().toBuffer();
    const form = new FormData();
    const file = new File([bytes], "one.png", { type: "image/png" });
    form.append("file", file);
    form.append("file", file);
    const response = await (await import("@/app/api/uploads/token-image/route")).POST(new Request("https://equicurve.test/api/uploads/token-image", { method: "POST", headers: { "x-forwarded-for": `multi-${Math.random()}` }, body: form }));
    expect(response.status).toBe(400);
  });

  it("rejects too-small and oversized payloads before storage", async () => {
    const small = await sharp({ create: { width: 128, height: 128, channels: 4, background: "#1b263b" } }).png().toBuffer();
    expect((await post(small, "image/png")).status).toBe(422);
    expect((await post(Buffer.alloc(1_000_001), "image/png")).status).toBe(413);
  });

  it("fails closed in production until a durable backend is configured", () => {
    const env = process.env as Record<string, string | undefined>;
    const before = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(() => getTokenImageStore()).toThrow(TokenImageStorageConfigError);
    } finally {
      if (before === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = before;
    }
  });

  it("bounds upload attempts at ten per ten minutes per client", async () => {
    const ip = `rate-${Math.random()}`;
    for (let i = 0; i < 10; i++) expect((await post(Buffer.from("bad"), "image/png", "bad.png", ip)).status).toBe(422);
    expect((await post(Buffer.from("bad"), "image/png", "bad.png", ip)).status).toBe(429);
  });
});

describe("creator identity rendering contracts", () => {
  it("uses safe new-tab links and keeps X out of Metaplex external_url", () => {
    const offering = readFileSync(resolve(process.cwd(), "src/components/offering/OfferingDetailClient.tsx"), "utf8");
    const preview = readFileSync(resolve(process.cwd(), "src/components/create/OfferingPreviewCard.tsx"), "utf8");
    expect(offering).toContain('target="_blank" rel="noopener noreferrer"');
    expect(offering).toContain("Website ↗");
    expect(offering).toContain("X ↗");
    expect(preview).toContain("Website ↗");
    expect(preview).toContain("X ↗");
    expect(readFileSync(resolve(process.cwd(), "src/components/create/CreateWizard.tsx"), "utf8")).not.toContain("external_url: xProfile");
  });
});

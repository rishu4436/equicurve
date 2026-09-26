import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  isHttpsUrl,
  isOnCurvePublicKey,
  isValidPublicKey,
  nameSchema,
  symbolSchema,
  validateSeedBuy,
  validateWizard,
} from "@/lib/validation";

const good = {
  name: "Acme Robotics",
  ticker: "ACME",
  thesis: "Tokenized exposure to a robotics issuer.",
  sector: "Equity",
  website: "",
  uri: "",
  raiseTarget: 100000,
  quote: "SOL" as const,
  seedBuy: "0",
  presetId: "short",
  feeIssuer: 70,
  lpLockPct: 100,
  feeClaimer: "",
  totalSupply: 1_000_000_000,
};

describe("schemas", () => {
  it("names: unicode ok, control / bidi chars rejected", () => {
    expect(nameSchema.safeParse("Société Générale 2").success).toBe(true);
    expect(nameSchema.safeParse("A").success).toBe(false);
    expect(nameSchema.safeParse("Evil\u202Egnp.exe").success).toBe(false);
    expect(nameSchema.safeParse("Bad\u0000Name").success).toBe(false);
    expect(nameSchema.safeParse("x".repeat(49)).success).toBe(false);
  });

  it("symbols: 2–8 uppercase alnum", () => {
    expect(symbolSchema.safeParse("ACME").success).toBe(true);
    expect(symbolSchema.safeParse("acme").success).toBe(false);
    expect(symbolSchema.safeParse("A").success).toBe(false);
    expect(symbolSchema.safeParse("TOOLONGSYM").success).toBe(false);
    expect(symbolSchema.safeParse("AC-ME").success).toBe(false);
  });

  it("https only", () => {
    expect(isHttpsUrl("https://example.com/x.json")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpsUrl("data:application/json,{}")).toBe(false);
  });

  it("public keys: valid vs on-curve wallet", () => {
    const wallet = Keypair.generate().publicKey.toBase58();
    expect(isValidPublicKey(wallet)).toBe(true);
    expect(isOnCurvePublicKey(wallet)).toBe(true);
    expect(isValidPublicKey("not-a-key")).toBe(false);
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("x")], new PublicKey(wallet));
    expect(isValidPublicKey(pda.toBase58())).toBe(true);
    expect(isOnCurvePublicKey(pda.toBase58())).toBe(false);
  });
});

describe("validateSeedBuy", () => {
  it("allows blank / zero", () => {
    expect(validateSeedBuy("", "SOL")).toBeUndefined();
    expect(validateSeedBuy("0", "USDC")).toBeUndefined();
    expect(validateSeedBuy("0.00", "SOL")).toBeUndefined();
  });
  it("enforces quote decimals", () => {
    expect(validateSeedBuy("0.000000001", "SOL")).toBeUndefined();
    expect(validateSeedBuy("0.0000001", "USDC")).toMatch(/at most 6/);
    expect(validateSeedBuy("-1", "SOL")).toBeTruthy();
    expect(validateSeedBuy("1e3", "SOL")).toBeTruthy();
  });
});

describe("validateWizard", () => {
  it("passes a good state", () => {
    expect(validateWizard(good)).toEqual({});
  });
  it("flags each bad field", () => {
    const e = validateWizard({
      ...good,
      name: "",
      ticker: "x",
      website: "http://insecure.example",
      uri: "ftp://x",
      lpLockPct: 5,
      feeIssuer: 101,
      feeClaimer: "nope",
      seedBuy: "1.0000000001",
    });
    for (const k of ["name", "ticker", "website", "uri", "lpLockPct", "feeIssuer", "feeClaimer", "seedBuy"]) {
      expect(e, k).toHaveProperty(k);
    }
  });
});

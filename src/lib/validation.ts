/**
 * Shared input validation (server routes + Create wizard).
 * Pure / isomorphic — safe to import from client and server code.
 */
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { AmountError, parseUiAmount } from "./amounts";

export const SECTORS = ["Equity", "RWA", "Fund", "Private Co", "Other"] as const;
export const PRESET_IDS = ["flat", "exponential", "long", "equity", "short"] as const;
export const QUOTES = ["SOL", "USDC"] as const;
export const CLUSTERS = ["devnet", "mainnet-beta", "testnet"] as const;

export const LIMITS = {
  nameMin: 2,
  nameMax: 48,
  symbolMin: 2,
  symbolMax: 8,
  thesisMin: 8,
  thesisMax: 140,
  descriptionMax: 500,
  urlMax: 200,
  raiseTargetMax: 1_000_000_000_000,
  totalSupplyMin: 1_000_000,
  totalSupplyMax: 10_000_000_000,
  lpLockMin: 10,
  seedBuyMaxWhole: 100_000n,
} as const;

/* ------------------------------------------------------------------ keys */

export function parsePublicKey(value: unknown): PublicKey | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  // base58, 32–44 chars; PublicKey ctor also enforces 32 bytes
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return null;
  try {
    const pk = new PublicKey(s);
    return pk.toBase58() === s ? pk : null;
  } catch {
    return null;
  }
}

export function isValidPublicKey(value: unknown): value is string {
  return parsePublicKey(value) !== null;
}

/** Wallet-style key (ed25519 point on curve) — PDAs are off-curve. */
export function isOnCurvePublicKey(value: unknown): value is string {
  const pk = parsePublicKey(value);
  return !!pk && PublicKey.isOnCurve(pk.toBytes());
}

/** Any valid address (pool / mint / config / PDA). */
export const addressSchema = z
  .string()
  .trim()
  .refine(isValidPublicKey, { message: "Not a valid Solana address" });

/** Signer-capable wallet address (must be on the ed25519 curve). */
export const walletSchema = z
  .string()
  .trim()
  .refine(isOnCurvePublicKey, {
    message: "Not a valid wallet address (must be an on-curve public key)",
  });

/* --------------------------------------------------------------- strings */

// Control chars, zero-width & bidi overrides are rejected everywhere.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;

function noControl(s: string): boolean {
  return !FORBIDDEN_CHARS.test(s);
}

/** Letters (any script), digits, spaces and a small punctuation set. */
const NAME_RE = /^[\p{L}\p{N} .,&'()\-_/+:]+$/u;

export const nameSchema = z
  .string()
  .trim()
  .min(LIMITS.nameMin, `Name must be at least ${LIMITS.nameMin} characters`)
  .max(LIMITS.nameMax, `Name must be at most ${LIMITS.nameMax} characters`)
  .refine(noControl, "Name contains invalid characters")
  .refine((s) => NAME_RE.test(s), "Name may only use letters, numbers, spaces and . , & ' ( ) - _ / + :");

export const symbolSchema = z
  .string()
  .trim()
  .regex(
    new RegExp(`^[A-Z0-9]{${LIMITS.symbolMin},${LIMITS.symbolMax}}$`),
    `Ticker must be ${LIMITS.symbolMin}–${LIMITS.symbolMax} uppercase letters or digits`,
  );

export const thesisSchema = z
  .string()
  .trim()
  .min(LIMITS.thesisMin, `Thesis must be at least ${LIMITS.thesisMin} characters`)
  .max(LIMITS.thesisMax, `Thesis must be at most ${LIMITS.thesisMax} characters`)
  .refine(noControl, "Thesis contains invalid characters");

export const descriptionSchema = z
  .string()
  .trim()
  .max(LIMITS.descriptionMax, `Description must be at most ${LIMITS.descriptionMax} characters`)
  .refine(noControl, "Description contains invalid characters");

export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s || s.length > LIMITS.urlMax || !noControl(s)) return false;
  try {
    const u = new URL(s);
    return (
      u.protocol === "https:" &&
      !!u.hostname &&
      u.hostname.includes(".") &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}

export const httpsUrlSchema = z
  .string()
  .trim()
  .refine(isHttpsUrl, `Must be an https:// URL (max ${LIMITS.urlMax} chars)`);

/** Empty string allowed (optional field), otherwise https URL. */
export const optionalHttpsUrlSchema = z
  .string()
  .trim()
  .refine((s) => s === "" || isHttpsUrl(s), `Must be empty or an https:// URL (max ${LIMITS.urlMax} chars)`);

/* --------------------------------------------------------------- numbers */

export const raiseTargetSchema = z
  .number()
  .int("Raise target must be a whole number")
  .min(1, "Raise target must be at least 1")
  .max(LIMITS.raiseTargetMax, "Raise target is too large");

export const pctSchema = z.number().int().min(0).max(100);
export const lpLockSchema = z.number().int().min(LIMITS.lpLockMin).max(100);

/* ---------------------------------------------------------- composites */

export const sectorSchema = z.enum(SECTORS);
export const presetIdSchema = z.enum(PRESET_IDS);
export const quoteSchema = z.enum(QUOTES);
export const clusterSchema = z.enum(CLUSTERS);

/** Off-chain, creator-authored descriptive profile stored in the registry. */
export const launchProfileSchema = z
  .object({
    name: nameSchema,
    ticker: symbolSchema,
    thesis: thesisSchema,
    sector: sectorSchema,
    presetId: presetIdSchema,
    raiseTarget: raiseTargetSchema,
    website: optionalHttpsUrlSchema.optional(),
  })
  .strict();

export type LaunchProfile = z.infer<typeof launchProfileSchema>;

/** Hosted token metadata JSON (Metaplex-style off-chain JSON). */
export const tokenMetadataSchema = z
  .object({
    name: nameSchema,
    symbol: symbolSchema,
    description: descriptionSchema,
    image: optionalHttpsUrlSchema,
    external_url: optionalHttpsUrlSchema.optional(),
  })
  .strict();

export type TokenMetadataInput = z.infer<typeof tokenMetadataSchema>;

/** First zod issue as a short message. */
export function firstIssue(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return "Invalid input";
  const path = i.path.length ? `${i.path.join(".")}: ` : "";
  return `${path}${i.message}`;
}

/* ------------------------------------------------------------ wizard */

export type WizardValidationInput = {
  name: string;
  ticker: string;
  thesis: string;
  sector: string;
  website: string;
  uri: string;
  /** Token image URL (optional, https). */
  image?: string;
  raiseTarget: number;
  quote: "SOL" | "USDC";
  seedBuy: string;
  presetId: string;
  feeIssuer: number;
  lpLockPct: number;
  feeClaimer: string;
  totalSupply: number;
};

export type FieldErrors = Partial<Record<keyof WizardValidationInput, string>>;

function check<T>(schema: z.ZodType<T>, value: unknown): string | undefined {
  const r = schema.safeParse(value);
  return r.success ? undefined : (r.error.issues[0]?.message ?? "Invalid");
}

/** Validate seed-buy amount string for the chosen quote (exact decimals). */
export function validateSeedBuy(value: string, quote: "SOL" | "USDC"): string | undefined {
  const s = (value ?? "").trim();
  if (s === "" || /^0*(\.0*)?$/.test(s)) return undefined; // 0 / blank = no seed buy
  try {
    parseUiAmount(s, quote === "USDC" ? 6 : 9, {
      max: LIMITS.seedBuyMaxWhole * 10n ** BigInt(quote === "USDC" ? 6 : 9),
    });
    return undefined;
  } catch (e) {
    return e instanceof AmountError ? e.message : "Invalid amount";
  }
}

/** Custom metadata URI override: blank or https only. */
export function validateMetadataUriOverride(value: string): string | undefined {
  const s = (value ?? "").trim();
  if (!s) return undefined;
  return isHttpsUrl(s) ? undefined : "Metadata URI override must be an https:// URL";
}

export function validateWizard(s: WizardValidationInput): FieldErrors {
  const e: FieldErrors = {};
  e.name = check(nameSchema, s.name);
  e.ticker = check(symbolSchema, s.ticker);
  e.thesis = check(thesisSchema, s.thesis);
  e.sector = check(sectorSchema, s.sector);
  e.website = check(optionalHttpsUrlSchema, s.website);
  e.uri = validateMetadataUriOverride(s.uri);
  e.image = check(optionalHttpsUrlSchema, s.image ?? "");
  e.raiseTarget = check(raiseTargetSchema, s.raiseTarget);
  e.quote = check(quoteSchema, s.quote);
  e.seedBuy = validateSeedBuy(s.seedBuy, s.quote);
  e.presetId = check(presetIdSchema, s.presetId);
  e.feeIssuer = check(pctSchema, s.feeIssuer);
  e.lpLockPct = check(lpLockSchema, s.lpLockPct);
  e.feeClaimer =
    s.feeClaimer.trim() === "" ? undefined : check(walletSchema, s.feeClaimer);
  e.totalSupply = check(
    z.number().int().min(LIMITS.totalSupplyMin).max(LIMITS.totalSupplyMax),
    s.totalSupply,
  );
  for (const k of Object.keys(e) as (keyof FieldErrors)[]) {
    if (!e[k]) delete e[k];
  }
  return e;
}

/**
 * Exact token amount conversion. All on-chain amounts are integers in the
 * token's smallest unit ("atoms": lamports for SOL, 1e-6 for USDC, …).
 *
 * Rules:
 * - Parsing user input goes string → bigint with NO floating point.
 * - More fractional digits than the token supports is rejected (never silently
 *   rounded), so what the user typed is exactly what is sent.
 * - Display formatting may round, but only on the string side.
 */
import BN from "bn.js";

export const SOL_DECIMALS = 9;
export const USDC_DECIMALS = 6;
export const U64_MAX = (1n << 64n) - 1n;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new AmountError(`Unsupported token decimals: ${decimals}`);
  }
}

const UI_AMOUNT_RE = /^(\d+)(?:\.(\d*))?$|^\.(\d+)$/;

/**
 * Parse a user-entered decimal string into integer atoms.
 * Accepts "1", "1.5", "0.000001", ".5", "1,000.25" (commas stripped).
 * Rejects negatives, exponents, NaN, empty, too many decimals, > u64.
 */
export function parseUiAmount(
  input: string,
  decimals: number,
  opts: { allowZero?: boolean; max?: bigint } = {},
): bigint {
  assertDecimals(decimals);
  if (typeof input !== "string") {
    throw new AmountError("Amount must be a string.");
  }
  const s = input.trim().replace(/[,_\s]/g, "");
  if (!s) throw new AmountError("Enter an amount.");
  const m = UI_AMOUNT_RE.exec(s);
  if (!m) throw new AmountError("Enter a plain decimal number (e.g. 1.25).");
  const whole = m[1] ?? "0";
  const frac = m[2] ?? m[3] ?? "";
  if (frac.length > decimals) {
    throw new AmountError(
      `Too many decimal places — this token supports at most ${decimals}.`,
    );
  }
  const atoms =
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt((frac || "").padEnd(decimals, "0") || "0");
  if (!opts.allowZero && atoms === 0n) {
    throw new AmountError("Amount must be greater than zero.");
  }
  const max = opts.max ?? U64_MAX;
  if (atoms > max) {
    throw new AmountError("Amount is too large.");
  }
  return atoms;
}

/** Same as parseUiAmount but returns a BN for SDK calls. */
export function parseUiAmountToBN(
  input: string,
  decimals: number,
  opts?: { allowZero?: boolean; max?: bigint },
): BN {
  return new BN(parseUiAmount(input, decimals, opts).toString(10));
}

/** Coerce bigint | BN | decimal-integer string | safe integer number to bigint. */
export function toAtoms(value: bigint | BN | string | number): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new AmountError("Non-integer or unsafe number used as atoms.");
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!/^-?\d+$/.test(s)) throw new AmountError(`Invalid atom string: ${value}`);
    return BigInt(s);
  }
  if (BN.isBN(value)) return BigInt(value.toString(10));
  throw new AmountError("Unsupported amount type.");
}

export function atomsToBN(value: bigint | string | BN): BN {
  return new BN(toAtoms(value).toString(10));
}

/**
 * Exact atoms → decimal string (no rounding, trailing zeros trimmed).
 * formatAtomsExact(1500000000n, 9) === "1.5"
 */
export function formatAtomsExact(
  value: bigint | BN | string | number,
  decimals: number,
): string {
  assertDecimals(decimals);
  const atoms = toAtoms(value);
  const neg = atoms < 0n;
  const abs = neg ? -atoms : atoms;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  let out = whole.toString(10);
  if (decimals > 0 && frac > 0n) {
    out += "." + frac.toString(10).padStart(decimals, "0").replace(/0+$/, "");
  }
  return neg ? `-${out}` : out;
}

/**
 * Display formatting: rounds half-up to `maxFractionDigits` on the string
 * side (no float), adds thousands separators to the whole part.
 */
export function formatAtoms(
  value: bigint | BN | string | number,
  decimals: number,
  maxFractionDigits = 6,
): string {
  assertDecimals(decimals);
  const atoms = toAtoms(value);
  const neg = atoms < 0n;
  let abs = neg ? -atoms : atoms;
  const keep = Math.max(0, Math.min(decimals, maxFractionDigits));
  const drop = decimals - keep;
  if (drop > 0) {
    const div = 10n ** BigInt(drop);
    const rem = abs % div;
    abs = abs / div + (rem * 2n >= div ? 1n : 0n);
  }
  const base = 10n ** BigInt(keep);
  const whole = (abs / base).toString(10).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac =
    keep > 0 ? (abs % base).toString(10).padStart(keep, "0").replace(/0+$/, "") : "";
  const out = frac ? `${whole}.${frac}` : whole;
  return neg && out !== "0" ? `-${out}` : out;
}

/** Format with a quote label (SOL 9 / USDC 6). */
export function formatQuoteAtoms(
  value: bigint | BN | string | number,
  quote: "SOL" | "USDC",
  maxFractionDigits?: number,
): string {
  const decimals = quote === "USDC" ? USDC_DECIMALS : SOL_DECIMALS;
  return `${formatAtoms(value, decimals, maxFractionDigits ?? (quote === "USDC" ? 4 : 6))} ${quote}`;
}

/** Safe variant for UI: returns fallback instead of throwing. */
export function tryFormatAtoms(
  value: bigint | BN | string | number | null | undefined,
  decimals: number,
  maxFractionDigits = 6,
  fallback = "—",
): string {
  if (value == null) return fallback;
  try {
    return formatAtoms(value, decimals, maxFractionDigits);
  } catch {
    return fallback;
  }
}

/**
 * Exact ratio numerator/denominator as a number in [0, 1] with 1e-6 precision
 * (bigint math, then a single safe conversion). Returns null if denominator ≤ 0.
 */
export function ratioClamped(
  numerator: bigint | BN | string,
  denominator: bigint | BN | string,
): number | null {
  const n = toAtoms(numerator);
  const d = toAtoms(denominator);
  if (d <= 0n) return null;
  if (n <= 0n) return 0;
  if (n >= d) return 1;
  return Number((n * 1_000_000n) / d) / 1_000_000;
}

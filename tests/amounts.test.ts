import BN from "bn.js";
import { describe, expect, it } from "vitest";
import {
  AmountError,
  formatAtoms,
  formatAtomsExact,
  formatQuoteAtoms,
  parseUiAmount,
  parseUiAmountToBN,
  ratioClamped,
  toAtoms,
  tryFormatAtoms,
  U64_MAX,
} from "@/lib/amounts";

describe("parseUiAmount", () => {
  it("parses exact decimals for 9 and 6 decimal tokens (no float drift)", () => {
    expect(parseUiAmount("1", 9)).toBe(1_000_000_000n);
    expect(parseUiAmount("0.1", 9)).toBe(100_000_000n);
    expect(parseUiAmount("0.3", 9)).toBe(300_000_000n); // 0.1+0.2 float trap
    expect(parseUiAmount("1.000000001", 9)).toBe(1_000_000_001n);
    expect(parseUiAmount("1.5", 6)).toBe(1_500_000n);
    expect(parseUiAmount("0.000001", 6)).toBe(1n);
    expect(parseUiAmount(".5", 6)).toBe(500_000n);
    expect(parseUiAmount("1,000.25", 6)).toBe(1_000_250_000n);
    // A value where Math.round(x * 10**d) historically goes wrong:
    expect(parseUiAmount("1.005", 9)).toBe(1_005_000_000n);
    expect(parseUiAmount("4.35", 6)).toBe(4_350_000n);
  });

  it("round-trips through formatAtomsExact", () => {
    for (const [s, d] of [
      ["123.456789", 6],
      ["0.000000001", 9],
      ["18446744073.709551615", 9],
      ["42", 0],
    ] as const) {
      expect(formatAtomsExact(parseUiAmount(s, d), d)).toBe(s);
    }
  });

  it("rejects too many decimals instead of rounding", () => {
    expect(() => parseUiAmount("0.0000001", 6)).toThrow(/at most 6/);
    expect(() => parseUiAmount("1.0000000001", 9)).toThrow(AmountError);
  });

  it("rejects invalid input", () => {
    for (const bad of ["", "  ", "-1", "1e9", "abc", "1.2.3", "NaN", "Infinity", "0x10", "+1"]) {
      expect(() => parseUiAmount(bad, 9), bad).toThrow(AmountError);
    }
  });

  it("rejects zero unless allowed", () => {
    expect(() => parseUiAmount("0", 9)).toThrow(/greater than zero/);
    expect(parseUiAmount("0.0", 9, { allowZero: true })).toBe(0n);
  });

  it("enforces u64 and custom max", () => {
    expect(parseUiAmount("18446744073709551615", 0)).toBe(U64_MAX);
    expect(() => parseUiAmount("18446744073709551616", 0)).toThrow(/too large/);
    expect(() => parseUiAmount("18446744074", 9)).toThrow(/too large/);
    expect(() => parseUiAmount("11", 0, { max: 10n })).toThrow(/too large/);
  });

  it("returns BN for SDK calls", () => {
    const bn = parseUiAmountToBN("2.5", 9);
    expect(BN.isBN(bn)).toBe(true);
    expect(bn.toString()).toBe("2500000000");
  });
});

describe("formatting", () => {
  it("formats with string-side half-up rounding and separators", () => {
    expect(formatAtoms(1_234_567_890_123n, 9, 4)).toBe("1,234.5679");
    expect(formatAtoms("1500000", 6)).toBe("1.5");
    expect(formatAtoms(new BN("999999999"), 9, 2)).toBe("1");
    expect(formatAtoms(0n, 9)).toBe("0");
    expect(formatAtoms(U64_MAX, 9, 9)).toBe("18,446,744,073.709551615");
  });

  it("formats quote amounts by label", () => {
    expect(formatQuoteAtoms("2500000", "USDC")).toBe("2.5 USDC");
    expect(formatQuoteAtoms("1", "SOL", 9)).toBe("0.000000001 SOL");
  });

  it("tryFormatAtoms falls back instead of throwing", () => {
    expect(tryFormatAtoms(null, 9)).toBe("—");
    expect(tryFormatAtoms("not-a-number", 9)).toBe("—");
    expect(tryFormatAtoms("12", 1)).toBe("1.2");
  });

  it("toAtoms rejects unsafe numbers", () => {
    expect(() => toAtoms(1.5)).toThrow(AmountError);
    expect(() => toAtoms(2 ** 60)).toThrow(AmountError);
    expect(toAtoms("42")).toBe(42n);
  });
});

describe("ratioClamped", () => {
  it("is exact, clamped and null for zero denominators", () => {
    expect(ratioClamped(1n, 4n)).toBe(0.25);
    expect(ratioClamped(5n, 4n)).toBe(1);
    expect(ratioClamped(0n, 4n)).toBe(0);
    expect(ratioClamped(1n, 0n)).toBeNull();
    expect(ratioClamped("84999999999", "85000000000")).toBeLessThan(1);
  });
});

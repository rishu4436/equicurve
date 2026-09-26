import { describe, expect, it } from "vitest";
import { buildLaunchReview, sqrtPriceToPriceString } from "@/lib/dbc/launchReview";
import { presetMigrationThresholdAtoms } from "@/lib/dbc/presets";

const base = {
  presetId: "short" as const,
  quote: "SOL" as const,
  quoteMint: "So11111111111111111111111111111111111111112",
  transferProfile: "open-spl" as const,
  totalSupply: 1_000_000_000,
  creatorPct: 70,
  lpLockPct: 100,
  mintRenounce: true,
  antiSniper: true,
  feeClaimer: "",
  wallet: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
  seedBuy: "0.25",
  cluster: "devnet",
  sharedConfig: null,
};

const val = (r: ReturnType<typeof buildLaunchReview>, label: string) =>
  r.rows.find((x) => x.label === label || x.label.startsWith(label))?.value ?? "";

describe("buildLaunchReview", () => {
  it("summarizes every on-chain setting", () => {
    const r = buildLaunchReview(base);
    expect(r.errors).toEqual([]);
    const labels = r.rows.map((x) => x.label);
    for (const l of [
      "Quote mint",
      "Base token program",
      "Total supply",
      "Decimals",
      "Preset",
      "Migration threshold",
      "Trading fee schedule",
      "Fee split (of each trading fee)",
      "Pool creation fee",
      "LP after graduation",
      "Mint authority",
      "Fee claimer (partner)",
      "Creator first buy",
    ]) {
      expect(labels).toContain(l);
    }
    expect(labels.some((l) => l.startsWith("Curve points"))).toBe(true);
    expect(val(r, "Base token program")).toContain("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    expect(val(r, "Fee split")).toBe("creator 56% · partner / fee claimer 24% · Meteora protocol 20%");
    expect(val(r, "Pool creation fee")).toContain("0.001 SOL");
    expect(val(r, "Creator first buy")).toContain("0.25 SOL exactly (250000000 atoms)");
    expect(val(r, "Fee claimer")).toBe(base.wallet);
    expect(r.migrationQuoteThresholdAtoms).toBe(presetMigrationThresholdAtoms("short", "SOL"));
    // SOL short preset now needs a few SOL, not 772.5 SOL.
    const sol = Number(BigInt(r.migrationQuoteThresholdAtoms!) / 1_000_000n) / 1000;
    expect(sol).toBeGreaterThan(1);
    expect(sol).toBeLessThan(10);
  });

  it("token-2022 + custom fee claimer + lock + USDC", () => {
    const r = buildLaunchReview({
      ...base,
      quote: "USDC",
      quoteMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      transferProfile: "token-2022",
      lpLockPct: 25,
      creatorPct: 0,
      feeClaimer: "11111111111111111111111111111112",
      seedBuy: "0",
    });
    expect(val(r, "Base token program")).toContain("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
    expect(val(r, "LP after graduation")).toContain("permanently locked 25%");
    expect(val(r, "LP after graduation")).toContain("unlocked 75%");
    expect(val(r, "Fee split")).toBe("creator 0% · partner / fee claimer 80% · Meteora protocol 20%");
    expect(val(r, "Creator first buy")).toMatch(/^none/);
    expect(val(r, "Migration threshold")).toContain("772.542485 USDC");
  });

  it("flags a seed buy that would complete the curve", () => {
    const r = buildLaunchReview({ ...base, seedBuy: "50" });
    expect(r.errors.join(" ")).toMatch(/migration threshold/);
  });

  it("sqrtPrice → price uses exact integer math", () => {
    // sqrtPrice = 2^64 → price 1 at equal decimals; base 9 / quote 6 → ×1000.
    expect(sqrtPriceToPriceString(1n << 64n, 9, 9)).toBe("1");
    expect(sqrtPriceToPriceString(1n << 64n, 9, 6)).toBe("1,000");
  });
});

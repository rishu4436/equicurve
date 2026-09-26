import { Keypair } from "@solana/web3.js";
import { validateConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { describe, expect, it } from "vitest";
import { buildPresetConfig, CURVE_PRESETS, DBC_CONSTRAINTS, validateEquiCurveConfig } from "@/lib/dbc/presets";

describe("DBC preset configs respect Meteora constraints", () => {
  const variants = [
    {},
    { quoteDecimals: 6 as const },
    { lpLockPct: 10 },
    { lpLockPct: 55, creatorTradingFeePercentage: 0 },
    { tokenType: "token-2022" as const, antiSniper: false },
  ];
  for (const p of CURVE_PRESETS) {
    for (const v of variants) {
      it(`${p.id} ${JSON.stringify(v)}`, () => {
        const cfg = buildPresetConfig(p.id, v);
        const curve = (cfg as { curve: unknown[] }).curve;
        expect(curve.length).toBeGreaterThan(0);
        expect(curve.length).toBeLessThanOrEqual(DBC_CONSTRAINTS.maxCurvePoints);
        expect(Number(cfg.partnerPermanentLockedLiquidityPercentage)).toBeGreaterThanOrEqual(10);
        expect(Number(cfg.migrationOption)).toBe(1);
        expect(validateEquiCurveConfig(cfg)).toEqual([]);
        expect(() =>
          validateConfigParameters({ ...cfg, leftoverReceiver: Keypair.generate().publicKey } as never),
        ).not.toThrow();
      });
    }
  }

  it("clamps LP lock below the 10% minimum", () => {
    const cfg = buildPresetConfig("short", { lpLockPct: 5 });
    expect(Number(cfg.partnerPermanentLockedLiquidityPercentage)).toBe(10);
  });

  it("validateEquiCurveConfig flags violations", () => {
    const cfg = buildPresetConfig("short");
    const bad = {
      ...cfg,
      partnerPermanentLockedLiquidityPercentage: 5,
      partnerLiquidityPercentage: 95,
      migrationOption: 0,
      curve: Array.from({ length: 17 }, () => (cfg as { curve: unknown[] }).curve[0]),
    } as typeof cfg;
    const errs = validateEquiCurveConfig(bad);
    expect(errs.join(" ")).toMatch(/16/);
    expect(errs.join(" ")).toMatch(/10%/);
    expect(errs.join(" ")).toMatch(/DAMM v2/);
  });
});

describe("pool creation fee units", () => {
  it("is 1,000,000 lamports (SDK takes SOL units)", () => {
    const cfg = buildPresetConfig("short") as { poolCreationFee: { toString(): string } };
    expect(cfg.poolCreationFee.toString()).toBe("1000000");
  });
});

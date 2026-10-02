import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertUsdcOverrideMint, resetUsdcOverrideCache, usdcMintFactsError } from "@/lib/dbc/usdcOverride";

const standIn = "Entdo3TrjdeCCVAMXHeNKBEfyuSnLVdeCKqeo7fdpUfh";

describe("USDC override mint", () => {
  const prev = { ...process.env };
  afterEach(() => {
    process.env = { ...prev };
    resetUsdcOverrideCache();
  });

  it("does nothing when the override is unset", async () => {
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    delete process.env.NEXT_PUBLIC_USDC_MINT_OVERRIDE;
    const read = vi.fn();
    await assertUsdcOverrideMint({} as never, read);
    expect(read).not.toHaveBeenCalled();
  });

  it("ignores the override on mainnet", async () => {
    process.env.NEXT_PUBLIC_CLUSTER = "mainnet-beta";
    process.env.NEXT_PUBLIC_USDC_MINT_OVERRIDE = standIn;
    const read = vi.fn();
    await assertUsdcOverrideMint({} as never, read);
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a mint that is not a 6-decimal SPL token and caches a valid read", async () => {
    process.env.NEXT_PUBLIC_CLUSTER = "devnet";
    process.env.NEXT_PUBLIC_USDC_MINT_OVERRIDE = standIn;
    expect(usdcMintFactsError({ owner: TOKEN_2022_PROGRAM_ID, decimals: 6 })).toMatch(/SPL/);
    expect(usdcMintFactsError({ owner: TOKEN_PROGRAM_ID, decimals: 9 })).toMatch(/6 decimals/);
    const read = vi.fn(async () => ({ owner: TOKEN_PROGRAM_ID, decimals: 6 }));
    await assertUsdcOverrideMint({} as never, read);
    await assertUsdcOverrideMint({} as never, read);
    expect(read).toHaveBeenCalledTimes(1);
    resetUsdcOverrideCache();
    const bad = vi.fn(async () => null);
    await expect(assertUsdcOverrideMint({} as never, bad)).rejects.toThrow(/could not be read/);
  });
});

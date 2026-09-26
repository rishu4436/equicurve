import { describe, expect, it } from "vitest";
import {
  detectPoolKind,
  TRANSFER_HOOK_POOL_DISCRIMINATOR,
  unwrapPoolState,
  VIRTUAL_POOL_DISCRIMINATOR,
} from "@/lib/dbc/poolAccount";

describe("detectPoolKind (by account discriminator, not object shape)", () => {
  it("identifies VirtualPool vs TransferHookPool", () => {
    expect(detectPoolKind(Uint8Array.from([...VIRTUAL_POOL_DISCRIMINATOR, 1, 2, 3]))).toBe("standard");
    expect(detectPoolKind(Uint8Array.from([...TRANSFER_HOOK_POOL_DISCRIMINATOR, 0]))).toBe("transfer-hook");
    expect(detectPoolKind(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(detectPoolKind(new Uint8Array(3))).toBeNull();
  });
});

describe("unwrapPoolState", () => {
  const inner = {
    config: "c",
    creator: "k",
    baseMint: "m",
    quoteReserve: "5",
    isMigrated: 1,
    migrationProgress: 3,
  };

  it("unwraps the SDK { poolState } wrapper (both pool kinds use it in 1.5.x)", () => {
    const s = unwrapPoolState({ poolState: inner });
    expect(s.isMigrated).toBe(1);
    expect(s.migrationProgress).toBe(3);
  });

  it("accepts a legacy flat account", () => {
    expect(unwrapPoolState(inner).isMigrated).toBe(1);
  });

  it("throws on missing fields instead of defaulting (e.g. isMigrated)", () => {
    const { isMigrated: _omit, ...noMig } = inner;
    void _omit;
    expect(() => unwrapPoolState({ poolState: noMig })).toThrow(/isMigrated/);
    expect(() => unwrapPoolState({ poolState: { config: "c" } })).toThrow(/missing/);
    expect(() => unwrapPoolState(null)).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  chainStatusFromCurve,
  checkMigrationConfig,
  computeCurveState,
  deriveGraduationView,
  MIGRATION_PROGRESS,
  type CurveState,
  type MigrationConfigCheck,
} from "@/lib/dbc/curveState";

const CONFIGS = ["cfg0", "cfg1", "cfg2", "cfg3", "cfg4", "cfg5"];
const okConfig: MigrationConfigCheck = { ok: true, expectedDammConfig: "cfg2" };

function curve(p: Partial<Parameters<typeof computeCurveState>[0]>): CurveState {
  return computeCurveState({
    quoteReserve: "0",
    migrationQuoteThreshold: "100",
    isMigrated: false,
    migrationProgress: MIGRATION_PROGRESS.PreBondingCurve,
    ...p,
  });
}

describe("computeCurveState (authoritative facts only)", () => {
  it("raising with exact progress", () => {
    expect(curve({ quoteReserve: "25" })).toEqual({ phase: "raising", progress: 0.25 });
  });

  it("complete when reserve ≥ threshold and progress flipped", () => {
    expect(
      curve({ quoteReserve: "100", migrationProgress: MIGRATION_PROGRESS.LockedVesting }),
    ).toEqual({ phase: "complete", progress: 1 });
  });

  it("flags a pending locker when migrationProgress = PostBondingCurve", () => {
    const c = curve({ quoteReserve: "150", migrationProgress: MIGRATION_PROGRESS.PostBondingCurve });
    expect(c.phase).toBe("complete");
    expect(c.lockerPending).toBe(true);
  });

  it("inconsistent completion read is UNKNOWN, not complete", () => {
    const c = curve({ quoteReserve: "100", migrationProgress: MIGRATION_PROGRESS.PreBondingCurve });
    expect(c.phase).toBe("unknown");
    expect(c.progress).toBeNull();
  });

  it("migrated from isMigrated or CreatedPool", () => {
    expect(curve({ isMigrated: true }).phase).toBe("migrated");
    expect(curve({ migrationProgress: MIGRATION_PROGRESS.CreatedPool }).phase).toBe("migrated");
  });

  it("failed / missing reads are UNKNOWN — never 0% or complete", () => {
    for (const c of [
      curve({ migrationQuoteThreshold: null }),
      curve({ quoteReserve: null }),
      curve({ isMigrated: null }),
      curve({ migrationQuoteThreshold: "0" }),
      curve({ quoteReserve: "garbage" }),
    ]) {
      expect(c.phase).toBe("unknown");
      expect(c.progress).toBeNull();
    }
  });
});

describe("chainStatusFromCurve", () => {
  it("maps phases to registry statuses", () => {
    expect(chainStatusFromCurve(curve({ quoteReserve: "0" }), "0")).toBe("new");
    expect(chainStatusFromCurve(curve({ quoteReserve: "1" }), "1")).toBe("raising");
    expect(
      chainStatusFromCurve(curve({ quoteReserve: "100", migrationProgress: 2 }), "100"),
    ).toBe("complete");
    expect(chainStatusFromCurve(curve({ isMigrated: true }), "100")).toBe("graduated");
    expect(chainStatusFromCurve(curve({ quoteReserve: null }), null)).toBe("unknown");
  });
});

describe("checkMigrationConfig", () => {
  it("resolves the DAMM v2 config from migrationFeeOption", () => {
    expect(
      checkMigrationConfig({ migrationOption: 1, migrationFeeOption: 3, dammV2FeeConfigs: CONFIGS }),
    ).toEqual({ ok: true, expectedDammConfig: "cfg3" });
  });
  it("refuses DAMM v1 targets", () => {
    const r = checkMigrationConfig({ migrationOption: 0, migrationFeeOption: 2, dammV2FeeConfigs: CONFIGS });
    expect(r.ok).toBe(false);
  });
  it("refuses unknown fee options and unread configs", () => {
    expect(checkMigrationConfig({ migrationOption: 1, migrationFeeOption: 9, dammV2FeeConfigs: CONFIGS }).ok).toBe(false);
    expect(checkMigrationConfig({ migrationOption: null, migrationFeeOption: null, dammV2FeeConfigs: CONFIGS }).ok).toBe(false);
  });
  it("refuses a mismatching operator override", () => {
    const r = checkMigrationConfig({
      migrationOption: 1,
      migrationFeeOption: 2,
      dammV2FeeConfigs: CONFIGS,
      overrideDammConfig: "cfg0",
    });
    expect(r).toMatchObject({ ok: false, expectedDammConfig: "cfg2" });
    expect(
      checkMigrationConfig({ migrationOption: 1, migrationFeeOption: 2, dammV2FeeConfigs: CONFIGS, overrideDammConfig: "cfg2" }).ok,
    ).toBe(true);
  });
});

describe("deriveGraduationView — distinct states", () => {
  const complete = curve({ quoteReserve: "100", migrationProgress: MIGRATION_PROGRESS.LockedVesting });
  const raising = curve({ quoteReserve: "40" });
  const migrated = curve({ isMigrated: true });

  it("unknown when the pool read failed", () => {
    const v = deriveGraduationView({ curve: null, tx: "idle", destination: "unchecked", config: null });
    expect(v.state).toBe("unknown");
    expect(v.canMigrate).toBe(false);
  });

  it("unknown when curve is unknown", () => {
    const v = deriveGraduationView({
      curve: curve({ migrationQuoteThreshold: null }),
      tx: "idle",
      destination: "unchecked",
      config: okConfig,
    });
    expect(v.state).toBe("unknown");
  });

  it("not eligible below threshold", () => {
    const v = deriveGraduationView({ curve: raising, tx: "idle", destination: "unchecked", config: okConfig });
    expect(v).toMatchObject({ state: "not_eligible", canMigrate: false });
  });

  it("not eligible when destination config is wrong", () => {
    const v = deriveGraduationView({
      curve: complete,
      tx: "idle",
      destination: "unchecked",
      config: { ok: false, expectedDammConfig: null, reason: "DAMM v1" },
    });
    expect(v).toMatchObject({ state: "not_eligible", canMigrate: false, detail: "DAMM v1" });
  });

  it("not eligible while the locker is pending", () => {
    const v = deriveGraduationView({
      curve: curve({ quoteReserve: "100", migrationProgress: MIGRATION_PROGRESS.PostBondingCurve }),
      tx: "idle",
      destination: "unchecked",
      config: okConfig,
    });
    expect(v).toMatchObject({ state: "not_eligible", canMigrate: false });
  });

  it("unknown when complete but config unread", () => {
    const v = deriveGraduationView({ curve: complete, tx: "idle", destination: "unchecked", config: null });
    expect(v.state).toBe("unknown");
    expect(v.canMigrate).toBe(false);
  });

  it("eligible only when complete + config OK", () => {
    const v = deriveGraduationView({ curve: complete, tx: "idle", destination: "unchecked", config: okConfig });
    expect(v).toMatchObject({ state: "eligible", canMigrate: true });
  });

  it("building is not yet submitted and cannot double-submit", () => {
    const v = deriveGraduationView({ curve: complete, tx: "building", destination: "unchecked", config: okConfig });
    expect(v.state).toBe("eligible");
    expect(v.canMigrate).toBe(false);
  });

  it("submitted while awaiting confirmation", () => {
    const v = deriveGraduationView({ curve: complete, tx: "submitted", destination: "unchecked", config: okConfig });
    expect(v).toMatchObject({ state: "submitted", canMigrate: false });
  });

  it("confirmed but destination not verified is NOT success", () => {
    for (const d of ["unchecked", "checking", "missing", "rpc_unavailable"] as const) {
      const v = deriveGraduationView({ curve: complete, tx: "confirmed", destination: d, config: okConfig });
      expect(v.state).toBe("confirmed");
    }
  });

  it("destination verified only after the DAMM v2 account fetch", () => {
    const v = deriveGraduationView({ curve: complete, tx: "confirmed", destination: "exists", config: okConfig });
    expect(v.state).toBe("destination_verified");
  });

  it("already-migrated pools (read-only view) use the destination check too", () => {
    expect(
      deriveGraduationView({ curve: migrated, tx: "idle", destination: "checking", config: okConfig }).state,
    ).toBe("confirmed");
    expect(
      deriveGraduationView({ curve: migrated, tx: "idle", destination: "exists", config: okConfig }).state,
    ).toBe("destination_verified");
  });

  it("failed tx allows retry only when still eligible", () => {
    const f = deriveGraduationView({ curve: complete, tx: "failed", destination: "unchecked", config: okConfig, txError: "boom" });
    expect(f).toMatchObject({ state: "failed", canMigrate: true, detail: "boom" });
    const g = deriveGraduationView({ curve: raising, tx: "failed", destination: "unchecked", config: okConfig });
    expect(g.canMigrate).toBe(false);
  });
});

describe("migrated pools with an unsupported destination", () => {
  it("never claims DAMM v2 verification for DAMM v1 migrations", () => {
    const v = deriveGraduationView({
      curve: computeCurveState({ quoteReserve: "1", migrationQuoteThreshold: "1", isMigrated: true, migrationProgress: 3 }),
      tx: "idle",
      destination: "missing",
      config: { ok: false, expectedDammConfig: null, reason: "migrates to DAMM v1" },
    });
    expect(v.state).toBe("confirmed");
    expect(v.detail).toMatch(/DAMM v1/);
  });
});

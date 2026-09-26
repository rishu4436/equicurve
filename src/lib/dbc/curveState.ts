/**
 * Pure mapping from authoritative on-chain DBC fields → UI state.
 * No heuristics: a missing / failed read is UNKNOWN, never 0% or complete.
 */
import { ratioClamped } from "@/lib/amounts";

/** DBC `migrationProgress` u8 (program enum). */
export const MIGRATION_PROGRESS = {
  PreBondingCurve: 0,
  PostBondingCurve: 1,
  LockedVesting: 2,
  CreatedPool: 3,
} as const;

/** DBC MigrationOption: 0 = DAMM v1 (deprecated), 1 = DAMM v2. */
export const MIGRATION_OPTION_DAMM_V2 = 1;

export type CurveFacts = {
  /** Pool quote reserve (atoms, decimal string) — null if not read. */
  quoteReserve: string | null;
  /** Config migrationQuoteThreshold (atoms) — null if config not read. */
  migrationQuoteThreshold: string | null;
  isMigrated: boolean | null;
  migrationProgress: number | null;
};

export type CurvePhase = "unknown" | "raising" | "complete" | "migrated";

export type CurveState = {
  phase: CurvePhase;
  /** 0..1 or null when unknown. */
  progress: number | null;
  reason?: string;
  /**
   * Curve complete but migrationProgress = PostBondingCurve: the config has
   * locked vesting and DBC `createLocker` must run before migration.
   */
  lockerPending?: boolean;
};

export function computeCurveState(f: CurveFacts): CurveState {
  if (f.isMigrated === true || f.migrationProgress === MIGRATION_PROGRESS.CreatedPool) {
    return { phase: "migrated", progress: 1 };
  }
  if (f.isMigrated == null) {
    return { phase: "unknown", progress: null, reason: "Pool account not read" };
  }
  if (f.quoteReserve == null || f.migrationQuoteThreshold == null) {
    return {
      phase: "unknown",
      progress: null,
      reason: "Quote reserve or migration threshold not read",
    };
  }
  let progress: number | null;
  let reserve: bigint;
  let threshold: bigint;
  try {
    reserve = BigInt(f.quoteReserve);
    threshold = BigInt(f.migrationQuoteThreshold);
    progress = ratioClamped(reserve, threshold);
  } catch {
    return { phase: "unknown", progress: null, reason: "Malformed on-chain amounts" };
  }
  if (progress == null) {
    return { phase: "unknown", progress: null, reason: "Migration threshold is zero" };
  }
  if (reserve >= threshold) {
    if (f.migrationProgress === MIGRATION_PROGRESS.PreBondingCurve) {
      // DBC flips migrationProgress in the same swap that completes the curve.
      return {
        phase: "unknown",
        progress: null,
        reason: "Quote reserve reached the threshold but migrationProgress is still PreBondingCurve (inconsistent read)",
      };
    }
    if (f.migrationProgress === MIGRATION_PROGRESS.PostBondingCurve) {
      return { phase: "complete", progress: 1, lockerPending: true };
    }
    return { phase: "complete", progress: 1 };
  }
  return { phase: "raising", progress };
}

/** Registry / Explore status derived only from chain facts. */
export type ChainStatus = "new" | "raising" | "complete" | "graduated" | "unknown";

export function chainStatusFromCurve(c: CurveState, quoteReserve: string | null): ChainStatus {
  switch (c.phase) {
    case "migrated":
      return "graduated";
    case "complete":
      return "complete";
    case "raising":
      return quoteReserve != null && BigInt(quoteReserve) === 0n ? "new" : "raising";
    default:
      return "unknown";
  }
}

/* --------------------------------------------------------------- config */

export type MigrationConfigCheck =
  | { ok: true; expectedDammConfig: string }
  | { ok: false; expectedDammConfig: string | null; reason: string };

/**
 * Verify the pool config migrates to DAMM v2 and resolve the DAMM v2 fee
 * config key the program expects (DAMM_V2_MIGRATION_FEE_ADDRESS[migrationFeeOption]).
 */
export function checkMigrationConfig(args: {
  migrationOption: number | null;
  migrationFeeOption: number | null;
  dammV2FeeConfigs: readonly string[];
  /** Optional operator override (NEXT_PUBLIC_DAMM_V2_CONFIG). */
  overrideDammConfig?: string | null;
}): MigrationConfigCheck {
  const { migrationOption, migrationFeeOption, dammV2FeeConfigs, overrideDammConfig } = args;
  if (migrationOption == null || migrationFeeOption == null) {
    return { ok: false, expectedDammConfig: null, reason: "Pool config not read — cannot verify migration target." };
  }
  if (migrationOption !== MIGRATION_OPTION_DAMM_V2) {
    return {
      ok: false,
      expectedDammConfig: null,
      reason: "This pool's config migrates to DAMM v1 (deprecated). EquiCurve only builds DAMM v2 migrations.",
    };
  }
  const expected = dammV2FeeConfigs[migrationFeeOption];
  if (!expected) {
    return {
      ok: false,
      expectedDammConfig: null,
      reason: `Unknown migrationFeeOption ${migrationFeeOption} — no published DAMM v2 config for it.`,
    };
  }
  if (overrideDammConfig && overrideDammConfig !== expected) {
    return {
      ok: false,
      expectedDammConfig: expected,
      reason: `NEXT_PUBLIC_DAMM_V2_CONFIG (${overrideDammConfig}) does not match the DAMM v2 config required by this pool's migrationFeeOption (${expected}). Unset it or fix it.`,
    };
  }
  return { ok: true, expectedDammConfig: expected };
}

/* ------------------------------------------------------- graduation UI */

export type MigrationTxPhase = "idle" | "building" | "submitted" | "confirmed" | "failed";
export type DestinationCheck = "unchecked" | "checking" | "exists" | "missing" | "rpc_unavailable";

export type GraduationState =
  | "unknown"
  | "not_eligible"
  | "eligible"
  | "submitted"
  | "confirmed"
  | "destination_verified"
  | "failed";

export type GraduationView = {
  state: GraduationState;
  label: string;
  detail: string;
  canMigrate: boolean;
};

export function deriveGraduationView(args: {
  curve: CurveState | null;
  tx: MigrationTxPhase;
  destination: DestinationCheck;
  config: MigrationConfigCheck | null;
  txError?: string | null;
}): GraduationView {
  const { curve, tx, destination, config, txError } = args;

  if (tx === "failed") {
    return {
      state: "failed",
      label: "Migration failed",
      detail: txError || "The migration transaction did not confirm.",
      canMigrate: curve?.phase === "complete" && !curve.lockerPending && config?.ok === true,
    };
  }
  if (tx === "building") {
    // Not on-chain yet: re-checking eligibility and building the tx.
    return {
      state: "eligible",
      label: "Preparing migration",
      detail: "Re-checking eligibility on-chain and building migrateToDammV2…",
      canMigrate: false,
    };
  }
  if (tx === "submitted") {
    return {
      state: "submitted",
      label: "Migration submitted",
      detail: "Waiting for the migration transaction to confirm…",
      canMigrate: false,
    };
  }

  const migratedOnChain = tx === "confirmed" || curve?.phase === "migrated";
  if (migratedOnChain) {
    if (config && !config.ok && destination !== "exists") {
      return {
        state: "confirmed",
        label: "Migrated · destination not verifiable",
        detail: `DBC reports migration, but the DAMM v2 destination cannot be verified: ${config.reason}`,
        canMigrate: false,
      };
    }
    if (destination === "exists") {
      return {
        state: "destination_verified",
        label: "DAMM v2 pool verified",
        detail: "Migration confirmed and the DAMM v2 pool account was fetched on-chain.",
        canMigrate: false,
      };
    }
    return {
      state: "confirmed",
      label: "Migration confirmed",
      detail:
        destination === "missing"
          ? "DBC reports migration, but the DAMM v2 pool account was not found yet. Refresh shortly."
          : destination === "rpc_unavailable"
            ? "DBC reports migration; DAMM v2 pool could not be checked (RPC unavailable)."
            : "DBC reports migration; verifying the DAMM v2 pool account…",
      canMigrate: false,
    };
  }

  if (!curve || curve.phase === "unknown") {
    return {
      state: "unknown",
      label: "Status unknown",
      detail: curve?.reason || "Could not read pool state from RPC.",
      canMigrate: false,
    };
  }
  if (curve.phase === "complete") {
    if (curve.lockerPending) {
      return {
        state: "not_eligible",
        label: "Not eligible yet",
        detail: "Curve complete, but this config has locked vesting: the DBC locker (createLocker) must be created before migrating.",
        canMigrate: false,
      };
    }
    if (config && !config.ok) {
      return { state: "not_eligible", label: "Not eligible", detail: config.reason, canMigrate: false };
    }
    if (!config) {
      return {
        state: "unknown",
        label: "Status unknown",
        detail: "Curve is complete but the migration config could not be verified.",
        canMigrate: false,
      };
    }
    return {
      state: "eligible",
      label: "Eligible to migrate",
      detail: "Quote reserve reached the migration threshold and the config targets DAMM v2.",
      canMigrate: true,
    };
  }
  return {
    state: "not_eligible",
    label: "Not eligible yet",
    detail: "Quote reserve is below the migration threshold.",
    canMigrate: false,
  };
}

/* ------------------------------------------------------ graduation numbers */

export type GraduationNumbers =
  | { known: false; reason: string }
  | {
      known: true;
      /** Config migrationQuoteThreshold (quote atoms). */
      threshold: bigint;
      /** Pool quote reserve (quote atoms). */
      reserve: bigint;
      /** Exact quote atoms still needed on the curve (0 when complete). */
      remaining: bigint;
      /** 0..1, display only (ratio of exact integers). */
      progress: number;
      /** Progress in basis points, exact integer floor. */
      progressBps: number;
      complete: boolean;
    };

/**
 * Exact graduation numbers from on-chain facts (bigint; never float on u64).
 * Remaining is quote that must still be swapped IN to the curve (net of
 * trading fees, which are charged on top of it for buys).
 */
export function graduationNumbers(f: Pick<CurveFacts, "quoteReserve" | "migrationQuoteThreshold" | "isMigrated">): GraduationNumbers {
  if (f.quoteReserve == null || f.migrationQuoteThreshold == null) {
    return { known: false, reason: "Quote reserve or migration threshold could not be read from chain." };
  }
  let reserve: bigint;
  let threshold: bigint;
  try {
    reserve = BigInt(f.quoteReserve);
    threshold = BigInt(f.migrationQuoteThreshold);
  } catch {
    return { known: false, reason: "Malformed on-chain amounts." };
  }
  if (threshold <= 0n) return { known: false, reason: "Migration threshold is zero." };
  const complete = f.isMigrated === true || reserve >= threshold;
  const remaining = complete ? 0n : threshold - reserve;
  const bps = complete ? 10_000n : (reserve * 10_000n) / threshold;
  return {
    known: true,
    threshold,
    reserve,
    remaining,
    progress: Number(bps) / 10_000,
    progressBps: Number(bps),
    complete,
  };
}

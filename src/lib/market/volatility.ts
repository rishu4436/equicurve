/**
 * DBC dynamic-fee volatility, ported from `VolatilityTracker` in the Meteora program
 * (`state/fee.rs`). The SDK charges the variable fee from the tracker but does not
 * move the tracker forward, so a multi-trade simulation has to.
 *
 * A fresh pool stores last_update_timestamp = 0. The first swap therefore sees a
 * long elapsed time, snaps the reference price to the pre-swap price, and only
 * then lets the post-swap accumulator record that swap's price move.
 */

const ONE_Q64 = 1n << 64n;
const BPS = 10_000n;
/** Default bin step, 1 bps, in Q64.64. Matches BIN_STEP_BPS_U128_DEFAULT. */
export const DEFAULT_BIN_STEP_U128 = 1844674407370955n;

export type DynamicFeeParams = {
  binStep: number;
  binStepU128: bigint;
  filterPeriod: number;
  decayPeriod: number;
  reductionFactor: number;
  maxVolatilityAccumulator: bigint;
  variableFeeControl: number;
};

export type VolState = {
  lastUpdate: bigint;
  sqrtRef: bigint;
  volAcc: bigint;
  volRef: bigint;
};

export function zeroVol(): VolState {
  return { lastUpdate: 0n, sqrtRef: 0n, volAcc: 0n, volRef: 0n };
}

export function readDynamicFee(raw: unknown): DynamicFeeParams | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.initialized === 0) return null;
  const binStep = typeof d.binStep === "number" ? d.binStep : 0;
  if (binStep <= 0) return null;
  const u128 = d.binStepU128;
  const binStepU128 =
    u128 != null && typeof (u128 as { toString?: () => string }).toString === "function"
      ? BigInt((u128 as { toString(): string }).toString())
      : DEFAULT_BIN_STEP_U128;
  const max = d.maxVolatilityAccumulator;
  return {
    binStep,
    binStepU128: binStepU128 > 0n ? binStepU128 : DEFAULT_BIN_STEP_U128,
    filterPeriod: typeof d.filterPeriod === "number" ? d.filterPeriod : 10,
    decayPeriod: typeof d.decayPeriod === "number" ? d.decayPeriod : 120,
    reductionFactor: typeof d.reductionFactor === "number" ? d.reductionFactor : 5_000,
    maxVolatilityAccumulator: typeof max === "number" ? BigInt(Math.max(0, Math.floor(max))) : 0n,
    variableFeeControl: typeof d.variableFeeControl === "number" ? d.variableFeeControl : 0,
  };
}

/** (upper << 64) / lower, then bins × 2. Matches get_delta_bin_id. */
export function deltaBin(binStepU128: bigint, sqrtA: bigint, sqrtB: bigint): bigint {
  if (sqrtA <= 0n || sqrtB <= 0n || binStepU128 <= 0n) return 0n;
  const upper = sqrtA > sqrtB ? sqrtA : sqrtB;
  const lower = sqrtA > sqrtB ? sqrtB : sqrtA;
  const ratio = (upper << 64n) / lower;
  if (ratio <= ONE_Q64) return 0n;
  return ((ratio - ONE_Q64) / binStepU128) * 2n;
}

function elapsedSec(vol: VolState, atSec: number, decayPeriod: number): bigint {
  if (vol.lastUpdate === 0n) return BigInt(decayPeriod + 1);
  const now = BigInt(Math.max(0, Math.floor(atSec)));
  return now > vol.lastUpdate ? now - vol.lastUpdate : 0n;
}

/** Pre-swap. Updates the reference price and the decayed volatility reference. */
export function updateReferences(vol: VolState, fee: DynamicFeeParams, sqrtPrice: bigint, atSec: number): VolState {
  const elapsed = elapsedSec(vol, atSec, fee.decayPeriod);
  if (elapsed < BigInt(fee.filterPeriod)) return vol;
  const next: VolState = { ...vol, sqrtRef: sqrtPrice };
  if (elapsed < BigInt(fee.decayPeriod)) {
    next.volRef = (vol.volAcc * BigInt(fee.reductionFactor)) / BPS;
  } else {
    next.volRef = 0n;
  }
  return next;
}

/** Post-swap. Folds the price move into the accumulator that the next quote will read. */
export function updateAccumulator(vol: VolState, fee: DynamicFeeParams, sqrtPrice: bigint, atSec: number): VolState {
  const moved = deltaBin(fee.binStepU128, sqrtPrice, vol.sqrtRef);
  let acc = vol.volRef + moved * BPS;
  if (fee.maxVolatilityAccumulator > 0n && acc > fee.maxVolatilityAccumulator) {
    acc = fee.maxVolatilityAccumulator;
  }
  return {
    ...vol,
    volAcc: acc,
    lastUpdate: moved > 0n ? BigInt(Math.max(0, Math.floor(atSec))) : vol.lastUpdate,
  };
}

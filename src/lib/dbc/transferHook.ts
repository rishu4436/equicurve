import {
  validateTransferHookProgram,
  validateTransferHookProgramExecutable,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey, type Connection } from "@solana/web3.js";
import { EquiCurveError } from "@/lib/errors";

/** Create-wizard profiles that map to real DBC SDK create paths. */
export type TransferProfile = "open-spl" | "token-2022" | "transfer-hook";

export const TRANSFER_PROFILE_LABELS: Record<TransferProfile, string> = {
  "open-spl": "Open SPL",
  "token-2022": "Token-2022 (no hook)",
  "transfer-hook": "Token-2022 + transfer hook",
};

/**
 * Optional executable Token-2022 transfer-hook program.
 * Required for the transfer-hook create path — never invent a fake ID.
 * Env: NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM
 */
export function getTransferHookProgram(): PublicKey | null {
  const raw = process.env.NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM?.trim();
  if (!raw) return null;
  try {
    const pk = new PublicKey(raw);
    if (!validateTransferHookProgram(pk)) return null;
    return pk;
  } catch {
    return null;
  }
}

export function isTransferHookProfileAvailable(): boolean {
  return getTransferHookProgram() !== null;
}

export async function requireTransferHookProgram(
  connection: Connection,
): Promise<PublicKey> {
  const program = getTransferHookProgram();
  if (!program) {
    throw new EquiCurveError(
      "Transfer-hook launches require NEXT_PUBLIC_TRANSFER_HOOK_PROGRAM set to an executable Token-2022 transfer-hook program ID (see Meteora DBC transfer-hook docs). EquiCurve does not ship a fake hook.",
      "VALIDATION",
    );
  }
  const ok = await validateTransferHookProgramExecutable(connection, program);
  if (!ok) {
    throw new EquiCurveError(
      `Transfer-hook program ${program.toBase58()} is not executable on this cluster (or is a disallowed program ID).`,
      "VALIDATION",
    );
  }
  return program;
}


export function parseTransferProfile(
  value: string | undefined | null,
): TransferProfile {
  if (value === "token-2022" || value === "Token-2022 (no hook)") {
    return "token-2022";
  }
  if (
    value === "transfer-hook" ||
    value === "Token-2022 + transfer hook" ||
    value === "Token-2022 transfer hook"
  ) {
    return "transfer-hook";
  }
  return "open-spl";
}

/**
 * Single place that turns SDK / RPC / wallet / program errors into short,
 * actionable user messages. Used by create, swap, migrate, claim and DAMM flows.
 */

export type EquiCurveErrorCode =
  | "MISSING_RPC"
  | "MISSING_WALLET"
  | "MISSING_CONFIG"
  | "RPC_UNAVAILABLE"
  | "SDK"
  | "VALIDATION"
  | "USER_REJECTED"
  | "TX_FAILED"
  | "TX_EXPIRED";

export class EquiCurveError extends Error {
  constructor(
    message: string,
    public readonly code: EquiCurveErrorCode,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "EquiCurveError";
  }
}

export type MappedErrorKind =
  | "user_rejected"
  | "blockhash_expired"
  | "insufficient_funds"
  | "slippage"
  | "account_not_found"
  | "rate_limited"
  | "rpc_unavailable"
  | "program_error"
  | "simulation_failed"
  | "pool_completed"
  | "wallet"
  | "validation"
  | "unknown";

export type MappedError = {
  kind: MappedErrorKind;
  message: string;
  /** Custom program error code (decimal) when present. */
  programErrorCode?: number;
  programErrorName?: string;
  /** Program id that failed, when present in logs. */
  programId?: string;
};

const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const DAMM_V2_PROGRAM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PeNszS5q5HS1bUsu";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";

/** Curated DBC program errors (codes from the SDK IDL). */
const DBC_ERRORS: Record<number, [string, string]> = {
  6002: ["ExceededSlippage", "Price moved beyond your slippage tolerance. Re-quote and try again, or raise slippage."],
  6005: ["AmountIsZero", "Amount is zero after fees — enter a larger amount."],
  6012: ["NotEnoughLiquidity", "Not enough liquidity on the curve for this trade size."],
  6013: ["PoolIsCompleted", "The bonding curve is complete — trading is closed until migration to DAMM v2."],
  6014: ["PoolIsIncompleted", "The curve has not reached its migration threshold yet."],
  6015: ["InvalidMigrationOption", "This pool's config does not support this migration target."],
  6021: ["InvalidCurve", "Invalid curve parameters in config."],
  6022: ["NotPermitToDoThisAction", "This wallet is not permitted to perform this action on the pool."],
  6029: ["InsufficientLiquidityForMigration", "Insufficient liquidity to migrate this pool."],
  6033: ["InsufficientLiquidity", "Insufficient liquidity for this trade."],
  6035: ["InvalidCreatorTradingFeePercentage", "Creator trading fee percentage is invalid."],
  6053: ["Unauthorized", "This wallet is not authorized for this action."],
  6055: ["InvalidMigrationLockedLiquidity", "Locked liquidity is below the protocol minimum (10%)."],
  6057: ["FirstSwapValidationFailed", "First-swap (anti-sniper) validation failed."],
  6071: ["MissingRemainingAccountForTransferHook", "Transfer-hook accounts are missing for this pool."],
  6076: ["PoolTypeMismatch", "Pool type mismatch — wrong instruction variant for this pool."],
};

/** Curated DAMM v2 (cp-amm) errors that commonly surface in swaps. */
const DAMM_ERRORS: Record<number, [string, string]> = {
  6002: ["ExceededSlippage", "Price moved beyond your slippage tolerance on DAMM v2. Re-quote and try again."],
  6003: ["PoolDisabled", "This DAMM v2 pool is disabled."],
  6006: ["AmountIsZero", "Amount is zero after fees — enter a larger amount."],
};

/** System program errors (SystemError enum). 1 = ResultWithNegativeLamports ("Transfer: insufficient lamports"). */
const SYSTEM_ERRORS: Record<number, [string, string]> = {
  1: ["InsufficientFunds", "Insufficient funds: your wallet needs more SOL (fees + rent) for this transaction."],
};

const SPL_TOKEN_ERRORS: Record<number, [string, string]> = {
  1: ["InsufficientFunds", "Insufficient token balance for this transaction."],
};

function rawMessage(err: unknown): string {
  if (err == null) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function collectLogs(err: unknown): string[] {
  const out: string[] = [];
  const visit = (e: unknown, depth: number) => {
    if (!e || typeof e !== "object" || depth > 3) return;
    const o = e as { logs?: unknown; transactionLogs?: unknown; cause?: unknown };
    for (const l of [o.logs, o.transactionLogs]) {
      if (Array.isArray(l)) out.push(...l.map(String));
    }
    visit(o.cause, depth + 1);
  };
  visit(err, 0);
  return out;
}

function fullText(err: unknown): string {
  const parts: string[] = [rawMessage(err)];
  let c: unknown = err && typeof err === "object" ? (err as { cause?: unknown }).cause : undefined;
  for (let i = 0; c && i < 3; i++) {
    parts.push(rawMessage(c));
    c = typeof c === "object" ? (c as { cause?: unknown }).cause : undefined;
  }
  parts.push(...collectLogs(err));
  return parts.join("\n");
}

/** Parse "custom program error: 0x1771" / {"Custom":6002} / Anchor "Error Number: 6002". */
export function parseCustomErrorCode(text: string): number | undefined {
  const hex = /custom program error:\s*0x([0-9a-f]+)/i.exec(text);
  if (hex) return parseInt(hex[1], 16);
  const json = /"Custom"\s*:\s*(\d+)/.exec(text);
  if (json) return Number(json[1]);
  const anchor = /Error Number:\s*(\d+)/i.exec(text);
  if (anchor) return Number(anchor[1]);
  return undefined;
}

/** Program that failed, from "Program <id> failed: …" log lines. */
export function parseFailedProgram(text: string): string | undefined {
  const m = /Program ([1-9A-HJ-NP-Za-km-z]{32,44}) failed/.exec(text);
  return m?.[1];
}

export function mapError(err: unknown): MappedError {
  if (err instanceof EquiCurveError) {
    if (err.code === "USER_REJECTED") return { kind: "user_rejected", message: err.message };
    if (err.code === "VALIDATION") return { kind: "validation", message: err.message };
    if (err.code === "MISSING_WALLET") return { kind: "wallet", message: err.message };
    if (err.code === "TX_EXPIRED") return { kind: "blockhash_expired", message: err.message };
    if (err.code === "SDK" || err.code === "TX_FAILED" || err.code === "RPC_UNAVAILABLE") {
      // fall through to pattern mapping using the cause for detail
      const inner = err.cause ? mapError(err.cause) : null;
      if (inner && inner.kind !== "unknown") return inner;
      if (err.code === "RPC_UNAVAILABLE") return { kind: "rpc_unavailable", message: err.message };
    }
    if (err.code !== "SDK" && err.code !== "TX_FAILED") return { kind: "unknown", message: err.message };
  }

  const text = fullText(err);
  const lower = text.toLowerCase();

  if (/user rejected|rejected the request|user denied|declined|transaction cancelled|request rejected|WalletSignTransactionError.*reject/i.test(text)) {
    return { kind: "user_rejected", message: "You rejected the request in your wallet. Nothing was sent." };
  }
  if (/blockhash not found|block height exceeded|TransactionExpiredBlockheightExceeded|has expired|expired.*blockhash/i.test(text)) {
    return {
      kind: "blockhash_expired",
      message: "Transaction expired before it confirmed (blockhash too old). Nothing was charged if it didn't land — check your wallet activity, then retry.",
    };
  }
  if (/\b429\b|too many requests|rate.?limit/i.test(text)) {
    return {
      kind: "rate_limited",
      message: "RPC is rate-limiting requests (429). Wait a few seconds and retry, or set a dedicated RPC (RPC_URL / NEXT_PUBLIC_RPC_URL).",
    };
  }

  const code = parseCustomErrorCode(text);
  const program = parseFailedProgram(text);
  if (code !== undefined) {
    let entry: [string, string] | undefined;
    if (program === DAMM_V2_PROGRAM) entry = DAMM_ERRORS[code];
    else if (program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM) entry = SPL_TOKEN_ERRORS[code];
    else if (program === SYSTEM_PROGRAM) entry = SYSTEM_ERRORS[code];
    else if (program === DBC_PROGRAM || !program) entry = DBC_ERRORS[code] ?? (code < 100 ? SPL_TOKEN_ERRORS[code] : undefined);
    if (entry) {
      const [name, msg] = entry;
      const kind: MappedErrorKind = /Slippage/.test(name)
        ? "slippage"
        : name === "InsufficientFunds"
          ? "insufficient_funds"
          : name === "PoolIsCompleted"
            ? "pool_completed"
            : "program_error";
      return { kind, message: msg, programErrorCode: code, programErrorName: name, programId: program };
    }
    return {
      kind: "program_error",
      message: `Transaction simulation failed: program error ${code} (0x${code.toString(16)})${program ? ` in ${program.slice(0, 4)}…${program.slice(-4)}` : ""}. Check inputs and try again.`,
      programErrorCode: code,
      programId: program,
    };
  }

  if (/slippage|exceeded.?slippage|minimum amount out|too little received/i.test(text)) {
    return { kind: "slippage", message: "Price moved beyond your slippage tolerance. Re-quote and try again." };
  }
  if (/insufficient (funds|lamports|balance)|attempt to debit an account but found no record of a prior credit|insufficientfundsforrent|insufficient funds for rent/i.test(text)) {
    return {
      kind: "insufficient_funds",
      message: "Insufficient funds: your wallet needs more SOL (fees + rent) or quote tokens for this transaction.",
    };
  }
  if (/account (does not exist|not found)|could not find account|AccountNotFound|pool .* not found|not found on this/i.test(text)) {
    return {
      kind: "account_not_found",
      message: "Account not found on this cluster. Check that your wallet and the app use the same network, and that the address is correct.",
    };
  }
  if (/\b(403|502|503|504)\b|failed to fetch|fetch failed|ECONNREFUSED|ETIMEDOUT|network ?error|timed out|timeout/i.test(text)) {
    return {
      kind: "rpc_unavailable",
      message: "RPC unavailable. Retry shortly or configure a dedicated RPC endpoint.",
    };
  }
  if (/simulation failed|SendTransactionError|failed to send transaction/i.test(text)) {
    return {
      kind: "simulation_failed",
      message: "Transaction simulation failed. Your inputs may be stale — refresh and try again.",
    };
  }
  if (lower.includes("wallet not connected") || /WalletNotConnected/i.test(text)) {
    return { kind: "wallet", message: "Connect a wallet first." };
  }
  const msg = rawMessage(err).trim();
  return { kind: "unknown", message: msg ? msg.slice(0, 240) : "Unexpected error" };
}

export function toUserMessage(err: unknown): string {
  return mapError(err).message;
}

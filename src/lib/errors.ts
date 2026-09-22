export type EquiCurveErrorCode =
  | "MISSING_RPC"
  | "MISSING_WALLET"
  | "MISSING_CONFIG"
  | "RPC_UNAVAILABLE"
  | "SDK"
  | "VALIDATION"
  | "USER_REJECTED";

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

export function toUserMessage(err: unknown): string {
  if (err instanceof EquiCurveError) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = String((err as { message: unknown }).message);
    if (/User rejected|rejected the request/i.test(msg)) {
      return "Wallet rejected the transaction.";
    }
    if (/403|429|failed to fetch|ECONNREFUSED|fetch failed/i.test(msg)) {
      return "RPC unavailable or rate-limited. Set NEXT_PUBLIC_RPC_URL to a dedicated endpoint.";
    }
    return msg;
  }
  return "Unexpected error";
}

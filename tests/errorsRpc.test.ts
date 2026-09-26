import { describe, expect, it } from "vitest";
import { EquiCurveError, mapError, parseCustomErrorCode } from "@/lib/errors";
import { isTransientRpcError, withRpcRetry, withTimeout, RpcTimeoutError } from "@/lib/rpc";

const DBC = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
const DAMM = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG";

describe("mapError", () => {
  it("DBC slippage from hex custom error + logs", () => {
    const err = Object.assign(new Error("Simulation failed: custom program error: 0x1772"), {
      logs: [`Program ${DBC} invoke [1]`, `Program ${DBC} failed: custom program error: 0x1772`],
    });
    const m = mapError(err);
    expect(m).toMatchObject({ kind: "slippage", programErrorCode: 6002, programErrorName: "ExceededSlippage", programId: DBC });
  });

  it("DBC pool completed", () => {
    expect(mapError(new Error('{"InstructionError":[2,{"Custom":6013}]}')).kind).toBe("pool_completed");
  });

  it("DAMM errors resolved by failing program", () => {
    const err = Object.assign(new Error("failed"), {
      logs: [`Program ${DAMM} failed: custom program error: 0x1772`],
    });
    expect(mapError(err).message).toMatch(/DAMM v2/);
  });

  it("unknown custom codes keep the numeric code", () => {
    const m = mapError(new Error("custom program error: 0x2710"));
    expect(m.kind).toBe("program_error");
    expect(m.programErrorCode).toBe(10000);
  });

  it("wallet rejection, blockhash expiry, 429, insufficient funds", () => {
    expect(mapError(new Error("User rejected the request.")).kind).toBe("user_rejected");
    expect(mapError(new Error("Blockhash not found")).kind).toBe("blockhash_expired");
    expect(mapError(new EquiCurveError("expired", "TX_EXPIRED")).kind).toBe("blockhash_expired");
    expect(mapError(new Error("Server responded with 429 Too Many Requests")).kind).toBe("rate_limited");
    expect(mapError(new Error("Attempt to debit an account but found no record of a prior credit.")).kind).toBe(
      "insufficient_funds",
    );
  });

  it("does not treat digits inside base58 addresses as HTTP codes", () => {
    const m = mapError(new Error("Unexpected state for 4gT4295qXyz"));
    expect(m.kind).toBe("unknown");
  });

  it("parses Anchor error numbers", () => {
    expect(parseCustomErrorCode("Error Number: 6002. Error Message: slippage")).toBe(6002);
  });
});

describe("withRpcRetry", () => {
  it("retries transient errors then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const r = await withRpcRetry(
      async () => {
        calls++;
        if (calls < 3) throw new Error("429 Too Many Requests");
        return "ok";
      },
      { sleepFn: async (ms) => void sleeps.push(ms) },
    );
    expect(r).toBe("ok");
    expect(calls).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[1]).toBeGreaterThan(sleeps[0] * 1.5 - 1);
  });

  it("does not retry non-transient errors", async () => {
    let calls = 0;
    await expect(
      withRpcRetry(async () => {
        calls++;
        throw new Error("Invalid param: WrongSize");
      }, { sleepFn: async () => {} }),
    ).rejects.toThrow(/WrongSize/);
    expect(calls).toBe(1);
  });

  it("gives up after the retry budget", async () => {
    let calls = 0;
    await expect(
      withRpcRetry(async () => {
        calls++;
        throw new Error("503 Service Unavailable");
      }, { retries: 2, sleepFn: async () => {} }),
    ).rejects.toThrow(/503/);
    expect(calls).toBe(3);
  });

  it("timeouts are transient", async () => {
    await expect(withTimeout(new Promise(() => {}), 10)).rejects.toBeInstanceOf(RpcTimeoutError);
    expect(isTransientRpcError(new RpcTimeoutError(10))).toBe(true);
  });
});

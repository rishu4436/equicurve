import { describe, expect, it, vi } from "vitest";
import { EquiCurveError, mapError, parseCustomErrorCode } from "@/lib/errors";
import { dedupeRpcRead, isTransientRpcError, withRpcFallback, withRpcRetry, withTimeout, withVerifiedRpcFallback, RpcTimeoutError } from "@/lib/rpc";

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
  it("coalesces concurrent identical reads without caching settled chain data", async () => {
    let calls = 0;
    let release!: (value: number) => void;
    const pending = new Promise<number>((resolve) => { release = resolve; });
    const read = () => { calls += 1; return pending; };
    const a = dedupeRpcRead("same", read);
    const b = dedupeRpcRead("same", read);
    expect(calls).toBe(1);
    release(7);
    await expect(Promise.all([a, b])).resolves.toEqual([7, 7]);
    await dedupeRpcRead("same", async () => { calls += 1; return 8; });
    expect(calls).toBe(2);
  });

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
    expect(sleeps).toEqual([250, 500]);
  });

  it("falls back only across the bounded list for transient read failures", async () => {
    const calls: string[] = [];
    const result = await withRpcFallback(["primary", "backup"], async (source) => {
      calls.push(source);
      if (source === "primary") throw new Error("429 Too Many Requests");
      return "ok";
    }, { retries: 0 });
    expect(result).toBe("ok");
    expect(calls).toEqual(["primary", "backup"]);
  });

  it("reaches a verified same-cluster fallback after a transient primary read failure", async () => {
    const reads: string[] = [];
    const sources = [
      { rpcEndpoint: "https://primary.example", getGenesisHash: async () => "devnet-genesis" },
      { rpcEndpoint: "https://fallback.example", getGenesisHash: async () => "devnet-genesis" },
    ];
    const result = await withVerifiedRpcFallback(sources, "devnet-genesis", async (source) => {
      reads.push(source.rpcEndpoint);
      if (source === sources[0]) throw new Error("503 Service Unavailable");
      return "fallback result";
    }, { retries: 0 });
    expect(result).toBe("fallback result");
    expect(reads).toEqual(["https://primary.example", "https://fallback.example"]);
  });

  it("rejects a network-mismatched fallback before executing its read", async () => {
    const fallbackRead = vi.fn();
    const sources = [
      { rpcEndpoint: "https://primary-mismatch-test.example", getGenesisHash: async () => "devnet-genesis" },
      { rpcEndpoint: "https://wrong-cluster.example", getGenesisHash: async () => "mainnet-genesis" },
    ];
    await expect(withVerifiedRpcFallback(sources, "devnet-genesis", async (source) => {
      if (source === sources[0]) throw new Error("429 Too Many Requests");
      fallbackRead();
      return "unsafe";
    }, { retries: 0 })).rejects.toThrow(/cluster mismatch/);
    expect(fallbackRead).not.toHaveBeenCalled();
  });

  it("fails closed without trying fallback after a verified non-transient read error", async () => {
    const reads: string[] = [];
    const sources = [
      { rpcEndpoint: "https://primary-closed.example", getGenesisHash: async () => "same" },
      { rpcEndpoint: "https://fallback-closed.example", getGenesisHash: async () => "same" },
    ];
    await expect(withVerifiedRpcFallback(sources, "same", async (source) => {
      reads.push(source.rpcEndpoint);
      throw new Error("invalid account data");
    }, { retries: 0 })).rejects.toThrow(/invalid account/);
    expect(reads).toEqual(["https://primary-closed.example"]);
  });

  it("does not switch endpoints for a non-transient read error", async () => {
    const calls: string[] = [];
    await expect(withRpcFallback(["primary", "backup"], async (source) => {
      calls.push(source);
      throw new Error("invalid account data");
    }, { retries: 0 })).rejects.toThrow(/invalid account/);
    expect(calls).toEqual(["primary"]);
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

import { afterEach, describe, expect, it, vi } from "vitest";
import { formatMetricValue, formatPriceAxis, formatTokenPriceExact } from "@/lib/marketDisplay";
import {
  activeVenueLabel,
  atomsToDecimalString,
  fetchSolUsdReference,
  multiplyDecimalByAtoms,
  multiplyDecimalStrings,
  resetSolUsdReferenceCache,
  resolveActiveVenue,
} from "@/lib/market/metrics";

const dammSnapshot = {
  curve: { phase: "migrated" as const, progress: 1 },
  migrationOption: 1,
  migrationFeeOption: 2,
  quoteMint: "So11111111111111111111111111111111111111112",
};

afterEach(() => {
  resetSolUsdReferenceCache();
  vi.restoreAllMocks();
});

describe("Market Terminal V2 metric primitives", () => {
  it("keeps DBC active before migration", () => {
    expect(resolveActiveVenue({ ...dammSnapshot, curve: { phase: "raising", progress: 0.2 } }, "unchecked")).toBe("dbc");
  });

  it("keeps a completed curve on DBC until migration is verified", () => {
    expect(resolveActiveVenue({ ...dammSnapshot, curve: { phase: "complete", progress: 1 } }, "missing")).toBe("dbc");
  });

  it("resolves an EQFULL-like migrated market to DAMM v2", () => {
    expect(resolveActiveVenue(dammSnapshot, "exists")).toBe("damm-v2");
  });

  it("returns Pending when migration exists but destination is not present", () => {
    expect(resolveActiveVenue(dammSnapshot, "missing")).toBe("pending");
  });

  it("returns Unknown when the destination read fails", () => {
    expect(resolveActiveVenue(dammSnapshot, "rpc_unavailable")).toBe("unknown");
  });

  it("returns Unknown when the lifecycle read itself is unknown", () => {
    expect(resolveActiveVenue({ ...dammSnapshot, curve: { phase: "unknown", progress: null } }, "exists")).toBe("unknown");
  });

  it("rejects a migrated pool with an unsupported migration option", () => {
    expect(resolveActiveVenue({ ...dammSnapshot, migrationOption: 0 }, "exists")).toBe("pending");
  });

  it("labels every canonical venue", () => {
    expect(activeVenueLabel("dbc")).toBe("DBC");
    expect(activeVenueLabel("damm-v2")).toBe("DAMM v2");
    expect(activeVenueLabel("pending")).toBe("Pending");
    expect(activeVenueLabel("unknown")).toBe("Unknown");
  });

  it("multiplies decimal strings without binary floating point", () => {
    expect(multiplyDecimalStrings("0.00000001366", "1000000000")).toBe("13.66");
  });

  it("handles decimal exponents from SDK-style values", () => {
    expect(multiplyDecimalStrings("1.366e-8", "1000000000")).toBe("13.66");
  });

  it("preserves exact total token decimals", () => {
    expect(atomsToDecimalString("1000000000000000000", 9)).toBe("1000000000");
  });

  it("computes FDV input from atom supply", () => {
    expect(multiplyDecimalByAtoms("0.00000001366", "1000000000000000000", 9)).toBe("13.66");
  });

  it("returns null for malformed decimal values", () => {
    expect(multiplyDecimalStrings("not-a-number", "2")).toBeNull();
  });

  it("returns null for malformed atom values", () => {
    expect(atomsToDecimalString("12.5", 9)).toBeNull();
    expect(atomsToDecimalString("12", -1)).toBeNull();
  });

  it("formats a tiny SOL price without ambiguous ell notation", () => {
    expect(formatTokenPriceExact("0.00000001366", "SOL", "EQFULL").primary).toBe("13.66 lamports / EQFULL");
    expect(formatPriceAxis(0.00000001366, "SOL")).toBe("13.66 lamports");
  });

  it("keeps unknown display values as an em dash", () => {
    expect(formatMetricValue(null, "SOL")).toBe("—");
    expect(formatMetricValue(null, "USD")).toBe("—");
  });

  it("formats USD values with a currency marker", () => {
    expect(formatMetricValue("1.24", "USD")).toBe("$1.24");
  });

  it("formats compact large USD values", () => {
    expect(formatMetricValue("12400", "USD")).toBe("$12.4K");
  });

  it("formats zero explicitly when it is mathematically known", () => {
    expect(formatMetricValue("0", "SOL")).toBe("0 SOL");
  });

  it("reads a bounded SOL/USD reference", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ solana: { usd: 142.5 } }), { status: 200 }));
    const result = await fetchSolUsdReference(fetchMock as unknown as typeof fetch);
    expect(result).toMatchObject({ usdPerSol: "142.5", source: "coingecko" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("degrades when the SOL/USD source fails", async () => {
    const fetchMock = vi.fn(async () => new Response("upstream failed", { status: 503 }));
    await expect(fetchSolUsdReference(fetchMock as unknown as typeof fetch)).resolves.toBeNull();
  });

  it("does not require USD to keep SOL values meaningful", () => {
    expect(formatTokenPriceExact("0.0245", "SOL", "TOKEN").primary).toBe("0.0245 SOL / TOKEN");
  });
});

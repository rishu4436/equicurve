import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const connection = {
    getTokenSupply: vi.fn(),
    getTokenAccountBalance: vi.fn(),
    getTokenLargestAccounts: vi.fn(),
  };
  return {
    connection,
    getServerConnection: vi.fn(() => connection),
    withReadConnection: vi.fn(async (_primary: unknown, read: (connection: unknown) => Promise<unknown>) => read(connection)),
    reconstructPoolPriceHistory: vi.fn(),
    limitRequest: vi.fn(async () => ({ ok: true, retryAfterSec: 0 })),
    clientKey: vi.fn(() => "test-client"),
  };
});

vi.mock("@/lib/connection", () => ({
  getServerConnection: mocks.getServerConnection,
  withReadConnection: mocks.withReadConnection,
}));
vi.mock("@/lib/dbc/priceHistory", () => ({
  reconstructPoolPriceHistory: mocks.reconstructPoolPriceHistory,
}));
vi.mock("@/lib/server/http", () => ({ clientKey: mocks.clientKey }));
vi.mock("@/lib/server/rateLimit", () => ({ limitRequest: mocks.limitRequest }));

import { GET as holdersGet } from "@/app/api/markets/[id]/holders/route";
import { GET as historyGet } from "@/app/api/markets/[id]/price-history/route";

const MINT = "HWooSsdCWPq9sv87SGGqppGmpnf8VFNMa1RmZFtmo6j8";
const POOL = "D2fzZHDfHHNWybyXLBHdvgJR6vmfH2rMj6rKXQF1WmGY";
const CREATOR = "11111111111111111111111111111111";
const ACCOUNT = "So11111111111111111111111111111111111111112";

function params<T>(value: T) {
  return { params: Promise.resolve(value) };
}

describe("private market read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.getTokenSupply.mockResolvedValue({ value: { amount: "1000000000", decimals: 9 } });
    mocks.connection.getTokenAccountBalance.mockResolvedValue({ value: { amount: "250000000" } });
    mocks.connection.getTokenLargestAccounts.mockResolvedValue({
      value: [{ address: new PublicKey(ACCOUNT), amount: "750000000" }],
    });
    mocks.reconstructPoolPriceHistory.mockResolvedValue({
      points: [{ t: 1, price: 0.000000013, source: "swap", sig: "sig" }],
      spot: 0.000000013,
      scanned: 1,
      parsedSwaps: 1,
      error: null,
    });
  });

  it("uses the server/private RPC path and returns normalized holder data", async () => {
    const response = await holdersGet(
      new Request(`https://equicurve.test/api/markets/${MINT}/holders?creator=${CREATOR}`),
      params({ id: MINT }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      supplyAtoms: "1000000000",
      decimals: 9,
      creatorBalanceAtoms: "250000000",
      largest: [{ address: ACCOUNT, amountAtoms: "750000000" }],
      partial: false,
      error: null,
    });
    expect(mocks.getServerConnection).toHaveBeenCalled();
    expect(mocks.withReadConnection).toHaveBeenCalledWith(
      mocks.connection,
      expect.any(Function),
      { server: true },
    );
    expect(JSON.stringify(body)).not.toMatch(/helius|api[_-]?key|RPC_URL|DEVNET_RPC/i);
  });

  it("rejects an invalid mint before any RPC read", async () => {
    const response = await holdersGet(
      new Request("https://equicurve.test/api/markets/not-a-mint/holders"),
      params({ id: "not-a-mint" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_mint" });
    expect(mocks.getServerConnection).not.toHaveBeenCalled();
  });

  it("keeps largest-account RPC failure truthful and degraded", async () => {
    mocks.connection.getTokenLargestAccounts.mockRejectedValue(new Error("429 Too Many Requests"));
    const response = await holdersGet(
      new Request(`https://equicurve.test/api/markets/${MINT}/holders`),
      params({ id: MINT }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      supplyAtoms: "1000000000",
      largest: [],
      partial: true,
      error: "Largest token-account distribution is temporarily unavailable.",
    });
  });

  it("uses the canonical reconstruction path through server reads", async () => {
    const response = await historyGet(
      new Request(`https://equicurve.test/api/markets/${POOL}/price-history`),
      params({ id: POOL }),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, scanned: 1, parsedSwaps: 1, spot: 0.000000013 });
    expect(mocks.reconstructPoolPriceHistory).toHaveBeenCalledWith(
      mocks.connection,
      expect.objectContaining({}),
      { limit: 100 },
    );
    expect(mocks.withReadConnection).toHaveBeenCalledWith(
      mocks.connection,
      expect.any(Function),
      { server: true },
    );
    expect(JSON.stringify(body)).not.toMatch(/helius|api[_-]?key|RPC_URL|DEVNET_RPC/i);
  });

  it("accepts a verified server fallback connection for a transient history read", async () => {
    const fallback = { rpcEndpoint: "https://dedicated-devnet.example" };
    mocks.withReadConnection.mockImplementationOnce(async (_primary, read) => read(fallback));
    const response = await historyGet(
      new Request(`https://equicurve.test/api/markets/${POOL}/price-history`),
      params({ id: POOL }),
    );
    expect(response.status).toBe(200);
    expect(mocks.reconstructPoolPriceHistory).toHaveBeenCalledWith(
      fallback,
      expect.anything(),
      { limit: 100 },
    );
  });

  it("rejects an invalid pool before invoking reconstruction", async () => {
    const response = await historyGet(
      new Request("https://equicurve.test/api/markets/not-a-pool/price-history"),
      params({ id: "not-a-pool" }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: "invalid_pool" });
    expect(mocks.reconstructPoolPriceHistory).not.toHaveBeenCalled();
  });

  it("returns a truthful 503 when canonical history reads remain unavailable", async () => {
    mocks.reconstructPoolPriceHistory.mockRejectedValue(new Error("429 Too Many Requests"));
    const response = await historyGet(
      new Request(`https://equicurve.test/api/markets/${POOL}/price-history`),
      params({ id: POOL }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "rpc_unavailable",
      points: [],
      spot: null,
    });
  });
});

describe("market read client boundaries", () => {
  it("keeps one shared dynamic route directory for market reads", () => {
    const root = resolve(process.cwd(), "src/app/api/markets");
    const dynamicDirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("["))
      .map((entry) => entry.name)
      .sort();
    expect(dynamicDirs).toEqual(["[id]"]);
    expect(existsSync(resolve(root, "[id]/holders/route.ts"))).toBe(true);
    expect(existsSync(resolve(root, "[id]/price-history/route.ts"))).toBe(true);
  });

  it("keeps expensive reads out of the browser components", () => {
    const offering = readFileSync(resolve(process.cwd(), "src/components/offering/OfferingDetailClient.tsx"), "utf8");
    const chart = readFileSync(resolve(process.cwd(), "src/components/offering/PriceHistoryChart.tsx"), "utf8");
    expect(offering).not.toContain("getTokenLargestAccounts");
    expect(chart).not.toMatch(/getSignaturesForAddress|getParsedTransactions|reconstructPoolPriceHistory/);
    expect(chart).toContain("/api/markets/");
  });
});

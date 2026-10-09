import { vi, describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";

const mocks = vi.hoisted(() => ({
  fallbackConnection: { rpcEndpoint: "https://claim-fallback.example" },
  getDbcClient: vi.fn(),
  requireDbcPool: vi.fn(),
  withReadConnection: vi.fn(),
  setFreshBlockhash: vi.fn(),
}));

vi.mock("@/lib/connection", () => ({ withReadConnection: mocks.withReadConnection }));
vi.mock("@/lib/send", () => ({ setFreshBlockhash: mocks.setFreshBlockhash }));
vi.mock("@/lib/dbc/client", () => ({ getDbcClient: mocks.getDbcClient }));
vi.mock("@/lib/dbc/poolAccount", () => ({ requireDbcPool: mocks.requireDbcPool }));

import { prepareClaimCreatorFees, prepareClaimPartnerFees } from "@/lib/dbc/claim";

const creator = new PublicKey("11111111111111111111111111111111");
const feeClaimer = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const config = new PublicKey("SysvarRent111111111111111111111111111111111");
const pool = new PublicKey("Stake11111111111111111111111111111111111111");

function side() {
  return {
    unclaimedBaseFee: { toString: () => "5" },
    unclaimedQuoteFee: { toString: () => "7" },
    claimedBaseFee: { toString: () => "0" },
    claimedQuoteFee: { toString: () => "0" },
    totalBaseFee: { toString: () => "5" },
    totalQuoteFee: { toString: () => "7" },
  };
}

describe("claim pre-sign verified read connection", () => {
  it("builds creator claims from the verified fallback connection", async () => {
    mocks.withReadConnection.mockImplementation(async (_primary: unknown, read: (connection: unknown) => Promise<unknown>) => read(mocks.fallbackConnection));
    mocks.requireDbcPool.mockResolvedValue({ kind: "standard", state: { config, creator } });
    mocks.getDbcClient.mockImplementation((connection: unknown) => {
      expect(connection).toBe(mocks.fallbackConnection);
      return {
        state: {
          getPoolFeeBreakdown: async () => ({ creator: side(), partner: side() }),
          getPoolConfig: async () => ({ feeClaimer }),
        },
        creator: { claimCreatorTradingFee: async () => ({}) },
      };
    });
    const result = await prepareClaimCreatorFees({ connection: {} as never, creator, pool });
    expect(result.breakdown.creatorUnclaimedBase).toBe("5");
    expect(mocks.setFreshBlockhash).toHaveBeenCalledWith({}, expect.anything(), creator);
  });

  it("builds partner claims from the verified fallback connection", async () => {
    mocks.withReadConnection.mockImplementation(async (_primary: unknown, read: (connection: unknown) => Promise<unknown>) => read(mocks.fallbackConnection));
    mocks.requireDbcPool.mockResolvedValue({ kind: "standard", state: { config, creator } });
    mocks.getDbcClient.mockImplementation((connection: unknown) => {
      expect(connection).toBe(mocks.fallbackConnection);
      return {
        state: {
          getPoolFeeBreakdown: async () => ({ creator: side(), partner: side() }),
          getPoolConfig: async () => ({ feeClaimer }),
        },
        partner: { claimPartnerTradingFee: async () => ({}) },
      };
    });
    const result = await prepareClaimPartnerFees({ connection: {} as never, feeClaimer, pool });
    expect(result.breakdown.partnerUnclaimedQuote).toBe("7");
    expect(result.roles.feeClaimer).toBe(feeClaimer.toBase58());
  });
});

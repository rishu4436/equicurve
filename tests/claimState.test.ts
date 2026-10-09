import { describe, expect, it } from "vitest";
import { hasClaimableFees, type FeeBreakdown } from "@/lib/dbc/claim";

const zero: FeeBreakdown = {
  creatorUnclaimedBase: "0",
  creatorUnclaimedQuote: "0",
  creatorClaimedBase: "0",
  creatorClaimedQuote: "0",
  creatorTotalBase: "0",
  creatorTotalQuote: "0",
  partnerUnclaimedBase: "0",
  partnerUnclaimedQuote: "0",
  partnerClaimedBase: "0",
  partnerClaimedQuote: "0",
  partnerTotalBase: "0",
  partnerTotalQuote: "0",
};

describe("fee claim availability", () => {
  it("disables both claim paths when every unclaimed amount is zero", () => {
    expect(hasClaimableFees(zero, "creator")).toBe(false);
    expect(hasClaimableFees(zero, "partner")).toBe(false);
  });

  it("allows the exact role when either base or quote fees are claimable", () => {
    expect(hasClaimableFees({ ...zero, creatorUnclaimedQuote: "1" }, "creator")).toBe(true);
    expect(hasClaimableFees({ ...zero, partnerUnclaimedBase: "2" }, "partner")).toBe(true);
  });
});

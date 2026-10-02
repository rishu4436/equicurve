import { describe, expect, it } from "vitest";
import { parseBrief, designPolicy } from "@/lib/market/policy";
import {
  SEARCH_CAP_SPAN,
  SEARCH_MAX_MARKET_CAP,
  SEARCH_MAX_RAISE_UI,
  searchableRaiseError,
} from "@/lib/market/searchDomain";

const maxRaise = {
  asset: "rwa" as const,
  objective: "controlled-discovery" as const,
  quote: "USDC" as const,
  targetRaise: String(SEARCH_MAX_RAISE_UI),
  typicalTrade: "1000",
  participants: 4,
  stressPaths: 1,
};

describe("market-cap search domain", () => {
  it("keeps the expanded probe window inside the safe integer", () => {
    const span = BigInt(SEARCH_CAP_SPAN);
    const maxCap = BigInt(SEARCH_MAX_MARKET_CAP);
    const raise = BigInt(SEARCH_MAX_RAISE_UI);
    expect(SEARCH_MAX_RAISE_UI).toBe(54_975_581_388);
    expect(raise * span <= maxCap).toBe(true);
    expect((raise + 1n) * span > maxCap).toBe(true);
    expect(searchableRaiseError(SEARCH_MAX_RAISE_UI)).toBeNull();
    expect(searchableRaiseError(SEARCH_MAX_RAISE_UI + 1)).toMatch(/54,975,581,388|54975581388/);
  });

  it("accepts the maximum USDC raise and rejects one quote token more", () => {
    expect(parseBrief(maxRaise).targetAtoms).toBe(BigInt(SEARCH_MAX_RAISE_UI) * 1_000_000n);
    expect(() => parseBrief({ ...maxRaise, targetRaise: String(SEARCH_MAX_RAISE_UI + 1) })).toThrow(/quote tokens/);
  });

  it("still rejects a SOL raise that cannot fit in u64 atoms", () => {
    expect(() =>
      parseBrief({
        ...maxRaise,
        quote: "SOL",
        targetRaise: String(SEARCH_MAX_RAISE_UI),
        typicalTrade: "0.1",
      }),
    ).toThrow(/too large/);
  });

  it("finds a threshold inside the band at the maximum accepted raise", () => {
    const policy = designPolicy(maxRaise);
    expect(policy.chosen.thresholdGap).toBeLessThan(0.05);
    expect(policy.chosen.recipe.migrationMarketCap).toBeLessThanOrEqual(SEARCH_MAX_MARKET_CAP);
    expect(policy.chosen.recipe.initialMarketCap).toBeLessThanOrEqual(SEARCH_MAX_MARKET_CAP);
    const threshold = BigInt(policy.chosen.thresholdAtoms);
    const target = BigInt(SEARCH_MAX_RAISE_UI) * 1_000_000n;
    const gap = threshold > target ? threshold - target : target - threshold;
    expect(gap * 100n).toBeLessThan(target * 5n);
  }, 180_000);
});

import { describe, expect, it } from "vitest";
import { buildPresetConfig } from "@/lib/dbc/presets";
import { applyBuy, applySell, initialState, openBook } from "@/lib/market/book";
import { designPolicy, materializeRecipe } from "@/lib/market/policy";
import { scoreCandidate } from "@/lib/market/score";
import type { ScenarioReport } from "@/lib/market/types";

function scenario(partial: Partial<ScenarioReport> & Pick<ScenarioReport, "id">): ScenarioReport {
  return {
    label: partial.id,
    participantsAsked: null,
    ordersRun: 1,
    ordersSkipped: 0,
    quoteFilledAtoms: "0",
    quotePaidAtoms: "0",
    feesAtoms: "0",
    progress: 0,
    graduated: false,
    largestBuyImpactBps: 0,
    endMoveBps: 0,
    drawdownBps: 0,
    concentration: 0,
    note: "",
    ...partial,
  };
}

function shortBook() {
  return openBook(buildPresetConfig("short"), 9);
}

describe("curve book uses Meteora swap math", () => {
  it("charges the short preset's 150 bps opening fee on a 1 SOL buy", () => {
    const book = shortBook();
    expect(book.threshold.toString(10)).toBe("3090169943");
    const { state, fill } = applyBuy(book, initialState(book), 1_000_000_000n, 0);
    expect(fill.skipped).toBe(false);
    expect(fill.feeAtoms).toBe(15_000_000n);
    expect(fill.reserveAddedAtoms).toBe(985_000_000n);
    expect(state.quoteReserve).toBe(985_000_000n);
    expect(fill.filledInputAtoms).toBe(1_000_000_000n);
    expect(fill.impactBps).toBeGreaterThan(0);
    expect(fill.unusedAtoms).toBe(0n);
  });

  it("partial-fills a buy past the threshold and refuses another buy", () => {
    const book = shortBook();
    const first = applyBuy(book, initialState(book), 6_000_000_000n, 0);
    expect(first.fill.completed).toBe(true);
    expect(first.fill.unusedAtoms).toBeGreaterThan(0n);
    expect(first.state.quoteReserve).toBeGreaterThanOrEqual(book.threshold);
    expect(first.fill.filledInputAtoms).toBeLessThan(6_000_000_000n);
    const second = applyBuy(book, first.state, 1_000_000_000n, 10);
    expect(second.fill.skipped).toBe(true);
    expect(second.state.quoteReserve).toBe(first.state.quoteReserve);
  });

  it("sells base back down without taking quote the curve does not hold", () => {
    const book = shortBook();
    const bought = applyBuy(book, initialState(book), 500_000_000n, 0);
    expect(bought.state.heldBase).toBeGreaterThan(0n);
    const sold = applySell(book, bought.state, bought.state.heldBase, 60);
    expect(sold.state.heldBase).toBe(0n);
    expect(sold.state.quoteReserve).toBeLessThan(bought.state.quoteReserve);
    expect(sold.fill.impactBps).toBeLessThan(0);
  });
});

describe("objective score", () => {
  const calm = [
    scenario({ id: "retail", progress: 0.4, largestBuyImpactBps: 20 }),
    scenario({ id: "whale", largestBuyImpactBps: 80 }),
    scenario({ id: "late", progress: 0.3 }),
    scenario({ id: "sell-pressure", drawdownBps: -40 }),
    scenario({ id: "volatile" }),
  ];
  const violent = [
    scenario({ id: "retail", progress: 1, graduated: true, largestBuyImpactBps: 1800 }),
    scenario({ id: "whale", largestBuyImpactBps: 4000 }),
    scenario({ id: "late", progress: 1 }),
    scenario({ id: "sell-pressure", drawdownBps: -2500 }),
    scenario({ id: "volatile" }),
  ];

  it("ranks a calm curve above a violent one when the objective is stability", () => {
    const calmScore = scoreCandidate("stable", 30, calm);
    const violentScore = scoreCandidate("stable", 1500, violent);
    expect(calmScore).toBeGreaterThan(violentScore);
  });

  it("ranks reaching graduation above a calm incomplete curve when the objective is fast graduation", () => {
    const calmScore = scoreCandidate("fast-graduation", 30, calm);
    const violentScore = scoreCandidate("fast-graduation", 400, violent);
    expect(violentScore).toBeGreaterThan(calmScore);
  });
});

describe("launch policy", () => {
  it("designs a curve whose threshold matches the requested raise and rebuilds the same config", () => {
    const policy = designPolicy({
      asset: "private-company",
      objective: "fast-graduation",
      quote: "SOL",
      targetRaise: "3.090169943",
      typicalTrade: "0.1",
      participants: 8,
      stressPaths: 4,
    });
    expect(policy.observedLaunches).toBeNull();
    expect(policy.limits.join(" ")).toMatch(/synthetic/i);
    expect(policy.why.length).toBeGreaterThan(2);
    expect(policy.chosen.thresholdGap).toBeLessThan(0.02);
    expect(policy.chosen.scenarios.map((s) => s.id)).toEqual([
      "retail",
      "whale",
      "late",
      "sell-pressure",
      "volatile",
    ]);
    expect(policy.alternatives).toHaveLength(5);
    const rebuilt = materializeRecipe(policy.chosen.recipe);
    const again = openBook(rebuilt, 9);
    expect(again.threshold.toString(10)).toBe(policy.chosen.thresholdAtoms);
  });

  it("rejects a typical trade that is absurd relative to the raise", () => {
    expect(() =>
      designPolicy({
        asset: "rwa",
        objective: "stable",
        quote: "USDC",
        targetRaise: "1000",
        typicalTrade: "5000000",
        participants: 10,
        stressPaths: 1,
      }),
    ).toThrow(/1,000/);
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { swapQuotePartialFill } from "@meteora-ag/dynamic-bonding-curve-sdk";
import BN from "bn.js";
import { describe, expect, it } from "vitest";
import { marketConfigFingerprint } from "@/lib/dbc/configFingerprint";
import { launchCurveConfig } from "@/lib/dbc/create";
import { buildLaunchReview } from "@/lib/dbc/launchReview";
import { buildPresetConfig, validateEquiCurveConfig } from "@/lib/dbc/presets";
import { applyBuy, applySell, initialState, openBook, type BookState, type CurveBook } from "@/lib/market/book";
import { runCohortStress } from "@/lib/market/cohorts";
import { constraintsFor, scenarioAssumptions } from "@/lib/market/constraints";
import { sha256Hex } from "@/lib/market/hash";
import { prefer } from "@/lib/market/pareto";
import { DBC_SDK_VERSION, deploymentAllowed, designPolicy, materializeRecipe, toDesignedMarket } from "@/lib/market/policy";
import type { LaunchPolicy } from "@/lib/market/types";
import { namedScenarios } from "@/lib/market/scenarios";
import { updateReferences } from "@/lib/market/volatility";

function shortBook() {
  return openBook(buildPresetConfig("short"), 9);
}

function feeRate(fee: bigint, input: bigint): bigint {
  if (input <= 0n) return 0n;
  return (fee * 1_000_000n) / input;
}

function directQuote(book: CurveBook, state: BookState, amount: bigint, atSec: number) {
  const pre = book.dynamicFee
    ? { ...state, vol: updateReferences(state.vol, book.dynamicFee, state.sqrtPrice, atSec) }
    : state;
  const bn = (n: bigint) => new BN(n.toString(10));
  const quoted = swapQuotePartialFill(
    {
      poolState: {
        sqrtPrice: bn(pre.sqrtPrice),
        baseReserve: bn(0n),
        quoteReserve: bn(pre.quoteReserve),
        activationPoint: bn(0n),
        volatilityTracker: {
          lastUpdateTimestamp: bn(pre.vol.lastUpdate),
          sqrtPriceReference: bn(pre.vol.sqrtRef),
          volatilityAccumulator: bn(pre.vol.volAcc),
          volatilityReference: bn(pre.vol.volRef),
          padding: [0, 0, 0],
        },
      },
    } as never,
    book.config as never,
    false,
    bn(amount),
    0,
    false,
    bn(BigInt(atSec)),
    false,
  ) as {
    tradingFee: BN;
    protocolFee: BN;
    referralFee: BN;
    outputAmount: BN;
  };
  const fee =
    BigInt(quoted.tradingFee.toString()) +
    BigInt(quoted.protocolFee.toString()) +
    BigInt(quoted.referralFee.toString());
  return { fee, output: BigInt(quoted.outputAmount.toString()) };
}

function curveSignature(cfg: object): string {
  const c = cfg as {
    sqrtStartPrice: { toString(): string };
    migrationQuoteThreshold: { toString(): string };
    creatorTradingFeePercentage: number;
    partnerPermanentLockedLiquidityPercentage: number;
    enableFirstSwapWithMinFee: boolean;
    curve: { sqrtPrice: { toString(): string }; liquidity: { toString(): string } }[];
  };
  return [
    c.migrationQuoteThreshold.toString(),
    c.sqrtStartPrice.toString(),
    String(c.creatorTradingFeePercentage),
    String(c.partnerPermanentLockedLiquidityPercentage),
    String(c.enableFirstSwapWithMinFee),
    ...c.curve.map((p) => `${p.sqrtPrice.toString()}:${p.liquidity.toString()}`),
  ].join("|");
}

function withoutClock(policy: LaunchPolicy) {
  const { createdAt, ...rest } = policy;
  return rest;
}

const brief = {
  asset: "private-company" as const,
  objective: "fast-graduation" as const,
  quote: "SOL" as const,
  targetRaise: "3.090169943",
  typicalTrade: "0.1",
  participants: 8,
  stressPaths: 2,
};

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

describe("sha256", () => {
  it("matches the known empty and abc digests", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("frontier preference", () => {
  const calm = {
    referenceImpactBps: 30,
    whaleImpactBps: 80,
    drawdownBps: -40,
    retailProgress: 0.4,
    lateProgress: 0.3,
    stressGraduation: 0,
  };
  const violent = {
    referenceImpactBps: 1500,
    whaleImpactBps: 4000,
    drawdownBps: -2500,
    retailProgress: 1,
    lateProgress: 1,
    stressGraduation: 1,
  };

  it("prefers the calmer curve when the objective is stability", () => {
    expect(prefer("stable", calm, violent)).toBeLessThan(0);
  });

  it("prefers the curve that fills when the objective is fast graduation", () => {
    expect(prefer("fast-graduation", violent, calm)).toBeLessThan(0);
  });
});

describe("asset assumptions", () => {
  it("tightens equity-style assets relative to speculative ones", () => {
    const equity = constraintsFor("tokenized-equity", "stable");
    const speculative = constraintsFor("speculative", "fast-graduation");
    expect(equity.multipleMax).toBeLessThan(speculative.multipleMax);
    expect(equity.maxWhaleImpactBps).toBeLessThan(speculative.maxWhaleImpactBps);
    expect(scenarioAssumptions("tokenized-equity").whaleMultiple).toBeLessThan(
      scenarioAssumptions("speculative").whaleMultiple,
    );
  });

  it("changes whale impact when the asset assumption changes", () => {
    const book = shortBook();
    const calm = namedScenarios({
      book,
      typicalAtoms: 50_000_000n,
      participants: 8,
      feeDurationSec: 600,
      asset: "tokenized-equity",
    });
    const wild = namedScenarios({
      book,
      typicalAtoms: 50_000_000n,
      participants: 8,
      feeDurationSec: 600,
      asset: "speculative",
    });
    const calmWhale = calm.find((s) => s.id === "whale")!;
    const wildWhale = wild.find((s) => s.id === "whale")!;
    expect(wildWhale.largestBuyImpactBps).toBeGreaterThan(calmWhale.largestBuyImpactBps);
  });
});

describe("dynamic fee replay", () => {
  it("charges a variable fee on a fast follow-up and a smaller one after decay", () => {
    const book = openBook(buildPresetConfig("exponential"), 9);
    expect(book.dynamicFee).not.toBeNull();
    const amount = 1_000_000_000n;
    const first = applyBuy(book, initialState(book), amount, 1);
    const second = applyBuy(book, first.state, amount, 2);
    const third = applyBuy(book, second.state, amount, 3);
    expect(feeRate(second.fill.feeAtoms, second.fill.filledInputAtoms)).toBeGreaterThan(
      feeRate(first.fill.feeAtoms, first.fill.filledInputAtoms),
    );

    const gap1 = applyBuy(book, initialState(book), amount, 1);
    const gap2 = applyBuy(book, gap1.state, amount, 10_000);
    const gap3 = applyBuy(book, gap2.state, amount, 10_001);
    expect(feeRate(gap3.fill.feeAtoms, gap3.fill.filledInputAtoms)).toBeLessThan(
      feeRate(third.fill.feeAtoms, third.fill.filledInputAtoms),
    );
  });

  it("matches swapQuotePartialFill on the first and second buy", () => {
    const book = openBook(buildPresetConfig("exponential"), 9);
    const amount = 100_000_000n;
    const open = initialState(book);
    const firstDirect = directQuote(book, open, amount, 0);
    const first = applyBuy(book, open, amount, 0);
    expect(first.fill.feeAtoms).toBe(firstDirect.fee);
    expect(first.fill.outputAtoms).toBe(firstDirect.output);

    const secondDirect = directQuote(book, first.state, amount, 1);
    const second = applyBuy(book, first.state, amount, 1);
    expect(second.fill.feeAtoms).toBe(secondDirect.fee);
    expect(second.fill.outputAtoms).toBe(secondDirect.output);
  });

  it("flags a static fee as not-used and an unreadable dynamic fee as base-only", () => {
    const plain = openBook(buildPresetConfig("short"), 9);
    expect(plain.dynamicFee).toBeNull();
    expect(plain.dynamicFeeUnreadable).toBe(false);
    const cfg = buildPresetConfig("short") as {
      poolFees: { baseFee: unknown; dynamicFee: unknown };
    };
    const broken = openBook(
      {
        ...cfg,
        poolFees: { ...cfg.poolFees, dynamicFee: { initialized: 1, binStep: 0, variableFeeControl: 0 } },
      } as never,
      9,
    );
    expect(broken.dynamicFee).toBeNull();
    expect(broken.dynamicFeeUnreadable).toBe(true);
  });
});

describe("cohort stress", () => {
  it("repeats a seed and changes when the seed changes", () => {
    const book = shortBook();
    const args = { book, typicalAtoms: 100_000_000n, feeDurationSec: 600, paths: 6 };
    const a = runCohortStress({ ...args, seed: 1 });
    const b = runCohortStress({ ...args, seed: 1 });
    const c = runCohortStress({ ...args, seed: 2 });
    expect(a.signature).toBe(b.signature);
    expect(a.signature).not.toBe(c.signature);
    expect(a.worstProgress).toBeLessThanOrEqual(a.p10Progress);
    expect(a.p10Progress).toBeLessThanOrEqual(a.medianProgress);
  });

  it("changes the retail sample when the participant count changes", () => {
    const book = shortBook();
    const args = { book, typicalAtoms: 100_000_000n, feeDurationSec: 600, paths: 4, seed: 7 };
    const few = runCohortStress({ ...args, participants: 4 });
    const many = runCohortStress({ ...args, participants: 80 });
    expect(few.participantSample).toBe(4);
    expect(many.participantSample).toBe(64);
    expect(few.signature).not.toBe(many.signature);
  });
});

describe("named samples", () => {
  it("caps retail orders at 64 and says how many participants were asked", () => {
    const book = shortBook();
    const hundred = namedScenarios({ book, typicalAtoms: 20_000_000n, participants: 100, feeDurationSec: 600 });
    const many = namedScenarios({ book, typicalAtoms: 20_000_000n, participants: 100_000, feeDurationSec: 600 });
    const retailHundred = hundred.find((s) => s.id === "retail")!;
    const retailMany = many.find((s) => s.id === "retail")!;
    expect(retailHundred.ordersRun).toBe(64);
    expect(retailMany.ordersRun).toBe(64);
    expect(retailHundred.note).toMatch(/100/);
    expect(retailMany.note).toMatch(/100000|100,000/);
  });

  it("gives a huge whale a larger price move than a small one", () => {
    const book = shortBook();
    const small = namedScenarios({ book, typicalAtoms: 5_000_000n, participants: 4, feeDurationSec: 600 });
    const huge = namedScenarios({ book, typicalAtoms: 200_000_000n, participants: 4, feeDurationSec: 600 });
    expect(huge.find((s) => s.id === "whale")!.largestBuyImpactBps).toBeGreaterThan(
      small.find((s) => s.id === "whale")!.largestBuyImpactBps,
    );
  });
});

describe("launch policy", () => {
  it("locks the SDK version string to the installed package", () => {
    const installed = JSON.parse(
      readFileSync(resolve("node_modules/@meteora-ag/dynamic-bonding-curve-sdk/package.json"), "utf8"),
    ).version as string;
    expect(DBC_SDK_VERSION).toBe(installed);
    const lock = JSON.parse(readFileSync(resolve("package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string }>;
    };
    expect(DBC_SDK_VERSION).toBe(lock.packages["node_modules/@meteora-ag/dynamic-bonding-curve-sdk"]?.version);
  });

  it("designs a deployable curve and repeats it for the same seed", () => {
    const first = designPolicy(brief);
    const second = designPolicy(brief);
    expect(withoutClock(first)).toEqual(withoutClock(second));
    expect(first.policyId).toBe(second.policyId);
    expect(first.createdAt).not.toBe("");
    expect(first.observedLaunches).toBeNull();
    expect(first.limits.join(" ")).toMatch(/synthetic/i);
    expect(first.why.length).toBeGreaterThan(2);
    expect(first.chosen.thresholdGap).toBeLessThan(0.05);
    expect(first.chosen.scenarios.map((s) => s.id)).toEqual([
      "retail",
      "whale",
      "late",
      "sell-pressure",
      "volatile",
    ]);
    expect(first.chosen.recipe.creatorTradingFeePercentage).toBe(70);
    expect(first.chosen.recipe.lpLockPct).toBe(100);
    expect(first.chosen.recipe.antiSniper).toBe(true);
    expect(first.candidates.length).toBeGreaterThan(1);
    expect(first.alternatives.length).toBeLessThan(first.candidates.length);
    expect(first.search.stage).toBe("coarse-to-fine");
    expect(first.search.multiples.length).toBeGreaterThan(3);
    expect(first.search.candidateCount).toBe(first.candidates.length);
    expect(first.why.join(" ")).toMatch(/preferred (feasible design|candidate) among/i);
    expect(first.why.join(" ")).not.toMatch(/optimal curve/i);
    const designed = toDesignedMarket(first);
    if (!first.chosen.feasible) {
      expect(first.why.join(" ")).toMatch(/tradeoff example/i);
      expect(first.why.join(" ")).not.toMatch(/preferred feasible design/i);
      expect(first.negotiation.status).toBe("needs-decision");
      expect(first.negotiation.budgetError).toBeNull();
      expect(deploymentAllowed(first)).toBe(false);
      expect(designed.constraintPolicy).toBeUndefined();
    } else {
      expect(first.negotiation.status).toBe("satisfied");
      expect(deploymentAllowed(first)).toBe(true);
      expect(designed.constraintPolicy?.relaxed).toEqual([]);
      expect(designed.constraintPolicy?.requested).toEqual(first.negotiation.requested);
      expect(designed.constraintPolicy?.applied).toEqual(first.negotiation.applied);
    }
    expect(first.limits.join(" ")).not.toMatch(/were relaxed/i);
    expect(first.limits.join(" ")).not.toMatch(/closest curves are shown/i);
    expect(first.chosen.stressWorstProgress).toBeLessThanOrEqual(first.chosen.stressP10Progress);
    expect(first.chosen.stressP10Progress).toBeLessThanOrEqual(first.chosen.stressMedianProgress);
    expect(first.limits.join(" ")).toMatch(/representative sample/i);
    const retailTrace = first.chosen.scenarios.find((s) => s.id === "retail");
    expect(retailTrace?.trace.length).toBeGreaterThan(0);

    for (const row of first.candidates) {
      expect(validateEquiCurveConfig(materializeRecipe(row.recipe))).toEqual([]);
      expect(row.recipe.creatorTradingFeePercentage).toBe(70);
      expect(row.recipe.lpLockPct).toBe(100);
      const preset = row.recipe.presetId;
      if (preset === "exponential" || preset === "equity") expect(row.dynamicFeeStatus).toBe("simulated");
      if (preset === "short" || preset === "flat" || preset === "long") expect(row.dynamicFeeStatus).toBe("not-used");
      const rebuilt = materializeRecipe(row.recipe);
      const deployed = launchCurveConfig({
        presetId: row.recipe.presetId,
        totalSupply: row.recipe.totalSupply,
        creatorTradingFeePercentage: row.recipe.creatorTradingFeePercentage,
        lpLockPct: row.recipe.lpLockPct,
        mintRenounce: true,
        antiSniper: row.recipe.antiSniper,
        quoteDecimals: 9,
        transferProfile: "open-spl",
        marketCaps: {
          initial: row.recipe.initialMarketCap,
          migration: row.recipe.migrationMarketCap,
        },
      });
      const reviewed = buildLaunchReview({
        presetId: row.recipe.presetId,
        quote: "SOL",
        quoteMint: "So11111111111111111111111111111111111111112",
        transferProfile: "open-spl",
        totalSupply: row.recipe.totalSupply,
        creatorPct: row.recipe.creatorTradingFeePercentage,
        lpLockPct: row.recipe.lpLockPct,
        mintRenounce: true,
        antiSniper: row.recipe.antiSniper,
        feeClaimer: "",
        wallet: null,
        seedBuy: "0",
        cluster: "devnet",
        sharedConfig: null,
        marketCaps: {
          initial: row.recipe.initialMarketCap,
          migration: row.recipe.migrationMarketCap,
        },
      });
      expect(row.configFingerprint).toBe(marketConfigFingerprint(rebuilt));
      expect(marketConfigFingerprint(deployed)).toBe(row.configFingerprint);
      expect(reviewed.configFingerprint).toBe(row.configFingerprint);
      expect(reviewed.migrationQuoteThresholdAtoms).toBe(row.thresholdAtoms);
    }

    const rebuilt = materializeRecipe(first.chosen.recipe);
    expect(openBook(rebuilt, 9).threshold.toString(10)).toBe(first.chosen.thresholdAtoms);
    const deployed = launchCurveConfig({
      presetId: first.chosen.recipe.presetId,
      totalSupply: first.chosen.recipe.totalSupply,
      creatorTradingFeePercentage: first.chosen.recipe.creatorTradingFeePercentage,
      lpLockPct: first.chosen.recipe.lpLockPct,
      mintRenounce: true,
      antiSniper: first.chosen.recipe.antiSniper,
      quoteDecimals: 9,
      transferProfile: "open-spl",
      marketCaps: {
        initial: first.chosen.recipe.initialMarketCap,
        migration: first.chosen.recipe.migrationMarketCap,
      },
    });
    expect(curveSignature(deployed)).toBe(curveSignature(rebuilt));

    const review = buildLaunchReview({
      presetId: first.chosen.recipe.presetId,
      quote: "SOL",
      quoteMint: "So11111111111111111111111111111111111111112",
      transferProfile: "open-spl",
      totalSupply: first.chosen.recipe.totalSupply,
      creatorPct: first.chosen.recipe.creatorTradingFeePercentage,
      lpLockPct: first.chosen.recipe.lpLockPct,
      mintRenounce: true,
      antiSniper: first.chosen.recipe.antiSniper,
      feeClaimer: "",
      wallet: null,
      seedBuy: "0",
      cluster: "devnet",
      sharedConfig: null,
      marketCaps: {
        initial: first.chosen.recipe.initialMarketCap,
        migration: first.chosen.recipe.migrationMarketCap,
      },
    });
    expect(review.migrationQuoteThresholdAtoms).toBe(first.chosen.thresholdAtoms);
  }, 180_000);

  it("changes the policy id when the seed changes", () => {
    const a = designPolicy({ ...brief, seed: 1 });
    const b = designPolicy({ ...brief, seed: 2 });
    expect(a.policyId).not.toBe(b.policyId);
    expect(a.chosen.recipe.creatorTradingFeePercentage).toBe(b.chosen.recipe.creatorTradingFeePercentage);
  }, 180_000);

  it("keeps a 20 billion USDC raise inside the threshold band", () => {
    const policy = designPolicy({
      asset: "rwa",
      objective: "controlled-discovery",
      quote: "USDC",
      targetRaise: "20000000000",
      typicalTrade: "1000",
      participants: 4,
      stressPaths: 1,
    });
    expect(policy.chosen.thresholdGap).toBeLessThan(0.05);
    const threshold = BigInt(policy.chosen.thresholdAtoms);
    const target = 20_000_000_000n * 1_000_000n;
    const gap = threshold > target ? threshold - target : target - threshold;
    expect(gap * 100n).toBeLessThan(target * 5n);
  }, 180_000);

  it("says when the retail sample is capped", () => {
    const policy = designPolicy({ ...brief, participants: 100_000, stressPaths: 1 });
    expect(policy.limits.join(" ")).toMatch(/64/);
    const retail = policy.chosen.scenarios.find((s) => s.id === "retail");
    expect(retail?.ordersRun).toBeLessThanOrEqual(64);
    expect(retail?.participantsAsked).toBe(100_000);
  }, 180_000);

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

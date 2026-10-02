import { describe, expect, it } from "vitest";
import { assessRobustness, readConstraintMetrics, scaledParticipants } from "@/lib/market/robustness";
import type { ConstraintBudget } from "@/lib/market/types";
import { designPolicy } from "@/lib/market/policy";
import type { CandidateReport } from "@/lib/market/types";

const brief = {
  asset: "private-company" as const,
  objective: "fast-graduation" as const,
  quote: "SOL" as const,
  targetRaise: "3.090169943",
  typicalTrade: "0.1",
  participants: 8,
  stressPaths: 2,
};

function snapshot(row: CandidateReport) {
  return {
    fingerprint: row.configFingerprint,
    initial: row.recipe.initialMarketCap,
    migration: row.recipe.migrationMarketCap,
    impact: row.reference.impactBps,
    rejected: [...row.rejected],
    whale: row.scenarios.find((item) => item.id === "whale")?.largestBuyImpactBps,
    retail: row.scenarios.find((item) => item.id === "retail")?.progress,
  };
}

const budget: ConstraintBudget = {
  maxThresholdGap: 0.05,
  maxReferenceImpactBps: 1200,
  maxWhaleImpactBps: 2200,
  maxConcentration: 0.55,
  minRetailProgress: 0.2,
};

describe("robustness of one design", () => {
  it("names the limit that failed when another displayed limit still passed", () => {
    const metrics = readConstraintMetrics(
      {
        thresholdGap: 0.01,
        referenceImpactBps: 100,
        whaleImpactBps: 2040,
        concentration: 0.2,
        retailProgress: 0.18,
      },
      budget,
      ["whale"],
    );
    expect(metrics.map((item) => item.id)).toEqual(["threshold", "reference", "whale", "concentration", "retail"]);
    expect(metrics.find((item) => item.id === "whale")).toMatchObject({
      passed: true,
      value: 2040,
      limit: 2200,
      bound: "maximum",
      focus: true,
    });
    expect(metrics.find((item) => item.id === "retail")).toMatchObject({
      passed: false,
      value: 0.18,
      limit: 0.2,
      bound: "minimum",
    });
    expect(metrics.filter((item) => !item.passed).map((item) => item.label)).toEqual(["Minimum retail fill"]);
  });

  it("scales the participant sample without dropping below one", () => {
    expect(scaledParticipants(1)).toBe(1);
    expect(scaledParticipants(4)).toBe(3);
    expect(scaledParticipants(40)).toBe(30);
  });

  it("moves one assumption at a time and leaves the chosen curve alone", () => {
    const policy = designPolicy(brief);
    const before = snapshot(policy.chosen);
    const report = assessRobustness({
      chosen: policy.chosen,
      brief: policy.brief,
      budget: policy.negotiation.applied,
    });
    expect(snapshot(policy.chosen)).toEqual(before);
    expect(report.fingerprint).toBe(policy.chosen.configFingerprint);
    expect(report.caseCount).toBe(4);
    expect(report.cases.map((item) => item.id)).toEqual([
      "base",
      "whale-plus",
      "typical-plus",
      "participants-minus",
    ]);
    expect(report.insideCount).toBe(report.cases.filter((item) => item.insideBudget).length);
    expect(report.note).toMatch(/do not select another design/i);

    const base = report.cases[0];
    const whale = report.cases[1];
    const typical = report.cases[2];
    const participants = report.cases[3];
    const value = (id: "reference" | "whale" | "retail", item: typeof base) =>
      item.metrics.find((metric) => metric.id === id)?.value ?? 0;
    const ids = ["threshold", "reference", "whale", "concentration", "retail"];

    expect(value("whale", whale)).toBeGreaterThanOrEqual(before.whale ?? 0);
    expect(value("reference", typical)).toBeGreaterThanOrEqual(before.impact);
    expect(base.metrics.map((metric) => metric.id)).toEqual(ids);
    expect(whale.metrics.map((metric) => metric.id)).toEqual(ids);
    expect(typical.metrics.map((metric) => metric.id)).toEqual(ids);
    expect(participants.metrics.map((metric) => metric.id)).toEqual(ids);
    for (const item of report.cases) {
      expect(item.insideBudget).toBe(item.blocking.length === 0);
      expect(item.blocking).toEqual(item.metrics.filter((metric) => !metric.passed).map((metric) => metric.label));
    }
    expect(whale.metrics.find((metric) => metric.focus)?.id).toBe("whale");
    expect(value("retail", participants)).toBeLessThanOrEqual(before.retail ?? 0);
    expect(participants.note).toMatch(/from 8 to 6/);

    const again = assessRobustness({
      chosen: policy.chosen,
      brief: policy.brief,
      budget: policy.negotiation.applied,
    });
    expect(again.cases.map((item) => item.metrics)).toEqual(report.cases.map((item) => item.metrics));
    expect(again.cases.map((item) => item.insideBudget)).toEqual(report.cases.map((item) => item.insideBudget));
    expect(snapshot(policy.chosen)).toEqual(before);
  }, 60_000);
});

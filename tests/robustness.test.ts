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
    expect(report.shockCount).toBe(10);
    expect(report.axes.map((axis) => axis.id)).toEqual(["whale", "typical", "participants", "sell", "late"]);
    expect(report.shockInsideCount).toBe(
      report.axes.flatMap((axis) => axis.cells).filter((cell) => cell.level !== "base" && cell.insideBudget).length,
    );
    expect(report.note).toMatch(/do not select another design/i);
    expect(report.note).toMatch(/no robustness score/i);

    const axis = (id: "whale" | "typical" | "participants" | "sell" | "late") =>
      report.axes.find((item) => item.id === id)!;
    const cell = (id: "whale" | "typical" | "participants" | "sell" | "late", level: "minus" | "base" | "plus") =>
      axis(id).cells.find((item) => item.level === level)!;
    const value = (id: "reference" | "whale" | "retail", item: ReturnType<typeof cell>) =>
      item.metrics.find((metric) => metric.id === id)?.value ?? 0;
    const budgetShape = (item: ReturnType<typeof cell>) =>
      item.metrics.map((metric) => ({ id: metric.id, value: metric.value, passed: metric.passed }));
    const ids = ["threshold", "reference", "whale", "concentration", "retail"];

    expect(value("whale", cell("whale", "plus"))).toBeGreaterThanOrEqual(before.whale ?? 0);
    expect(value("reference", cell("typical", "plus"))).toBeGreaterThanOrEqual(before.impact);
    expect(value("retail", cell("participants", "minus"))).toBeLessThanOrEqual(before.retail ?? 0);
    expect(cell("participants", "minus").note).toMatch(/from 8 to 6/);
    expect(cell("participants", "plus").note).toMatch(/from 8 to 10/);
    expect(cell("whale", "plus").metrics.find((metric) => metric.focus)?.id).toBe("whale");
    expect(budgetShape(cell("sell", "plus"))).toEqual(budgetShape(cell("sell", "base")));
    expect(budgetShape(cell("late", "plus"))).toEqual(budgetShape(cell("late", "base")));
    expect(budgetShape(cell("sell", "base"))).toEqual(budgetShape(cell("whale", "base")));
    expect(cell("sell", "plus").observation?.detail).toMatch(/4375 bps/);
    expect(cell("sell", "minus").observation?.detail).toMatch(/2625 bps/);
    expect(cell("sell", "plus").observation?.detail).toMatch(/not one of the five budget limits/);
    expect(cell("late", "plus").observation?.detail).toMatch(/not one of the five budget limits/);

    for (const item of report.axes.flatMap((row) => row.cells)) {
      expect(item.metrics.map((metric) => metric.id)).toEqual(ids);
      expect(item.insideBudget).toBe(item.blocking.length === 0);
      expect(item.blocking).toEqual(item.metrics.filter((metric) => !metric.passed).map((metric) => metric.label));
    }
    const labels = report.axes.map((row) => row.label);
    expect(report.mostSensitive.every((name) => labels.includes(name))).toBe(true);
    expect(report.leastSensitive.every((name) => labels.includes(name))).toBe(true);
    const highest = Math.max(...report.axes.map((row) => row.departures));
    if (highest === 0 || report.tied) {
      expect(report.mostSensitive).toEqual([]);
      expect(report.leastSensitive).toEqual([]);
    } else {
      expect(report.mostSensitive).toEqual(
        report.axes.filter((row) => row.departures === highest).map((row) => row.label),
      );
    }

    const again = assessRobustness({
      chosen: policy.chosen,
      brief: policy.brief,
      budget: policy.negotiation.applied,
    });
    expect(again.axes.map((row) => row.cells.map((item) => item.metrics))).toEqual(
      report.axes.map((row) => row.cells.map((item) => item.metrics)),
    );
    expect(again.axes.map((row) => row.cells.map((item) => item.insideBudget))).toEqual(
      report.axes.map((row) => row.cells.map((item) => item.insideBudget)),
    );
    expect(snapshot(policy.chosen)).toEqual(before);
  }, 60_000);
});

import type { MarketObjective, ScenarioReport } from "./types";

/**
 * Weights sum to 100. A higher score is a better fit for that objective.
 * Impact and sell-drawdown are rewards for small moves. Progress is a reward
 * for actually raising the quote the issuer asked for.
 */
const WEIGHTS: Record<
  MarketObjective,
  { impact: number; whale: number; sell: number; retail: number; late: number }
> = {
  stable: { impact: 40, whale: 25, sell: 20, retail: 10, late: 5 },
  "controlled-discovery": { impact: 25, whale: 20, sell: 15, retail: 25, late: 15 },
  participation: { impact: 20, whale: 10, sell: 10, retail: 40, late: 20 },
  "fast-graduation": { impact: 10, whale: 10, sell: 5, retail: 45, late: 30 },
  "long-runway": { impact: 20, whale: 15, sell: 15, retail: 15, late: 35 },
  "whale-protection": { impact: 15, whale: 45, sell: 15, retail: 15, late: 10 },
};

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** 0 bps → 1, 2_000 bps (20%) → 0. Moves past 20% score 0. */
function calm(bps: number): number {
  return clamp01(1 - Math.abs(bps) / 2_000);
}

function byId(reports: ScenarioReport[], id: ScenarioReport["id"]): ScenarioReport {
  const found = reports.find((r) => r.id === id);
  if (!found) throw new Error(`Missing scenario ${id}.`);
  return found;
}

export function scoreCandidate(objective: MarketObjective, referenceImpactBps: number, scenarios: ScenarioReport[]): number {
  const w = WEIGHTS[objective];
  const retail = byId(scenarios, "retail");
  const whale = byId(scenarios, "whale");
  const late = byId(scenarios, "late");
  const sell = byId(scenarios, "sell-pressure");
  const raw =
    w.impact * calm(referenceImpactBps) +
    w.whale * calm(whale.largestBuyImpactBps) +
    w.sell * calm(sell.drawdownBps) +
    w.retail * clamp01(retail.progress) +
    w.late * clamp01(late.progress);
  return Math.round(raw * 100) / 100;
}

export function objectiveLabel(objective: MarketObjective): string {
  switch (objective) {
    case "stable":
      return "price stability";
    case "controlled-discovery":
      return "controlled price discovery";
    case "participation":
      return "broad participation";
    case "fast-graduation":
      return "reaching graduation quickly";
    case "long-runway":
      return "a long discovery runway";
    case "whale-protection":
      return "limiting the price impact of large buys";
  }
}

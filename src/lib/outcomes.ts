import "server-only";

import type {
  CycleOutcomeEvaluation,
  MarkedPaperPosition,
  OutcomeEvaluationSummary,
  OutcomeHorizon,
  PaperBookSummary,
} from "@/lib/types";

const HORIZON_HOURS: Record<OutcomeHorizon, number> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
};

function sum(xs: number[]): number {
  return xs.reduce((total, x) => total + x, 0);
}

function mean(xs: number[]): number | null {
  return xs.length ? sum(xs) / xs.length : null;
}

function weightedAverage(rows: Array<{ weight: number; value: number }>): number | null {
  const totalWeight = sum(rows.map((r) => r.weight));
  if (totalWeight <= 0 || !rows.length) return null;
  return sum(rows.map((r) => r.weight * r.value)) / totalWeight;
}

function finite(xs: Array<number | null | undefined>): number[] {
  return xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

function byCycle(positions: MarkedPaperPosition[]): Map<string, MarkedPaperPosition[]> {
  const grouped = new Map<string, MarkedPaperPosition[]>();
  for (const position of positions) {
    const rows = grouped.get(position.cycleId) ?? [];
    rows.push(position);
    grouped.set(position.cycleId, rows);
  }
  return grouped;
}

function evaluateCycle(
  cycleId: string,
  rows: MarkedPaperPosition[],
  horizon: OutcomeHorizon,
  now: Date,
): CycleOutcomeEvaluation {
  const openedAt = rows.map((r) => r.openedAt).sort()[0] ?? now.toISOString();
  const openedMs = Date.parse(openedAt);
  const ageHours = Number.isFinite(openedMs)
    ? Math.max(0, (now.getTime() - openedMs) / (60 * 60 * 1000))
    : 0;
  const notionalUsd = sum(rows.map((r) => r.notionalUsd));
  const currentValueUsd = sum(rows.map((r) => r.currentValueUsd));
  const returnPct = notionalUsd > 0 ? (currentValueUsd - notionalUsd) / notionalUsd : 0;
  const benchmarkReturnPct = weightedAverage(
    rows
      .filter((r) => r.benchmarkReturnPct != null)
      .map((r) => ({ weight: r.notionalUsd, value: r.benchmarkReturnPct as number })),
  );
  const alphaVsBenchmarkPct =
    benchmarkReturnPct == null ? null : returnPct - benchmarkReturnPct;
  const positionReturns = rows.map((r) => r.returnPct);
  const hitRate = positionReturns.length
    ? positionReturns.filter((r) => r > 0).length / positionReturns.length
    : null;
  const avgExpectedReturn = mean(finite(rows.map((r) => r.expectedReturn))) ?? 0;
  const calibrationErrorPct = returnPct - avgExpectedReturn;

  return {
    cycleId,
    horizon,
    status: ageHours >= HORIZON_HOURS[horizon] ? "ready" : "pending",
    openedAt,
    evaluatedAt: now.toISOString(),
    ageHours,
    positions: rows.length,
    notionalUsd,
    returnPct,
    benchmarkReturnPct,
    alphaVsBenchmarkPct,
    hitRate,
    avgForecastScore: mean(finite(rows.map((r) => r.forecastScore))) ?? 0,
    avgExpectedReturn,
    calibrationErrorPct,
    maxDrawdownProxyPct: Math.min(0, ...positionReturns),
  };
}

export function buildOutcomeEvaluationSummary(
  paperBook: PaperBookSummary,
  now = new Date(),
): OutcomeEvaluationSummary {
  const grouped = byCycle(paperBook.openPositions ?? []);
  const evaluations = [...grouped.entries()]
    .flatMap(([cycleId, rows]) =>
      (Object.keys(HORIZON_HOURS) as OutcomeHorizon[]).map((horizon) =>
        evaluateCycle(cycleId, rows, horizon, now),
      ),
    )
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));

  const horizons = (Object.keys(HORIZON_HOURS) as OutcomeHorizon[]).map((horizon) => {
    const rows = evaluations.filter((e) => e.horizon === horizon);
    const ready = rows.filter((e) => e.status === "ready");
    return {
      horizon,
      readyCycles: ready.length,
      pendingCycles: rows.length - ready.length,
      avgReturnPct: mean(ready.map((e) => e.returnPct)),
      avgAlphaPct: mean(finite(ready.map((e) => e.alphaVsBenchmarkPct))),
      hitRate: mean(finite(ready.map((e) => e.hitRate))),
      avgCalibrationErrorPct: mean(finite(ready.map((e) => e.calibrationErrorPct))),
    };
  });

  return {
    generatedAt: now.toISOString(),
    horizons,
    evaluations,
  };
}

import { describe, expect, it } from "vitest";

import { buildOutcomeEvaluationSummary } from "../lib/outcomes";
import type { MarkedPaperPosition, PaperBookSummary } from "../lib/types";

function position(overrides: Partial<MarkedPaperPosition> = {}): MarkedPaperPosition {
  return {
    id: "p1",
    cycleId: "cycle-a",
    symbol: "ETH/USD",
    assetClass: "crypto",
    timeframe: "15Min",
    openedAt: "2026-01-01T00:00:00.000Z",
    entryPrice: 100,
    quantity: 1,
    notionalUsd: 100,
    forecastScore: 0.8,
    expectedReturn: 0.04,
    benchmarkSymbol: "BTC/USD",
    status: "open",
    markPrice: 112,
    markAt: "2026-01-02T00:00:00.000Z",
    currentValueUsd: 112,
    unrealizedPnlUsd: 12,
    returnPct: 0.12,
    ageHours: 24,
    benchmarkReturnPct: 0.03,
    alphaVsBenchmarkPct: 0.09,
    ...overrides,
  };
}

function book(openPositions: MarkedPaperPosition[]): PaperBookSummary {
  return {
    generatedAt: "2026-01-02T00:00:00.000Z",
    openPositions,
    cycleOutcomes: [],
    totals: {
      openCount: openPositions.length,
      notionalUsd: 100,
      currentValueUsd: 112,
      unrealizedPnlUsd: 12,
      returnPct: 0.12,
      benchmarkReturnPct: 0.03,
      alphaVsBenchmarkPct: 0.09,
    },
  };
}

describe("outcome evaluator", () => {
  it("marks horizons ready only after enough elapsed time", () => {
    const summary = buildOutcomeEvaluationSummary(
      book([position()]),
      new Date("2026-01-01T06:30:00.000Z"),
    );

    expect(summary.evaluations.find((e) => e.horizon === "1h")?.status).toBe("ready");
    expect(summary.evaluations.find((e) => e.horizon === "6h")?.status).toBe("ready");
    expect(summary.evaluations.find((e) => e.horizon === "24h")?.status).toBe("pending");
  });

  it("computes alpha, hit rate, and calibration error", () => {
    const summary = buildOutcomeEvaluationSummary(
      book([position(), position({ id: "p2", returnPct: -0.02, currentValueUsd: 98 })]),
      new Date("2026-01-02T01:00:00.000Z"),
    );
    const oneHour = summary.evaluations.find((e) => e.horizon === "1h");

    expect(oneHour?.hitRate).toBe(0.5);
    expect(oneHour?.alphaVsBenchmarkPct).toBeCloseTo(0.02);
    expect(oneHour?.calibrationErrorPct).toBeCloseTo(0.01);
  });
});

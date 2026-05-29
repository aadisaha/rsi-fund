import { describe, expect, it } from "vitest";

import { buildInvestmentChannelCalibration } from "../lib/investment-estimator";
import type { PaperBookSummary } from "../lib/types";

function book(overrides: Partial<PaperBookSummary> = {}): PaperBookSummary {
  return {
    generatedAt: "2026-01-01T00:00:00.000Z",
    openPositions: [],
    cycleOutcomes: [],
    totals: {
      openCount: 0,
      notionalUsd: 0,
      currentValueUsd: 0,
      unrealizedPnlUsd: 0,
      returnPct: 0,
      benchmarkReturnPct: null,
      alphaVsBenchmarkPct: null,
    },
    ...overrides,
  };
}

describe("investment estimator", () => {
  it("uses the investment prior when there is no paper evidence", () => {
    const calibration = buildInvestmentChannelCalibration(book());
    expect(calibration.diagnostics.sampleSize).toBe(0);
    expect(calibration.channel.meanReturn).toBeCloseTo(0.075);
    expect(calibration.channel.readiness).toBeCloseTo(0.74);
  });

  it("raises the blended mean with positive paper alpha", () => {
    const calibration = buildInvestmentChannelCalibration(
      book({
        openPositions: Array.from({ length: 10 }, (_, i) => ({
          id: `p${i}`,
          cycleId: `c${i}`,
          symbol: "BTC/USD",
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
          markPrice: 115,
          markAt: "2026-01-02T00:00:00.000Z",
          currentValueUsd: 115,
          unrealizedPnlUsd: 15,
          returnPct: 0.15,
          ageHours: 24,
          benchmarkReturnPct: 0.03,
          alphaVsBenchmarkPct: 0.12,
        })),
        totals: {
          openCount: 10,
          notionalUsd: 1_000,
          currentValueUsd: 1_150,
          unrealizedPnlUsd: 150,
          returnPct: 0.15,
          benchmarkReturnPct: 0.03,
          alphaVsBenchmarkPct: 0.12,
        },
      }),
    );

    expect(calibration.diagnostics.evidenceWeight).toBeGreaterThan(0);
    expect(calibration.channel.meanReturn).toBeGreaterThan(0.075);
  });

  it("lowers the blended mean with negative paper alpha", () => {
    const calibration = buildInvestmentChannelCalibration(
      book({
        openPositions: Array.from({ length: 10 }, (_, i) => ({
          id: `p${i}`,
          cycleId: `c${i}`,
          symbol: "ETH/USD",
          assetClass: "crypto",
          timeframe: "15Min",
          openedAt: "2026-01-01T00:00:00.000Z",
          entryPrice: 100,
          quantity: 1,
          notionalUsd: 100,
          forecastScore: -0.2,
          expectedReturn: -0.02,
          benchmarkSymbol: "BTC/USD",
          status: "open",
          markPrice: 92,
          markAt: "2026-01-02T00:00:00.000Z",
          currentValueUsd: 92,
          unrealizedPnlUsd: -8,
          returnPct: -0.08,
          ageHours: 24,
          benchmarkReturnPct: 0.02,
          alphaVsBenchmarkPct: -0.1,
        })),
        totals: {
          openCount: 10,
          notionalUsd: 1_000,
          currentValueUsd: 920,
          unrealizedPnlUsd: -80,
          returnPct: -0.08,
          benchmarkReturnPct: 0.02,
          alphaVsBenchmarkPct: -0.1,
        },
      }),
    );

    expect(calibration.channel.meanReturn).toBeLessThan(0.075);
  });
});

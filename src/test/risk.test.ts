import { afterEach, describe, expect, it } from "vitest";

import { evaluatePaperCycleRisk, type PaperCycleRiskInput } from "../lib/risk";

const originalKillSwitch = process.env.PAPER_KILL_SWITCH;
const now = new Date("2026-05-28T12:00:00.000Z");

function baseInput(overrides: Partial<PaperCycleRiskInput> = {}): PaperCycleRiskInput {
  return {
    now,
    generatedAt: now.toISOString(),
    symbols: ["BTC/USD", "ETH/USD"],
    availableCapitalUsd: 10_000,
    plannedFills: [
      { symbol: "BTC/USD", notionalUsd: 1_500 },
      { symbol: "ETH/USD", notionalUsd: 1_000 },
    ],
    openExposureUsd: 1_000,
    cache: {
      symbols: ["BTC/USD", "ETH/USD"],
      entries: [
        {
          symbol: "BTC/USD",
          assetClass: "crypto",
          timeframe: "15Min",
          bars: 200,
          fetchedAt: "2026-05-28T11:59:00.000Z",
          source: "alpaca_crypto_us",
          start: "2026-05-27T00:00:00.000Z",
          end: "2026-05-28T11:45:00.000Z",
        },
        {
          symbol: "ETH/USD",
          assetClass: "crypto",
          timeframe: "15Min",
          bars: 200,
          fetchedAt: "2026-05-28T11:59:30.000Z",
          source: "alpaca_crypto_us",
          start: "2026-05-27T00:00:00.000Z",
          end: "2026-05-28T11:45:00.000Z",
        },
      ],
    },
    limits: {
      maxCacheAgeMs: 5 * 60 * 1000,
      maxSymbols: 4,
      maxNotionalUsd: 5_000,
      maxPerSymbolNotionalUsd: 2_500,
      maxOpenExposureUsd: 5_000,
    },
    ...overrides,
  };
}

function limit(input: PaperCycleRiskInput, name: string) {
  return evaluatePaperCycleRisk(input).limits.find((l) => l.name === name);
}

afterEach(() => {
  if (originalKillSwitch == null) {
    delete process.env.PAPER_KILL_SWITCH;
  } else {
    process.env.PAPER_KILL_SWITCH = originalKillSwitch;
  }
});

describe("evaluatePaperCycleRisk", () => {
  it("passes when all paper cycle limits are within bounds", () => {
    delete process.env.PAPER_KILL_SWITCH;

    const result = evaluatePaperCycleRisk(baseInput());

    expect(result.ok).toBe(true);
    expect(result.limits.every((l) => l.ok)).toBe(true);
    expect(result.summary).toBe("Paper cycle risk passed all limits.");
  });

  it("fails stale market cache", () => {
    const input = baseInput({
      cache: {
        symbols: ["BTC/USD"],
        entries: [
          {
            symbol: "BTC/USD",
            assetClass: "crypto",
            timeframe: "15Min",
            bars: 200,
            fetchedAt: "2026-05-28T11:00:00.000Z",
            source: "alpaca_crypto_us",
            start: null,
            end: null,
          },
        ],
      },
    });

    expect(limit(input, "cache-freshness")?.ok).toBe(false);
  });

  it("fails max symbols", () => {
    expect(
      limit(baseInput({ symbols: ["A", "B", "C", "D", "E"] }), "max-symbols")?.ok,
    ).toBe(false);
  });

  it("fails max total notional", () => {
    expect(
      limit(
        baseInput({ plannedFills: [{ symbol: "BTC/USD", notionalUsd: 5_001 }] }),
        "max-notional",
      )?.ok,
    ).toBe(false);
  });

  it("fails max per-symbol notional after aggregating fills", () => {
    expect(
      limit(
        baseInput({
          plannedFills: [
            { symbol: "BTC/USD", notionalUsd: 1_500 },
            { symbol: "BTC/USD", notionalUsd: 1_100 },
          ],
        }),
        "max-per-symbol-notional",
      )?.ok,
    ).toBe(false);
  });

  it("fails max open exposure", () => {
    expect(limit(baseInput({ openExposureUsd: 3_000 }), "max-open-exposure")?.ok).toBe(false);
  });

  it("fails negative or zero capital", () => {
    expect(limit(baseInput({ availableCapitalUsd: 0 }), "capital")?.ok).toBe(false);
    expect(limit(baseInput({ availableCapitalUsd: -1 }), "capital")?.ok).toBe(false);
  });

  it("fails when PAPER_KILL_SWITCH is active", () => {
    process.env.PAPER_KILL_SWITCH = "true";

    const result = evaluatePaperCycleRisk(baseInput());

    expect(result.ok).toBe(false);
    expect(result.limits.find((l) => l.name === "kill-switch")?.ok).toBe(false);
    expect(result.summary).toContain("kill-switch");
  });
});

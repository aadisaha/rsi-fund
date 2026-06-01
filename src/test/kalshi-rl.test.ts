import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { appendKalshiOrderbookEvents } from "@/lib/kalshi-orderbook";
import { readKalshiRlSummary, runKalshiRlOnce, simulateKalshiPaperRl } from "@/lib/kalshi-rl";
import type { GeneticPolicyGenome, KalshiOrderbookEvent } from "@/lib/types";

const originalDataDir = process.env.QUANT_DATA_DIR;
const originalPopulation = process.env.KALSHI_RL_POPULATION;
const originalSeries = process.env.KALSHI_RL_SERIES;
const originalValidatedPnl = process.env.KALSHI_RL_VALIDATED_PNL_USD;
let tmpDir = "";

function event(index: number, yesMid: number, options: { baseIso?: string; marketTicker?: string } = {}): KalshiOrderbookEvent {
  const spread = 0.04;
  const yesBid = yesMid - spread / 2;
  const yesAsk = yesMid + spread / 2;
  const baseMs = Date.parse(options.baseIso ?? "2026-05-29T12:00:00Z");
  return {
    receivedAt: new Date(baseMs + index * 60_000).toISOString(),
    marketTicker: options.marketTicker ?? "KXBTC15M-TEST",
    seriesTicker: "KXBTC15M",
    eventType: "ticker",
    windowOpenTime: new Date(baseMs).toISOString(),
    windowCloseTime: new Date(baseMs + 15 * 60_000).toISOString(),
    yesBid,
    yesAsk,
    noBid: 1 - yesAsk,
    noAsk: 1 - yesBid,
    spread,
    yesDepth: 100,
    noDepth: 100,
    tradedPrice: null,
    tradedQuantity: null,
    settlementValue: null,
    raw: {
      currentPrice: 100,
      targetPrice: 99,
    },
  };
}

function syntheticEvents(): KalshiOrderbookEvent[] {
  return syntheticEventsAt("2026-05-29T12:00:00Z", "KXBTC15M-TEST");
}

function syntheticEventsAt(baseIso: string, marketTicker: string): KalshiOrderbookEvent[] {
  const path = [0.5, 0.51, 0.53, 0.56, 0.6, 0.64, 0.68, 0.72, 0.75];
  return [
    ...path.map((price, index) => event(index, price, { baseIso, marketTicker })),
    {
      ...event(14, 0.98, { baseIso, marketTicker }),
      eventType: "settlement",
      settlementValue: 1,
    },
  ];
}

function easyProfitEventsAt(baseIso: string, marketTicker: string): KalshiOrderbookEvent[] {
  const path = [0.12, 0.16, 0.22, 0.3, 0.39, 0.49, 0.6, 0.7, 0.78, 0.84, 0.89, 0.92, 0.94, 0.96];
  return [
    ...path.map((price, index) => event(index, price, { baseIso, marketTicker })),
    {
      ...event(14, 0.98, { baseIso, marketTicker }),
      eventType: "settlement",
      settlementValue: 1,
    },
  ];
}

const genome: GeneticPolicyGenome = {
  genomeId: "test-genome",
  entryThreshold: 0.025,
  exitThreshold: 0.001,
  maxHoldSeconds: 120,
  momentumWindow: 2,
  spreadCap: 0.05,
  depthFloor: 10,
  minSecondsToClose: 1,
  maxSecondsToClose: 900,
  stopLoss: 0.25,
  takeProfit: 0.2,
  positionSizeFraction: 0.02,
};

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "kalshi-rl-"));
  process.env.QUANT_DATA_DIR = tmpDir;
  process.env.KALSHI_RL_POPULATION = "8";
  process.env.KALSHI_RL_SERIES = "KXBTC15M";
});

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env.QUANT_DATA_DIR;
  } else {
    process.env.QUANT_DATA_DIR = originalDataDir;
  }
  if (originalPopulation === undefined) {
    delete process.env.KALSHI_RL_POPULATION;
  } else {
    process.env.KALSHI_RL_POPULATION = originalPopulation;
  }
  if (originalSeries === undefined) {
    delete process.env.KALSHI_RL_SERIES;
  } else {
    process.env.KALSHI_RL_SERIES = originalSeries;
  }
  if (originalValidatedPnl === undefined) {
    delete process.env.KALSHI_RL_VALIDATED_PNL_USD;
  } else {
    process.env.KALSHI_RL_VALIDATED_PNL_USD = originalValidatedPnl;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe("kalshi genetic RL paper simulator", () => {
  it("simulates paper-only fills and settlement PnL", () => {
    const result = simulateKalshiPaperRl(syntheticEvents(), genome, {
      bankrollUsd: 1000,
      maxMarketUsd: 25,
      maxOpenUsd: 100,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.pnlUsd).toBeGreaterThan(0);
    expect(result.reward).toBeGreaterThan(0);
    expect(result.trades.every((trade) => trade.closedAt)).toBe(true);
  });

  it("keeps a small no-trade penalty so agents keep exploring entries", () => {
    const idleGenome: GeneticPolicyGenome = {
      ...genome,
      genomeId: "idle-genome",
      entryThreshold: 0.95,
    };
    const result = simulateKalshiPaperRl(syntheticEvents(), idleGenome, {
      bankrollUsd: 1000,
      maxMarketUsd: 25,
      maxOpenUsd: 100,
    });

    expect(result.trades).toHaveLength(0);
    expect(result.reward).toBe(-0.25);
  });

  it("does not block paper entries when REST quotes omit depth", () => {
    const noDepthEvents = syntheticEvents().map((row) => ({
      ...row,
      yesDepth: null,
      noDepth: null,
    }));
    const result = simulateKalshiPaperRl(noDepthEvents, genome, {
      bankrollUsd: 1000,
      maxMarketUsd: 25,
      maxOpenUsd: 100,
    });

    expect(result.trades.length).toBeGreaterThan(0);
  });

  it("reports live open exposure at the latest tick before 15-minute settlement", () => {
    const holdingGenome: GeneticPolicyGenome = {
      ...genome,
      maxHoldSeconds: 900,
      exitThreshold: 0,
      takeProfit: 0.95,
      stopLoss: 0.95,
    };
    const liveEvents = syntheticEvents()
      .slice(0, -1)
      .map((row) => ({ ...row, settlementValue: null }));
    const result = simulateKalshiPaperRl(liveEvents, holdingGenome, {
      bankrollUsd: 1000,
      maxMarketUsd: 25,
      maxOpenUsd: 100,
    });

    expect(result.openPositions.length).toBeGreaterThan(0);
    expect(result.openPositions[0].side).toBe("yes");
    expect(result.openPositions[0].costBasisUsd).toBeGreaterThan(0);
    expect(result.openPositions[0].markValueUsd).toBeGreaterThan(0);
  });

  it("books open holdings at binary settlement when a market rolls without a settlement event", () => {
    const holdingGenome: GeneticPolicyGenome = {
      ...genome,
      maxHoldSeconds: 900,
      exitThreshold: 0,
      takeProfit: 0.95,
      stopLoss: 0.95,
    };
    const rolledEvents = syntheticEvents()
      .slice(0, -1)
      .map((row, index) => ({
        ...row,
        receivedAt:
          index === 8
            ? "2026-05-29T12:15:05.000Z"
            : row.receivedAt,
        settlementValue: null,
        raw: {
          currentPrice: 101,
          targetPrice: 99,
        },
      }));
    const result = simulateKalshiPaperRl(rolledEvents, holdingGenome, {
      bankrollUsd: 1000,
      maxMarketUsd: 25,
      maxOpenUsd: 100,
    });

    expect(result.openPositions).toHaveLength(0);
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.at(-1)?.exitPrice).toBe(1);
    expect(result.trades.at(-1)?.reason).toContain("settled from final BTC vs target");
    expect(result.pnlUsd).toBeGreaterThan(0);
  });

  it("rewards trade efficiency beyond raw paper PnL", () => {
    const result = simulateKalshiPaperRl(syntheticEvents(), genome, {
      bankrollUsd: 1000,
      maxMarketUsd: 25,
      maxOpenUsd: 100,
    });
    const totalNotional = result.trades.reduce((sum, trade) => sum + trade.notionalUsd, 0);
    const entryBonus = Math.min(0.25, result.trades.length * 0.03);
    const exposureBonus = Math.min(0.15, totalNotional * 0.001);
    const churnPenalty = result.trades.length * 0.015;
    const pnlReward = result.pnlUsd >= 0 ? result.pnlUsd * 25 : result.pnlUsd * 35;
    const rewardWithoutEfficiency =
      pnlReward + entryBonus + exposureBonus - result.drawdownUsd * 1.25 - churnPenalty;

    expect(result.pnlUsd / totalNotional).toBeGreaterThan(0);
    expect(result.reward).toBeGreaterThan(rewardWithoutEfficiency);
  });

  it("adds a bounded early-entry bonus only when a sub-90c entry is profitable", () => {
    const result = simulateKalshiPaperRl(syntheticEvents(), genome, {
      bankrollUsd: 1000,
      maxMarketUsd: 25,
      maxOpenUsd: 100,
    });
    const totalNotional = result.trades.reduce((sum, trade) => sum + trade.notionalUsd, 0);
    const entryBonus = Math.min(0.25, result.trades.length * 0.03);
    const exposureBonus = Math.min(0.15, totalNotional * 0.001);
    const churnPenalty = result.trades.length * 0.015;
    const pnlReward = result.pnlUsd >= 0 ? result.pnlUsd * 25 : result.pnlUsd * 35;
    const efficiency = result.pnlUsd / totalNotional;
    const efficiencyBonus = Math.min(efficiency * 2, 0.25);
    const rewardWithoutEarly =
      pnlReward + entryBonus + exposureBonus + efficiencyBonus - result.drawdownUsd * 1.25 - churnPenalty;

    expect(result.trades.some((trade) => trade.entryPrice < 0.9 && trade.pnlUsd > 0)).toBe(true);
    expect(result.reward).toBeGreaterThan(rewardWithoutEarly);
    expect(result.reward - rewardWithoutEarly).toBeLessThanOrEqual(2);
  });

  it("penalizes negative paper PnL more heavily than raw loss", () => {
    const losingGenome: GeneticPolicyGenome = {
      ...genome,
      genomeId: "losing-genome",
      maxHoldSeconds: 900,
      momentumWindow: 2,
      exitThreshold: 0,
      takeProfit: 0.95,
      stopLoss: 0.95,
    };
    const losingEvents = syntheticEvents().map((row) => ({
      ...row,
      settlementValue: row.settlementValue == null ? null : 0,
    }));
    const result = simulateKalshiPaperRl(losingEvents, losingGenome, {
      bankrollUsd: 1000,
      maxMarketUsd: 25,
      maxOpenUsd: 100,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.pnlUsd).toBeLessThan(0);
    expect(result.reward).toBeLessThan(result.pnlUsd);
  });

  it("waits cleanly when no ingested orderbook data exists", async () => {
    const run = await runKalshiRlOnce();

    expect(run.eventCount).toBe(0);
    expect(run.promoted).toBe(false);
    expect(run.notes[0]).toContain("Waiting");
  });

  it("evaluates a population once ingestion data exists", async () => {
    await appendKalshiOrderbookEvents(syntheticEvents());
    const run = await runKalshiRlOnce();

    expect(run.eventCount).toBeGreaterThan(0);
    expect(run.evaluatedMarkets).toEqual(["KXBTC15M-TEST"]);
    expect(run.leaderboard.length).toBeGreaterThan(0);
    expect(Array.isArray(run.leaderboard[0].recentTrades)).toBe(true);
    const summary = await readKalshiRlSummary();
    expect(summary.liveLeaderboard?.length).toBeGreaterThan(0);
    expect(summary.generationComparison?.eliteArchive.total).toBe(summary.eliteArchive?.length);
  });

  it("reports rolling generation PnL across repeated runs", async () => {
    await appendKalshiOrderbookEvents(easyProfitEventsAt("2026-05-29T12:00:00Z", "KXBTC15M-GATE"));
    await runKalshiRlOnce();
    const run = await runKalshiRlOnce();

    expect(run.leaderboard.every((row) => typeof row.pnlLast4 === "number")).toBe(true);
    expect(run.leaderboard.every((row) => typeof row.pnlLast10 === "number")).toBe(true);
  });

  it("treats the first validated run as a gate and counts only later trades", async () => {
    process.env.KALSHI_RL_VALIDATED_PNL_USD = "0.000001";
    process.env.KALSHI_RL_POPULATION = "64";
    await appendKalshiOrderbookEvents(syntheticEvents());
    const firstRun = await runKalshiRlOnce();
    const firstValidated = firstRun.leaderboard.filter((row) => row.tier === "validated");

    expect(firstValidated.length).toBeGreaterThan(0);
    expect(firstValidated.every((row) => row.contributesToPerformance !== true)).toBe(true);
    expect(firstValidated.every((row) => row.performance?.netPnlUsd === 0)).toBe(true);
    expect(firstValidated.every((row) => row.isValidationRun === true)).toBe(true);

    const postValidationStart = new Date(Date.parse(firstRun.generatedAt) + 60_000).toISOString();
    await appendKalshiOrderbookEvents(easyProfitEventsAt(postValidationStart, "KXBTC15M-POST"));
    const secondRun = await runKalshiRlOnce();
    const accounted = secondRun.leaderboard.filter((row) => row.contributesToPerformance);

    expect(accounted.length).toBeGreaterThan(0);
    expect(accounted.every((row) => row.validationAt && Date.parse(row.validationAt) < Date.parse(secondRun.generatedAt))).toBe(true);
    expect(accounted.some((row) => (row.performance?.betsWon ?? 0) + (row.performance?.betsLost ?? 0) > 0)).toBe(true);
  });
});

import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  runGeneticPreTraining,
  readPreTrainingSummary,
  simulatePreTrainingAgent,
} from "@/lib/pre-training";
import type { KalshiCandle, KalshiHistoryManifest } from "@/lib/kalshi-history";
import type { PreTrainingAgentGenome } from "@/lib/types";

const gzipAsync = promisify(gzip);
const originalDataDir = process.env.QUANT_DATA_DIR;
const originalHistoryDir = process.env.KALSHI_HISTORY_DATA_DIR;
let tmpDir = "";
let historyDir = "";

function candle(marketTicker: string, index: number, yes: number): KalshiCandle {
  const ts = Math.floor(Date.parse("2026-05-29T12:00:00Z") / 1000) + index * 60;
  const spread = 0.03;
  return {
    marketTicker,
    seriesTicker: "KXBTC15M",
    source: "historical",
    periodInterval: 1,
    endPeriodTs: ts,
    yesBid: {
      open: yes - spread / 2,
      low: yes - spread / 2,
      high: yes - spread / 2,
      close: yes - spread / 2,
    },
    yesAsk: {
      open: yes + spread / 2,
      low: yes + spread / 2,
      high: yes + spread / 2,
      close: yes + spread / 2,
    },
    price: {
      open: yes,
      low: yes,
      high: yes,
      close: yes,
      mean: yes,
      previous: index ? yes - 0.02 : null,
      min: yes,
      max: yes,
    },
    volume: 100,
    openInterest: 500,
  };
}

async function writeHistory(markets: Record<string, KalshiCandle[]>): Promise<void> {
  const files: string[] = [];
  for (const [marketTicker, candles] of Object.entries(markets)) {
    const file = path.join("candles", `market=${marketTicker}.jsonl.gz`);
    const fullPath = path.join(historyDir, file);
    await mkdir(path.dirname(fullPath), { recursive: true });
    const body = candles.map((row) => JSON.stringify(row)).join("\n") + "\n";
    await writeFile(fullPath, await gzipAsync(Buffer.from(body, "utf8")));
    files.push(file);
  }

  const manifest: KalshiHistoryManifest = {
    version: 1,
    generatedAt: "2026-05-29T13:00:00.000Z",
    markets: Object.fromEntries(
      Object.entries(markets).map(([marketTicker, candles], index) => [
        marketTicker,
        {
          marketTicker,
          seriesTickers: ["KXBTC15M"],
          sources: ["historical"],
          periodIntervals: [1],
          candles: candles.length,
          startTs: candles[0].endPeriodTs,
          endTs: candles.at(-1)?.endPeriodTs ?? candles[0].endPeriodTs,
          files: [files[index]],
          updatedAt: "2026-05-29T13:00:00.000Z",
        },
      ]),
    ),
  };
  await writeFile(path.join(historyDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function trendMarket(marketTicker: string, start: number, step: number): KalshiCandle[] {
  return Array.from({ length: 34 }, (_, index) => candle(marketTicker, index, Math.min(0.96, Math.max(0.04, start + step * index))));
}

const genome: PreTrainingAgentGenome = {
  genomeId: "pretrain-test",
  generation: 1,
  parentGenomeIds: [],
  family: "momentum",
  lookbackMinutes: 3,
  entryEdge: 0.035,
  exitEdge: 0.002,
  maxHoldMinutes: 8,
  maxSpread: 0.05,
  minVolume: 0,
  stopLoss: 0.25,
  takeProfit: 0.25,
  allocationPct: 0.02,
  riskPenalty: 1,
};

beforeEach(async () => {
  tmpDir = await mkdtempCompat("pre-training-");
  historyDir = path.join(tmpDir, "kalshi-history");
  process.env.QUANT_DATA_DIR = tmpDir;
  process.env.KALSHI_HISTORY_DATA_DIR = historyDir;
});

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env.QUANT_DATA_DIR;
  } else {
    process.env.QUANT_DATA_DIR = originalDataDir;
  }
  if (originalHistoryDir === undefined) {
    delete process.env.KALSHI_HISTORY_DATA_DIR;
  } else {
    process.env.KALSHI_HISTORY_DATA_DIR = originalHistoryDir;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

async function mkdtempCompat(prefix: string): Promise<string> {
  const base = path.join(os.tmpdir(), prefix);
  await mkdir(base, { recursive: true });
  return path.join(await mkdtemp(base), "");
}

describe("historical genetic pre-training", () => {
  it("simulates a paper-only historical candle strategy", () => {
    const result = simulatePreTrainingAgent(
      [{ marketTicker: "KXBTC15M-TEST", candles: trendMarket("KXBTC15M-TEST", 0.2, 0.025) }],
      genome,
      { bankrollUsd: 1000, maxMarketUsd: 25 },
    );

    expect(result.trades).toBeGreaterThan(0);
    expect(result.pnlUsd).toBeGreaterThan(0);
    expect(result.reward).toBeGreaterThan(0);
    expect(result.recentTrades?.every((trade) => trade.closedAt)).toBe(true);
  });

  it("runs multiple genetic cycles over cached historical markets", async () => {
    await writeHistory({
      "KXBTC15M-A": trendMarket("KXBTC15M-A", 0.18, 0.024),
      "KXBTC15M-B": trendMarket("KXBTC15M-B", 0.82, -0.022),
      "KXBTC15M-C": trendMarket("KXBTC15M-C", 0.2, 0.021),
      "KXBTC15M-D": trendMarket("KXBTC15M-D", 0.78, -0.019),
    });

    const run = await runGeneticPreTraining({ cycles: 3, populationSize: 16, marketLimit: 4 });

    expect(run.cycles).toHaveLength(3);
    expect(run.candleCount).toBeGreaterThan(0);
    expect(run.trainMarkets.length).toBeGreaterThan(0);
    expect(run.validationMarkets.length).toBeGreaterThan(0);
    expect(run.leaderboard.length).toBeGreaterThan(0);

    const summary = await readPreTrainingSummary();
    expect(summary.lastRun?.runId).toBe(run.runId);
    expect(summary.availableMarkets).toBe(4);
  });
});

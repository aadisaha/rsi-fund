import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  backfillKalshiHistory,
  buildKalshiCandlesticksPath,
  buildKalshiTrainingEvidence,
  readKalshiCandles,
  readKalshiHistoryManifest,
} from "@/lib/kalshi-history";

const originalDataDir = process.env.KALSHI_HISTORY_DATA_DIR;
const originalMinSamples = process.env.KALSHI_TRSI_MIN_SAMPLES;
let tmpDir = "";

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "kalshi-history-"));
  process.env.KALSHI_HISTORY_DATA_DIR = tmpDir;
  process.env.KALSHI_TRSI_MIN_SAMPLES = "3";
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (originalDataDir === undefined) {
    delete process.env.KALSHI_HISTORY_DATA_DIR;
  } else {
    process.env.KALSHI_HISTORY_DATA_DIR = originalDataDir;
  }
  if (originalMinSamples === undefined) {
    delete process.env.KALSHI_TRSI_MIN_SAMPLES;
  } else {
    process.env.KALSHI_TRSI_MIN_SAMPLES = originalMinSamples;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe("kalshi history", () => {
  it("builds live and historical candlestick paths with required query params", () => {
    expect(
      buildKalshiCandlesticksPath({
        source: "live",
        seriesTicker: "KXBTC",
        marketTicker: "KXBTC-TEST",
        startTs: 10,
        endTs: 70,
        periodInterval: 1,
      }),
    ).toBe(
      "/trade-api/v2/series/KXBTC/markets/KXBTC-TEST/candlesticks?start_ts=10&end_ts=70&period_interval=1",
    );
    expect(
      buildKalshiCandlesticksPath({
        source: "historical",
        marketTicker: "KXBTC-OLD",
        startTs: 10,
        endTs: 70,
        periodInterval: 1,
      }),
    ).toBe(
      "/trade-api/v2/historical/markets/KXBTC-OLD/candlesticks?start_ts=10&end_ts=70&period_interval=1",
    );
  });

  it("fetches, normalizes, compresses, and reads minute candles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ticker: "KXBTC-TEST",
          candlesticks: [
            {
              end_period_ts: 1_700_000_000,
              yes_bid: { close_dollars: "0.5100" },
              yes_ask: { close_dollars: "0.5300" },
              price: { close_dollars: "0.5200", previous_dollars: "0.5000" },
              volume_fp: "12.50",
              open_interest_fp: "40",
            },
            {
              end_period_ts: 1_700_000_060,
              yes_bid: { close_dollars: "0.5200" },
              yes_ask: { close_dollars: "0.5400" },
              price: { close_dollars: "0.5300" },
              volume_fp: "8",
            },
          ],
        }),
      })),
    );

    const result = await backfillKalshiHistory({
      markets: [{ seriesTicker: "KXBTC", marketTicker: "KXBTC-TEST" }],
      startTs: 1_700_000_000,
      endTs: 1_700_000_060,
    });
    const candles = await readKalshiCandles({ marketTickers: ["KXBTC-TEST"] });
    const manifest = await readKalshiHistoryManifest();

    expect(result.requests[0].writtenCandles).toBe(2);
    expect(candles).toHaveLength(2);
    expect(candles[0].price.close).toBe(0.52);
    expect(manifest.markets["KXBTC-TEST"].files[0]).toContain(".jsonl.gz");
  });

  it("builds empirical samples once enough minute candles exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ticker: "KXBTC-TEST",
          candlesticks: Array.from({ length: 20 }, (_, i) => ({
            end_period_ts: 1_700_000_000 + i * 60,
            yes_bid: { close_dollars: "0.4900" },
            yes_ask: { close_dollars: "0.5100" },
            price: { close_dollars: String(0.5 + i * 0.005) },
          })),
        }),
      })),
    );

    await backfillKalshiHistory({
      markets: [{ seriesTicker: "KXBTC", marketTicker: "KXBTC-TEST" }],
      startTs: 1_700_000_000,
      endTs: 1_700_001_140,
    });
    const evidence = await buildKalshiTrainingEvidence({ minSamples: 3, horizonMinutes: 3 });

    expect(evidence?.sampleSize).toBeGreaterThanOrEqual(3);
    expect(evidence?.markets).toEqual(["KXBTC-TEST"]);
    expect(evidence?.createSamples.some((x) => x > 0)).toBe(true);
  });
});

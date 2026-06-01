import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { buildKalshiTrainingEvidence, readKalshiCandles, readKalshiHistoryManifest } from "@/lib/kalshi-history";

loadEnvConfig(process.cwd());

type Stats = {
  count: number;
  mean: number | null;
  min: number | null;
  p05: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
};

type MarketStats = {
  marketTicker: string;
  source: string;
  candles: number;
  startTs: number;
  endTs: number;
  spanMinutes: number;
  missingMinutes: number;
  firstClose: number | null;
  lastClose: number | null;
  minClose: number | null;
  maxClose: number | null;
  totalVolume: number;
  meanSpread: number | null;
};

function pct(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(values: Array<number | null | undefined>): Stats {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    count: clean.length,
    mean: clean.length ? clean.reduce((sum, v) => sum + v, 0) / clean.length : null,
    min: pct(clean, 0),
    p05: pct(clean, 0.05),
    p25: pct(clean, 0.25),
    median: pct(clean, 0.5),
    p75: pct(clean, 0.75),
    p95: pct(clean, 0.95),
    p99: pct(clean, 0.99),
    max: pct(clean, 1),
  };
}

function dateKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function monthKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 7);
}

function inc(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function topEntries(map: Map<string, number>, n = 12): Array<{ key: string; value: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, value]) => ({ key, value }));
}

function allEntries(map: Map<string, number>): Array<{ key: string; value: number }> {
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ key, value }));
}

function fmt(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

async function dirSizeBytes(root: string): Promise<number> {
  let total = 0;
  async function walk(dir: string) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const info = await stat(full);
      if (info.isDirectory()) {
        await walk(full);
      } else {
        total += info.size;
      }
    }
  }
  await walk(root);
  return total;
}

async function main() {
  const manifest = await readKalshiHistoryManifest();
  const candles = await readKalshiCandles({ periodInterval: 1 });
  const dataDir = process.env.KALSHI_HISTORY_DATA_DIR || path.join(process.cwd(), ".data", "kalshi-history");
  const manifestMarkets = Object.values(manifest.markets);

  const bySource = new Map<string, number>();
  const byMonth = new Map<string, number>();
  const byDay = new Map<string, number>();
  const byHourUtc = new Map<string, number>();
  const byMarket = new Map<string, typeof candles>();
  const prices: number[] = [];
  const firstMinutePrices: number[] = [];
  const finalMinutePrices: number[] = [];
  const spreads: number[] = [];
  const volumes: number[] = [];
  const openInterest: number[] = [];
  let priceCloseMissing = 0;
  let bidAskMissing = 0;
  let outsideUnitInterval = 0;

  for (const candle of candles) {
    inc(bySource, candle.source);
    inc(byMonth, monthKey(candle.endPeriodTs));
    inc(byDay, dateKey(candle.endPeriodTs));
    inc(byHourUtc, new Date(candle.endPeriodTs * 1000).toISOString().slice(11, 13));
    byMarket.set(candle.marketTicker, [...(byMarket.get(candle.marketTicker) ?? []), candle]);

    const close = candle.price.close;
    if (close == null) {
      priceCloseMissing += 1;
    } else {
      prices.push(close);
      if (close < 0 || close > 1) outsideUnitInterval += 1;
    }

    if (candle.yesBid.close == null || candle.yesAsk.close == null) {
      bidAskMissing += 1;
    } else {
      spreads.push(Math.max(0, candle.yesAsk.close - candle.yesBid.close));
    }
    if (candle.volume != null) volumes.push(candle.volume);
    if (candle.openInterest != null) openInterest.push(candle.openInterest);
  }

  const marketStats: MarketStats[] = [];
  for (const [marketTicker, rows] of byMarket) {
    const sorted = [...rows].sort((a, b) => a.endPeriodTs - b.endPeriodTs);
    const closes = sorted.map((c) => c.price.close).filter((v): v is number => v != null);
    const spreadValues = sorted
      .map((c) => (c.yesAsk.close != null && c.yesBid.close != null ? Math.max(0, c.yesAsk.close - c.yesBid.close) : null))
      .filter((v): v is number => v != null);
    const startTs = sorted[0].endPeriodTs;
    const endTs = sorted.at(-1)!.endPeriodTs;
    const spanMinutes = Math.floor((endTs - startTs) / 60) + 1;
    const uniqueMinutes = new Set(sorted.map((c) => c.endPeriodTs)).size;
    marketStats.push({
      marketTicker,
      source: sorted[0].source,
      candles: sorted.length,
      startTs,
      endTs,
      spanMinutes,
      missingMinutes: Math.max(0, spanMinutes - uniqueMinutes),
      firstClose: sorted.find((c) => c.price.close != null)?.price.close ?? null,
      lastClose: [...sorted].reverse().find((c) => c.price.close != null)?.price.close ?? null,
      minClose: closes.length ? Math.min(...closes) : null,
      maxClose: closes.length ? Math.max(...closes) : null,
      totalVolume: sorted.reduce((sum, c) => sum + (c.volume ?? 0), 0),
      meanSpread: spreadValues.length ? spreadValues.reduce((sum, v) => sum + v, 0) / spreadValues.length : null,
    });
  }

  for (const market of marketStats) {
    if (market.firstClose != null) firstMinutePrices.push(market.firstClose);
    if (market.lastClose != null) finalMinutePrices.push(market.lastClose);
  }

  const marketCandles = stats(marketStats.map((m) => m.candles));
  const marketSpanMinutes = stats(marketStats.map((m) => m.spanMinutes));
  const marketMissingMinutes = stats(marketStats.map((m) => m.missingMinutes));
  const marketTotalVolume = stats(marketStats.map((m) => m.totalVolume));
  const marketMeanSpread = stats(marketStats.map((m) => m.meanSpread));
  const marketRange = stats(marketStats.map((m) => (m.minClose != null && m.maxClose != null ? m.maxClose - m.minClose : null)));
  const firstToLastMove = stats(
    marketStats.map((m) => (m.firstClose != null && m.lastClose != null ? m.lastClose - m.firstClose : null)),
  );
  const denseMarkets = marketStats.filter((m) => m.candles >= 12).length;
  const emptyMarkets = manifestMarkets.filter((m) => m.candles === 0).length;

  const starts = marketStats.map((m) => m.startTs);
  const ends = marketStats.map((m) => m.endTs);
  const evidence = await buildKalshiTrainingEvidence({ minSamples: 1, horizonMinutes: 15 });
  const summary = {
    generatedAt: new Date().toISOString(),
    dataDir,
    compressedBytes: await dirSizeBytes(dataDir),
    manifest: {
      markets: manifestMarkets.length,
      marketsWithCandles: marketStats.length,
      emptyMarkets,
      candles: candles.length,
      start: starts.length ? new Date(Math.min(...starts) * 1000).toISOString() : null,
      end: ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null,
      sources: [...new Set(manifestMarkets.flatMap((m) => m.sources))].sort(),
      periodIntervals: [...new Set(manifestMarkets.flatMap((m) => m.periodIntervals))].sort((a, b) => a - b),
    },
    candleDistributions: {
      priceClose: stats(prices),
      firstMinutePrice: stats(firstMinutePrices),
      finalMinutePrice: stats(finalMinutePrices),
      yesSpread: stats(spreads),
      volume: stats(volumes),
      openInterest: stats(openInterest),
    },
    marketDistributions: {
      candlesPerMarket: marketCandles,
      spanMinutes: marketSpanMinutes,
      missingMinutes: marketMissingMinutes,
      totalVolume: marketTotalVolume,
      meanSpread: marketMeanSpread,
      priceRange: marketRange,
      firstToLastMove,
      denseMarkets,
      denseMarketShare: marketStats.length ? denseMarkets / marketStats.length : null,
    },
    dataQuality: {
      priceCloseMissing,
      bidAskMissing,
      outsideUnitInterval,
      candlesWithVolume: volumes.length,
      candlesWithOpenInterest: openInterest.length,
    },
    counts: {
      bySource: allEntries(bySource),
      byMonth: allEntries(byMonth),
      busiestDays: topEntries(byDay, 15),
      byHourUtc: allEntries(byHourUtc),
    },
    trainingEvidence: evidence
      ? {
          sampleSize: evidence.sampleSize,
          minSamples: evidence.minSamples,
          horizonMinutes: evidence.horizonMinutes,
          markets: evidence.markets.length,
          source: evidence.source,
          createSamples: stats(evidence.createSamples),
          decaySamples: stats(evidence.decaySamples),
        }
      : null,
    examples: {
      mostCandles: [...marketStats].sort((a, b) => b.candles - a.candles).slice(0, 10),
      highestVolume: [...marketStats].sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 10),
      widestMeanSpread: [...marketStats]
        .filter((m) => m.meanSpread != null)
        .sort((a, b) => (b.meanSpread ?? 0) - (a.meanSpread ?? 0))
        .slice(0, 10),
    },
  };

  await mkdir(path.join(process.cwd(), ".data", "kalshi-history"), { recursive: true });
  await writeFile(
    path.join(process.cwd(), ".data", "kalshi-history", "eda-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  const markdown = [
    "# Kalshi BTC 15M History EDA",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "## Coverage",
    "",
    table(
      ["Metric", "Value"],
      [
        ["Manifest markets", fmt(summary.manifest.markets, 0)],
        ["Markets with candles", fmt(summary.manifest.marketsWithCandles, 0)],
        ["Manifest markets with zero candles", fmt(summary.manifest.emptyMarkets, 0)],
        ["One-minute candles", fmt(summary.manifest.candles, 0)],
        ["Coverage start", summary.manifest.start ?? "n/a"],
        ["Coverage end", summary.manifest.end ?? "n/a"],
        ["Compressed cache", `${fmt(summary.compressedBytes / 1024 / 1024, 1)} MB`],
        ["Sources", summary.manifest.sources.join(", ")],
      ],
    ),
    "",
    "## Candle Counts By Month",
    "",
    table(["Month", "Candles"], summary.counts.byMonth.map((row) => [row.key, fmt(row.value, 0)])),
    "",
    "## Core Distributions",
    "",
    table(
      ["Distribution", "Count", "Mean", "P05", "P25", "Median", "P75", "P95", "P99", "Max"],
      [
        ["Close price", summary.candleDistributions.priceClose],
        ["First close per market", summary.candleDistributions.firstMinutePrice],
        ["Final close per market", summary.candleDistributions.finalMinutePrice],
        ["Bid/ask spread", summary.candleDistributions.yesSpread],
        ["Candle volume", summary.candleDistributions.volume],
        ["Open interest", summary.candleDistributions.openInterest],
        ["Candles per market", summary.marketDistributions.candlesPerMarket],
        ["Market span minutes", summary.marketDistributions.spanMinutes],
        ["Missing minutes per market", summary.marketDistributions.missingMinutes],
        ["First-to-last move", summary.marketDistributions.firstToLastMove],
        ["In-market price range", summary.marketDistributions.priceRange],
      ].map(([name, s]) => {
        const dist = s as Stats;
        return [
          name as string,
          fmt(dist.count, 0),
          fmt(dist.mean),
          fmt(dist.p05),
          fmt(dist.p25),
          fmt(dist.median),
          fmt(dist.p75),
          fmt(dist.p95),
          fmt(dist.p99),
          fmt(dist.max),
        ];
      }),
    ),
    "",
    "## Data Quality",
    "",
    table(
      ["Check", "Value"],
      [
        ["Candles missing price close", fmt(summary.dataQuality.priceCloseMissing, 0)],
        ["Candles missing bid or ask close", fmt(summary.dataQuality.bidAskMissing, 0)],
        ["Close prices outside [0, 1]", fmt(summary.dataQuality.outsideUnitInterval, 0)],
        ["Candles with volume", fmt(summary.dataQuality.candlesWithVolume, 0)],
        ["Candles with open interest", fmt(summary.dataQuality.candlesWithOpenInterest, 0)],
        ["Dense markets, >=12 candles", fmt(summary.marketDistributions.denseMarkets, 0)],
        ["Dense market share", `${fmt((summary.marketDistributions.denseMarketShare ?? 0) * 100, 2)}%`],
      ],
    ),
    "",
    "## Training Evidence",
    "",
    summary.trainingEvidence
      ? table(
          ["Metric", "Value"],
          [
            ["Sample size", fmt(summary.trainingEvidence.sampleSize, 0)],
            ["Horizon minutes", fmt(summary.trainingEvidence.horizonMinutes, 0)],
            ["Markets represented", fmt(summary.trainingEvidence.markets, 0)],
            ["Evidence source", summary.trainingEvidence.source],
            ["Create sample median", fmt(summary.trainingEvidence.createSamples.median)],
            ["Decay sample median", fmt(summary.trainingEvidence.decaySamples.median)],
          ],
        )
      : "No empirical training evidence could be built.",
    "",
    "## Highest Volume Markets",
    "",
    table(
      ["Market", "Candles", "Start", "End", "Total Volume", "First Close", "Last Close"],
      summary.examples.highestVolume.slice(0, 8).map((m) => [
        m.marketTicker,
        fmt(m.candles, 0),
        new Date(m.startTs * 1000).toISOString(),
        new Date(m.endTs * 1000).toISOString(),
        fmt(m.totalVolume, 0),
        fmt(m.firstClose),
        fmt(m.lastClose),
      ]),
    ),
    "",
    "## Busiest Days",
    "",
    table(["Day", "Candles"], summary.counts.busiestDays.map((row) => [row.key, fmt(row.value, 0)])),
    "",
  ].join("\n");

  await mkdir(path.join(process.cwd(), "docs"), { recursive: true });
  await writeFile(path.join(process.cwd(), "docs", "kalshi-history-eda.md"), markdown);

  console.log(
    JSON.stringify(
      {
        ok: true,
        report: "docs/kalshi-history-eda.md",
        summary: ".data/kalshi-history/eda-summary.json",
        manifest: summary.manifest,
        priceClose: summary.candleDistributions.priceClose,
        trainingEvidence: summary.trainingEvidence,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

import { loadEnvConfig } from "@next/env";

import {
  backfillKalshiHistory,
  discoverKalshiMarkets,
  readKalshiHistoryManifest,
  type KalshiDiscoveredMarket,
} from "@/lib/kalshi-history";

loadEnvConfig(process.cwd());

function parseTime(raw: string, name: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`${name} must be a Unix timestamp or ISO date.`);
  return Math.floor(ms / 1000);
}

function argValue(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

function numberArg(name: string, fallback: number): number {
  const value = Number(argValue(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

async function cachedMarketTickers(): Promise<Set<string>> {
  const manifest = await readKalshiHistoryManifest();
  return new Set(Object.values(manifest.markets).map((market) => market.marketTicker));
}

async function backfillBatch(args: {
  markets: KalshiDiscoveredMarket[];
  requestStartTs: number;
  requestEndTs: number;
  chunkMinutes: number;
}): Promise<{ markets: number; candles: number; failed: number }> {
  try {
    const result = await backfillKalshiHistory({
      markets: args.markets,
      startTs: args.requestStartTs,
      endTs: args.requestEndTs,
      periodInterval: 1,
      chunkMinutes: args.chunkMinutes,
    });
    return {
      markets: result.requests.length,
      candles: result.requests.reduce((sum, request) => sum + request.writtenCandles, 0),
      failed: 0,
    };
  } catch (error) {
    if (args.markets.length === 1) {
      const market = args.markets[0];
      console.error(
        JSON.stringify({
          level: "warn",
          message: "market backfill failed",
          marketTicker: market.marketTicker,
          source: market.source,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return { markets: 0, candles: 0, failed: 1 };
    }

    let markets = 0;
    let candles = 0;
    let failed = 0;
    for (const market of args.markets) {
      const result = await backfillBatch({ ...args, markets: [market] });
      markets += result.markets;
      candles += result.candles;
      failed += result.failed;
    }
    return { markets, candles, failed };
  }
}

const seriesTickers = argValue("--series", process.env.KALSHI_HISTORY_SERIES || "KXBTC15M")
  .split(",")
  .map((series) => series.trim())
  .filter(Boolean);
const requestStartTs = parseTime(argValue("--start", "2015-01-01T00:00:00Z"), "start");
const requestEndTs = parseTime(argValue("--end", new Date().toISOString()), "end");
const discoveryEndTs = parseTime(argValue("--discovery-end", new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString()), "discovery-end");
const maxMarkets = numberArg("--max-markets", 1_000_000);
const batchSize = numberArg("--batch-size", 50);
const chunkMinutes = numberArg("--chunk-minutes", 4_000);
const includeCached = process.argv.includes("--include-cached");

async function main() {
  console.log(
    JSON.stringify({
      event: "discover:start",
      seriesTickers,
      requestStart: new Date(requestStartTs * 1000).toISOString(),
      requestEnd: new Date(requestEndTs * 1000).toISOString(),
      discoveryEnd: new Date(discoveryEndTs * 1000).toISOString(),
      maxMarkets,
    }),
  );

  const discovered = await discoverKalshiMarkets({
    seriesTickers,
    startTs: requestStartTs,
    endTs: discoveryEndTs,
    maxMarkets,
  });

  const cached = includeCached ? new Set<string>() : await cachedMarketTickers();
  const markets = discovered.filter((market) => !cached.has(market.marketTicker));

  console.log(
    JSON.stringify({
      event: "discover:done",
      discovered: discovered.length,
      cachedSkipped: discovered.length - markets.length,
      pending: markets.length,
      earliestClose: discovered[0]?.closeTs ? new Date(discovered[0].closeTs * 1000).toISOString() : null,
      latestClose: discovered.at(-1)?.closeTs ? new Date(discovered.at(-1)!.closeTs! * 1000).toISOString() : null,
    }),
  );

  if (discovered.length >= maxMarkets) {
    console.error(
      JSON.stringify({
        level: "warn",
        message: "discovery reached max-markets; raise --max-markets and rerun to prove exhaustion",
        maxMarkets,
      }),
    );
  }

  let doneMarkets = 0;
  let doneCandles = 0;
  let failedMarkets = 0;

  for (let i = 0; i < markets.length; i += batchSize) {
    const batch = markets.slice(i, i + batchSize);
    const result = await backfillBatch({
      markets: batch,
      requestStartTs,
      requestEndTs,
      chunkMinutes,
    });
    doneMarkets += result.markets;
    doneCandles += result.candles;
    failedMarkets += result.failed;

    console.log(
      JSON.stringify({
        event: "backfill:progress",
        processed: Math.min(i + batch.length, markets.length),
        pending: markets.length,
        doneMarkets,
        doneCandles,
        failedMarkets,
        lastMarket: batch.at(-1)?.marketTicker ?? null,
      }),
    );
  }

  const manifest = await readKalshiHistoryManifest();
  const manifestMarkets = Object.values(manifest.markets);
  const manifestCandles = manifestMarkets.reduce((sum, market) => sum + market.candles, 0);
  const starts = manifestMarkets.map((market) => market.startTs).filter((ts): ts is number => typeof ts === "number");
  const ends = manifestMarkets.map((market) => market.endTs).filter((ts): ts is number => typeof ts === "number");

  console.log(
    JSON.stringify({
      event: "complete",
      manifestMarkets: manifestMarkets.length,
      manifestCandles,
      manifestStart: starts.length ? new Date(Math.min(...starts) * 1000).toISOString() : null,
      manifestEnd: ends.length ? new Date(Math.max(...ends) * 1000).toISOString() : null,
      failedMarkets,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

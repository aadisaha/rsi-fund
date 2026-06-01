import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";

import { envTrim } from "@/lib/env";
import { kalshiBaseUrl } from "@/lib/kalshi";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export type KalshiHistorySource = "live" | "historical";
export type KalshiPeriodInterval = 1 | 60 | 1440;

type RawOhlc = {
  open?: string | number | null;
  low?: string | number | null;
  high?: string | number | null;
  close?: string | number | null;
  mean?: string | number | null;
  previous?: string | number | null;
  min?: string | number | null;
  max?: string | number | null;
  open_dollars?: string | number | null;
  low_dollars?: string | number | null;
  high_dollars?: string | number | null;
  close_dollars?: string | number | null;
  mean_dollars?: string | number | null;
  previous_dollars?: string | number | null;
  min_dollars?: string | number | null;
  max_dollars?: string | number | null;
};

type RawCandlestick = {
  end_period_ts?: number;
  yes_bid?: RawOhlc;
  yes_ask?: RawOhlc;
  price?: RawOhlc;
  volume?: string | number | null;
  volume_fp?: string | number | null;
  open_interest?: string | number | null;
  open_interest_fp?: string | number | null;
};

type RawCandlesticksResponse = {
  ticker?: string;
  candlesticks?: RawCandlestick[];
};

type RawMarket = {
  ticker?: string;
  open_time?: string | null;
  close_time?: string | null;
  expiration_time?: string | null;
  settlement_ts?: string | null;
  status?: string | null;
};

type RawMarketsResponse = {
  markets?: RawMarket[];
  cursor?: string;
};

export type KalshiCandle = {
  marketTicker: string;
  seriesTicker: string | null;
  source: KalshiHistorySource;
  periodInterval: KalshiPeriodInterval;
  endPeriodTs: number;
  yesBid: Ohlc;
  yesAsk: Ohlc;
  price: PriceOhlc;
  volume: number | null;
  openInterest: number | null;
};

export type Ohlc = {
  open: number | null;
  low: number | null;
  high: number | null;
  close: number | null;
};

export type PriceOhlc = Ohlc & {
  mean: number | null;
  previous: number | null;
  min: number | null;
  max: number | null;
};

export type KalshiHistoryMarketRequest = {
  marketTicker: string;
  seriesTicker?: string | null;
  source?: KalshiHistorySource;
};

export type KalshiBackfillRequest = {
  markets?: KalshiHistoryMarketRequest[];
  seriesTickers?: string[];
  startTs: number;
  endTs: number;
  periodInterval?: KalshiPeriodInterval;
  chunkMinutes?: number;
  maxMarkets?: number;
};

export type KalshiBackfillResult = {
  generatedAt: string;
  dataDir: string;
  periodInterval: KalshiPeriodInterval;
  startTs: number;
  endTs: number;
  discoveredMarkets: number;
  requests: Array<{
    marketTicker: string;
    seriesTicker: string | null;
    source: KalshiHistorySource;
    fetchedCandles: number;
    writtenCandles: number;
    files: string[];
  }>;
  manifest: KalshiHistoryManifest;
};

export type KalshiDiscoveredMarket = KalshiHistoryMarketRequest & {
  openTs: number | null;
  closeTs: number | null;
  status: string | null;
};

export type KalshiHistoryManifest = {
  version: 1;
  generatedAt: string;
  markets: Record<string, KalshiHistoryMarketManifest>;
};

export type KalshiHistoryMarketManifest = {
  marketTicker: string;
  seriesTickers: string[];
  sources: KalshiHistorySource[];
  periodIntervals: KalshiPeriodInterval[];
  candles: number;
  startTs: number | null;
  endTs: number | null;
  files: string[];
  updatedAt: string;
};

export type KalshiTrainingEvidence = {
  source: string;
  sampleSize: number;
  minSamples: number;
  horizonMinutes: number;
  createSamples: number[];
  decaySamples: number[];
  markets: string[];
};

function dataDir(): string {
  return (
    envTrim(process.env.KALSHI_HISTORY_DATA_DIR) ||
    path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "kalshi-history")
  );
}

function manifestPath(root = dataDir()): string {
  return path.join(root, "manifest.json");
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "unknown";
}

function dateKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseTimeSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function kalshiFetchJson<T>(apiPath: string): Promise<T> {
  const retries = Math.max(0, Math.min(envNumber("KALSHI_HISTORY_RETRIES", 4), 8));
  const throttleMs = Math.max(0, envNumber("KALSHI_HISTORY_THROTTLE_MS", 250));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (throttleMs) await sleep(throttleMs);
    const res = await fetch(`${kalshiBaseUrl()}${apiPath}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (res.ok) return (await res.json()) as T;

    const body = await res.text();
    if (res.status !== 429 || attempt >= retries) {
      throw new Error(`Kalshi read failed (${res.status}): ${body.slice(0, 180)}`);
    }

    const retryAfter = Number(res.headers?.get("retry-after"));
    const backoffMs = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : Math.min(20_000, 1_000 * 2 ** attempt);
    await sleep(backoffMs);
  }

  throw new Error("Kalshi read failed after retries.");
}

function normalizeOhlc(raw: RawOhlc | undefined): Ohlc {
  return {
    open: parseNumber(raw?.open ?? raw?.open_dollars),
    low: parseNumber(raw?.low ?? raw?.low_dollars),
    high: parseNumber(raw?.high ?? raw?.high_dollars),
    close: parseNumber(raw?.close ?? raw?.close_dollars),
  };
}

function normalizePrice(raw: RawOhlc | undefined): PriceOhlc {
  return {
    ...normalizeOhlc(raw),
    mean: parseNumber(raw?.mean ?? raw?.mean_dollars),
    previous: parseNumber(raw?.previous ?? raw?.previous_dollars),
    min: parseNumber(raw?.min ?? raw?.min_dollars),
    max: parseNumber(raw?.max ?? raw?.max_dollars),
  };
}

export function normalizeKalshiCandle(args: {
  raw: RawCandlestick;
  marketTicker: string;
  seriesTicker?: string | null;
  source: KalshiHistorySource;
  periodInterval: KalshiPeriodInterval;
}): KalshiCandle | null {
  if (!Number.isFinite(args.raw.end_period_ts)) return null;
  return {
    marketTicker: args.marketTicker,
    seriesTicker: args.seriesTicker || null,
    source: args.source,
    periodInterval: args.periodInterval,
    endPeriodTs: Number(args.raw.end_period_ts),
    yesBid: normalizeOhlc(args.raw.yes_bid),
    yesAsk: normalizeOhlc(args.raw.yes_ask),
    price: normalizePrice(args.raw.price),
    volume: parseNumber(args.raw.volume ?? args.raw.volume_fp),
    openInterest: parseNumber(args.raw.open_interest ?? args.raw.open_interest_fp),
  };
}

export function buildKalshiCandlesticksPath(args: {
  marketTicker: string;
  seriesTicker?: string | null;
  source: KalshiHistorySource;
  startTs: number;
  endTs: number;
  periodInterval: KalshiPeriodInterval;
}): string {
  const query = new URLSearchParams({
    start_ts: String(args.startTs),
    end_ts: String(args.endTs),
    period_interval: String(args.periodInterval),
  });
  const market = encodeURIComponent(args.marketTicker);
  if (args.source === "historical") {
    return `/trade-api/v2/historical/markets/${market}/candlesticks?${query}`;
  }
  if (!args.seriesTicker) {
    throw new Error("seriesTicker is required for live Kalshi candlesticks.");
  }
  return `/trade-api/v2/series/${encodeURIComponent(args.seriesTicker)}/markets/${market}/candlesticks?${query}`;
}

export async function fetchKalshiCandlesticks(args: {
  marketTicker: string;
  seriesTicker?: string | null;
  source: KalshiHistorySource;
  startTs: number;
  endTs: number;
  periodInterval: KalshiPeriodInterval;
}): Promise<KalshiCandle[]> {
  const apiPath = buildKalshiCandlesticksPath(args);
  const json = await kalshiFetchJson<RawCandlesticksResponse>(apiPath);
  const ticker = json.ticker || args.marketTicker;
  return (json.candlesticks ?? [])
    .map((raw) =>
      normalizeKalshiCandle({
        raw,
        marketTicker: ticker,
        seriesTicker: args.seriesTicker,
        source: args.source,
        periodInterval: args.periodInterval,
      }),
    )
    .filter((c): c is KalshiCandle => Boolean(c));
}

async function fetchKalshiMarketsPage(args: {
  seriesTicker: string;
  source: KalshiHistorySource;
  cursor?: string;
}): Promise<RawMarketsResponse> {
  const query = new URLSearchParams({
    series_ticker: args.seriesTicker,
    limit: "1000",
  });
  if (args.cursor) query.set("cursor", args.cursor);
  const prefix = args.source === "historical" ? "/trade-api/v2/historical/markets" : "/trade-api/v2/markets";
  return kalshiFetchJson<RawMarketsResponse>(`${prefix}?${query}`);
}

export async function discoverKalshiMarkets(args: {
  seriesTickers: string[];
  startTs: number;
  endTs: number;
  maxMarkets?: number;
}): Promise<KalshiDiscoveredMarket[]> {
  const maxMarkets = Math.max(1, args.maxMarkets ?? 50_000);
  const markets = new Map<string, KalshiDiscoveredMarket>();

  for (const seriesTicker of args.seriesTickers) {
    for (const source of ["historical", "live"] as const) {
      let cursor = "";
      do {
        const page = await fetchKalshiMarketsPage({
          seriesTicker,
          source,
          cursor: cursor || undefined,
        });
        for (const raw of page.markets ?? []) {
          if (!raw.ticker) continue;
          const closeTs =
            parseTimeSeconds(raw.settlement_ts) ??
            parseTimeSeconds(raw.close_time) ??
            parseTimeSeconds(raw.expiration_time);
          const openTs = parseTimeSeconds(raw.open_time);
          if (closeTs != null && (closeTs < args.startTs || closeTs > args.endTs)) continue;
          const key = `${source}:${raw.ticker}`;
          markets.set(key, {
            marketTicker: raw.ticker,
            seriesTicker,
            source,
            openTs,
            closeTs,
            status: raw.status ?? null,
          });
          if (markets.size >= maxMarkets) return [...markets.values()];
        }
        cursor = page.cursor ?? "";
      } while (cursor && markets.size < maxMarkets);
    }
  }

  return [...markets.values()].sort((a, b) => {
    const at = a.closeTs ?? 0;
    const bt = b.closeTs ?? 0;
    if (at !== bt) return at - bt;
    return a.marketTicker.localeCompare(b.marketTicker);
  });
}

function marketFetchWindow(args: {
  market: KalshiHistoryMarketRequest | KalshiDiscoveredMarket;
  requestStartTs: number;
  requestEndTs: number;
  periodInterval: KalshiPeriodInterval;
}): { startTs: number; endTs: number } {
  const discovered = args.market as Partial<KalshiDiscoveredMarket>;
  if (typeof discovered.closeTs === "number" && Number.isFinite(discovered.closeTs)) {
    const paddedOpen =
      typeof discovered.openTs === "number" && Number.isFinite(discovered.openTs)
        ? discovered.openTs - args.periodInterval * 60
        : discovered.closeTs - 30 * 60;
    return {
      startTs: Math.max(args.requestStartTs, paddedOpen),
      endTs: Math.min(args.requestEndTs, discovered.closeTs),
    };
  }
  return { startTs: args.requestStartTs, endTs: args.requestEndTs };
}

async function readJsonlGz(file: string): Promise<KalshiCandle[]> {
  try {
    const compressed = await readFile(file);
    const raw = await gunzipAsync(compressed);
    return raw
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as KalshiCandle);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function writeJsonlGz(file: string, candles: KalshiCandle[]): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const body = candles.map((c) => JSON.stringify(c)).join("\n") + (candles.length ? "\n" : "");
  const compressed = await gzipAsync(Buffer.from(body, "utf8"), { level: 9 });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, compressed);
  await rename(tmp, file);
}

function partitionFile(root: string, candle: KalshiCandle): string {
  const series = safeSegment(candle.seriesTicker ?? "archived");
  return path.join(
    root,
    "candles",
    `period=${candle.periodInterval}m`,
    `source=${candle.source}`,
    `series=${series}`,
    `market=${safeSegment(candle.marketTicker)}`,
    `date=${dateKey(candle.endPeriodTs)}.jsonl.gz`,
  );
}

async function readManifest(root = dataDir()): Promise<KalshiHistoryManifest> {
  try {
    return JSON.parse(await readFile(manifestPath(root), "utf8")) as KalshiHistoryManifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { version: 1, generatedAt: new Date(0).toISOString(), markets: {} };
  }
}

async function writeManifest(manifest: KalshiHistoryManifest, root = dataDir()): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(manifestPath(root), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function writeCandles(root: string, candles: KalshiCandle[]): Promise<{ candles: number; files: string[] }> {
  const byFile = new Map<string, KalshiCandle[]>();
  for (const candle of candles) {
    const file = partitionFile(root, candle);
    byFile.set(file, [...(byFile.get(file) ?? []), candle]);
  }

  const files: string[] = [];
  let written = 0;
  for (const [file, batch] of byFile) {
    const merged = new Map<number, KalshiCandle>();
    for (const candle of await readJsonlGz(file)) merged.set(candle.endPeriodTs, candle);
    for (const candle of batch) merged.set(candle.endPeriodTs, candle);
    const sorted = [...merged.values()].sort((a, b) => a.endPeriodTs - b.endPeriodTs);
    await writeJsonlGz(file, sorted);
    written += batch.length;
    files.push(path.relative(root, file));
  }
  return { candles: written, files: files.sort() };
}

async function summarizeMarketFiles(
  root: string,
  market: KalshiHistoryMarketManifest,
): Promise<KalshiHistoryMarketManifest> {
  const candles: KalshiCandle[] = [];
  for (const file of market.files) {
    for (const candle of await readJsonlGz(path.join(root, file))) {
      if (candle.marketTicker === market.marketTicker) candles.push(candle);
    }
  }
  const times = candles.map((c) => c.endPeriodTs);
  return {
    ...market,
    seriesTickers: [
      ...new Set([
        ...market.seriesTickers,
        ...candles.map((c) => c.seriesTicker).filter((s): s is string => Boolean(s)),
      ]),
    ].sort(),
    sources: [...new Set([...market.sources, ...candles.map((c) => c.source)])].sort(),
    periodIntervals: [...new Set([...market.periodIntervals, ...candles.map((c) => c.periodInterval)])].sort(
      (a, b) => a - b,
    ) as KalshiPeriodInterval[],
    candles: candles.length,
    startTs: times.length ? Math.min(...times) : null,
    endTs: times.length ? Math.max(...times) : null,
    updatedAt: new Date().toISOString(),
  };
}

async function updateManifest(
  root: string,
  manifest: KalshiHistoryManifest,
  request: KalshiHistoryMarketRequest & { source: KalshiHistorySource; periodInterval: KalshiPeriodInterval },
  candles: KalshiCandle[],
  files: string[],
): Promise<void> {
  const existing = manifest.markets[request.marketTicker] ?? {
    marketTicker: request.marketTicker,
    seriesTickers: [],
    sources: [],
    periodIntervals: [],
    candles: 0,
    startTs: null,
    endTs: null,
    files: [],
    updatedAt: new Date(0).toISOString(),
  };
  const times = candles.map((c) => c.endPeriodTs);
  const uniqueFiles = new Set([...existing.files, ...files]);
  const seriesTickers = new Set(existing.seriesTickers);
  if (request.seriesTicker) seriesTickers.add(request.seriesTicker);
  const next = {
    ...existing,
    seriesTickers: [...seriesTickers].sort(),
    sources: [...new Set([...existing.sources, request.source])].sort(),
    periodIntervals: [...new Set([...existing.periodIntervals, request.periodInterval])].sort(
      (a, b) => a - b,
    ) as KalshiPeriodInterval[],
    candles: existing.candles + candles.length,
    startTs: times.length ? Math.min(existing.startTs ?? Infinity, ...times) : existing.startTs,
    endTs: times.length ? Math.max(existing.endTs ?? 0, ...times) : existing.endTs,
    files: [...uniqueFiles].sort(),
    updatedAt: new Date().toISOString(),
  };
  manifest.markets[request.marketTicker] = await summarizeMarketFiles(root, next);
  manifest.generatedAt = new Date().toISOString();
}

export async function backfillKalshiHistory(request: KalshiBackfillRequest): Promise<KalshiBackfillResult> {
  if (!Number.isFinite(request.startTs) || !Number.isFinite(request.endTs) || request.endTs < request.startTs) {
    throw new Error("Provide a valid startTs/endTs window.");
  }

  const discovered = request.seriesTickers?.length
    ? await discoverKalshiMarkets({
        seriesTickers: request.seriesTickers,
        startTs: request.startTs,
        endTs: request.endTs,
        maxMarkets: request.maxMarkets,
      })
    : [];
  const markets = [...(request.markets ?? []), ...discovered];
  if (!markets.length) throw new Error("At least one Kalshi market or series ticker is required.");

  const root = dataDir();
  await mkdir(root, { recursive: true });
  const periodInterval = request.periodInterval ?? 1;
  const chunkMinutes = Math.max(1, Math.min(request.chunkMinutes ?? 7_200, 9_000));
  const manifest = await readManifest(root);
  const requests: KalshiBackfillResult["requests"] = [];

  for (const market of markets) {
    const source = market.source ?? (market.seriesTicker ? "live" : "historical");
    const window = marketFetchWindow({
      market,
      requestStartTs: request.startTs,
      requestEndTs: request.endTs,
      periodInterval,
    });
    let cursor = window.startTs;
    const fetched: KalshiCandle[] = [];
    while (cursor <= window.endTs) {
      const chunkEnd = Math.min(window.endTs, cursor + chunkMinutes * 60 - periodInterval * 60);
      const candles = await fetchKalshiCandlesticks({
        marketTicker: market.marketTicker,
        seriesTicker: market.seriesTicker,
        source,
        startTs: cursor,
        endTs: chunkEnd,
        periodInterval,
      });
      fetched.push(...candles);
      cursor = chunkEnd + periodInterval * 60;
    }
    const unique = [...new Map(fetched.map((c) => [c.endPeriodTs, c])).values()].sort(
      (a, b) => a.endPeriodTs - b.endPeriodTs,
    );
    const written = await writeCandles(root, unique);
    await updateManifest(root, manifest, { ...market, source, periodInterval }, unique, written.files);
    requests.push({
      marketTicker: market.marketTicker,
      seriesTicker: market.seriesTicker ?? null,
      source,
      fetchedCandles: fetched.length,
      writtenCandles: written.candles,
      files: written.files,
    });
  }

  await writeManifest(manifest, root);
  return {
    generatedAt: new Date().toISOString(),
    dataDir: root,
    periodInterval,
    startTs: request.startTs,
    endTs: request.endTs,
    discoveredMarkets: discovered.length,
    requests,
    manifest,
  };
}

async function pathExists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function discoverFiles(root: string): Promise<string[]> {
  const out: string[] = [];
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
      } else if (entry.endsWith(".jsonl.gz")) {
        out.push(path.relative(root, full));
      }
    }
  }
  await walk(path.join(root, "candles"));
  return out.sort();
}

export async function readKalshiHistoryManifest(): Promise<KalshiHistoryManifest> {
  const root = dataDir();
  const manifest = await readManifest(root);
  if (Object.keys(manifest.markets).length || !(await pathExists(path.join(root, "candles")))) {
    return manifest;
  }
  const files = await discoverFiles(root);
  return {
    ...manifest,
    markets: files.reduce<KalshiHistoryManifest["markets"]>((acc, file) => {
      const marketMatch = file.match(/market=([^/]+)/);
      const marketTicker = marketMatch?.[1] ?? "unknown";
      acc[marketTicker] = {
        marketTicker,
        seriesTickers: [],
        sources: [],
        periodIntervals: [],
        candles: 0,
        startTs: null,
        endTs: null,
        files: [...(acc[marketTicker]?.files ?? []), file],
        updatedAt: manifest.generatedAt,
      };
      return acc;
    }, {}),
  };
}

export async function readKalshiCandles(options: {
  marketTickers?: string[];
  periodInterval?: KalshiPeriodInterval;
} = {}): Promise<KalshiCandle[]> {
  const root = dataDir();
  const manifest = await readKalshiHistoryManifest();
  const selected = new Set(options.marketTickers ?? []);
  const files = new Set<string>();
  for (const market of Object.values(manifest.markets)) {
    if (selected.size && !selected.has(market.marketTicker)) continue;
    for (const file of market.files) files.add(file);
  }
  const candles: KalshiCandle[] = [];
  for (const file of files) {
    for (const candle of await readJsonlGz(path.join(root, file))) {
      if (options.periodInterval && candle.periodInterval !== options.periodInterval) continue;
      candles.push(candle);
    }
  }
  return candles.sort((a, b) => a.endPeriodTs - b.endPeriodTs);
}

function pctReturn(start: number, end: number): number {
  return Math.max(-1, Math.min(1, end / Math.max(start, 0.01) - 1));
}

export async function buildKalshiTrainingEvidence(options: {
  horizonMinutes?: number;
  minSamples?: number;
  marketTickers?: string[];
} = {}): Promise<KalshiTrainingEvidence | null> {
  const horizonMinutes = options.horizonMinutes ?? Number(process.env.KALSHI_TRSI_HORIZON_MINUTES || 15);
  const minSamples = options.minSamples ?? Number(process.env.KALSHI_TRSI_MIN_SAMPLES || 250);
  const candles = await readKalshiCandles({
    marketTickers: options.marketTickers,
    periodInterval: 1,
  });
  const byMarket = new Map<string, KalshiCandle[]>();
  for (const candle of candles) {
    if (candle.price.close == null) continue;
    byMarket.set(candle.marketTicker, [...(byMarket.get(candle.marketTicker) ?? []), candle]);
  }

  const createSamples: number[] = [];
  const decaySamples: number[] = [];
  const markets: string[] = [];
  for (const [market, marketCandles] of byMarket) {
    const sorted = marketCandles.sort((a, b) => a.endPeriodTs - b.endPeriodTs);
    if (sorted.length < 2) continue;
    markets.push(market);

    const first = sorted.find((c) => c.price.close != null);
    const last = [...sorted].reverse().find((c) => c.price.close != null);
    if (first?.price.close != null && last?.price.close != null && first.endPeriodTs < last.endPeriodTs) {
      const spread =
        first.yesAsk.close != null && first.yesBid.close != null
          ? Math.max(0, first.yesAsk.close - first.yesBid.close)
          : 0.02;
      const drawdown = Math.min(
        0,
        ...sorted.map((c) => (c.price.close == null ? 0 : pctReturn(first.price.close!, c.price.close))),
      );
      const move = pctReturn(first.price.close, last.price.close);
      createSamples.push(Math.max(0, move - spread));
      decaySamples.push(Math.max(0, spread + Math.abs(drawdown)));
    }

    for (let i = 0; i + horizonMinutes < sorted.length; i += 1) {
      const now = sorted[i];
      const future = sorted[i + horizonMinutes];
      const nowClose = now.price.close;
      const futureClose = future.price.close;
      if (nowClose == null || futureClose == null) continue;
      const spread =
        now.yesAsk.close != null && now.yesBid.close != null
          ? Math.max(0, now.yesAsk.close - now.yesBid.close)
          : 0.02;
      const window = sorted.slice(i, i + horizonMinutes + 1);
      const drawdown = Math.min(0, ...window.map((c) => (c.price.close == null ? 0 : pctReturn(nowClose, c.price.close))));
      const move = pctReturn(nowClose, futureClose);
      createSamples.push(Math.max(0, move - spread));
      decaySamples.push(Math.max(0, spread + Math.abs(drawdown)));
    }
  }

  if (createSamples.length < minSamples) return null;
  const hash = createHash("sha256")
    .update(`${markets.join(",")}:${createSamples.length}:${createSamples[0] ?? 0}:${createSamples.at(-1) ?? 0}`)
    .digest("hex")
    .slice(0, 10);
  return {
    source: `kalshi-history:${hash}`,
    sampleSize: createSamples.length,
    minSamples,
    horizonMinutes,
    createSamples,
    decaySamples,
    markets: markets.sort(),
  };
}

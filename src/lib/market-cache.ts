import "server-only";

import {
  fetchAlpacaCryptoBars,
  fetchAlpacaDailyBars,
  type AlpacaBarTimeframe,
} from "@/lib/alpaca";
import { readDocument, writeDocument } from "@/lib/storage";
import type { MarketCacheEntry, MarketCacheSummary } from "@/lib/types";

const CACHE_FILE = "market-cache.json";
const CACHE_NAMESPACE = "market-cache";
const DAILY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const INTRADAY_CACHE_TTL_MS = 60 * 1000;

type MarketCacheFile = {
  version: 1;
  entries: Record<string, MarketCacheEntry>;
};

type AssetClass = MarketCacheEntry["assetClass"];

type EnsureMarketCacheOptions = {
  days?: number;
  timeframe?: AlpacaBarTimeframe;
};

const CRYPTO_ALIASES: Record<string, string> = {
  BTC: "BTC/USD",
  BITCOIN: "BTC/USD",
  ETH: "ETH/USD",
  ETHEREUM: "ETH/USD",
  SOL: "SOL/USD",
  SOLANA: "SOL/USD",
};

export function normalizeCycleSymbol(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!cleaned) return null;
  if (CRYPTO_ALIASES[cleaned]) return CRYPTO_ALIASES[cleaned];
  const s = cleaned.replace(/[^A-Z./\-]/g, "").slice(0, 16);
  return s || null;
}

function assetClassForSymbol(symbol: string): AssetClass {
  return symbol.includes("/") ? "crypto" : "stock";
}

function cacheKey(symbol: string, timeframe: AlpacaBarTimeframe): string {
  return `${symbol}|${timeframe}`;
}

function normalizeCache(value: unknown): MarketCacheFile {
  try {
    const parsed = value as Partial<MarketCacheFile>;
    const entries = Object.fromEntries(
      Object.values(parsed.entries ?? {}).map((entry) => {
        const symbol = normalizeCycleSymbol(entry.symbol) ?? entry.symbol;
        const assetClass = entry.assetClass ?? assetClassForSymbol(symbol);
        const timeframe = entry.timeframe ?? (assetClass === "crypto" ? "15Min" : "1Day");
        const source = entry.source ?? (assetClass === "crypto" ? "alpaca_crypto_us" : "alpaca_iex");
        const hydrated: MarketCacheEntry = {
          ...entry,
          symbol,
          assetClass,
          timeframe,
          source,
          bars: entry.bars ?? [],
        };
        return [cacheKey(symbol, timeframe), hydrated];
      }),
    );
    return {
      version: 1,
      entries,
    };
  } catch {
    return { version: 1, entries: {} };
  }
}

async function readCache(): Promise<MarketCacheFile> {
  return readDocument(
    CACHE_NAMESPACE,
    CACHE_FILE,
    { version: 1, entries: {} },
    normalizeCache,
  );
}

async function writeCache(cache: MarketCacheFile): Promise<void> {
  await writeDocument(CACHE_NAMESPACE, CACHE_FILE, cache);
}

function isFresh(entry: MarketCacheEntry | undefined, minBars: number): boolean {
  if (!entry || entry.bars.length < minBars) return false;
  const age = Date.now() - Date.parse(entry.fetchedAt);
  const ttl = entry.timeframe === "15Min" ? INTRADAY_CACHE_TTL_MS : DAILY_CACHE_TTL_MS;
  const latestBarAge = Date.now() - Date.parse(entry.bars.at(-1)?.at ?? "");
  const latestBarIsCurrent =
    entry.timeframe !== "15Min" ||
    (Number.isFinite(latestBarAge) && latestBarAge < 2 * 60 * 60 * 1000);
  return Number.isFinite(age) && age < ttl && latestBarIsCurrent;
}

export function defaultCycleSymbols(): string[] {
  const raw = process.env.CYCLE_SYMBOLS?.trim();
  if (raw) {
    const parsed = raw
      .split(",")
      .map((s) => normalizeCycleSymbol(s))
      .filter((s): s is string => Boolean(s));
    if (parsed.length) return [...new Set(parsed)].slice(0, 12);
  }
  return ["BTC/USD", "ETH/USD", "SOL/USD"];
}

export async function ensureMarketCache(
  symbols = defaultCycleSymbols(),
  options: number | EnsureMarketCacheOptions = {},
): Promise<{ entries: MarketCacheEntry[]; summary: MarketCacheSummary }> {
  const opts = typeof options === "number" ? { days: options } : options;
  const timeframe = opts.timeframe ?? "15Min";
  const days = opts.days ?? (timeframe === "15Min" ? 21 : 140);
  const safeSymbols = [...new Set(symbols.map((s) => normalizeCycleSymbol(s)).filter(Boolean))] as string[];
  const cache = await readCache();
  const entries: MarketCacheEntry[] = [];

  for (const symbol of safeSymbols) {
    const assetClass = assetClassForSymbol(symbol);
    const requestedTimeframe = assetClass === "crypto" ? timeframe : "1Day";
    const key = cacheKey(symbol, requestedTimeframe);
    const minBars = requestedTimeframe === "15Min" ? 96 : 45;
    let entry = cache.entries[key] ?? cache.entries[symbol];
    if (
      entry?.symbol !== symbol ||
      entry?.timeframe !== requestedTimeframe ||
      entry?.assetClass !== assetClass ||
      !isFresh(entry, minBars)
    ) {
      const bars =
        assetClass === "crypto"
          ? await fetchAlpacaCryptoBars(symbol, days, requestedTimeframe)
          : await fetchAlpacaDailyBars(symbol, days);
      entry = {
        symbol,
        fetchedAt: new Date().toISOString(),
        source: assetClass === "crypto" ? "alpaca_crypto_us" : "alpaca_iex",
        assetClass,
        timeframe: requestedTimeframe,
        bars,
      };
      cache.entries[key] = entry;
    }
    entries.push(entry);
  }

  await writeCache(cache);
  return {
    entries,
    summary: summarizeMarketCache(entries),
  };
}

export async function readMarketCacheSummary(): Promise<MarketCacheSummary> {
  const cache = await readCache();
  return summarizeMarketCache(Object.values(cache.entries));
}

export async function readMarketCacheEntries(): Promise<MarketCacheEntry[]> {
  const cache = await readCache();
  return Object.values(cache.entries);
}

function summarizeMarketCache(entries: MarketCacheEntry[]): MarketCacheSummary {
  const sorted = [...entries].sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    symbols: sorted.map((e) => e.symbol),
    entries: sorted.map((e) => ({
      symbol: e.symbol,
      assetClass: e.assetClass,
      timeframe: e.timeframe,
      bars: e.bars.length,
      fetchedAt: e.fetchedAt,
      source: e.source,
      start: e.bars[0]?.at ?? null,
      end: e.bars.at(-1)?.at ?? null,
    })),
  };
}

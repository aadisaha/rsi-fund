import "server-only";

import { readMarketCacheEntries } from "@/lib/market-cache";
import { readDocument, writeDocument } from "@/lib/storage";
import type {
  MarketCacheEntry,
  MarkedPaperPosition,
  PaperBookPosition,
  PaperBookSummary,
  PaperCycleForecast,
  PaperCycleOutcome,
  PaperCycleRun,
} from "@/lib/types";

const BOOK_FILE = "paper-book.json";
const BOOK_NAMESPACE = "paper-book";

type PaperBookFile = {
  version: 1;
  positions: PaperBookPosition[];
};

function id(): string {
  return `pos-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBook(value: unknown): PaperBookFile {
  try {
    const parsed = value as Partial<PaperBookFile>;
    return {
      version: 1,
      positions: parsed.positions ?? [],
    };
  } catch {
    return { version: 1, positions: [] };
  }
}

async function readBook(): Promise<PaperBookFile> {
  return readDocument(BOOK_NAMESPACE, BOOK_FILE, { version: 1, positions: [] }, normalizeBook);
}

async function writeBook(book: PaperBookFile): Promise<void> {
  await writeDocument(BOOK_NAMESPACE, BOOK_FILE, book);
}

export async function recordPaperCycleFills(run: PaperCycleRun): Promise<PaperBookPosition[]> {
  if (run.rejected || !run.simulatedFills.length) return [];

  const book = await readBook();
  const existingForCycle = new Set(
    book.positions
      .filter((p) => p.cycleId === run.cycleId)
      .map((p) => `${p.symbol}:${p.notionalUsd}:${p.entryPrice}`),
  );
  const forecastBySymbol = new Map<string, PaperCycleForecast>(
    run.forecasts.map((f) => [f.symbol, f]),
  );

  const newPositions = run.simulatedFills
    .filter((fill) => !existingForCycle.has(`${fill.symbol}:${fill.notionalUsd}:${fill.referencePrice}`))
    .map((fill) => {
      const forecast = forecastBySymbol.get(fill.symbol);
      const assetClass = forecast?.assetClass ?? (fill.symbol.includes("/") ? "crypto" : "stock");
      const timeframe = forecast?.timeframe ?? (assetClass === "crypto" ? "15Min" : "1Day");
      return {
        id: id(),
        cycleId: run.cycleId,
        symbol: fill.symbol,
        assetClass,
        timeframe,
        openedAt: run.generatedAt,
        entryPrice: fill.referencePrice,
        quantity: fill.quantity,
        notionalUsd: fill.notionalUsd,
        forecastScore: forecast?.score ?? 0,
        expectedReturn: forecast?.expectedReturn ?? 0,
        benchmarkSymbol: assetClass === "crypto" ? "BTC/USD" : "SPY",
        status: "open" as const,
      };
    });

  if (newPositions.length) {
    book.positions.push(...newPositions);
    await writeBook(book);
  }
  return newPositions;
}

export async function readMarkedPaperBook(): Promise<PaperBookSummary> {
  const [book, cacheEntries] = await Promise.all([readBook(), readMarketCacheEntries()]);
  return markBook(book.positions, cacheEntries);
}

function markBook(
  positions: PaperBookPosition[],
  cacheEntries: MarketCacheEntry[],
): PaperBookSummary {
  const cacheBySymbol = new Map<string, MarketCacheEntry[]>();
  for (const entry of cacheEntries) {
    const existing = cacheBySymbol.get(entry.symbol) ?? [];
    existing.push(entry);
    cacheBySymbol.set(entry.symbol, existing);
  }

  const marked = positions.map((position) => markPosition(position, cacheBySymbol));
  const cycleOutcomes = outcomesByCycle(marked);
  const notionalUsd = sum(marked.map((p) => p.notionalUsd));
  const currentValueUsd = sum(marked.map((p) => p.currentValueUsd));
  const unrealizedPnlUsd = currentValueUsd - notionalUsd;
  const weightedBenchmark = weightedAverage(
    marked
      .filter((p) => p.benchmarkReturnPct != null)
      .map((p) => ({ weight: p.notionalUsd, value: p.benchmarkReturnPct as number })),
  );
  const returnPct = notionalUsd > 0 ? unrealizedPnlUsd / notionalUsd : 0;

  return {
    generatedAt: new Date().toISOString(),
    openPositions: marked.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt)),
    cycleOutcomes,
    totals: {
      openCount: marked.length,
      notionalUsd,
      currentValueUsd,
      unrealizedPnlUsd,
      returnPct,
      benchmarkReturnPct: weightedBenchmark,
      alphaVsBenchmarkPct: weightedBenchmark == null ? null : returnPct - weightedBenchmark,
    },
  };
}

function markPosition(
  position: PaperBookPosition,
  cacheBySymbol: Map<string, MarketCacheEntry[]>,
): MarkedPaperPosition {
  const entry = bestEntry(cacheBySymbol.get(position.symbol) ?? [], position.timeframe);
  const latest = entry?.bars.at(-1) ?? null;
  const markPrice = latest?.close ?? null;
  const currentValueUsd = markPrice == null ? position.notionalUsd : position.quantity * markPrice;
  const unrealizedPnlUsd = currentValueUsd - position.notionalUsd;
  const returnPct = position.notionalUsd > 0 ? unrealizedPnlUsd / position.notionalUsd : 0;
  const benchmarkReturnPct = benchmarkReturn(position, cacheBySymbol);
  const openedMs = Date.parse(position.openedAt);
  const ageHours = Number.isFinite(openedMs)
    ? Math.max(0, (Date.now() - openedMs) / (60 * 60 * 1000))
    : 0;

  return {
    ...position,
    markPrice,
    markAt: latest?.at ?? null,
    currentValueUsd,
    unrealizedPnlUsd,
    returnPct,
    ageHours,
    benchmarkReturnPct,
    alphaVsBenchmarkPct: benchmarkReturnPct == null ? null : returnPct - benchmarkReturnPct,
  };
}

function benchmarkReturn(
  position: PaperBookPosition,
  cacheBySymbol: Map<string, MarketCacheEntry[]>,
): number | null {
  const benchmarkEntry = bestEntry(
    cacheBySymbol.get(position.benchmarkSymbol) ?? [],
    position.timeframe,
  );
  if (!benchmarkEntry?.bars.length) return null;
  const current = benchmarkEntry.bars.at(-1);
  const entry = firstBarAtOrAfter(benchmarkEntry, position.openedAt);
  if (!current || !entry || entry.close <= 0) return null;
  return current.close / entry.close - 1;
}

function firstBarAtOrAfter(entry: MarketCacheEntry, iso: string) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return entry.bars.at(0) ?? null;
  return entry.bars.find((bar) => Date.parse(bar.at) >= t) ?? entry.bars.at(0) ?? null;
}

function bestEntry(entries: MarketCacheEntry[], timeframe: PaperBookPosition["timeframe"]) {
  return (
    entries.find((entry) => entry.timeframe === timeframe) ??
    entries.sort((a, b) => b.bars.length - a.bars.length)[0] ??
    null
  );
}

function outcomesByCycle(positions: MarkedPaperPosition[]): PaperCycleOutcome[] {
  const byCycle = new Map<string, MarkedPaperPosition[]>();
  for (const position of positions) {
    const rows = byCycle.get(position.cycleId) ?? [];
    rows.push(position);
    byCycle.set(position.cycleId, rows);
  }

  return [...byCycle.entries()]
    .map(([cycleId, rows]) => {
      const notionalUsd = sum(rows.map((p) => p.notionalUsd));
      const currentValueUsd = sum(rows.map((p) => p.currentValueUsd));
      const unrealizedPnlUsd = currentValueUsd - notionalUsd;
      const returnPct = notionalUsd > 0 ? unrealizedPnlUsd / notionalUsd : 0;
      const benchmarkReturnPct = weightedAverage(
        rows
          .filter((p) => p.benchmarkReturnPct != null)
          .map((p) => ({ weight: p.notionalUsd, value: p.benchmarkReturnPct as number })),
      );
      return {
        cycleId,
        openedAt: rows.map((p) => p.openedAt).sort()[0],
        positions: rows.length,
        notionalUsd,
        currentValueUsd,
        unrealizedPnlUsd,
        returnPct,
        avgForecastScore: mean(rows.map((p) => p.forecastScore)),
        benchmarkReturnPct,
        alphaVsBenchmarkPct: benchmarkReturnPct == null ? null : returnPct - benchmarkReturnPct,
      };
    })
    .sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
}

function sum(xs: number[]): number {
  return xs.reduce((total, x) => total + x, 0);
}

function mean(xs: number[]): number {
  return sum(xs) / Math.max(xs.length, 1);
}

function weightedAverage(rows: Array<{ weight: number; value: number }>): number | null {
  const totalWeight = sum(rows.map((r) => r.weight));
  if (totalWeight <= 0 || !rows.length) return null;
  return sum(rows.map((r) => r.weight * r.value)) / totalWeight;
}

import type {
  MarketCacheSummary,
  PaperBookSummary,
  PaperCycleRiskLimit,
  PaperCycleRiskResult,
} from "@/lib/types";

type PlannedFill = {
  symbol: string;
  notionalUsd: number;
};

export type PaperCycleRiskLimits = {
  maxCacheAgeMs?: number;
  maxSymbols?: number;
  maxNotionalUsd?: number;
  maxPerSymbolNotionalUsd?: number;
  maxOpenExposureUsd?: number;
};

export type PaperCycleRiskInput = {
  generatedAt?: string;
  now?: Date;
  symbols: string[];
  cache: MarketCacheSummary;
  plannedFills: PlannedFill[];
  openBook?: PaperBookSummary;
  openExposureUsd?: number;
  availableCapitalUsd: number | null;
  limits?: PaperCycleRiskLimits;
};

const DEFAULT_LIMITS = {
  maxCacheAgeMs: 2 * 60 * 60 * 1000,
  maxSymbols: 12,
};

function envFlag(value: string | undefined): boolean {
  if (value == null) return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return !["0", "false", "no", "off"].includes(normalized);
}

function finiteNonNegative(value: number | null | undefined): number {
  return Number.isFinite(value) && value != null && value > 0 ? value : 0;
}

function dollars(value: number): string {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function newestCacheAgeMs(cache: MarketCacheSummary, now: Date): number | null {
  const ages = cache.entries
    .map((entry) => Date.parse(entry.fetchedAt))
    .filter((t) => Number.isFinite(t))
    .map((t) => now.getTime() - t);
  if (!ages.length) return null;
  return Math.max(...ages);
}

function aggregateBySymbol(fills: PlannedFill[]): Map<string, number> {
  const bySymbol = new Map<string, number>();
  for (const fill of fills) {
    bySymbol.set(fill.symbol, (bySymbol.get(fill.symbol) ?? 0) + finiteNonNegative(fill.notionalUsd));
  }
  return bySymbol;
}

export function evaluatePaperCycleRisk(input: PaperCycleRiskInput): PaperCycleRiskResult {
  const now = input.now ?? new Date();
  const generatedAt = input.generatedAt ?? now.toISOString();
  const capital = input.availableCapitalUsd;
  const positiveCapital = finiteNonNegative(capital);
  const plannedNotionalUsd = input.plannedFills.reduce(
    (sum, fill) => sum + finiteNonNegative(fill.notionalUsd),
    0,
  );
  const openExposureUsd = finiteNonNegative(
    input.openExposureUsd ?? input.openBook?.totals.notionalUsd,
  );
  const totalOpenExposureUsd = openExposureUsd + plannedNotionalUsd;
  const maxNotionalUsd = input.limits?.maxNotionalUsd ?? positiveCapital;
  const maxPerSymbolNotionalUsd =
    input.limits?.maxPerSymbolNotionalUsd ?? Math.max(positiveCapital * 0.25, 0);
  const maxOpenExposureUsd = input.limits?.maxOpenExposureUsd ?? positiveCapital;
  const maxCacheAgeMs = input.limits?.maxCacheAgeMs ?? DEFAULT_LIMITS.maxCacheAgeMs;
  const maxSymbols = input.limits?.maxSymbols ?? DEFAULT_LIMITS.maxSymbols;
  const cacheAgeMs = newestCacheAgeMs(input.cache, now);
  const bySymbol = aggregateBySymbol(input.plannedFills);
  const largestSymbol = [...bySymbol.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const killSwitch = envFlag(process.env.PAPER_KILL_SWITCH);

  const limits: PaperCycleRiskLimit[] = [
    {
      name: "kill-switch",
      ok: !killSwitch,
      actual: killSwitch,
      limit: false,
      message: killSwitch
        ? "PAPER_KILL_SWITCH is active; paper cycle must be withheld."
        : "PAPER_KILL_SWITCH is not active.",
    },
    {
      name: "capital",
      ok: Number.isFinite(capital) && capital != null && capital > 0,
      actual: capital,
      limit: "> 0",
      message:
        Number.isFinite(capital) && capital != null && capital > 0
          ? `Capital source is positive at ${dollars(capital)}.`
          : "Capital source must be positive before paper risk can pass.",
    },
    {
      name: "cache-freshness",
      ok: cacheAgeMs != null && cacheAgeMs >= 0 && cacheAgeMs <= maxCacheAgeMs,
      actual: cacheAgeMs,
      limit: maxCacheAgeMs,
      message:
        cacheAgeMs == null
          ? "No valid market cache timestamps are available."
          : cacheAgeMs < 0
            ? "Market cache timestamp is in the future."
            : cacheAgeMs <= maxCacheAgeMs
              ? `Market cache age is within ${Math.round(maxCacheAgeMs / 1000)} seconds.`
              : `Market cache is stale at ${Math.round(cacheAgeMs / 1000)} seconds old.`,
    },
    {
      name: "max-symbols",
      ok: input.symbols.length <= maxSymbols,
      actual: input.symbols.length,
      limit: maxSymbols,
      message:
        input.symbols.length <= maxSymbols
          ? `Symbol count ${input.symbols.length} is within the limit.`
          : `Symbol count ${input.symbols.length} exceeds max ${maxSymbols}.`,
    },
    {
      name: "max-notional",
      ok: plannedNotionalUsd <= maxNotionalUsd,
      actual: plannedNotionalUsd,
      limit: maxNotionalUsd,
      message:
        plannedNotionalUsd <= maxNotionalUsd
          ? `Planned notional ${dollars(plannedNotionalUsd)} is within max notional.`
          : `Planned notional ${dollars(plannedNotionalUsd)} exceeds ${dollars(maxNotionalUsd)}.`,
    },
    {
      name: "max-per-symbol-notional",
      ok: (largestSymbol?.[1] ?? 0) <= maxPerSymbolNotionalUsd,
      actual: largestSymbol ? `${largestSymbol[0]}:${largestSymbol[1]}` : 0,
      limit: maxPerSymbolNotionalUsd,
      message:
        (largestSymbol?.[1] ?? 0) <= maxPerSymbolNotionalUsd
          ? "Per-symbol planned notional is within limit."
          : `${largestSymbol?.[0]} planned notional ${dollars(
              largestSymbol?.[1] ?? 0,
            )} exceeds ${dollars(maxPerSymbolNotionalUsd)}.`,
    },
    {
      name: "max-open-exposure",
      ok: totalOpenExposureUsd <= maxOpenExposureUsd,
      actual: totalOpenExposureUsd,
      limit: maxOpenExposureUsd,
      message:
        totalOpenExposureUsd <= maxOpenExposureUsd
          ? `Open exposure plus planned notional ${dollars(totalOpenExposureUsd)} is within limit.`
          : `Open exposure plus planned notional ${dollars(totalOpenExposureUsd)} exceeds ${dollars(
              maxOpenExposureUsd,
            )}.`,
    },
  ];

  const failed = limits.filter((limit) => !limit.ok);
  return {
    generatedAt,
    ok: failed.length === 0,
    limits,
    summary: failed.length
      ? `Paper cycle risk failed ${failed.length} limit${failed.length === 1 ? "" : "s"}: ${failed
          .map((limit) => limit.name)
          .join(", ")}.`
      : "Paper cycle risk passed all limits.",
  };
}

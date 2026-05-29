import "server-only";

import { fetchAlpacaSnapshot } from "@/lib/alpaca";
import { activeExperiment } from "@/lib/experiments";
import { buildInvestmentChannelCalibration } from "@/lib/investment-estimator";
import { appendLedger } from "@/lib/ledger";
import { defaultCycleSymbols, ensureMarketCache } from "@/lib/market-cache";
import { buildAllocationProposal } from "@/lib/optimizer";
import { buildOutcomeEvaluationSummary } from "@/lib/outcomes";
import { readMarkedPaperBook, recordPaperCycleFills } from "@/lib/paper-book";
import { readRecursionState, runRecursiveResearchDecision } from "@/lib/recursion";
import { evaluatePaperCycleRisk } from "@/lib/risk";
import { computeTRsi } from "@/lib/trsi";
import type {
  ExperimentSpec,
  MarketCacheEntry,
  PaperCycleForecast,
  PaperCycleRun,
  ResearchDecisionParameterSet,
} from "@/lib/types";

let activeCycle: Promise<PaperCycleRun> | null = null;

function returns(closes: number[]): number[] {
  return closes.slice(1).map((c, i) => c / closes[i] - 1);
}

function mean(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / Math.max(xs.length, 1);
}

function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

function pctChange(closes: number[], lookback: number): number {
  if (closes.length <= lookback) return 0;
  const last = closes.at(-1);
  const prior = closes.at(-1 - lookback);
  if (!last || !prior || prior <= 0) return 0;
  return last / prior - 1;
}

function cadenceForEntries(entries: MarketCacheEntry[]): "market-hours" | "24/7" {
  return entries.every((e) => e.assetClass === "crypto") ? "24/7" : "market-hours";
}

function marketForEntries(entries: MarketCacheEntry[]): "equities" | "crypto" {
  return entries.every((e) => e.assetClass === "crypto") ? "crypto" : "equities";
}

function numberParam(
  parameters: ExperimentSpec["parameters"],
  key: keyof ResearchDecisionParameterSet,
  fallback: number,
): number {
  const n = Number(parameters[key]);
  return Number.isFinite(n) ? n : fallback;
}

function lookbackLabel(bars: number, isIntradayCrypto: boolean): string {
  if (!isIntradayCrypto) return `${bars}d`;
  const hours = (bars * 15) / 60;
  return hours >= 24 && hours % 24 === 0 ? `${hours / 24}d` : `${hours}h`;
}

function forecastFromEntry(
  entry: MarketCacheEntry,
  parameters: ExperimentSpec["parameters"],
): PaperCycleForecast | null {
  const closes = entry.bars.map((b) => b.close).filter((n) => Number.isFinite(n) && n > 0);
  const isIntradayCrypto = entry.assetClass === "crypto" && entry.timeframe === "15Min";
  const shortLookback = isIntradayCrypto
    ? numberParam(parameters, "shortLookbackBars", 96)
    : 20;
  const longLookback = isIntradayCrypto
    ? numberParam(parameters, "longLookbackBars", 96 * 7)
    : 60;
  const minBars = Math.max(shortLookback + 1, isIntradayCrypto ? 120 : 45);
  if (closes.length < minBars) return null;
  const recentReturns = returns(closes).slice(-longLookback);
  const shortMomentum = pctChange(closes, shortLookback);
  const longMomentum = pctChange(closes, longLookback);
  const barsPerYear = isIntradayCrypto ? 365 * 24 * 4 : 252;
  const annualizedVol = sd(recentReturns) * Math.sqrt(barsPerYear);
  const expectedReturn = 0.65 * shortMomentum + 0.35 * longMomentum;
  const confidenceBase = isIntradayCrypto ? 28 : 14;
  const confidence = Math.max(0.05, Math.min(0.95, Math.sqrt(closes.length) / confidenceBase));
  const score = expectedReturn / Math.max(annualizedVol, 0.03) * confidence;
  return {
    symbol: entry.symbol,
    assetClass: entry.assetClass,
    timeframe: entry.timeframe,
    lastClose: closes.at(-1)!,
    shortMomentum,
    longMomentum,
    shortLookbackLabel: lookbackLabel(shortLookback, isIntradayCrypto),
    longLookbackLabel: lookbackLabel(longLookback, isIntradayCrypto),
    annualizedVol,
    expectedReturn,
    confidence,
    score,
  };
}

export async function runPaperCycle(symbols?: string[]): Promise<PaperCycleRun> {
  const cycleId = `cycle-${Date.now().toString(36)}`;
  const experiment = await activeExperiment();
  const cycleSymbols = symbols?.length ? symbols : experiment.universe.length ? experiment.universe : defaultCycleSymbols();
  const [alpaca, cacheResult, paperBook] = await Promise.all([
    fetchAlpacaSnapshot(),
    ensureMarketCache(cycleSymbols, { timeframe: "15Min" }),
    readMarkedPaperBook(),
  ]);
  const outcomeEvaluation = buildOutcomeEvaluationSummary(paperBook);
  const investmentCalibration = buildInvestmentChannelCalibration(paperBook);

  const proposal = buildAllocationProposal({
    equityUsd: alpaca.ok ? alpaca.equityUsd : null,
    cashUsd: alpaca.ok ? alpaca.cashUsd : null,
    kalshiPortfolioUsd: null,
    recentLedgerCount: cacheResult.entries.length,
    investmentEstimate: investmentCalibration.channel,
  });
  const tRsi = computeTRsi(proposal);

  const forecasts = cacheResult.entries
    .map((entry) => forecastFromEntry(entry, experiment.parameters))
    .filter((f): f is PaperCycleForecast => Boolean(f))
    .sort((a, b) => b.score - a.score);

  const maxPositiveForecasts = Math.max(
    1,
    Math.min(5, numberParam(experiment.parameters, "maxPositiveForecasts", 5)),
  );
  const positive = forecasts.filter((f) => f.score > 0).slice(0, maxPositiveForecasts);
  const investmentBudget =
    proposal.channels.find((c) => c.id === "I")?.proposedUsd ?? 0;
  const totalScore = positive.reduce((sum, f) => sum + f.score, 0);
  const simulatedFills =
    tRsi.approved && totalScore > 0
      ? positive.map((f) => {
          const notionalUsd = Math.round((investmentBudget * f.score) / totalScore);
          return {
            symbol: f.symbol,
            notionalUsd,
            referencePrice: f.lastClose,
            quantity: Number((notionalUsd / f.lastClose).toFixed(6)),
            reason:
              f.assetClass === "crypto"
                ? "Paper 15-minute crypto momentum allocation; no live order sent."
                : "Paper momentum allocation; no live order sent.",
          };
        })
      : [];
  const risk = evaluatePaperCycleRisk({
    symbols: cacheResult.summary.symbols,
    cache: cacheResult.summary,
    plannedFills: simulatedFills,
    openBook: paperBook,
    availableCapitalUsd: proposal.deployableCapitalUsd,
  });

  const rejected = !tRsi.approved || simulatedFills.length === 0 || !risk.ok;
  const reason = rejected
    ? !risk.ok
      ? risk.summary
      : "Cycle withheld: certificate failed or no positive paper forecasts."
    : "Cycle accepted in paper mode and simulated fills were recorded.";

  const recursion = await readRecursionState();
  const run: PaperCycleRun = {
    cycleId,
    generatedAt: new Date().toISOString(),
    mode: "paper",
    symbols: cacheResult.summary.symbols,
    timeframe: "15Min",
    cadence: cadenceForEntries(cacheResult.entries),
    market: marketForEntries(cacheResult.entries),
    cache: cacheResult.summary,
    proposal,
    tRsi,
    risk,
    recursion,
    forecasts,
    simulatedFills,
    rejected,
    reason,
    experimentId: experiment.experimentId,
    modelId: experiment.modelId,
  };

  await appendLedger({
    type: "observation",
    source: "system",
    payload: {
      cycleId,
      cache: cacheResult.summary,
      alpacaMode: alpaca.ok ? alpaca.mode : alpaca.mode,
      cadence: cadenceForEntries(cacheResult.entries),
      market: marketForEntries(cacheResult.entries),
      experimentId: experiment.experimentId,
      modelId: experiment.modelId,
      activeDecisionId: recursion.activeDecisionId,
      outcomeEvaluation,
    },
  });

  for (const f of forecasts) {
    await appendLedger({
      type: "forecast",
      modelId: "ewm-v0-paper-cycle",
      target: f.symbol,
      mean: f.expectedReturn,
      sigma: f.annualizedVol,
      payload: { cycleId, experimentId: experiment.experimentId, forecast: f },
    });
  }

  await appendLedger({
    type: "observation",
    source: "system",
    payload: {
      cycleId,
      outcomeEvaluation: {
        horizons: outcomeEvaluation.horizons,
        readyEvaluations: outcomeEvaluation.evaluations.filter((e) => e.status === "ready").length,
      },
    },
  });

  await appendLedger({
    type: "paper_action",
    action: rejected ? "rejected" : "simulated_fill",
    channel: "portfolio",
    notionalUsd: simulatedFills.reduce((sum, f) => sum + f.notionalUsd, 0),
    reason,
    payload: run,
  });

  const newPositions = await recordPaperCycleFills(run);
  if (newPositions.length) {
    await appendLedger({
      type: "observation",
      source: "system",
      payload: {
        cycleId,
        paperBook: {
          addedPositions: newPositions.length,
          notionalUsd: newPositions.reduce((sum, p) => sum + p.notionalUsd, 0),
        },
      },
    });
  }

  await appendLedger({
    type: "certificate",
    approved: tRsi.approved,
    tRsi: tRsi.tRsi,
    threshold: tRsi.threshold,
    reason: tRsi.reason,
    payload: { cycleId, tRsi, risk },
  });

  const nextRecursion = await runRecursiveResearchDecision({
    cycleId,
    activeExperiment: experiment,
    paperBook,
    outcomeEvaluation,
    cache: cacheResult.summary,
    proposal,
  });
  run.recursion = nextRecursion;
  run.researchDecisionId = nextRecursion.lastDecision?.decisionId ?? null;

  return run;
}

export async function runPaperCycleLocked(
  symbols?: string[],
): Promise<PaperCycleRun> {
  if (activeCycle) return activeCycle;
  activeCycle = runPaperCycle(symbols).finally(() => {
    activeCycle = null;
  });
  return activeCycle;
}

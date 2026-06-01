import "server-only";

import { fetchAlpacaCryptoBars, fetchAlpacaDailyBars } from "@/lib/alpaca";
import { normalizeCycleSymbol } from "@/lib/market-cache";
import type {
  BacktestModelResult,
  CachedBar,
  ModelComparisonBacktest,
} from "@/lib/types";

type ModelSpec = {
  modelId: string;
  label: string;
  trainWindowBars: number;
  predict: (closes: number[]) => number;
};

function mean(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / Math.max(xs.length, 1);
}

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1));
}

function pctChange(closes: number[], lookback: number): number {
  if (closes.length <= lookback) return 0;
  const last = closes.at(-1);
  const prior = closes.at(-1 - lookback);
  if (!last || !prior || prior <= 0) return 0;
  return last / prior - 1;
}

function returns(closes: number[]): number[] {
  return closes.slice(1).map((close, index) => close / closes[index] - 1);
}

function rollingMean(closes: number[], lookback: number): number {
  return mean(closes.slice(-lookback));
}

function rollingReturns(closes: number[], lookback: number): number[] {
  return returns(closes).slice(-lookback);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function exponentialReturnForecast(closes: number[], lookback: number, halfLife: number): number {
  const rs = rollingReturns(closes, lookback);
  if (!rs.length) return 0;
  let weightSum = 0;
  let weighted = 0;
  for (let i = 0; i < rs.length; i += 1) {
    const age = rs.length - 1 - i;
    const weight = Math.exp(-Math.log(2) * age / halfLife);
    weightSum += weight;
    weighted += rs[i] * weight;
  }
  return weightSum > 0 ? weighted / weightSum : 0;
}

function modelSpecs(isCrypto: boolean): ModelSpec[] {
  const short = isCrypto ? 16 : 5;
  const medium = isCrypto ? 96 : 20;
  const long = isCrypto ? 96 * 7 : 60;
  const breakout = isCrypto ? 48 : 20;

  return [
    {
      modelId: "last-return-persistence",
      label: "Last return persistence",
      trainWindowBars: Math.max(short + 2, 12),
      predict: (closes) => rollingReturns(closes, 1).at(-1) ?? 0,
    },
    {
      modelId: "ewm-short-momentum",
      label: "EWM short momentum",
      trainWindowBars: medium + 2,
      predict: (closes) => exponentialReturnForecast(closes, medium, Math.max(4, short / 2)),
    },
    {
      modelId: "dual-horizon-momentum",
      label: "Dual-horizon momentum",
      trainWindowBars: long + 2,
      predict: (closes) => {
        const shortDrift = pctChange(closes, medium) / medium;
        const longDrift = pctChange(closes, long) / long;
        return 0.65 * shortDrift + 0.35 * longDrift;
      },
    },
    {
      modelId: "mean-reversion-zscore",
      label: "Mean reversion z-score",
      trainWindowBars: medium + 2,
      predict: (closes) => {
        const price = closes.at(-1) ?? 0;
        const ma = rollingMean(closes, medium);
        const vol = sd(rollingReturns(closes, medium));
        if (price <= 0 || ma <= 0 || vol <= 0) return 0;
        const z = clamp((price / ma - 1) / Math.max(vol * Math.sqrt(medium), 0.0001), -3, 3);
        return clamp(-z * vol * 0.18, -0.025, 0.025);
      },
    },
    {
      modelId: "channel-breakout",
      label: "Channel breakout",
      trainWindowBars: breakout + 2,
      predict: (closes) => {
        const price = closes.at(-1) ?? 0;
        const window = closes.slice(-breakout - 1, -1);
        const upper = Math.max(...window);
        const lower = Math.min(...window);
        const avgAbsMove = mean(rollingReturns(closes, breakout).map((r) => Math.abs(r)));
        if (price > upper) return avgAbsMove;
        if (price < lower) return -avgAbsMove;
        return 0;
      },
    },
    {
      modelId: "ensemble-average",
      label: "Simple ensemble",
      trainWindowBars: long + 2,
      predict: (closes) => {
        const ewm = exponentialReturnForecast(closes, medium, Math.max(4, short / 2));
        const dual = 0.65 * (pctChange(closes, medium) / medium) + 0.35 * (pctChange(closes, long) / long);
        const price = closes.at(-1) ?? 0;
        const ma = rollingMean(closes, medium);
        const vol = sd(rollingReturns(closes, medium));
        const reversion = price > 0 && ma > 0 && vol > 0
          ? clamp(-((price / ma - 1) / Math.max(vol * Math.sqrt(medium), 0.0001)) * vol * 0.12, -0.02, 0.02)
          : 0;
        return mean([ewm, dual, reversion]);
      },
    },
  ];
}

function maxDrawdownPct(equityCurve: number[]): number | null {
  if (!equityCurve.length) return null;
  let peak = equityCurve[0];
  let drawdown = 0;
  for (const equity of equityCurve) {
    peak = Math.max(peak, equity);
    if (peak > 0) drawdown = Math.min(drawdown, equity / peak - 1);
  }
  return drawdown * 100;
}

function evaluateSpec(
  spec: ModelSpec,
  bars: CachedBar[],
  horizonBars: number,
  periodsPerYear: number,
): BacktestModelResult {
  const closes = bars.map((bar) => bar.close).filter((close) => Number.isFinite(close) && close > 0);
  const predictions: number[] = [];
  const actuals: number[] = [];
  const strategyReturns: number[] = [];
  const equityCurve: number[] = [1];

  for (let i = spec.trainWindowBars; i < closes.length - horizonBars; i += 1) {
    const history = closes.slice(0, i + 1);
    const current = closes[i];
    const future = closes[i + horizonBars];
    if (!current || !future || current <= 0) continue;
    const predicted = clamp(spec.predict(history), -0.08, 0.08);
    const actual = future / current - 1;
    const direction = predicted > 0 ? 1 : predicted < 0 ? -1 : 0;
    const strategyReturn = direction * actual;
    predictions.push(predicted);
    actuals.push(actual);
    strategyReturns.push(strategyReturn);
    equityCurve.push((equityCurve.at(-1) ?? 1) * (1 + strategyReturn));
  }

  if (!predictions.length) {
    return {
      modelId: spec.modelId,
      label: spec.label,
      observations: 0,
      trainWindowBars: spec.trainWindowBars,
      horizonBars,
      directionalAccuracy: null,
      rmseBps: null,
      maeBps: null,
      strategyReturnPct: null,
      buyHoldReturnPct: null,
      maxDrawdownPct: null,
      sharpeProxy: null,
      lastPredictionPct: null,
      lastTargetPrice: null,
      note: "Not enough bars for this model window.",
    };
  }

  const errors = predictions.map((prediction, index) => prediction - actuals[index]);
  const correct = predictions.filter((prediction, index) => Math.sign(prediction) === Math.sign(actuals[index])).length;
  const startIndex = spec.trainWindowBars;
  const startPrice = closes[startIndex];
  const endPrice = closes.at(-1);
  const buyHold = startPrice && endPrice ? endPrice / startPrice - 1 : null;
  const strategyVol = sd(strategyReturns);
  const avgStrategyReturn = mean(strategyReturns);
  const lastPrediction = clamp(spec.predict(closes), -0.08, 0.08);
  const lastClose = closes.at(-1) ?? null;

  return {
    modelId: spec.modelId,
    label: spec.label,
    observations: predictions.length,
    trainWindowBars: spec.trainWindowBars,
    horizonBars,
    directionalAccuracy: correct / predictions.length,
    rmseBps: Math.sqrt(mean(errors.map((error) => error ** 2))) * 10_000,
    maeBps: mean(errors.map((error) => Math.abs(error))) * 10_000,
    strategyReturnPct: ((equityCurve.at(-1) ?? 1) - 1) * 100,
    buyHoldReturnPct: buyHold == null ? null : buyHold * 100,
    maxDrawdownPct: maxDrawdownPct(equityCurve),
    sharpeProxy: strategyVol > 0 ? (avgStrategyReturn / strategyVol) * Math.sqrt(periodsPerYear / horizonBars) : null,
    lastPredictionPct: lastPrediction * 100,
    lastTargetPrice: lastClose == null ? null : lastClose * (1 + lastPrediction),
    note: "Walk-forward next-bar forecast; each prediction only sees prior bars.",
  };
}

export function compareModelArchitectures(
  symbol: string,
  timeframe: "1Day" | "15Min",
  bars: CachedBar[],
  horizonBars = 1,
): ModelComparisonBacktest {
  const safeSymbol = normalizeCycleSymbol(symbol);
  if (!safeSymbol) throw new Error("A market symbol is required.");

  const isCrypto = timeframe === "15Min";
  const cleanBars = bars.filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
  const safeHorizon = Math.max(1, Math.min(16, Math.floor(horizonBars)));
  const periodsPerYear = isCrypto ? 365 * 24 * 4 : 252;
  const results = modelSpecs(isCrypto).map((spec) =>
    evaluateSpec(spec, cleanBars, safeHorizon, periodsPerYear),
  );
  const ranked = results
    .filter((result) => result.directionalAccuracy != null)
    .sort((a, b) => {
      const aScore = (a.directionalAccuracy ?? 0) * 2 + (a.sharpeProxy ?? 0) * 0.15 - (a.rmseBps ?? 0) / 10_000;
      const bScore = (b.directionalAccuracy ?? 0) * 2 + (b.sharpeProxy ?? 0) * 0.15 - (b.rmseBps ?? 0) / 10_000;
      return bScore - aScore;
    });

  return {
    symbol: safeSymbol,
    timeframe,
    generatedAt: new Date().toISOString(),
    start: cleanBars[0]?.at ?? null,
    end: cleanBars.at(-1)?.at ?? null,
    observations: cleanBars.length,
    horizonBars: safeHorizon,
    bestModelId: ranked[0]?.modelId ?? null,
    results,
    note: isCrypto
      ? "Compares simple 15-minute crypto predictors using walk-forward next-bar forecasts."
      : "Compares simple daily equity predictors using walk-forward next-bar forecasts.",
  };
}

export async function runModelComparisonBacktest(
  symbol: string,
  horizonBars = 1,
): Promise<ModelComparisonBacktest> {
  const safeSymbol = normalizeCycleSymbol(symbol);
  if (!safeSymbol) throw new Error("A market symbol is required.");

  const isCrypto = safeSymbol.includes("/");
  const timeframe = isCrypto ? "15Min" : "1Day";
  const bars = isCrypto
    ? await fetchAlpacaCryptoBars(safeSymbol, 45, "15Min")
    : await fetchAlpacaDailyBars(safeSymbol, 252);
  return compareModelArchitectures(safeSymbol, timeframe, bars, horizonBars);
}

export async function runBaselineBacktest(symbol: string): Promise<ModelComparisonBacktest> {
  return runModelComparisonBacktest(symbol);
}

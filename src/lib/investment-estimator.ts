import type {
  ChannelEstimate,
  InvestmentChannelCalibration,
  PaperBookSummary,
} from "@/lib/types";

const PRIOR = {
  meanReturn: 0.075,
  sigma: 0.042,
  readiness: 0.74,
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function finite(xs: Array<number | null | undefined>): number[] {
  return xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

function mean(xs: number[]): number {
  return xs.reduce((sum, x) => sum + x, 0) / Math.max(xs.length, 1);
}

function sd(xs: number[]): number {
  if (xs.length < 2) return PRIOR.sigma;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

export function buildInvestmentChannelCalibration(
  paperBook: PaperBookSummary,
): InvestmentChannelCalibration {
  const positions = paperBook.openPositions ?? [];
  const outcomes = paperBook.cycleOutcomes ?? [];
  const returns = finite(positions.map((p) => p.returnPct));
  const alphas = finite(positions.map((p) => p.alphaVsBenchmarkPct));
  const outcomeReturns = finite(outcomes.map((o) => o.returnPct));
  const outcomeAlphas = finite(outcomes.map((o) => o.alphaVsBenchmarkPct));
  const sampleSize = Math.max(positions.length, outcomes.length);
  const evidenceWeight = clamp(sampleSize / 25, 0, 0.85);
  const hitRate =
    returns.length > 0 ? returns.filter((r) => r > 0).length / returns.length : null;
  const avgForecastScore =
    positions.length > 0 ? mean(finite(positions.map((p) => p.forecastScore))) : 0;
  const realizedReturn = paperBook.totals.returnPct;
  const alphaVsBenchmark =
    paperBook.totals.alphaVsBenchmarkPct ??
    (alphas.length ? mean(alphas) : null) ??
    (outcomeAlphas.length ? mean(outcomeAlphas) : null);
  const evidenceMean = clamp(alphaVsBenchmark ?? realizedReturn, -0.2, 0.2);
  const dispersion = Math.max(0.01, sd([...returns, ...outcomeReturns]));
  const drawdownProxy = Math.min(0, ...returns, ...outcomeReturns);
  const blendedMean =
    PRIOR.meanReturn * (1 - evidenceWeight) + evidenceMean * evidenceWeight;
  const blendedSigma = clamp(
    PRIOR.sigma * (1 - evidenceWeight) + dispersion * evidenceWeight,
    0.01,
    0.25,
  );
  const hitRateBonus = hitRate == null ? 0 : (hitRate - 0.5) * 0.18;
  const forecastBonus = clamp(avgForecastScore, -1, 1) * 0.05;
  const drawdownPenalty = Math.min(Math.abs(drawdownProxy), 0.25) * 0.5;
  const readiness = clamp(
    PRIOR.readiness * (1 - evidenceWeight) +
      (0.4 + evidenceWeight * 0.45 + hitRateBonus + forecastBonus - drawdownPenalty) *
        evidenceWeight,
    0.25,
    0.95,
  );

  const channel: ChannelEstimate = {
    id: "I",
    name: "Investments",
    description: "Paper outcome-calibrated rebalance budget using forecast edge minus friction.",
    meanReturn: blendedMean,
    sigma: blendedSigma,
    readiness,
    source:
      sampleSize > 0
        ? `Paper book evidence blend; ${sampleSize} outcome sample${sampleSize === 1 ? "" : "s"}`
        : "Paper book prior; waiting for simulated fills and marks",
  };

  return {
    channel,
    diagnostics: {
      sampleSize,
      evidenceWeight,
      hitRate,
      avgForecastScore,
      realizedReturn,
      alphaVsBenchmark,
      evidenceMean,
      drawdownProxy,
      priorMeanReturn: PRIOR.meanReturn,
      priorSigma: PRIOR.sigma,
      priorReadiness: PRIOR.readiness,
      blendedMeanReturn: blendedMean,
      blendedSigma,
      blendedReadiness: readiness,
    },
  };
}

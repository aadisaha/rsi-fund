import "server-only";

import { alpacaStatus, fetchAlpacaSnapshot } from "@/lib/alpaca";
import { buildOpsCapabilityGroups, buildSecretStatus } from "@/lib/capabilities";
import { readExperimentRegistry } from "@/lib/experiments";
import { kalshiStatus, fetchKalshiSnapshot } from "@/lib/kalshi";
import { buildKalshiTrainingEvidence, readKalshiHistoryManifest } from "@/lib/kalshi-history";
import { readKalshiPretrainedRlSummary } from "@/lib/kalshi-pretrained-rl";
import { readKalshiRlSummary } from "@/lib/kalshi-rl";
import { buildInvestmentChannelCalibration } from "@/lib/investment-estimator";
import { readLedger, seedInitialLedger } from "@/lib/ledger";
import { readMarketCacheEntries, readMarketCacheSummary } from "@/lib/market-cache";
import { buildAllocationProposal } from "@/lib/optimizer";
import { buildOutcomeEvaluationSummary } from "@/lib/outcomes";
import { readMarkedPaperBook } from "@/lib/paper-book";
import { readRecursionState } from "@/lib/recursion";
import { storageStatus } from "@/lib/storage-status";
import { computeTRsi } from "@/lib/trsi";
import type {
  DashboardPayload,
  LedgerRecord,
  MarketCacheEntry,
  MarketLiveSeries,
  MarketCacheSummary,
  PaperCycleForecast,
  PaperCycleRun,
  PaperBookSummary,
  RecursionState,
} from "@/lib/types";

type DashboardPayloadWithRecursion = DashboardPayload & {
  ops: DashboardPayload["ops"] & {
    recursion?: RecursionState;
  };
};

function isPaperCycleRunPayload(payload: unknown): payload is PaperCycleRun {
  return typeof payload === "object" && payload !== null && Array.isArray((payload as PaperCycleRun).forecasts);
}

function latestForecastsBySymbol(cycles: LedgerRecord[]): Map<string, { forecast: PaperCycleForecast; generatedAt: string; modelId: string }> {
  const forecasts = new Map<string, { forecast: PaperCycleForecast; generatedAt: string; modelId: string }>();
  for (const cycle of cycles) {
    if (!isPaperCycleRunPayload(cycle.payload)) continue;
    for (const forecast of cycle.payload.forecasts ?? []) {
      if (!forecasts.has(forecast.symbol)) {
        forecasts.set(forecast.symbol, {
          forecast,
          generatedAt: cycle.payload.generatedAt,
          modelId: cycle.payload.modelId ?? "ewm-v0-paper-cycle",
        });
      }
    }
  }
  return forecasts;
}

function buildMarketLiveSeries(
  entries: MarketCacheEntry[],
  cycles: LedgerRecord[],
): MarketLiveSeries[] {
  const latestForecasts = latestForecastsBySymbol(cycles);
  return entries
    .filter((entry) => entry.bars.length > 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
    .slice(0, 8)
    .map((entry) => {
      const latest = latestForecasts.get(entry.symbol);
      const points = entry.bars.slice(-128).map((bar) => ({
        at: bar.at,
        close: bar.close,
      }));
      const startPrice = points.at(-1)?.close ?? latest?.forecast.lastClose ?? 0;
      const horizonBars = entry.timeframe === "15Min" ? 16 : 5;
      return {
        symbol: entry.symbol,
        timeframe: entry.timeframe,
        source: entry.source,
        fetchedAt: entry.fetchedAt,
        bars: entry.bars.length,
        start: entry.bars[0]?.at ?? null,
        end: entry.bars.at(-1)?.at ?? null,
        points,
        forecast:
          latest && startPrice > 0
            ? {
                modelId: latest.modelId,
                generatedAt: latest.generatedAt,
                expectedReturn: latest.forecast.expectedReturn,
                annualizedVol: latest.forecast.annualizedVol,
                confidence: latest.forecast.confidence,
                score: latest.forecast.score,
                startPrice,
                targetPrice: startPrice * (1 + latest.forecast.expectedReturn),
                horizonBars,
              }
            : null,
      };
    });
}

function emptyPaperBook(): PaperBookSummary {
  return {
    generatedAt: new Date().toISOString(),
    openPositions: [],
    cycleOutcomes: [],
    totals: {
      openCount: 0,
      notionalUsd: 0,
      currentValueUsd: 0,
      unrealizedPnlUsd: 0,
      returnPct: 0,
      benchmarkReturnPct: null,
      alphaVsBenchmarkPct: null,
    },
  };
}

function emptyMarketCache(): MarketCacheSummary {
  return {
    symbols: [],
    entries: [],
  };
}

type DashboardBuildOptions = {
  includeKalshiHistory?: boolean;
};

export async function buildDashboardPayload(options: DashboardBuildOptions = {}): Promise<DashboardPayload> {
  const includeKalshiHistory = options.includeKalshiHistory ?? true;
  await seedInitialLedger();
  const [
    alpaca,
    kalshi,
    ledger,
    cache,
    cacheEntries,
    paperBook,
    experimentRegistry,
    recursion,
    kalshiEvidence,
    kalshiHistory,
    kalshiRl,
    kalshiPretrainedRl,
  ] = await Promise.all([
    fetchAlpacaSnapshot(),
    fetchKalshiSnapshot(),
    readLedger(60),
    readMarketCacheSummary(),
    readMarketCacheEntries(),
    readMarkedPaperBook(),
    readExperimentRegistry(),
    readRecursionState(),
    includeKalshiHistory ? buildKalshiTrainingEvidence() : Promise.resolve(null),
    includeKalshiHistory ? readKalshiHistoryManifest() : Promise.resolve(null),
    readKalshiRlSummary(),
    readKalshiPretrainedRlSummary(),
  ]);

  const alpacaAccount = alpaca.ok
    ? {
        mode: alpaca.mode,
        equityUsd: alpaca.equityUsd,
        cashUsd: alpaca.cashUsd,
        buyingPowerUsd: alpaca.buyingPowerUsd,
        positions: alpaca.positions,
      }
    : {
        mode: alpaca.mode,
        equityUsd: null,
        cashUsd: null,
        buyingPowerUsd: null,
        positions: [],
      };

  const kalshiAccount = kalshi.ok
    ? {
        mode: kalshi.mode,
        balanceUsd: kalshi.balanceUsd,
        portfolioValueUsd: kalshi.portfolioValueUsd,
        positions: kalshi.positions,
      }
    : {
        mode: kalshi.mode,
        balanceUsd: null,
        portfolioValueUsd: null,
        positions: [],
      };

  const investmentCalibration = buildInvestmentChannelCalibration(paperBook);
  const outcomeEvaluation = buildOutcomeEvaluationSummary(paperBook);
  const proposal = buildAllocationProposal({
    equityUsd: alpacaAccount.equityUsd,
    cashUsd: alpacaAccount.cashUsd,
    kalshiPortfolioUsd: kalshiAccount.portfolioValueUsd,
    recentLedgerCount: ledger.length,
    investmentEstimate: investmentCalibration.channel,
  });
  const tRsi = computeTRsi(proposal, kalshiEvidence);

  const runs = ledger.filter((r) => r.type === "forecast");
  const models = ledger.filter((r) => r.type === "model_version");
  const cycles = ledger.filter(
    (r) =>
      r.type === "paper_action" &&
      (r.action === "simulated_fill" || r.action === "rejected") &&
      typeof r.payload?.cycleId === "string",
  );
  const marketSeries = buildMarketLiveSeries(cacheEntries, cycles as LedgerRecord[]);

  const payload: DashboardPayloadWithRecursion = {
    generatedAt: new Date().toISOString(),
    services: [
      {
        ...alpacaStatus(),
        ok: alpaca.ok,
        message: alpaca.ok ? alpacaStatus().message : alpaca.message,
      },
      {
        ...kalshiStatus(),
        ok: kalshi.ok,
        message: kalshi.ok ? kalshiStatus().message : kalshi.message,
      },
      {
        name: "Execution",
        configured: true,
        ok: true,
        mode: "local",
        message: "Paper-only crypto/equity cycle runner. This app has no live order route.",
      },
    ],
    accounts: {
      alpaca: alpacaAccount,
      kalshi: kalshiAccount,
    },
    ledger,
    proposal,
    investmentCalibration,
    outcomeEvaluation,
    experimentRegistry,
    tRsi,
    paperBook,
    ops: {
      capabilities: buildOpsCapabilityGroups(),
      secrets: buildSecretStatus(),
      storage: storageStatus(),
      localCommands: [
        {
          name: "Run app",
          command: "npm run dev",
          purpose: "Starts the local dashboard and API routes.",
        },
        {
          name: "One cycle",
          command: "npm run cycle:once",
          purpose: "Calls the local API once and records a paper cycle.",
        },
        {
          name: "Daemon",
          command: "npm run cycle:daemon",
          purpose: "Runs repeated paper cycles against the local app.",
        },
        {
          name: "Kalshi RL once",
          command: "npm run kalshi:rl-once",
          purpose: "Waits for BTC 15-minute orderbook ingestion, then runs one paper genetic RL update.",
        },
        {
          name: "Kalshi RL daemon",
          command: "npm run kalshi:rl-daemon",
          purpose: "Repeats the paper genetic RL update every 5 minutes by default.",
        },
        {
          name: "Pretrained RL train",
          command: "npm run kalshi:pretrained-rl-train",
          purpose: "Runs one isolated CPU paper-shadow pretrained RL training pass.",
        },
        {
          name: "Pretrained RL signal",
          command: "npm run kalshi:pretrained-rl-once",
          purpose: "Runs one isolated paper-shadow inference pass from the pretrained RL checkpoint.",
        },
        {
          name: "Molly pretrained line",
          command: "npm run kalshi:pretrained-rl-molly",
          purpose: "Evaluates Molly-family agents against recent live orderbook events in paper-shadow mode.",
        },
      ],
    },
    research: {
      runs: runs as LedgerRecord[],
      models: models as LedgerRecord[],
      cycles: cycles as LedgerRecord[],
      cache,
      marketSeries,
      kalshiRl,
      kalshiPretrainedRl,
      notes: [
        "Default cycle universe is BTC/USD, ETH/USD, and SOL/USD on 15-minute Alpaca crypto bars.",
        kalshiHistory
          ? `Kalshi history cache contains ${Object.keys(kalshiHistory.markets).length} market${Object.keys(kalshiHistory.markets).length === 1 ? "" : "s"}; empirical t-RSI activates after the configured sample floor is met.`
          : "Kalshi history/t-RSI scan skipped for this fast RL view.",
        "Crypto cycles are designed for 24/7 data collection and quick paper feedback.",
        "t-RSI is experimental and not audit-ready.",
        "Durable production jobs and hosted persistence are still needed for unattended collection.",
        kalshiRl.recentEvents
          ? `Kalshi RL has ${kalshiRl.recentEvents} recent orderbook event${kalshiRl.recentEvents === 1 ? "" : "s"} for ${kalshiRl.seriesTicker}.`
          : "Kalshi RL is waiting for orderbook ingestion under .data/kalshi-orderbook.",
        kalshiPretrainedRl.lastRun
          ? `Pretrained RL latest CPU shadow run ${kalshiPretrainedRl.lastRun.runId} scored ${kalshiPretrainedRl.lastRun.samples.validation} validation samples.`
          : "Pretrained RL has no CPU shadow run yet.",
      ],
    },
  };

  payload.ops.recursion = recursion;

  return payload;
}

export async function buildRlDashboardPayload(): Promise<DashboardPayload> {
  const [ledger, experimentRegistry, recursion, kalshiRl] = await Promise.all([
    readLedger(20),
    readExperimentRegistry(),
    readRecursionState(),
    readKalshiRlSummary(),
  ]);
  const paperBook = emptyPaperBook();
  const investmentCalibration = buildInvestmentChannelCalibration(paperBook);
  const proposal = buildAllocationProposal({
    equityUsd: null,
    cashUsd: null,
    kalshiPortfolioUsd: null,
    recentLedgerCount: ledger.length,
    investmentEstimate: investmentCalibration.channel,
  });
  const tRsi = computeTRsi(proposal, null);
  const models = ledger.filter((r) => r.type === "model_version");

  const payload: DashboardPayloadWithRecursion = {
    generatedAt: new Date().toISOString(),
    services: [
      {
        ...alpacaStatus(),
        ok: false,
        message: "Skipped live Alpaca read for fast RL page load.",
      },
      {
        ...kalshiStatus(),
        ok: false,
        message: "Skipped live Kalshi portfolio read for fast RL page load.",
      },
      {
        name: "Execution",
        configured: true,
        ok: true,
        mode: "local",
        message: "Paper-only RL monitor. This app has no live order route.",
      },
    ],
    accounts: {
      alpaca: {
        mode: "unconfigured",
        equityUsd: null,
        cashUsd: null,
        buyingPowerUsd: null,
        positions: [],
      },
      kalshi: {
        mode: "unconfigured",
        balanceUsd: null,
        portfolioValueUsd: null,
        positions: [],
      },
    },
    ledger,
    proposal,
    investmentCalibration,
    outcomeEvaluation: buildOutcomeEvaluationSummary(paperBook),
    experimentRegistry,
    tRsi,
    paperBook,
    ops: {
      capabilities: buildOpsCapabilityGroups(),
      secrets: buildSecretStatus(),
      storage: storageStatus(),
      localCommands: [
        {
          name: "Kalshi RL once",
          command: "npm run kalshi:rl-once",
          purpose: "Runs one paper genetic RL update.",
        },
        {
          name: "Kalshi RL daemon",
          command: "npm run kalshi:rl-daemon",
          purpose: "Repeats paper genetic RL updates every 5 minutes by default.",
        },
      ],
    },
    research: {
      runs: [],
      models: models as LedgerRecord[],
      cycles: [],
      cache: emptyMarketCache(),
      marketSeries: [],
      kalshiRl,
      notes: [
        "Fast RL page: external broker reads, market cache refreshes, and Kalshi history scans are skipped.",
        kalshiRl.recentEvents
          ? `Kalshi RL has ${kalshiRl.recentEvents} recent orderbook event${kalshiRl.recentEvents === 1 ? "" : "s"} for ${kalshiRl.seriesTicker}.`
          : "Kalshi RL is waiting for orderbook ingestion under .data/kalshi-orderbook.",
      ],
    },
  };
  payload.ops.recursion = recursion;
  return payload;
}

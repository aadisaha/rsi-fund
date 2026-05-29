import "server-only";

import { alpacaStatus, fetchAlpacaSnapshot } from "@/lib/alpaca";
import { buildOpsCapabilityGroups, buildSecretStatus } from "@/lib/capabilities";
import { readExperimentRegistry } from "@/lib/experiments";
import { kalshiStatus, fetchKalshiSnapshot } from "@/lib/kalshi";
import { buildKalshiTrainingEvidence, readKalshiHistoryManifest } from "@/lib/kalshi-history";
import { buildInvestmentChannelCalibration } from "@/lib/investment-estimator";
import { readLedger, seedInitialLedger } from "@/lib/ledger";
import { readMarketCacheSummary } from "@/lib/market-cache";
import { buildAllocationProposal } from "@/lib/optimizer";
import { buildOutcomeEvaluationSummary } from "@/lib/outcomes";
import { readMarkedPaperBook } from "@/lib/paper-book";
import { readRecursionState } from "@/lib/recursion";
import { storageStatus } from "@/lib/storage-status";
import { computeTRsi } from "@/lib/trsi";
import type { DashboardPayload, LedgerRecord, RecursionState } from "@/lib/types";

type DashboardPayloadWithRecursion = DashboardPayload & {
  ops: DashboardPayload["ops"] & {
    recursion?: RecursionState;
  };
};

export async function buildDashboardPayload(): Promise<DashboardPayload> {
  await seedInitialLedger();
  const [
    alpaca,
    kalshi,
    ledger,
    cache,
    paperBook,
    experimentRegistry,
    recursion,
    kalshiEvidence,
    kalshiHistory,
  ] = await Promise.all([
    fetchAlpacaSnapshot(),
    fetchKalshiSnapshot(),
    readLedger(60),
    readMarketCacheSummary(),
    readMarkedPaperBook(),
    readExperimentRegistry(),
    readRecursionState(),
    buildKalshiTrainingEvidence(),
    readKalshiHistoryManifest(),
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
      ],
    },
    research: {
      runs: runs as LedgerRecord[],
      models: models as LedgerRecord[],
      cycles: cycles as LedgerRecord[],
      cache,
      notes: [
        "Default cycle universe is BTC/USD, ETH/USD, and SOL/USD on 15-minute Alpaca crypto bars.",
        `Kalshi history cache contains ${Object.keys(kalshiHistory.markets).length} market${Object.keys(kalshiHistory.markets).length === 1 ? "" : "s"}; empirical t-RSI activates after the configured sample floor is met.`,
        "Crypto cycles are designed for 24/7 data collection and quick paper feedback.",
        "t-RSI is experimental and not audit-ready.",
        "Durable production jobs and hosted persistence are still needed for unattended collection.",
      ],
    },
  };

  payload.ops.recursion = recursion;

  return payload;
}

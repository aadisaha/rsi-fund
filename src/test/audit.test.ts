import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaperCycleForecast, PaperCycleRun, TRsiResult } from "@/lib/types";

vi.mock("server-only", () => ({}));

let tmp: string;
let originalDataDir: string | undefined;
let originalStorageDriver: string | undefined;
let originalDatabaseUrl: string | undefined;

const cycleId = "cycle-audit-fixture";
const generatedAt = "2026-01-01T10:03:00.000Z";

const forecast: PaperCycleForecast = {
  symbol: "BTC/USD",
  assetClass: "crypto",
  timeframe: "15Min",
  lastClose: 100_000,
  shortMomentum: 0.01,
  longMomentum: 0.04,
  shortLookbackLabel: "1d",
  longLookbackLabel: "7d",
  annualizedVol: 0.5,
  expectedReturn: 0.02,
  confidence: 0.7,
  score: 0.028,
};

const tRsi: TRsiResult = {
  generatedAt,
  status: "experimental_not_audit_ready",
  horizonDays: 7,
  tRsi: 1.2,
  alphaCreateMean: 0.03,
  alphaDecayMean: 0.01,
  standardError: 0.02,
  threshold: 1,
  approved: true,
  reason: "Fixture certificate.",
  samples: [{ bucket: "fixture", create: 0.03, decay: 0.01 }],
};

function makeRun(overrides: Partial<PaperCycleRun> = {}): PaperCycleRun {
  return {
    cycleId,
    generatedAt,
    mode: "paper",
    symbols: ["BTC/USD"],
    timeframe: "15Min",
    cadence: "24/7",
    market: "crypto",
    cache: {
      symbols: ["BTC/USD"],
      entries: [
        {
          symbol: "BTC/USD",
          assetClass: "crypto",
          timeframe: "15Min",
          bars: 200,
          fetchedAt: "2026-01-01T10:02:00.000Z",
          source: "alpaca_crypto_us",
          start: "2026-01-01T09:00:00.000Z",
          end: "2026-01-01T10:00:00.000Z",
        },
      ],
    },
    proposal: {
      generatedAt,
      mode: "paper",
      deployableCapitalUsd: 10_000,
      shadowPrice: 1,
      riskAversion: 0.5,
      killSwitch: false,
      channels: [
        {
          id: "I",
          name: "Investment",
          description: "Fixture allocation channel.",
          meanReturn: 0.02,
          sigma: 0.1,
          readiness: 0.8,
          source: "fixture",
          riskAdjustedScore: 0.16,
          proposedUsd: 1_000,
        },
      ],
      constraints: [{ name: "paper", ok: true, message: "Paper fixture." }],
      summary: "Fixture proposal.",
    },
    tRsi,
    risk: {
      generatedAt,
      ok: true,
      limits: [{ name: "kill-switch", ok: true, actual: false, limit: false, message: "Off." }],
      summary: "Fixture risk accepted.",
    },
    forecasts: [forecast],
    simulatedFills: [
      {
        symbol: "BTC/USD",
        notionalUsd: 1_000,
        referencePrice: 100_000,
        quantity: 0.01,
        reason: "Paper fixture fill; no live order sent.",
      },
    ],
    rejected: false,
    reason: "Fixture cycle accepted in paper mode.",
    experimentId: "exp-fixture",
    modelId: "model-fixture",
    researchDecisionId: null,
    ...overrides,
  };
}

async function appendAt(at: string, event: Parameters<typeof import("@/lib/ledger").appendLedger>[0]) {
  const { appendLedger } = await import("@/lib/ledger");
  vi.setSystemTime(new Date(at));
  return appendLedger(event);
}

async function seedReplayLedger(run = makeRun()) {
  await appendAt("2026-01-01T10:00:00.000Z", {
    type: "observation",
    source: "system",
    payload: { cycleId, cache: run.cache },
  });
  await appendAt("2026-01-01T10:01:00.000Z", {
    type: "forecast",
    modelId: "model-fixture",
    target: forecast.symbol,
    mean: forecast.expectedReturn,
    sigma: forecast.annualizedVol,
    payload: { cycleId, experimentId: run.experimentId, forecast },
  });
  await appendAt("2026-01-01T10:04:00.000Z", {
    type: "paper_action",
    action: "simulated_fill",
    channel: "portfolio",
    notionalUsd: 1_000,
    reason: run.reason,
    payload: run,
  });
  await appendAt("2026-01-01T10:05:00.000Z", {
    type: "certificate",
    approved: run.tRsi.approved,
    tRsi: run.tRsi.tRsi,
    threshold: run.tRsi.threshold,
    reason: run.tRsi.reason,
    payload: { cycleId, tRsi: run.tRsi, risk: run.risk },
  });
}

beforeEach(async () => {
  originalDataDir = process.env.QUANT_DATA_DIR;
  originalStorageDriver = process.env.QUANT_STORAGE_DRIVER;
  originalDatabaseUrl = process.env.DATABASE_URL;
  tmp = await mkdtemp(path.join(tmpdir(), "quant-audit-"));
  process.env.QUANT_DATA_DIR = path.join(tmp, ".data");
  process.env.QUANT_STORAGE_DRIVER = "local";
  delete process.env.DATABASE_URL;
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(async () => {
  vi.useRealTimers();
  if (originalDataDir == null) {
    delete process.env.QUANT_DATA_DIR;
  } else {
    process.env.QUANT_DATA_DIR = originalDataDir;
  }
  if (originalStorageDriver == null) {
    delete process.env.QUANT_STORAGE_DRIVER;
  } else {
    process.env.QUANT_STORAGE_DRIVER = originalStorageDriver;
  }
  if (originalDatabaseUrl == null) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  await rm(tmp, { recursive: true, force: true });
});

describe("historical replay audit bundles", () => {
  it("reconstructs cycle evidence and proves paper-only cutoff-safe replay", async () => {
    await seedReplayLedger();
    const { buildHistoricalReplayBundle } = await import("@/lib/audit");

    const bundle = await buildHistoricalReplayBundle(cycleId);

    expect(bundle.found).toBe(true);
    expect(bundle.cycle?.cycleId).toBe(cycleId);
    expect(bundle.evidence.action?.type).toBe("paper_action");
    expect(bundle.evidence.forecasts).toHaveLength(1);
    expect(bundle.evidence.forecasts[0].forecast?.symbol).toBe("BTC/USD");
    expect(bundle.evidence.certificate?.approved).toBe(true);
    expect(bundle.evidence.marketDataCutoff.ok).toBe(true);
    expect(bundle.evidence.paperOnlyProof.ok).toBe(true);
    expect(bundle.filtration.chronological).toBe(true);
    expect(bundle.filtration.leakedRecords).toEqual([]);
    expect(bundle.checks.every((check) => check.ok)).toBe(true);
  });

  it("flags post-action decision inputs as filtration leaks", async () => {
    await seedReplayLedger();
    const leaked = await appendAt("2026-01-01T10:06:00.000Z", {
      type: "forecast",
      modelId: "model-fixture",
      target: "ETH/USD",
      mean: 0.1,
      sigma: 0.3,
      payload: { cycleId, forecast: { ...forecast, symbol: "ETH/USD" } },
    });
    const { buildHistoricalReplayBundle } = await import("@/lib/audit");

    const bundle = await buildHistoricalReplayBundle(cycleId);

    expect(bundle.filtration.leakedRecords).toEqual([leaked.id]);
    expect(bundle.checks.find((check) => check.name === "filtration-order")?.ok).toBe(false);
  });

  it("serves replay bundles from the audit API route", async () => {
    await seedReplayLedger();
    const { GET } = await import("@/app/api/audit/replay/route");

    const response = await GET(
      new Request(`http://localhost/api/audit/replay?cycleId=${cycleId}`, {
        headers: { host: "localhost" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.bundle.cycleId).toBe(cycleId);
    expect(body.bundle.evidence.paperOnlyProof.ok).toBe(true);
  });

  it("rejects route requests without a cycle id", async () => {
    const { GET } = await import("@/app/api/audit/replay/route");

    const response = await GET(
      new Request("http://localhost/api/audit/replay", {
        headers: { host: "localhost" },
      }),
    );

    expect(response.status).toBe(400);
  });
});

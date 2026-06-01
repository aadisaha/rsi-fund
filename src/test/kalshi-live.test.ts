import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneticPolicyGenome, KalshiPaperRlOpenPosition } from "@/lib/types";

vi.mock("server-only", () => ({}));

const kalshiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@/lib/kalshi", () => ({
  kalshiApiGet: kalshiMocks.get,
  kalshiApiPost: kalshiMocks.post,
  kalshiApiDelete: kalshiMocks.del,
}));

const rlMocks = vi.hoisted(() => ({
  summary: vi.fn(),
}));

vi.mock("@/lib/kalshi-rl", () => ({
  readKalshiRlSummary: rlMocks.summary,
}));

let tmp: string;
let originalEnv: NodeJS.ProcessEnv;

const genome: GeneticPolicyGenome = {
  genomeId: "validated-genome",
  parentGenomeIds: [],
  generation: 1,
  entryThreshold: 0.02,
  exitThreshold: 0.01,
  maxHoldSeconds: 120,
  momentumWindow: 5,
  spreadCap: 0.04,
  depthFloor: 0,
  minSecondsToClose: 30,
  maxSecondsToClose: 900,
  stopLoss: 0.2,
  takeProfit: 0.2,
  positionSizeFraction: 0.025,
};

function openPosition(overrides: Partial<KalshiPaperRlOpenPosition> = {}): KalshiPaperRlOpenPosition {
  return {
    marketTicker: "KXBTC15M-TEST",
    side: "yes",
    yesContracts: 50,
    noContracts: 0,
    netContracts: 50,
    costBasisUsd: 25,
    markValueUsd: 26,
    unrealizedPnlUsd: 1,
    averageEntryPrice: 0.5,
    markPrice: 0.52,
    openedAt: "2026-06-01T00:01:00.000Z",
    markedAt: "2026-06-01T00:01:10.000Z",
    secondsToClose: 600,
    ...overrides,
  };
}

function liveSummary(positions: KalshiPaperRlOpenPosition[] = [openPosition()]) {
  return {
    enabled: false,
    seriesTicker: "KXBTC15M",
    bankrollUsd: 1000,
    maxMarketUsd: 25,
    maxOpenUsd: 100,
    recentEvents: 1,
    latestEventAt: "2026-06-01T00:01:10.000Z",
    latestEvent: null,
    recentQuoteEvents: [],
    latestMarketUrl: null,
    champion: null,
    lastRun: {
      runId: "kalshi-rl-test",
      generatedAt: "2026-06-01T00:01:00.000Z",
      seriesTicker: "KXBTC15M",
      populationSize: 1,
      evaluatedMarkets: ["KXBTC15M-TEST"],
      eventCount: 1,
      best: null,
      previousChampion: null,
      champion: null,
      promoted: false,
      baselineReward: 0,
      leaderboard: [],
      paper: { bankrollUsd: 1000, maxMarketUsd: 25, maxOpenUsd: 100 },
      notes: [],
    },
    liveLeaderboard: [
      {
        genome,
        status: "candidate",
        parentGenomeIds: [],
        contributesToPerformance: true,
        reward: 10,
        pnlUsd: 10,
        trades: 1,
        drawdownUsd: 0,
        openPositions: positions,
      },
    ],
    runHistory: [],
  };
}

function mockMarketFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        markets: [
          {
            ticker: "KXBTC15M-TEST",
            open_time: "2026-06-01T00:00:00.000Z",
            close_time: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
            floor_strike: "73500",
            yes_ask_dollars: "0.50",
            no_ask_dollars: "0.51",
            last_price_dollars: "0.50",
          },
        ],
      }),
    })),
  );
}

beforeEach(async () => {
  vi.resetModules();
  vi.useRealTimers();
  originalEnv = { ...process.env };
  tmp = await mkdtemp(path.join(tmpdir(), "kalshi-live-"));
  process.env.QUANT_DATA_DIR = path.join(tmp, ".data");
  process.env.QUANT_STORAGE_DRIVER = "local";
  process.env.KALSHI_LIVE_TRADING_ENABLED = "true";
  process.env.KALSHI_LIVE_KILL_SWITCH = "false";
  process.env.KALSHI_LIVE_MAX_OPEN_USD = "500";
  process.env.KALSHI_LIVE_MAX_ORDER_USD = "25";
  process.env.KALSHI_LIVE_MAX_FEED_AGE_MS = "45000";
  process.env.KALSHI_LIVE_MAX_RECONCILIATION_AGE_MS = "60000";
  kalshiMocks.get.mockReset();
  kalshiMocks.post.mockReset();
  kalshiMocks.del.mockReset();
  rlMocks.summary.mockReset();
  mockMarketFetch();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  process.env = originalEnv;
  await rm(tmp, { recursive: true, force: true });
});

describe("kalshi live safety", () => {
  it("keeps live trading blocked when the env kill switch is active", async () => {
    process.env.KALSHI_LIVE_KILL_SWITCH = "true";
    kalshiMocks.get.mockResolvedValue({});
    rlMocks.summary.mockResolvedValue(liveSummary());

    const { runKalshiLiveTick } = await import("@/lib/kalshi-live");
    const result = await runKalshiLiveTick();

    expect(result.status.blockers).toContain("kill-switch");
    expect(kalshiMocks.post).not.toHaveBeenCalled();
  });

  it("uses deterministic client_order_id values so duplicate ticks do not double-submit", async () => {
    let remoteClientOrderId: string | null = null;
    kalshiMocks.get.mockImplementation(async (pathArg: string) => {
      if (pathArg.includes("/orders")) {
        return remoteClientOrderId
          ? { orders: [{ client_order_id: remoteClientOrderId, order_id: "remote-1", status: "resting" }] }
          : { orders: [] };
      }
      if (pathArg.includes("/positions")) return { market_positions: [] };
      if (pathArg.includes("/balance")) return { balance: 50_000, portfolio_value: 50_000 };
      return {};
    });
    kalshiMocks.post.mockImplementation(async (_pathArg: string, body: Record<string, unknown>) => {
      remoteClientOrderId = String(body.client_order_id);
      return { order: { client_order_id: remoteClientOrderId, order_id: "remote-1", status: "resting" } };
    });
    rlMocks.summary.mockResolvedValue(liveSummary());

    const { runKalshiLiveTick } = await import("@/lib/kalshi-live");
    const first = await runKalshiLiveTick();
    const second = await runKalshiLiveTick();

    expect(first.submitted).toHaveLength(1);
    expect(second.submitted).toHaveLength(0);
    expect(kalshiMocks.post).toHaveBeenCalledTimes(1);
    expect(first.submitted[0].clientOrderId).toBe(remoteClientOrderId);
  });

  it("reconciles a Kalshi duplicate-order conflict instead of creating a second order", async () => {
    let remoteClientOrderId = "";
    kalshiMocks.get.mockImplementation(async (pathArg: string) => {
      if (pathArg.includes("/orders")) {
        return remoteClientOrderId
          ? { orders: [{ client_order_id: remoteClientOrderId, order_id: "remote-conflict", status: "resting" }] }
          : { orders: [] };
      }
      if (pathArg.includes("/positions")) return { market_positions: [] };
      if (pathArg.includes("/balance")) return { balance: 50_000, portfolio_value: 50_000 };
      return {};
    });
    kalshiMocks.post.mockImplementation(async (_pathArg: string, body: Record<string, unknown>) => {
      remoteClientOrderId = String(body.client_order_id);
      const error = new Error("duplicate client_order_id");
      Object.assign(error, { status: 409 });
      throw error;
    });
    rlMocks.summary.mockResolvedValue(liveSummary());

    const { runKalshiLiveTick } = await import("@/lib/kalshi-live");
    const result = await runKalshiLiveTick();

    expect(kalshiMocks.post).toHaveBeenCalledTimes(1);
    expect(result.submitted[0].status).toBe("resting");
    expect(result.submitted[0].remoteOrderId).toBe("remote-conflict");
  });

  it("ignores remote Kalshi orders that were not created by the live swarm", async () => {
    process.env.KALSHI_LIVE_TRADING_ENABLED = "false";
    kalshiMocks.get.mockImplementation(async (pathArg: string) => {
      if (pathArg.includes("/orders")) {
        return {
          orders: [
            {
              client_order_id: "legacy-manual-order",
              order_id: "manual-1",
              status: "executed",
              ticker: "KXLEGACY-TEST",
            },
          ],
        };
      }
      if (pathArg.includes("/positions")) return { market_positions: [] };
      if (pathArg.includes("/balance")) return { balance: 50_000, portfolio_value: 50_000 };
      return {};
    });

    const { runKalshiLiveTick } = await import("@/lib/kalshi-live");
    const result = await runKalshiLiveTick();

    expect(result.reconciliation?.ok).toBe(true);
    expect(result.reconciliation?.mismatchCount).toBe(0);
    expect(result.reconciliation?.remoteOrderCount).toBe(0);
    expect(result.status.safetyHalt).toBeNull();
    expect(result.status.recentIntents).toHaveLength(0);
  });

  it("honors the global exposure cap without resizing order notional", async () => {
    kalshiMocks.get.mockImplementation(async (pathArg: string) => {
      if (pathArg.includes("/orders")) return { orders: [] };
      if (pathArg.includes("/positions")) return { market_positions: [] };
      if (pathArg.includes("/balance")) return { balance: 50_000, portfolio_value: 50_000 };
      return {};
    });
    kalshiMocks.post.mockResolvedValue({ order: { order_id: "remote-1", status: "resting" } });
    process.env.KALSHI_LIVE_MAX_OPEN_USD = "25";
    rlMocks.summary.mockResolvedValue(
      liveSummary([
        openPosition({ openedAt: "2026-06-01T00:01:00.000Z" }),
        openPosition({ openedAt: "2026-06-01T00:01:01.000Z" }),
      ]),
    );

    const { runKalshiLiveTick } = await import("@/lib/kalshi-live");
    const result = await runKalshiLiveTick();

    expect(result.submitted).toHaveLength(1);
    expect(result.submitted[0].notionalUsd).toBe(25);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].notionalUsd).toBe(25);
  });

  it("turning on the operator kill switch cancels resting live orders", async () => {
    let remoteClientOrderId: string | null = null;
    kalshiMocks.get.mockImplementation(async (pathArg: string) => {
      if (pathArg.includes("/orders")) {
        return remoteClientOrderId
          ? { orders: [{ client_order_id: remoteClientOrderId, order_id: "remote-1", status: "resting" }] }
          : { orders: [] };
      }
      if (pathArg.includes("/positions")) return { market_positions: [] };
      if (pathArg.includes("/balance")) return { balance: 50_000, portfolio_value: 50_000 };
      return {};
    });
    kalshiMocks.post.mockImplementation(async (_pathArg: string, body: Record<string, unknown>) => {
      remoteClientOrderId = String(body.client_order_id);
      return { order: { client_order_id: remoteClientOrderId, order_id: "remote-1", status: "resting" } };
    });
    kalshiMocks.del.mockResolvedValue({ ok: true });
    rlMocks.summary.mockResolvedValue(liveSummary());

    const { runKalshiLiveTick, setKalshiLiveKillSwitch, readKalshiLiveStatus } = await import("@/lib/kalshi-live");
    await runKalshiLiveTick();
    await setKalshiLiveKillSwitch({ active: true, reason: "operator stop" });
    const status = await readKalshiLiveStatus();

    expect(kalshiMocks.del).toHaveBeenCalledWith("/trade-api/v2/portfolio/orders/remote-1");
    expect(status.recentIntents[0].status).toBe("canceled");
  });

  it("rejects cron reconciliation without CRON_SECRET authorization", async () => {
    process.env.CRON_SECRET = "secret";
    const { GET } = await import("@/app/api/cron/kalshi-reconcile/route");

    const res = await GET(new Request("https://example.com/api/cron/kalshi-reconcile"));
    expect(res.status).toBe(401);
  });
});

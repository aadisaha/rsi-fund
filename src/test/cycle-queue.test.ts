import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let originalDataDir: string | undefined;
let originalStorageDriver: string | undefined;
let tmp: string;

const fakeCycle = {
  cycleId: "cycle-test",
  generatedAt: "2026-05-29T12:00:00.000Z",
  mode: "paper",
  symbols: ["BTC/USD"],
  timeframe: "15Min",
  cadence: "24/7",
  market: "crypto",
  cache: { symbols: ["BTC/USD"] },
  proposal: {},
  tRsi: {},
  risk: { ok: true },
  recursion: {},
  forecasts: [],
  simulatedFills: [{ symbol: "BTC/USD" }],
  rejected: false,
  reason: "Cycle accepted in paper mode and simulated fills were recorded.",
  experimentId: "experiment-test",
  modelId: "model-test",
};

async function importQueue() {
  vi.resetModules();
  vi.doMock("@/lib/paper-cycle", () => ({
    runPaperCycleLocked: vi.fn(async () => fakeCycle),
  }));
  return import("../lib/cycle-queue");
}

beforeEach(async () => {
  originalDataDir = process.env.QUANT_DATA_DIR;
  originalStorageDriver = process.env.QUANT_STORAGE_DRIVER;
  tmp = await mkdtemp(path.join(tmpdir(), "quant-cycle-queue-"));
  process.env.QUANT_DATA_DIR = path.join(tmp, ".data");
  process.env.QUANT_STORAGE_DRIVER = "local";
});

afterEach(async () => {
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
  vi.doUnmock("@/lib/paper-cycle");
  await rm(tmp, { recursive: true, force: true });
});

describe("cycle queue", () => {
  it("enqueues paper cycle jobs idempotently", async () => {
    const { enqueuePaperCycleJob } = await importQueue();

    const first = await enqueuePaperCycleJob({
      symbols: "btc/usd, eth/usd",
      idempotencyKey: "same-window",
    });
    const second = await enqueuePaperCycleJob({
      symbols: "sol/usd",
      idempotencyKey: "same-window",
    });

    expect(first.status).toBe("queued");
    expect(second).toEqual(first);
    expect(first.input?.symbols).toEqual(["BTC/USD", "ETH/USD"]);
  });

  it("claims queued paper cycles in FIFO order", async () => {
    const { claimNextQueuedPaperCycleJob, enqueuePaperCycleJob } = await importQueue();

    const first = await enqueuePaperCycleJob({ idempotencyKey: "first" });
    const second = await enqueuePaperCycleJob({ idempotencyKey: "second" });

    await expect(claimNextQueuedPaperCycleJob()).resolves.toMatchObject({
      runId: first.runId,
      status: "running",
    });
    await expect(claimNextQueuedPaperCycleJob()).resolves.toMatchObject({
      runId: second.runId,
      status: "running",
    });
    await expect(claimNextQueuedPaperCycleJob()).resolves.toBeNull();
  });

  it("runs one claimed queued cycle and records a terminal job", async () => {
    const { enqueuePaperCycleJob, runNextQueuedPaperCycleJob } = await importQueue();
    const { readRecentJobs } = await import("../lib/jobs");

    const queued = await enqueuePaperCycleJob({
      symbols: ["BTC/USD"],
      idempotencyKey: "run-window",
    });
    const result = await runNextQueuedPaperCycleJob();

    expect(result).toMatchObject({
      claimed: true,
      job: {
        runId: queued.runId,
        status: "succeeded",
        output: {
          cycle: {
            cycleId: "cycle-test",
            rejected: false,
            simulatedFills: 1,
          },
        },
      },
    });
    await expect(readRecentJobs()).resolves.toMatchObject([
      {
        runId: queued.runId,
        status: "succeeded",
      },
    ]);
  });
});

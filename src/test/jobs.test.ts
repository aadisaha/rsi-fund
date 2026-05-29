import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let originalDataDir: string | undefined;
let tmp: string;

async function importJobs() {
  vi.resetModules();
  return import("../lib/jobs");
}

beforeEach(async () => {
  originalDataDir = process.env.QUANT_DATA_DIR;
  tmp = await mkdtemp(path.join(tmpdir(), "quant-jobs-"));
  process.env.QUANT_DATA_DIR = path.join(tmp, ".data");
});

afterEach(async () => {
  if (originalDataDir == null) {
    delete process.env.QUANT_DATA_DIR;
  } else {
    process.env.QUANT_DATA_DIR = originalDataDir;
  }
  await rm(tmp, { recursive: true, force: true });
});

describe("jobs", () => {
  it("creates deterministic run IDs for the same idempotency key", async () => {
    const { createRunId } = await importJobs();

    expect(createRunId("paper cycle", { symbols: ["BTC/USD", "ETH/USD"], bucket: "m15" })).toBe(
      createRunId("paper cycle", { bucket: "m15", symbols: ["BTC/USD", "ETH/USD"] }),
    );
    expect(createRunId("paper cycle", "bucket-a")).not.toBe(createRunId("paper cycle", "bucket-b"));
    expect(createRunId("paper cycle", "bucket-a")).toMatch(/^paper-cycle-[A-Za-z0-9_-]{16}$/);
  });

  it("begins and finishes a job in local data storage", async () => {
    const { beginJob, createRunId, finishJob, readRecentJobs } = await importJobs();
    const runId = createRunId("paper-cycle", "2026-05-28T10:00Z:BTC,ETH");

    const started = await beginJob({
      runId,
      jobName: "paper-cycle",
      idempotencyKey: "2026-05-28T10:00Z:BTC,ETH",
      input: { symbols: ["BTC/USD", "ETH/USD"] },
    });
    expect(started.status).toBe("running");

    const finished = await finishJob(runId, { cycleId: "cycle-1", rejected: false });
    expect(finished.status).toBe("succeeded");
    expect(finished.output).toEqual({ cycleId: "cycle-1", rejected: false });
    expect(Date.parse(finished.finishedAt ?? "")).toBeGreaterThan(0);

    const raw = await readFile(path.join(tmp, ".data", "jobs.json"), "utf8");
    expect(JSON.parse(raw).jobs[runId].status).toBe("succeeded");

    const recent = await readRecentJobs();
    expect(recent).toHaveLength(1);
    expect(recent[0].runId).toBe(runId);
  });

  it("treats duplicate begin calls as idempotent", async () => {
    const { beginJob, createRunId, readRecentJobs } = await importJobs();
    const runId = createRunId("paper-cycle", "same-cycle-window");

    const first = await beginJob(runId, "paper-cycle", { attempt: 1 });
    const second = await beginJob(runId, "paper-cycle", { attempt: 2 });

    expect(second).toEqual(first);
    expect((await readRecentJobs()).map((job) => job.runId)).toEqual([runId]);
  });

  it("records failed jobs without allowing a later terminal overwrite", async () => {
    const { beginJob, failJob, finishJob } = await importJobs();
    const runId = "paper-cycle-fail";

    await beginJob(runId);
    const failed = await failJob(runId, new Error("market data unavailable"));
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("market data unavailable");

    await expect(finishJob(runId, { cycleId: "too-late" })).resolves.toEqual(failed);
  });

  it("serializes concurrent local writes", async () => {
    const { beginJob, finishJob, readRecentJobs } = await importJobs();

    await Promise.all(
      Array.from({ length: 20 }, async (_, n) => {
        const runId = `paper-cycle-${n}`;
        await beginJob(runId, "paper-cycle", { n });
        return finishJob(runId, { n });
      }),
    );

    const recent = await readRecentJobs(25);
    expect(recent).toHaveLength(20);
    expect(recent.every((job) => job.status === "succeeded")).toBe(true);
  });
});

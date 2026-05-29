import "server-only";

import { readFile } from "node:fs/promises";

import { createRunId, failJob, finishJob, type JobRun } from "@/lib/jobs";
import { runPaperCycleLocked } from "@/lib/paper-cycle";
import { dataPath, pgQuery, storageMode, writeJsonFile } from "@/lib/storage";

export type CycleQueueJobStatus = JobRun["status"];

export type CycleQueueJob = Omit<JobRun, "status"> & {
  status: CycleQueueJobStatus;
};

export type EnqueuePaperCycleInput = {
  symbols?: unknown;
  runId?: unknown;
  idempotencyKey?: unknown;
};

export type RunNextCycleQueueResult =
  | {
      claimed: false;
    }
  | {
      claimed: true;
      job: CycleQueueJob | JobRun;
      cycle?: Awaited<ReturnType<typeof runPaperCycleLocked>>;
      error?: string;
    };

type JobsFile = {
  version: 1;
  jobs: Record<string, CycleQueueJob>;
};

type JobRow = {
  run_id: string;
  job_name: string;
  status: CycleQueueJobStatus;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string;
  finished_at: Date | string | null;
  idempotency_key: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
};

let localQueue = Promise.resolve();

function enqueueLocal<T>(work: () => Promise<T>): Promise<T> {
  const next = localQueue.then(work, work);
  localQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function nowIso(): string {
  return new Date().toISOString();
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function rowToJob(row: JobRow): CycleQueueJob {
  return {
    runId: row.run_id,
    jobName: row.job_name,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    startedAt: iso(row.started_at),
    finishedAt: row.finished_at ? iso(row.finished_at) : undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    input: row.input ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
  };
}

function jobsPath(): string {
  return dataPath("jobs.json");
}

async function readJobsFile(): Promise<JobsFile> {
  const raw = await readFile(jobsPath(), "utf8").catch(() => "");
  if (!raw.trim()) return { version: 1, jobs: {} };

  try {
    const parsed = JSON.parse(raw) as Partial<JobsFile>;
    return {
      version: 1,
      jobs: Object.fromEntries(
        Object.values(parsed.jobs ?? {})
          .filter((job): job is CycleQueueJob => Boolean(job?.runId))
          .map((job) => [job.runId, job]),
      ),
    };
  } catch {
    return { version: 1, jobs: {} };
  }
}

async function writeJobsFile(file: JobsFile): Promise<void> {
  await writeJsonFile("jobs.json", file);
}

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeCycleSymbols(raw: unknown): string[] | undefined {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  const symbols = values
    .map((value) => cleanString(value).toUpperCase())
    .filter(Boolean)
    .slice(0, 12);
  return symbols.length ? symbols : undefined;
}

function jobSymbols(job: CycleQueueJob): string[] | undefined {
  const raw = job.input?.symbols;
  return Array.isArray(raw)
    ? normalizeCycleSymbols(raw)
    : typeof raw === "string" && raw !== "active-experiment"
      ? normalizeCycleSymbols(raw)
      : undefined;
}

function cycleJobOutput(cycle: Awaited<ReturnType<typeof runPaperCycleLocked>>) {
  return {
    cycle: {
      cycleId: cycle.cycleId,
      generatedAt: cycle.generatedAt,
      rejected: cycle.rejected,
      simulatedFills: cycle.simulatedFills.length,
      reason: cycle.reason,
    },
  };
}

export async function enqueuePaperCycleJob(
  input: EnqueuePaperCycleInput = {},
): Promise<CycleQueueJob> {
  const symbols = normalizeCycleSymbols(input.symbols);
  const requestedKey = cleanString(input.idempotencyKey);
  const idempotencyKey =
    requestedKey ||
    `${new Date().toISOString().slice(0, 16)}:${symbols?.join(",") ?? "active-experiment"}`;
  const requestedRunId = cleanString(input.runId);
  const runId = requestedRunId || createRunId("paper-cycle", idempotencyKey);
  const at = nowIso();
  const jobInput = {
    symbols: symbols ?? "active-experiment",
    queue: {
      enqueuedAt: at,
      source: "cycle.enqueue",
    },
  };

  if (storageMode() === "postgres") {
    const rows = await pgQuery<JobRow>(
      `insert into quant_job_runs (
         run_id, job_name, status, created_at, updated_at, started_at,
         idempotency_key, input
       )
       values ($1, 'paper-cycle', 'queued', $2, $2, $2, $3, $4::jsonb)
       on conflict (run_id) do nothing
       returning *`,
      [runId, at, idempotencyKey, JSON.stringify(jobInput)],
    );
    if (rows[0]) return rowToJob(rows[0]);
    const existing = await pgQuery<JobRow>(
      "select * from quant_job_runs where run_id = $1",
      [runId],
    );
    if (!existing[0]) throw new Error(`Cannot read queued cycle job after insert: ${runId}`);
    return rowToJob(existing[0]);
  }

  return enqueueLocal(async () => {
    const file = await readJobsFile();
    const existing = file.jobs[runId];
    if (existing) return existing;

    const job: CycleQueueJob = {
      runId,
      jobName: "paper-cycle",
      status: "queued",
      createdAt: at,
      updatedAt: at,
      startedAt: at,
      idempotencyKey,
      input: jobInput,
    };
    file.jobs[job.runId] = job;
    await writeJobsFile(file);
    return job;
  });
}

export async function claimNextQueuedPaperCycleJob(): Promise<CycleQueueJob | null> {
  if (storageMode() === "postgres") {
    const at = nowIso();
    const rows = await pgQuery<JobRow>(
      `update quant_job_runs
       set status = 'running',
           updated_at = $1,
           started_at = $1
       where run_id = (
         select run_id
         from quant_job_runs
         where job_name = 'paper-cycle'
           and status = 'queued'
         order by created_at asc
         for update skip locked
         limit 1
       )
       returning *`,
      [at],
    );
    return rows[0] ? rowToJob(rows[0]) : null;
  }

  return enqueueLocal(async () => {
    const file = await readJobsFile();
    const queued = Object.values(file.jobs)
      .filter((job) => job.jobName === "paper-cycle" && job.status === "queued")
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    if (!queued) return null;

    const at = nowIso();
    const claimed: CycleQueueJob = {
      ...queued,
      status: "running",
      updatedAt: at,
      startedAt: at,
    };
    file.jobs[claimed.runId] = claimed;
    await writeJobsFile(file);
    return claimed;
  });
}

export async function runNextQueuedPaperCycleJob(): Promise<RunNextCycleQueueResult> {
  const job = await claimNextQueuedPaperCycleJob();
  if (!job) return { claimed: false };

  try {
    const cycle = await runPaperCycleLocked(jobSymbols(job));
    const finished = await finishJob(job.runId, cycleJobOutput(cycle));
    return { claimed: true, job: finished, cycle };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown paper cycle error.";
    const failed = await failJob(job.runId, message);
    return { claimed: true, job: failed, error: message };
  }
}

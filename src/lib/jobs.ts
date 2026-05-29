import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { dataPath, pgQuery, storageMode, writeJsonFile } from "@/lib/storage";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

export type JobRun = {
  runId: string;
  jobName: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  finishedAt?: string;
  idempotencyKey?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
};

export type BeginJobInput = {
  runId: string;
  jobName?: string;
  idempotencyKey?: string;
  input?: Record<string, unknown>;
};

export type FinishJobInput = {
  runId: string;
  output?: Record<string, unknown>;
};

export type FailJobInput = {
  runId: string;
  error: string | Error;
  output?: Record<string, unknown>;
};

type JobsFile = {
  version: 1;
  jobs: Record<string, JobRun>;
};

let jobQueue = Promise.resolve();

function jobsPath(): string {
  return dataPath("jobs.json");
}

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = jobQueue.then(work, work);
  jobQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function nowIso(): string {
  return new Date().toISOString();
}

function slug(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "job";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashPart(value: unknown): string {
  return createHash("sha256")
    .update(stableStringify(value))
    .digest("base64url")
    .slice(0, 16);
}

export function createRunId(
  jobName = "paper-cycle",
  idempotencyKey: unknown = `${Date.now()}-${Math.random()}`,
): string {
  return `${slug(jobName)}-${hashPart(idempotencyKey)}`;
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
          .filter((job): job is JobRun => Boolean(job?.runId))
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

type JobRow = {
  run_id: string;
  job_name: string;
  status: JobStatus;
  created_at: Date | string;
  updated_at: Date | string;
  started_at: Date | string;
  finished_at: Date | string | null;
  idempotency_key: string | null;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: string | null;
};

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function rowToJob(row: JobRow): JobRun {
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

function normalizeBegin(
  runOrInput: string | BeginJobInput,
  jobName = "paper-cycle",
  input?: Record<string, unknown>,
): BeginJobInput {
  if (typeof runOrInput === "string") {
    return { runId: runOrInput, jobName, input };
  }
  return {
    jobName: "paper-cycle",
    ...runOrInput,
  };
}

function normalizeFinish(
  runOrInput: string | FinishJobInput,
  output?: Record<string, unknown>,
): FinishJobInput {
  return typeof runOrInput === "string" ? { runId: runOrInput, output } : runOrInput;
}

function normalizeFail(
  runOrInput: string | FailJobInput,
  error?: string | Error,
  output?: Record<string, unknown>,
): FailJobInput {
  if (typeof runOrInput === "string") {
    if (!error) throw new Error("failJob requires an error");
    return { runId: runOrInput, error, output };
  }
  return runOrInput;
}

export async function beginJob(
  runOrInput: string | BeginJobInput,
  jobName?: string,
  input?: Record<string, unknown>,
): Promise<JobRun> {
  const begin = normalizeBegin(runOrInput, jobName, input);
  if (storageMode() === "postgres") {
    const at = nowIso();
    const rows = await pgQuery<JobRow>(
      `insert into quant_job_runs (
         run_id, job_name, status, created_at, updated_at, started_at,
         idempotency_key, input
       )
       values ($1, $2, 'running', $3, $3, $3, $4, $5::jsonb)
       on conflict (run_id) do nothing
       returning *`,
      [
        begin.runId,
        begin.jobName ?? "paper-cycle",
        at,
        begin.idempotencyKey ?? null,
        JSON.stringify(begin.input ?? null),
      ],
    );
    if (rows[0]) return rowToJob(rows[0]);
    const existing = await pgQuery<JobRow>(
      "select * from quant_job_runs where run_id = $1",
      [begin.runId],
    );
    if (!existing[0]) throw new Error(`Cannot read job run after insert: ${begin.runId}`);
    return rowToJob(existing[0]);
  }

  return enqueue(async () => {
    const file = await readJobsFile();
    const existing = file.jobs[begin.runId];
    if (existing) return existing;

    const at = nowIso();
    const job: JobRun = {
      runId: begin.runId,
      jobName: begin.jobName ?? "paper-cycle",
      status: "running",
      createdAt: at,
      updatedAt: at,
      startedAt: at,
      idempotencyKey: begin.idempotencyKey,
      input: begin.input,
    };
    file.jobs[job.runId] = job;
    await writeJobsFile(file);
    return job;
  });
}

export async function finishJob(
  runOrInput: string | FinishJobInput,
  output?: Record<string, unknown>,
): Promise<JobRun> {
  const finish = normalizeFinish(runOrInput, output);
  if (storageMode() === "postgres") {
    const at = nowIso();
    const updated = await pgQuery<JobRow>(
      `update quant_job_runs
       set status = 'succeeded',
           updated_at = $2,
           finished_at = $2,
           output = $3::jsonb,
           error = null
       where run_id = $1 and finished_at is null
       returning *`,
      [finish.runId, at, JSON.stringify(finish.output ?? null)],
    );
    if (updated[0]) return rowToJob(updated[0]);
    const existing = await pgQuery<JobRow>(
      "select * from quant_job_runs where run_id = $1",
      [finish.runId],
    );
    if (!existing[0]) throw new Error(`Cannot finish unknown job run: ${finish.runId}`);
    return rowToJob(existing[0]);
  }

  return enqueue(async () => {
    const file = await readJobsFile();
    const existing = file.jobs[finish.runId];
    if (!existing) throw new Error(`Cannot finish unknown job run: ${finish.runId}`);
    if (existing.finishedAt) return existing;

    const at = nowIso();
    const job: JobRun = {
      ...existing,
      status: "succeeded",
      updatedAt: at,
      finishedAt: at,
      output: finish.output,
    };
    delete job.error;
    file.jobs[job.runId] = job;
    await writeJobsFile(file);
    return job;
  });
}

export async function failJob(
  runOrInput: string | FailJobInput,
  error?: string | Error,
  output?: Record<string, unknown>,
): Promise<JobRun> {
  const fail = normalizeFail(runOrInput, error, output);
  if (storageMode() === "postgres") {
    const at = nowIso();
    const message = fail.error instanceof Error ? fail.error.message : fail.error;
    const updated = await pgQuery<JobRow>(
      `update quant_job_runs
       set status = 'failed',
           updated_at = $2,
           finished_at = $2,
           output = $3::jsonb,
           error = $4
       where run_id = $1 and finished_at is null
       returning *`,
      [fail.runId, at, JSON.stringify(fail.output ?? null), message],
    );
    if (updated[0]) return rowToJob(updated[0]);
    const existing = await pgQuery<JobRow>(
      "select * from quant_job_runs where run_id = $1",
      [fail.runId],
    );
    if (!existing[0]) throw new Error(`Cannot fail unknown job run: ${fail.runId}`);
    return rowToJob(existing[0]);
  }

  return enqueue(async () => {
    const file = await readJobsFile();
    const existing = file.jobs[fail.runId];
    if (!existing) throw new Error(`Cannot fail unknown job run: ${fail.runId}`);
    if (existing.finishedAt) return existing;

    const at = nowIso();
    const job: JobRun = {
      ...existing,
      status: "failed",
      updatedAt: at,
      finishedAt: at,
      output: fail.output,
      error: fail.error instanceof Error ? fail.error.message : fail.error,
    };
    file.jobs[job.runId] = job;
    await writeJobsFile(file);
    return job;
  });
}

export async function readRecentJobs(limit = 50): Promise<JobRun[]> {
  if (storageMode() === "postgres") {
    const rows = await pgQuery<JobRow>(
      "select * from quant_job_runs order by updated_at desc limit $1",
      [Math.max(0, limit)],
    );
    return rows.map(rowToJob);
  }

  return enqueue(async () => {
    const file = await readJobsFile();
    return Object.values(file.jobs)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .slice(0, Math.max(0, limit));
  });
}

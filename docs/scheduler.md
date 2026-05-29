# Scheduler

`npm run cycle:daemon` repeats `npm run cycle:once` against the running app. For queue-backed execution, `npm run cycle:enqueue` or `POST /api/cycle/enqueue` creates a durable paper-cycle job and `npm run cycle:worker` polls `/api/cycle/worker` to claim and execute queued jobs.

Environment:

- `CYCLE_BASE_URL`: app URL, default `http://localhost:3000`.
- `CYCLE_SYMBOLS`: comma-separated universe, default from app config.
- `CYCLE_INTERVAL_MS`: interval, minimum 30 seconds.
- `CYCLE_IDEMPOTENCY_KEY`: optional stable key for `cycle:enqueue`.
- `CYCLE_WORKER_POLL_MS`: queue worker poll interval, minimum one second.
- `CYCLE_WORKER_ONCE`: when `true`, worker exits after one claim attempt.
- `AGENT_API_TOKEN`: required for non-localhost targets.
- `PAPER_KILL_SWITCH`: when truthy, risk evaluation withholds paper cycles.
- `DATABASE_URL`: enables durable Postgres job records.

The API caps request symbols to 12. The current local lock prevents duplicate in-process cycles.

Local job readiness:

- `src/lib/jobs.ts` provides a file-backed run registry under `QUANT_DATA_DIR/jobs.json`, or `.data/jobs.json` by default.
- `createRunId(jobName, idempotencyKey)` creates a deterministic run id when the scheduler supplies a stable cycle window or symbol key.
- `beginJob` is idempotent for an existing `runId`; `finishJob` and `failJob` mark a running job terminal without rewriting already-finished runs.
- `src/lib/cycle-queue.ts` stores queued paper-cycle jobs in the same job registry. In Postgres mode, worker claims use `for update skip locked`; in local mode, the app process serializes file updates.
- Writes use a temporary file plus rename and an in-process queue, which is appropriate for local paper-cycle idempotency. Production should still use a durable job lock and idempotency key in Postgres or a queue.

Cycle responses now include the terminal job record. `scripts/cycle-once.mjs` prints `runId`, `jobStatus`, and `riskOk` alongside the cycle result.

## Worker Commands

Run the app server first:

```bash
npm run start
```

Run one immediate cycle:

```bash
CYCLE_BASE_URL=https://YOUR_APP_HOST npm run cycle:once
```

Run the direct local daemon:

```bash
CYCLE_BASE_URL=https://YOUR_APP_HOST CYCLE_INTERVAL_MS=30000 npm run cycle:daemon
```

Run the queue worker:

```bash
CYCLE_BASE_URL=https://YOUR_APP_HOST npm run cycle:worker
```

For non-localhost targets, set `AGENT_API_TOKEN` in the worker environment.

## Queue Target

A production queue should enqueue `{ window, symbols }` jobs, use one consumer group per strategy/universe, and map each queue item to a stable cycle idempotency key. Postgres `quant_job_runs` is the durable job audit; queue acknowledgements are delivery mechanics only.

Until a queue consumer exists, avoid running overlapping daemons for the same `CYCLE_SYMBOLS` set.

# Production Operations Notes

This project is still paper-only. These notes describe the durable-storage and worker posture needed for unattended paper operation, and the boundary before any live-order implementation.

## Postgres Persistence

Set `DATABASE_URL` to a managed Postgres connection string to make Postgres the authoritative store for ledger records, document state, paper book/cache, experiment registry, recursion decisions, and job runs. The app creates the required `quant_*` tables on first server-side storage use.

Recommended production env:

```bash
DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DATABASE
POSTGRES_SSL=true
POSTGRES_POOL_MAX=5
QUANT_STORAGE_DRIVER=
```

Storage selection:

- `DATABASE_URL` present: use Postgres.
- `QUANT_STORAGE_DRIVER=local`: force local `.data` JSON/JSONL files even when `DATABASE_URL` exists.
- no `DATABASE_URL`: use local `.data` files, or `QUANT_DATA_DIR` when set.

Use local fallback only for development and smoke tests. It is not durable enough for unattended paper collection or audit retention.

## Dashboard Hardening

Keep the dashboard private by default. Non-localhost access requires `AGENT_API_TOKEN` as a Bearer token; production deployments should also sit behind Cloudflare Access, a WAF, or an equivalent identity-aware proxy. Do not expose broker credentials, Postgres credentials, or LLM keys to browser-side code or research-agent prompts.

## Queue-Backed Cycles

Current commands:

```bash
npm run cycle:once
npm run cycle:enqueue
npm run cycle:daemon
npm run cycle:worker
```

`cycle:once` posts to `CYCLE_BASE_URL/api/cycle/run`. `cycle:daemon` repeats `cycle:once` at `CYCLE_INTERVAL_MS` and is suitable for a single direct scheduler process. `cycle:enqueue` creates durable paper-cycle jobs through `/api/cycle/enqueue`; `cycle:worker` polls `/api/cycle/worker` and claims one queued job at a time.

Production queue target:

- A scheduler enqueues cycle windows and symbol sets with `cycle:enqueue` or `/api/cycle/enqueue`.
- Exactly one worker consumer claims each queue item through `cycle:worker` or `/api/cycle/worker`.
- The worker supplies a stable idempotency key per window/universe so duplicate queue deliveries resolve to the same job run.
- Postgres remains the source of truth for `quant_job_runs`; queue delivery state is not the audit record.

Run one worker pool per environment/universe and avoid mixing overlapping direct daemons with queue workers for the same strategy.

## Historical Replay And Audit

The replay primitive is server-side only today: `buildHistoricalReplayBundle(cycleId, limit)` reconstructs a paper cycle from ledger records, checks filtration order, validates market-data cutoff, confirms forecasts/certificates, and verifies paper mode.

Operational use:

1. Capture the `cycleId` from `npm run cycle:once`, the dashboard ledger, or a `paper_action` ledger record.
2. Build a replay bundle from server-side code with that `cycleId`.
3. Store the resulting JSON in an audit artifact location such as R2 or an internal evidence bucket.
4. Treat any failed replay check as an audit blocker before promoting strategy changes.

Replay is also available through the operator-protected API:

```bash
curl "$CYCLE_BASE_URL/api/audit/replay?cycleId=cycle-id"
```

For non-localhost targets, include `Authorization: Bearer $AGENT_API_TOKEN`.

## Live-Order Design Review Boundary

There is no live order route in this app. Do not add broker order placement or production execution workers until a separate design review approves:

- Formal auth and role-based operator approvals.
- Transactional order intent, approval, submission, acknowledgement, and reconciliation records.
- Independent risk limits, kill switch, and incident rollback process.
- Broker adapter failure-mode analysis and paper-to-live parity tests.
- Monitoring, alerting, backups, and audit export retention.

Until that review is complete, all cycles must remain paper/read-only even when production infrastructure is available.

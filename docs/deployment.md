# Deployment Notes

## Local

Use local mode for development and paper feedback:

```bash
npm run dev
npm run cycle:once
```

The dashboard is intended for `localhost`. Non-localhost access must provide `AGENT_API_TOKEN` as a Bearer token.

## DigitalOcean

Use credits here for:

- App Platform or Droplet deployment.
- Managed Postgres for ledger/book/cache.
- Worker process for `cycle:worker` once `DATABASE_URL` is configured, with `cycle:daemon` retained as the direct local scheduler.
- Backups, logs, and restart policy.

Set `DATABASE_URL` for durable storage. Set `POSTGRES_SSL=true` for managed Postgres providers that require TLS, and tune `POSTGRES_POOL_MAX` conservatively for the chosen instance size. Do not deploy with `.data/` as the authoritative store beyond a temporary smoke test.

After deploy, run `CYCLE_BASE_URL=https://YOUR_APP_HOST npm run storage:check` to verify the selected storage driver with a document and job round trip.

## Cloudflare

Use credits here for:

- Access/WAF in front of the dashboard.
- R2 for artifacts and audit bundles.
- Queues for paper-cycle/backtest jobs.
- Cron Triggers for health checks or job enqueueing.

The queue-facing command is `npm run cycle:enqueue`; `npm run cycle:worker` consumes queued jobs. A Cloudflare Queue design should enqueue stable cycle windows and let one worker consumer invoke the cycle API with idempotent job keys.

## OpenRouter

Use credits after the deterministic loop is stable. The first integrations should be read-only research agents that summarize ledger outcomes and propose experiments. They should never receive broker secrets and should never call live order routes.

## Storage Driver

`DATABASE_URL` switches storage to Postgres. `QUANT_STORAGE_DRIVER=local` forces local files for development, emergency smoke tests, or isolated debugging. Leave `QUANT_STORAGE_DRIVER` unset in production so the presence of `DATABASE_URL` selects Postgres.

## Live-Order Boundary

Deployment readiness does not imply live-trading readiness. Broker order placement requires a separate design review covering order intent records, approvals, risk limits, kill switch behavior, reconciliation, monitoring, and incident response.

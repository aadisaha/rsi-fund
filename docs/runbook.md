# Runbook

## Cycle Fails

1. Check `/api/health`.
2. Check the dashboard Ops tab for missing credentials.
3. Run `npm run cycle:once` and inspect the JSON output.
4. If Alpaca is unavailable, confirm `ALPACA_PAPER=true` or set explicit `PAPER_STARTING_EQUITY_USD` for paper-only sizing.

## Stale Data

Run a paper cycle to refresh `.data/market-cache.json`. Intraday crypto cache freshness is intentionally short; daily equity bars refresh less often.

## Ledger Review

The append-only local ledger is `.data/ledger.jsonl`. Each paper cycle records observations, forecasts, a paper action, optional paper-book observation, and a certificate.

When `DATABASE_URL` is set and `QUANT_STORAGE_DRIVER` is not `local`, ledger records are stored in Postgres table `quant_ledger_records` instead of `.data/ledger.jsonl`.

## Storage Check

Run `npm run storage:check` against a running app to verify the selected storage driver. It performs a harmless document round trip plus a `storage-check` job run. For deployed targets, set `CYCLE_BASE_URL` and `AGENT_API_TOKEN`, or call `POST /api/storage/check` with a Bearer token.

## Historical Replay

Use the `cycleId` printed by `npm run cycle:once`, or from a `paper_action` ledger record. The server-side replay helper builds a bundle with the cycle payload, related ledger records, filtration checks, market-data cutoff checks, forecast/certificate presence, and paper-only verification.

Use `/api/audit/replay?cycleId=<cycle-id>` or `POST /api/audit/replay` with `{ "cycleId": "..." }` to generate a replay bundle. For non-localhost targets, include `Authorization: Bearer $AGENT_API_TOKEN`. Export the resulting JSON to the audit artifact store for review.

## Stop The System

Stop the dev server or daemon process. There is no live execution route, so stopping the process stops all paper-cycle activity.

## Before Live Trading

Require a separate design review and implementation phase with formal auth, transactional order intent records, human approvals, independent risk controls, kill switch, broker order adapters, reconciliation, monitoring, backups, and incident response. Production paper infrastructure must not be reused as implicit approval for live orders.

# Self Recursive Quant Fund MVP

Local, paper-only implementation of the white-paper architecture: read-only broker state, market-data cache, paper cycle runner, optimizer proposal, experimental t-RSI certificate, append-only ledger, and operator dashboard.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Useful commands:

```bash
npm test
npm run lint
npm run build
npm run cycle:once
npm run cycle:enqueue
npm run cycle:daemon
npm run cycle:worker
npm run kalshi:backfill -- --market SERIES:TICKER --start 2025-01-01 --end 2025-01-08
npm run kalshi:backfill -- --series KXBTC15M --last-year --max-markets 1000
npm run kalshi:rl-once
npm run kalshi:rl-daemon
npm run storage:check
```

`cycle:once`, `cycle:enqueue`, `cycle:daemon`, `cycle:worker`, `kalshi:backfill`, `kalshi:rl-once`, `kalshi:rl-daemon`, and `storage:check` call the local app API, so `npm run dev` or `npm start` must already be running. Enqueue paper cycles with `POST /api/cycle/enqueue`; the worker claims queued jobs through the API and records terminal job status.
`kalshi:rl-daemon` runs a new genetic paper-RL generation every 5 minutes by default; override with `KALSHI_RL_INTERVAL_MS`.
`kalshi:pretrained-rl-train` runs the isolated CPU pretrained black-box RL sidecar against cached Kalshi BTC 15-minute history and writes only to `.data/kalshi-pretrained-rl`. `kalshi:pretrained-rl-once` emits one paper-shadow signal from the latest checkpoint.
`kalshi:pretrained-rl-molly` evaluates the Molly agent line against recent live orderbook events in paper-shadow mode only.

Production operators should also read [docs/production.md](docs/production.md) for Postgres persistence, storage fallback behavior, worker/queue posture, replay/audit usage, and the live-order design-review boundary.

## Safety Boundary

This app has no live order route. It only records paper proposals, paper forecasts, certificates, and simulated fills. For MVP safety, non-localhost access requires `AGENT_API_TOKEN`; Alpaca live reads are blocked unless `ALLOW_LIVE_READS=true`; Kalshi defaults to demo unless `KALSHI_PRODUCTION=true` or the legacy alias `KALSHI_DEMO=false`.

Do not paste secrets into chat or commit `.env.local`. Use restricted API keys and keep the app in paper/read-only mode until a separate live-execution design review exists. Production infrastructure credits do not change this boundary.

## What Works Now

- Operator cockpit with Alpaca/Kalshi read-only status.
- 24/7 paper cycle for default crypto universe: BTC, ETH, SOL.
- Local `.data/ledger.jsonl`, `.data/market-cache.json`, and `.data/paper-book.json` unless `QUANT_DATA_DIR` is set.
- Optional Postgres persistence when `DATABASE_URL` is set; `QUANT_STORAGE_DRIVER=local` forces the local fallback. `npm run storage:check` verifies the selected storage path with a document and job round trip.
- Baseline diagnostic backtest.
- Paper optimizer over the five white-paper channels.
- Horizon-based paper outcome evaluation for 1h, 6h, 24h, and 7d checks.
- Local experiment registry tying cycles back to a model/spec.
- Local job registry for cycle idempotency, enqueueing, worker claims, and daemon observability.
- Server-side historical replay bundle builder for paper-cycle audit checks.
- Compressed Kalshi 1-minute candle backfill cache under `.data/kalshi-history` plus an empirical t-RSI evidence path that activates after enough real samples are present.
- Paper-only genetic RL for Kalshi BTC 15-minute markets once ingestion agents append orderbook/ticker JSONL under `.data/kalshi-orderbook` or post visible screen ticks to `POST /api/kalshi/orderbook/ingest`.
- Paper-shadow pretrained RL for Kalshi BTC 15-minute markets from cached 1-minute candle history, isolated from the genetic RL champion/run files.
- Molly-family pretrained RL agents that use live orderbook events for paper-shadow trades without calling any live order route.
- Paper risk engine for stale cache, notional, exposure, capital, symbol count, and kill-switch checks.
- Experimental t-RSI certificate tracking.
- Ops tab showing credit-dependent build surface.

## What Credits Unlock

DigitalOcean: production deployment, managed Postgres, always-on workers, restart policies, backups, and long-running research jobs.

Cloudflare: Access/WAF, public dashboard hosting, R2 artifact storage, Queues, Cron Triggers, and edge health checks.

OpenRouter: research agents, report generation, experiment diagnostics, and natural-language operator summaries grounded in ledger records.

## Production Gap

Local files are acceptable for a paper MVP but are not durable production storage. Before unattended paper production, enable Postgres or another transactional store, add queue-backed idempotent jobs, formal auth, monitoring, and backups. Before any capital execution, complete a separate live-order safety review.

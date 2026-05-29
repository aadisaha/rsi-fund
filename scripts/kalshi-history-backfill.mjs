const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENT_API_TOKEN ?? "";

function usage() {
  return [
    "Usage:",
    "  node scripts/kalshi-history-backfill.mjs --market SERIES:TICKER --start 2025-01-01 --end 2025-01-08",
    "  node scripts/kalshi-history-backfill.mjs --market historical:TICKER --start 2025-01-01T00:00:00Z --end 2025-02-01T00:00:00Z",
    "  node scripts/kalshi-history-backfill.mjs --series KXBTC15M --last-year --max-markets 1000",
    "",
    "Env alternatives:",
    "  KALSHI_HISTORY_MARKETS=SERIES:TICKER,historical:TICKER",
    "  KALSHI_HISTORY_SERIES=KXBTC15M,KXETH15M",
    "  KALSHI_HISTORY_START=2025-01-01",
    "  KALSHI_HISTORY_END=2025-01-08",
  ].join("\n");
}

function parseTime(raw, name) {
  if (!raw) throw new Error(`${name} is required.`);
  if (/^\d+$/.test(raw)) return Number(raw);
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) throw new Error(`${name} must be a Unix timestamp or ISO date.`);
  return Math.floor(ms / 1000);
}

function parseMarket(raw) {
  const [left, ...rest] = raw.split(":");
  const right = rest.join(":");
  if (!right) {
    return { source: "historical", marketTicker: left };
  }
  if (left.toLowerCase() === "historical" || left.toLowerCase() === "archived") {
    return { source: "historical", marketTicker: right };
  }
  return { source: "live", seriesTicker: left, marketTicker: right };
}

const args = process.argv.slice(2);
const markets = [];
const seriesTickers = [];
let start = process.env.KALSHI_HISTORY_START ?? "";
let end = process.env.KALSHI_HISTORY_END ?? "";
let periodInterval = Number(process.env.KALSHI_HISTORY_PERIOD_INTERVAL ?? 1);
let chunkMinutes = Number(process.env.KALSHI_HISTORY_CHUNK_MINUTES ?? 7200);
let maxMarkets = Number(process.env.KALSHI_HISTORY_MAX_MARKETS ?? 50000);

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--help" || arg === "-h") {
    console.log(usage());
    process.exit(0);
  }
  if (arg === "--market") {
    markets.push(parseMarket(args[++i] ?? ""));
  } else if (arg === "--series") {
    seriesTickers.push(args[++i] ?? "");
  } else if (arg === "--start") {
    start = args[++i] ?? "";
  } else if (arg === "--end") {
    end = args[++i] ?? "";
  } else if (arg === "--last-year") {
    const now = new Date();
    const prior = new Date(now);
    prior.setUTCFullYear(prior.getUTCFullYear() - 1);
    start = prior.toISOString();
    end = now.toISOString();
  } else if (arg === "--period-interval") {
    periodInterval = Number(args[++i]);
  } else if (arg === "--chunk-minutes") {
    chunkMinutes = Number(args[++i]);
  } else if (arg === "--max-markets") {
    maxMarkets = Number(args[++i]);
  } else {
    throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
  }
}

for (const raw of (process.env.KALSHI_HISTORY_MARKETS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  markets.push(parseMarket(raw));
}

for (const raw of (process.env.KALSHI_HISTORY_SERIES ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  seriesTickers.push(raw);
}

if (!markets.length && !seriesTickers.length) {
  console.error(usage());
  process.exit(1);
}

const headers = { "Content-Type": "application/json" };
if (token) headers.Authorization = `Bearer ${token}`;

const res = await fetch(`${baseUrl}/api/kalshi/history/backfill`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    markets,
    seriesTickers: [...new Set(seriesTickers.filter(Boolean))],
    startTs: parseTime(start, "start"),
    endTs: parseTime(end, "end"),
    periodInterval,
    chunkMinutes,
    maxMarkets,
  }),
});

const json = await res.json().catch(() => ({}));
if (!res.ok || json.ok === false) {
  console.error(json.error ?? `Kalshi backfill failed with HTTP ${res.status}`);
  process.exit(1);
}

const result = json.result;
console.log(
  JSON.stringify(
    {
      ok: true,
      generatedAt: result.generatedAt,
      dataDir: result.dataDir,
      discoveredMarkets: result.discoveredMarkets,
      requests: result.requests.map((r) => ({
        marketTicker: r.marketTicker,
        source: r.source,
        fetchedCandles: r.fetchedCandles,
        writtenCandles: r.writtenCandles,
        files: r.files.length,
      })),
    },
    null,
    2,
  ),
);

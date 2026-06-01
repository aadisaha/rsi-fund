const baseUrl = process.env.CYCLE_BASE_URL ?? "http://localhost:3000";
const token = process.env.AGENT_API_TOKEN ?? "";
const seriesTicker = process.env.KALSHI_RL_SERIES ?? "KXBTC15M";
const intervalMs = Math.max(250, Number(process.env.KALSHI_ORDERBOOK_CAPTURE_MS ?? 1_000));
const kalshiApiBase = process.env.KALSHI_API_BASE ?? "https://api.elections.kalshi.com/trade-api/v2";

function usage() {
  console.log("Usage: npm run kalshi:orderbook-capture -- [--once] [--interval-ms 1000]");
}

let once = false;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--once") {
    once = true;
  } else if (arg === "--interval-ms") {
    const next = Number(args[++i]);
    if (Number.isFinite(next) && next > 0) process.env.KALSHI_ORDERBOOK_CAPTURE_MS = String(next);
  } else if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else {
    throw new Error(`Unknown argument: ${arg}`);
  }
}

function dollars(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function marketToEvent(market) {
  const yesAsk = dollars(market.yes_ask_dollars);
  const noAsk = dollars(market.no_ask_dollars);
  const target = dollars(market.floor_strike);
  return {
    receivedAt: new Date().toISOString(),
    marketTicker: market.ticker,
    seriesTicker,
    windowOpenTime: market.open_time,
    windowCloseTime: market.close_time,
    targetPrice: target,
    yesAsk,
    noAsk,
    upPrice: yesAsk,
    downPrice: noAsk,
    chance: dollars(market.last_price_dollars),
    source: "kalshi-rest-market",
    raw: {
      eventTicker: market.event_ticker,
      status: market.status,
      liquidityDollars: market.liquidity_dollars,
      openInterest: market.open_interest_fp,
      volume: market.volume_fp,
      updatedTime: market.updated_time,
      yesBid: dollars(market.yes_bid_dollars),
      noBid: dollars(market.no_bid_dollars),
    },
  };
}

async function captureOnce() {
  const url = new URL(`${kalshiApiBase}/markets`);
  url.searchParams.set("series_ticker", seriesTicker);
  url.searchParams.set("status", "open");
  const kalshiRes = await fetch(url, { cache: "no-store" });
  if (!kalshiRes.ok) throw new Error(`Kalshi markets HTTP ${kalshiRes.status}`);
  const kalshiJson = await kalshiRes.json();
  const markets = Array.isArray(kalshiJson.markets) ? kalshiJson.markets : [];
  const active = markets
    .filter((market) => market && typeof market.ticker === "string")
    .sort((a, b) => Date.parse(a.close_time ?? "") - Date.parse(b.close_time ?? ""))[0];
  if (!active) throw new Error(`No open ${seriesTicker} market returned by Kalshi.`);

  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const event = marketToEvent(active);
  const ingestRes = await fetch(`${baseUrl}/api/kalshi/orderbook/ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
  });
  const ingestJson = await ingestRes.json().catch(() => ({}));
  if (!ingestRes.ok || ingestJson.ok === false) {
    throw new Error(ingestJson.error ?? `ingest HTTP ${ingestRes.status}`);
  }
  console.log(
    JSON.stringify({
      at: event.receivedAt,
      marketTicker: event.marketTicker,
      upAsk: event.yesAsk,
      downAsk: event.noAsk,
      target: event.targetPrice,
      accepted: ingestJson.accepted,
    }),
  );
}

while (true) {
  try {
    await captureOnce();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  if (once) break;
  await new Promise((resolve) => setTimeout(resolve, Math.max(250, Number(process.env.KALSHI_ORDERBOOK_CAPTURE_MS ?? intervalMs))));
}

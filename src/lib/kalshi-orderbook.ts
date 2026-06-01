import "server-only";

import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { dataDir, pgQuery, storageMode } from "@/lib/storage";
import type { KalshiOrderbookEvent, KalshiOrderbookEventType } from "@/lib/types";

type RawRecord = Record<string, unknown>;

export type KalshiScreenTickInput = {
  receivedAt?: unknown;
  marketTicker?: unknown;
  seriesTicker?: unknown;
  windowOpenTime?: unknown;
  windowCloseTime?: unknown;
  targetPrice?: unknown;
  currentPrice?: unknown;
  chance?: unknown;
  upPrice?: unknown;
  downPrice?: unknown;
  yesAsk?: unknown;
  noAsk?: unknown;
  source?: unknown;
  tape?: unknown;
};

export type OrderbookLevel = {
  price: number;
  quantity: number;
};

export type OrderbookStateSummary = {
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  spread: number | null;
  yesDepth: number;
  noDepth: number;
};

function envTrim(value: string | undefined): string {
  return value?.trim() ?? "";
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

function eventId(event: KalshiOrderbookEvent): string {
  return createHash("sha256")
    .update(stableStringify(event))
    .digest("base64url")
    .slice(0, 32);
}

export function kalshiOrderbookDataDir(): string {
  return envTrim(process.env.KALSHI_ORDERBOOK_DATA_DIR) || path.join(dataDir(), "kalshi-orderbook");
}

function numberFrom(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isoFrom(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function rawObject(value: unknown): RawRecord {
  return typeof value === "object" && value !== null ? (value as RawRecord) : {};
}

function compactRawObject(value: RawRecord): RawRecord {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v != null && v !== ""));
}

function boundedPrice(value: unknown): number | null {
  const n = numberFrom(value);
  if (n == null) return null;
  const dollars = n > 1 && n <= 100 ? n / 100 : n;
  return dollars >= 0 && dollars <= 1 ? dollars : null;
}

function looseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return numberFrom(value);
  const cleaned = value.replace(/[$,%¢,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function screenProbability(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") {
    const n = looseNumber(value);
    if (n == null) return null;
    if (value.includes("%") || value.includes("¢")) return n / 100;
    return n > 1 && n <= 100 ? n / 100 : n;
  }
  return boundedPrice(value);
}

function bestBid(levels: OrderbookLevel[]): number | null {
  return levels.length ? Math.max(...levels.map((level) => level.price)) : null;
}

function depth(levels: OrderbookLevel[]): number {
  return levels.reduce((sum, level) => sum + level.quantity, 0);
}

function normalizeLevels(value: unknown): OrderbookLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => {
      const tuple = Array.isArray(raw) ? raw : [];
      const price = boundedPrice(tuple[0]);
      const quantity = numberFrom(tuple[1]);
      return price == null || quantity == null || quantity <= 0 ? null : { price, quantity };
    })
    .filter((level): level is OrderbookLevel => Boolean(level))
    .sort((a, b) => b.price - a.price);
}

export function summarizeOrderbook(args: {
  yesLevels: OrderbookLevel[];
  noLevels: OrderbookLevel[];
}): OrderbookStateSummary {
  const yesBid = bestBid(args.yesLevels);
  const noBid = bestBid(args.noLevels);
  const yesAsk = noBid == null ? null : 1 - noBid;
  const noAsk = yesBid == null ? null : 1 - yesBid;
  const spread = yesBid == null || yesAsk == null ? null : Math.max(0, yesAsk - yesBid);
  return {
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    spread,
    yesDepth: depth(args.yesLevels),
    noDepth: depth(args.noLevels),
  };
}

export function normalizeOrderbookSnapshot(raw: unknown): OrderbookStateSummary {
  const body = rawObject(raw);
  const book = rawObject(body.orderbook_fp ?? body.orderbook ?? body);
  return summarizeOrderbook({
    yesLevels: normalizeLevels(book.yes_dollars ?? book.yes),
    noLevels: normalizeLevels(book.no_dollars ?? book.no),
  });
}

function eventTypeFrom(value: unknown): KalshiOrderbookEventType {
  const raw = String(value ?? "ticker");
  if (raw === "orderbook_snapshot" || raw === "orderbook_delta" || raw === "trade") return raw;
  if (raw === "market_lifecycle" || raw === "market_lifecycle_v2") return "market_lifecycle";
  if (raw === "settlement" || raw === "settled") return "settlement";
  if (raw === "rest_snapshot") return "rest_snapshot";
  return "ticker";
}

export function normalizeKalshiOrderbookEvent(value: unknown): KalshiOrderbookEvent | null {
  const raw = rawObject(value);
  const body = rawObject(raw.msg ?? raw.message ?? raw.payload ?? raw);
  const nestedRaw = rawObject(body.raw ?? raw.raw);
  const msg = {
    ...compactRawObject(nestedRaw),
    ...compactRawObject(body),
  };
  const eventType = eventTypeFrom(raw.type ?? raw.eventType ?? msg.type);
  const bookSummary =
    eventType === "orderbook_snapshot" || eventType === "rest_snapshot"
      ? normalizeOrderbookSnapshot(msg.orderbook_fp ?? msg.orderbook ?? msg)
      : null;
  const yesAsk = screenProbability(msg.yesAsk ?? msg.upPrice ?? msg.yes_ask_dollars ?? msg.yes_ask ?? bookSummary?.yesAsk);
  const noAsk = screenProbability(msg.noAsk ?? msg.downPrice ?? msg.no_ask_dollars ?? msg.no_ask ?? bookSummary?.noAsk);
  const yesBid =
    screenProbability(msg.yesBid ?? msg.yes_bid_dollars ?? msg.yes_bid ?? bookSummary?.yesBid) ??
    (noAsk == null ? null : 1 - noAsk);
  const noBid =
    screenProbability(msg.noBid ?? msg.no_bid_dollars ?? msg.no_bid ?? bookSummary?.noBid) ??
    (yesAsk == null ? null : 1 - yesAsk);
  const derivedSpread = yesBid == null || yesAsk == null ? null : Math.max(0, yesAsk - yesBid);
  const marketTicker = stringFrom(msg.marketTicker ?? msg.market_ticker ?? msg.ticker);
  if (!marketTicker) return null;

  return {
    receivedAt:
      isoFrom(raw.receivedAt) ??
      isoFrom(msg.receivedAt) ??
      isoFrom(msg.ts) ??
      isoFrom(msg.time) ??
      new Date().toISOString(),
    marketTicker,
    seriesTicker: stringFrom(msg.seriesTicker ?? msg.series_ticker),
    eventType,
    windowOpenTime: isoFrom(msg.windowOpenTime ?? msg.open_time ?? msg.openTime),
    windowCloseTime: isoFrom(
      msg.windowCloseTime ?? msg.close_time ?? msg.closeTime ?? msg.expiration_time ?? msg.expirationTime,
    ),
    yesBid,
    yesAsk,
    noBid,
    noAsk,
    spread: numberFrom(msg.spread) ?? bookSummary?.spread ?? derivedSpread,
    yesDepth: numberFrom(msg.yesDepth ?? msg.yes_bid_size_fp) ?? bookSummary?.yesDepth ?? null,
    noDepth: numberFrom(msg.noDepth ?? msg.no_bid_size_fp) ?? bookSummary?.noDepth ?? null,
    tradedPrice: screenProbability(msg.tradedPrice ?? msg.chance ?? msg.price_dollars ?? msg.price ?? msg.last_price_dollars),
    tradedQuantity: numberFrom(msg.tradedQuantity ?? msg.count ?? msg.quantity ?? msg.size),
    settlementValue: boundedPrice(
      msg.settlementValue ?? msg.settlement_value_dollars ?? msg.yes_settlement_value_dollars,
    ),
    raw: {
      ...(raw as Record<string, unknown>),
      source: stringFrom(msg.source) ?? stringFrom(nestedRaw.source) ?? stringFrom(raw.source) ?? "kalshi",
      targetPrice: looseNumber(msg.targetPrice ?? msg.target_price),
      currentPrice: looseNumber(msg.currentPrice ?? msg.current_price),
      chance: screenProbability(msg.chance),
    },
  };
}

export function normalizeKalshiScreenTick(input: KalshiScreenTickInput): KalshiOrderbookEvent | null {
  const marketTicker = stringFrom(input.marketTicker) ?? `${stringFrom(input.seriesTicker) ?? "KXBTC15M"}-SCREEN`;
  const seriesTicker = stringFrom(input.seriesTicker) ?? "KXBTC15M";
  const yesAsk = screenProbability(input.yesAsk ?? input.upPrice);
  const noAsk = screenProbability(input.noAsk ?? input.downPrice);
  if (yesAsk != null && yesAsk <= 0) return null;
  if (noAsk != null && noAsk <= 0) return null;
  const chance = screenProbability(input.chance);
  const yesBid = noAsk == null ? chance : 1 - noAsk;
  const noBid = yesAsk == null ? (chance == null ? null : 1 - chance) : 1 - yesAsk;
  const inferredYesAsk = yesAsk ?? chance;
  const inferredNoAsk = noAsk ?? (chance == null ? null : 1 - chance);
  const spread =
    yesBid == null || inferredYesAsk == null ? null : Math.max(0, inferredYesAsk - yesBid);

  return {
    receivedAt: isoFrom(input.receivedAt) ?? new Date().toISOString(),
    marketTicker,
    seriesTicker,
    eventType: "ticker",
    windowOpenTime: isoFrom(input.windowOpenTime),
    windowCloseTime: isoFrom(input.windowCloseTime),
    yesBid,
    yesAsk: inferredYesAsk,
    noBid,
    noAsk: inferredNoAsk,
    spread,
    yesDepth: null,
    noDepth: null,
    tradedPrice: chance,
    tradedQuantity: null,
    settlementValue: null,
    raw: {
      source: stringFrom(input.source) ?? "screen",
      targetPrice: looseNumber(input.targetPrice),
      currentPrice: looseNumber(input.currentPrice),
      chance,
      tape: input.tape,
    },
  };
}

async function walkJsonlFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      const info = await stat(full).catch(() => null);
      if (!info) continue;
      if (info.isDirectory()) {
        await walk(full);
      } else if (entry.endsWith(".jsonl")) {
        files.push(full);
      }
    }
  }
  await walk(root);
  return files.sort();
}

export async function appendKalshiOrderbookEvents(events: KalshiOrderbookEvent[]): Promise<void> {
  if (!events.length) return;
  if (storageMode() === "postgres") {
    for (const event of events) {
      await pgQuery(
        `insert into quant_kalshi_orderbook_events (
           event_id, received_at, series_ticker, market_ticker, event
         )
         values ($1, $2, $3, $4, $5::jsonb)
         on conflict (event_id) do nothing`,
        [
          eventId(event),
          event.receivedAt,
          event.seriesTicker,
          event.marketTicker,
          JSON.stringify(event),
        ],
      );
    }
    return;
  }

  const root = kalshiOrderbookDataDir();
  await mkdir(root, { recursive: true });
  const byDate = new Map<string, KalshiOrderbookEvent[]>();
  for (const event of events) {
    const date = event.receivedAt.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), event]);
  }
  for (const [date, batch] of byDate) {
    await appendFile(
      path.join(root, `${date}.jsonl`),
      batch.map((event) => JSON.stringify(event)).join("\n") + "\n",
      "utf8",
    );
  }
}

export async function readKalshiOrderbookEvents(options: {
  limit?: number;
  marketTickers?: string[];
  seriesTicker?: string;
} = {}): Promise<KalshiOrderbookEvent[]> {
  if (storageMode() === "postgres") {
    const selected = options.marketTickers ?? [];
    const limit = Math.max(1, options.limit ?? 10_000);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (options.seriesTicker) {
      params.push(options.seriesTicker);
      clauses.push(`series_ticker = $${params.length}`);
    }
    if (selected.length) {
      params.push(selected);
      clauses.push(`market_ticker = any($${params.length}::text[])`);
    }
    params.push(limit);
    const rows = await pgQuery<{ event: KalshiOrderbookEvent }>(
      `select event
       from quant_kalshi_orderbook_events
       ${clauses.length ? `where ${clauses.join(" and ")}` : ""}
       order by received_at desc
       limit $${params.length}`,
      params,
    );
    return rows
      .map((row) => normalizeKalshiOrderbookEvent(row.event))
      .filter((event): event is KalshiOrderbookEvent => Boolean(event))
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  }

  const root = kalshiOrderbookDataDir();
  const selected = new Set(options.marketTickers ?? []);
  const files = await walkJsonlFiles(root);
  const events: KalshiOrderbookEvent[] = [];
  for (const file of files) {
    const raw = await readFile(file, "utf8").catch(() => "");
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const event = normalizeKalshiOrderbookEvent(JSON.parse(line));
        if (!event) continue;
        if (selected.size && !selected.has(event.marketTicker)) continue;
        if (options.seriesTicker && event.seriesTicker && event.seriesTicker !== options.seriesTicker) continue;
        events.push(event);
      } catch {
        // Ignore malformed ingestion records; the collector is append-only and may be interrupted mid-write.
      }
    }
  }
  const sorted = events.sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
  return options.limit && sorted.length > options.limit ? sorted.slice(-options.limit) : sorted;
}

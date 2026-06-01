import "server-only";

import { createHash } from "node:crypto";

import { appendLedger } from "@/lib/ledger";
import {
  appendKalshiOrderbookEvents,
  normalizeKalshiOrderbookEvent,
  readKalshiOrderbookEvents,
  type KalshiScreenTickInput,
} from "@/lib/kalshi-orderbook";
import { kalshiApiDelete, kalshiApiGet, kalshiApiPost } from "@/lib/kalshi";
import { readKalshiRlSummary } from "@/lib/kalshi-rl";
import { pgQuery, readDocument, storageMode, writeDocument } from "@/lib/storage";
import type {
  GeneticPolicyGenome,
  GeneticTrainingRun,
  KalshiOrderbookEvent,
  KalshiPaperRlOpenPosition,
  KalshiPosition,
} from "@/lib/types";

type KalshiLiveIntentStatus =
  | "planned"
  | "skipped"
  | "submitted"
  | "resting"
  | "partial"
  | "filled"
  | "canceled"
  | "rejected"
  | "unknown"
  | "orphan_remote";

export type KalshiLiveKillSwitchState = {
  active: boolean;
  reason: string;
  source: "operator" | "safety" | "system";
  updatedAt: string;
};

export type KalshiLiveOrderIntent = {
  clientOrderId: string;
  createdAt: string;
  updatedAt: string;
  status: KalshiLiveIntentStatus;
  runId: string;
  genomeId: string;
  marketTicker: string;
  side: "yes" | "no";
  action: "buy" | "sell";
  signalAt: string;
  price: number;
  count: number;
  notionalUsd: number;
  reduceOnly: boolean;
  reason: string;
  remoteOrderId?: string;
  remoteStatus?: string;
  rawRemote?: Record<string, unknown>;
  error?: string;
};

export type KalshiLiveReconciliationRun = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  mismatchCount: number;
  localOrderCount: number;
  remoteOrderCount: number;
  remotePositionCount: number;
  remoteExposureUsd: number;
  remotePositions: KalshiPosition[];
  balanceUsd: number | null;
  errors: string[];
};

export type KalshiLiveStatus = {
  generatedAt: string;
  tradingEnabled: boolean;
  storage: {
    mode: ReturnType<typeof storageMode>;
    durable: boolean;
    liveReady: boolean;
  };
  killSwitch: KalshiLiveKillSwitchState & {
    envActive: boolean;
    effectiveActive: boolean;
  };
  safetyHalt: KalshiLiveKillSwitchState | null;
  feed: {
    latestEventAt: string | null;
    ageMs: number | null;
    maxAgeMs: number;
    stale: boolean;
    marketTicker: string | null;
  };
  reconciliation: {
    latest: KalshiLiveReconciliationRun | null;
    ageMs: number | null;
    maxAgeMs: number;
    stale: boolean;
  };
  exposure: {
    openUsd: number;
    pendingOrderUsd: number;
    remotePositionUsd: number;
    maxOpenUsd: number;
    maxOrderUsd: number;
  };
  remotePositions: KalshiPosition[];
  recentIntents: KalshiLiveOrderIntent[];
  blockers: string[];
};

type LiveDocument = {
  version: 1;
  killSwitch: KalshiLiveKillSwitchState | null;
  safetyHalt: KalshiLiveKillSwitchState | null;
  latestHeartbeatAt: string | null;
  latestReconciliation: KalshiLiveReconciliationRun | null;
  intents: Record<string, KalshiLiveOrderIntent>;
};

type RemoteOrder = {
  order_id?: string;
  id?: string;
  client_order_id?: string;
  status?: string;
  ticker?: string;
  market_ticker?: string;
  side?: "yes" | "no";
  action?: "buy" | "sell";
};

type RemoteOrdersResponse = {
  orders?: RemoteOrder[];
};

type RemoteBalanceResponse = {
  balance?: number;
  portfolio_value?: number;
};

type RemotePositionsResponse = {
  market_positions?: KalshiPosition[];
};

const LIVE_NAMESPACE = "kalshi-live";
const LIVE_FILE = "kalshi-live-state.json";
const LIVE_CLIENT_ORDER_ID_PREFIX = "kq_";
let localLiveQueue = Promise.resolve();

function envTrim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const normalized = raw.trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(normalized);
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function defaultDocument(): LiveDocument {
  return {
    version: 1,
    killSwitch: null,
    safetyHalt: null,
    latestHeartbeatAt: null,
    latestReconciliation: null,
    intents: {},
  };
}

function normalizeDocument(value: unknown): LiveDocument {
  const raw = typeof value === "object" && value !== null ? (value as Partial<LiveDocument>) : {};
  return {
    version: 1,
    killSwitch: raw.killSwitch ?? null,
    safetyHalt: raw.safetyHalt ?? null,
    latestHeartbeatAt: typeof raw.latestHeartbeatAt === "string" ? raw.latestHeartbeatAt : null,
    latestReconciliation: raw.latestReconciliation ?? null,
    intents: raw.intents ?? {},
  };
}

async function readLiveDocument(): Promise<LiveDocument> {
  return readDocument(LIVE_NAMESPACE, LIVE_FILE, defaultDocument(), normalizeDocument);
}

async function writeLiveDocument(doc: LiveDocument): Promise<void> {
  await writeDocument(LIVE_NAMESPACE, LIVE_FILE, doc);
}

function enqueueLocal<T>(work: () => Promise<T>): Promise<T> {
  const next = localLiveQueue.then(work, work);
  localLiveQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
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

export function kalshiLiveClientOrderId(parts: {
  runId: string;
  genomeId: string;
  marketTicker: string;
  side: string;
  action: string;
  signalAt: string;
}): string {
  return `${LIVE_CLIENT_ORDER_ID_PREFIX}${createHash("sha256").update(stableStringify(parts)).digest("base64url").slice(0, 42)}`;
}

function isKalshiLiveClientOrderId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(LIVE_CLIENT_ORDER_ID_PREFIX);
}

function cents(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value * 100)));
}

function rawStatusToLocal(status: string | undefined): KalshiLiveIntentStatus {
  const s = (status ?? "").toLowerCase();
  if (s.includes("fill") || s === "executed") return "filled";
  if (s.includes("partial")) return "partial";
  if (s.includes("cancel")) return "canceled";
  if (s.includes("reject")) return "rejected";
  if (s.includes("rest") || s.includes("open") || s.includes("pending")) return "resting";
  return "submitted";
}

function numberFrom(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dollarsFromCents(value: unknown): number | null {
  const n = numberFrom(value);
  return n == null ? null : n / 100;
}

export function kalshiLiveConfig() {
  return {
    tradingEnabled: envFlag("KALSHI_LIVE_TRADING_ENABLED", false),
    envKillSwitchActive: envFlag("KALSHI_LIVE_KILL_SWITCH", true),
    maxOpenUsd: envNumber("KALSHI_LIVE_MAX_OPEN_USD", 100),
    maxOrderUsd: envNumber("KALSHI_LIVE_MAX_ORDER_USD", 25),
    orderSizeMultiplier: envNumber("KALSHI_LIVE_ORDER_SIZE_MULTIPLIER", 0.2),
    maxFeedAgeMs: envNumber("KALSHI_LIVE_MAX_FEED_AGE_MS", 45_000),
    maxReconciliationAgeMs: envNumber("KALSHI_LIVE_MAX_RECONCILIATION_AGE_MS", 60_000),
    seriesTicker: envTrim(process.env.KALSHI_RL_SERIES) || "KXBTC15M",
    requireDurableStorage: process.env.NODE_ENV !== "test",
  };
}

export async function setKalshiLiveKillSwitch(input: {
  active: boolean;
  reason: string;
  source?: KalshiLiveKillSwitchState["source"];
}): Promise<KalshiLiveKillSwitchState> {
  const state: KalshiLiveKillSwitchState = {
    active: input.active,
    reason: input.reason.trim() || (input.active ? "Kill switch active." : "Kill switch cleared."),
    source: input.source ?? "operator",
    updatedAt: nowIso(),
  };
  const doc = await readLiveDocument();
  doc.killSwitch = state;
  await writeLiveDocument(doc);
  if (state.active) await cancelRestingLiveOrders(state.reason);
  await appendLedger({
    type: "observation",
    source: "kalshi",
    payload: { kind: "kalshi_live_kill_switch", state },
  });
  return state;
}

async function cancelRestingLiveOrders(reason: string): Promise<void> {
  const cancellable = new Set<KalshiLiveIntentStatus>(["submitted", "resting", "partial", "unknown"]);
  const intents = (await readIntents(200)).filter(
    (intent) =>
      isKalshiLiveClientOrderId(intent.clientOrderId) &&
      intent.remoteOrderId &&
      cancellable.has(intent.status),
  );
  for (const intent of intents) {
    try {
      await kalshiApiDelete(`/trade-api/v2/portfolio/orders/${encodeURIComponent(intent.remoteOrderId ?? "")}`);
      await updateIntent({
        ...intent,
        status: "canceled",
        error: `Canceled by live kill switch: ${reason}`,
      });
    } catch (error) {
      await updateIntent({
        ...intent,
        status: "unknown",
        error: error instanceof Error ? error.message : "Unknown Kalshi cancel error.",
      });
    }
  }
}

async function setSafetyHalt(reason: string): Promise<KalshiLiveKillSwitchState> {
  const halt: KalshiLiveKillSwitchState = {
    active: true,
    reason,
    source: "safety",
    updatedAt: nowIso(),
  };
  const doc = await readLiveDocument();
  doc.safetyHalt = halt;
  await writeLiveDocument(doc);
  return halt;
}

async function clearSafetyHaltIfHealthy(): Promise<void> {
  const doc = await readLiveDocument();
  if (doc.safetyHalt?.source !== "safety") return;
  doc.safetyHalt = null;
  await writeLiveDocument(doc);
}

async function upsertIntent(intent: KalshiLiveOrderIntent): Promise<KalshiLiveOrderIntent> {
  if (storageMode() === "postgres") {
    const rows = await pgQuery<{ intent: KalshiLiveOrderIntent }>(
      `insert into quant_kalshi_live_intents (
         client_order_id, intent, status, created_at, updated_at
       )
       values ($1, $2::jsonb, $3, $4, $5)
       on conflict (client_order_id) do nothing
       returning intent`,
      [
        intent.clientOrderId,
        JSON.stringify(intent),
        intent.status,
        intent.createdAt,
        intent.updatedAt,
      ],
    );
    if (rows[0]) return rows[0].intent;
    const existing = await pgQuery<{ intent: KalshiLiveOrderIntent }>(
      "select intent from quant_kalshi_live_intents where client_order_id = $1",
      [intent.clientOrderId],
    );
    return existing[0]?.intent ?? intent;
  }

  return enqueueLocal(async () => {
    const doc = await readLiveDocument();
    const existing = doc.intents[intent.clientOrderId];
    if (existing) return existing;
    doc.intents[intent.clientOrderId] = intent;
    await writeLiveDocument(doc);
    return intent;
  });
}

async function updateIntent(intent: KalshiLiveOrderIntent): Promise<KalshiLiveOrderIntent> {
  const updated = { ...intent, updatedAt: nowIso() };
  if (storageMode() === "postgres") {
    await pgQuery(
      `update quant_kalshi_live_intents
       set intent = $2::jsonb, status = $3, updated_at = $4
       where client_order_id = $1`,
      [updated.clientOrderId, JSON.stringify(updated), updated.status, updated.updatedAt],
    );
    return updated;
  }

  return enqueueLocal(async () => {
    const doc = await readLiveDocument();
    doc.intents[updated.clientOrderId] = updated;
    await writeLiveDocument(doc);
    return updated;
  });
}

async function readIntents(limit = 100): Promise<KalshiLiveOrderIntent[]> {
  if (storageMode() === "postgres") {
    const rows = await pgQuery<{ intent: KalshiLiveOrderIntent }>(
      `select intent
       from quant_kalshi_live_intents
       order by updated_at desc
       limit $1`,
      [Math.max(1, limit)],
    );
    return rows.map((row) => row.intent);
  }
  const doc = await readLiveDocument();
  return Object.values(doc.intents)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, limit);
}

function pendingOrderExposureUsd(intents: KalshiLiveOrderIntent[]): number {
  const pendingStatuses = new Set<KalshiLiveIntentStatus>([
    "planned",
    "submitted",
    "resting",
    "partial",
    "unknown",
  ]);
  return intents
    .filter((intent) => intent.action === "buy" && pendingStatuses.has(intent.status))
    .reduce((sum, intent) => sum + Math.max(0, intent.notionalUsd), 0);
}

function dollarsText(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function remotePositionExposureUsd(positions: KalshiPosition[]): number {
  return positions.reduce((sum, position) => {
    return sum + Math.abs(dollarsText(position.market_exposure_dollars));
  }, 0);
}

async function recordHeartbeat(at: string): Promise<void> {
  const doc = await readLiveDocument();
  doc.latestHeartbeatAt = at;
  await writeLiveDocument(doc);
}

async function recordReconciliation(run: KalshiLiveReconciliationRun): Promise<void> {
  const doc = await readLiveDocument();
  doc.latestReconciliation = run;
  await writeLiveDocument(doc);
  if (storageMode() === "postgres") {
    await pgQuery(
      `insert into quant_kalshi_live_reconciliation_runs (
         run_id, started_at, finished_at, ok, mismatch_count, run
       )
       values ($1, $2, $3, $4, $5, $6::jsonb)
       on conflict (run_id) do nothing`,
      [
        run.runId,
        run.startedAt,
        run.finishedAt,
        run.ok,
        run.mismatchCount,
        JSON.stringify(run),
      ],
    );
  }
}

export async function fetchKalshiLiveMarketTick(): Promise<KalshiOrderbookEvent> {
  const cfg = kalshiLiveConfig();
  const apiBase = process.env.KALSHI_API_BASE ?? "https://api.elections.kalshi.com/trade-api/v2";
  const url = new URL(`${apiBase}/markets`);
  url.searchParams.set("series_ticker", cfg.seriesTicker);
  url.searchParams.set("status", "open");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Kalshi market feed failed (${res.status})`);
  const json = (await res.json()) as { markets?: Array<Record<string, unknown>> };
  const active = (json.markets ?? [])
    .filter((market) => typeof market.ticker === "string")
    .sort((a, b) => Date.parse(String(a.close_time ?? "")) - Date.parse(String(b.close_time ?? "")))[0];
  if (!active) throw new Error(`No open ${cfg.seriesTicker} market returned by Kalshi.`);
  const raw: KalshiScreenTickInput = {
    receivedAt: new Date().toISOString(),
    marketTicker: active.ticker,
    seriesTicker: cfg.seriesTicker,
    windowOpenTime: active.open_time,
    windowCloseTime: active.close_time,
    targetPrice: active.floor_strike,
    yesAsk: active.yes_ask_dollars,
    noAsk: active.no_ask_dollars,
    chance: active.last_price_dollars,
    source: "kalshi-rest-market",
  };
  const tick = normalizeKalshiOrderbookEvent(raw);
  if (!tick) throw new Error("Kalshi market tick could not be normalized.");
  return tick;
}

function quotePrice(quote: KalshiOrderbookEvent, side: "yes" | "no"): number | null {
  return side === "yes" ? quote.yesAsk : quote.noAsk;
}

function validQuoteForOrder(quote: KalshiOrderbookEvent, maxFeedAgeMs: number, now = new Date()): string | null {
  const age = now.getTime() - Date.parse(quote.receivedAt);
  if (!Number.isFinite(age) || age < 0 || age > maxFeedAgeMs) return "feed-stale";
  if (quote.yesAsk == null || quote.noAsk == null || quote.yesAsk <= 0 || quote.noAsk <= 0) return "invalid-quote";
  if (!quote.windowCloseTime || Date.parse(quote.windowCloseTime) <= now.getTime()) return "market-closed";
  return null;
}

function candidateFromPosition(args: {
  runId: string;
  genome: GeneticPolicyGenome;
  position: KalshiPaperRlOpenPosition;
  quote: KalshiOrderbookEvent;
  maxOrderUsd: number;
  orderSizeMultiplier: number;
}): KalshiLiveOrderIntent | null {
  const side = args.position.side;
  if (side !== "yes" && side !== "no") return null;
  const price = quotePrice(args.quote, side);
  if (price == null || price <= 0 || price >= 1) return null;
  const notionalUsd = Number((args.position.costBasisUsd * args.orderSizeMultiplier).toFixed(2));
  if (notionalUsd <= 0 || notionalUsd > args.maxOrderUsd) return null;
  const count = Math.max(1, Math.floor(notionalUsd / price));
  const signalAt = args.position.openedAt || args.quote.receivedAt;
  const clientOrderId = kalshiLiveClientOrderId({
    runId: args.runId,
    genomeId: args.genome.genomeId,
    marketTicker: args.position.marketTicker,
    side,
    action: "buy",
    signalAt,
  });
  const at = nowIso();
  return {
    clientOrderId,
    createdAt: at,
    updatedAt: at,
    status: "planned",
    runId: args.runId,
    genomeId: args.genome.genomeId,
    marketTicker: args.position.marketTicker,
    side,
    action: "buy",
    signalAt,
    price,
    count,
    notionalUsd,
    reduceOnly: false,
    reason: `Validated genome ${args.genome.genomeId} opened a paper-live ${side} position.`,
  };
}

function buildCandidates(summary: Awaited<ReturnType<typeof readKalshiRlSummary>>, quote: KalshiOrderbookEvent): KalshiLiveOrderIntent[] {
  const lastRun = summary.lastRun as GeneticTrainingRun | null;
  const runId = lastRun?.runId ?? "live";
  const rows = summary.liveLeaderboard ?? lastRun?.leaderboard ?? [];
  const candidates: KalshiLiveOrderIntent[] = [];
  const cfg = kalshiLiveConfig();
  for (const row of rows) {
    if (!row.contributesToPerformance) continue;
    for (const position of row.openPositions ?? []) {
      const candidate = candidateFromPosition({
        runId,
        genome: row.genome,
        position,
        quote,
        maxOrderUsd: cfg.maxOrderUsd,
        orderSizeMultiplier: cfg.orderSizeMultiplier,
      });
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

async function submitKalshiOrder(intent: KalshiLiveOrderIntent): Promise<KalshiLiveOrderIntent> {
  const body: Record<string, unknown> = {
    ticker: intent.marketTicker,
    client_order_id: intent.clientOrderId,
    action: intent.action,
    side: intent.side,
    type: "limit",
    count: intent.count,
  };
  body[intent.side === "yes" ? "yes_price" : "no_price"] = cents(intent.price);

  try {
    const res = await kalshiApiPost<{ order?: RemoteOrder }>("/trade-api/v2/portfolio/orders", body);
    const order = res.order ?? {};
    return updateIntent({
      ...intent,
      status: rawStatusToLocal(order.status),
      remoteOrderId: order.order_id ?? order.id,
      remoteStatus: order.status,
      rawRemote: order as Record<string, unknown>,
    });
  } catch (error) {
    const status = typeof error === "object" && error !== null ? Number((error as { status?: unknown }).status) : null;
    if (status === 409) {
      const reconciled = await reconcileClientOrder(intent.clientOrderId);
      return updateIntent({
        ...intent,
        status: reconciled?.status ?? "unknown",
        remoteOrderId: reconciled?.remoteOrderId,
        remoteStatus: reconciled?.remoteStatus,
        rawRemote: reconciled?.rawRemote,
        error: "Kalshi reported duplicate client_order_id; reconciled existing order.",
      });
    }
    return updateIntent({
      ...intent,
      status: "unknown",
      error: error instanceof Error ? error.message : "Unknown Kalshi order submission error.",
    });
  }
}

async function reconcileClientOrder(clientOrderId: string): Promise<KalshiLiveOrderIntent | null> {
  const orders = await fetchRemoteOrders(clientOrderId).catch(() => []);
  const remote = orders.find((order) => order.client_order_id === clientOrderId);
  if (!remote) return null;
  return {
    clientOrderId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    status: rawStatusToLocal(remote.status),
    runId: "remote",
    genomeId: "remote",
    marketTicker: remote.ticker ?? remote.market_ticker ?? "unknown",
    side: remote.side ?? "yes",
    action: remote.action ?? "buy",
    signalAt: nowIso(),
    price: 0,
    count: 0,
    notionalUsd: 0,
    reduceOnly: false,
    reason: "Remote order reconciled by client_order_id.",
    remoteOrderId: remote.order_id ?? remote.id,
    remoteStatus: remote.status,
    rawRemote: remote as Record<string, unknown>,
  };
}

async function fetchRemoteOrders(clientOrderId?: string): Promise<RemoteOrder[]> {
  const url = new URL("http://local/trade-api/v2/portfolio/orders");
  url.searchParams.set("limit", "100");
  if (clientOrderId) url.searchParams.set("client_order_id", clientOrderId);
  const path = `${url.pathname}?${url.searchParams.toString()}`;
  const res = await kalshiApiGet<RemoteOrdersResponse>(path);
  return res.orders ?? [];
}

async function fetchRemotePositions(): Promise<KalshiPosition[]> {
  const res = await kalshiApiGet<RemotePositionsResponse>(
    "/trade-api/v2/portfolio/positions?limit=100&count_filter=position&settlement_status=unsettled",
  );
  return res.market_positions ?? [];
}

async function fetchRemoteBalanceUsd(): Promise<number | null> {
  const res = await kalshiApiGet<RemoteBalanceResponse>("/trade-api/v2/portfolio/balance");
  return dollarsFromCents(res.balance ?? res.portfolio_value);
}

export async function runKalshiLiveReconciliation(): Promise<KalshiLiveReconciliationRun> {
  const startedAt = nowIso();
  const runId = `kalshi-live-reconcile-${Date.now().toString(36)}`;
  const errors: string[] = [];
  const local = await readIntents(500);
  let remoteOrders: RemoteOrder[] = [];
  let remotePositions: KalshiPosition[] = [];
  let balanceUsd: number | null = null;

  try {
    [remoteOrders, remotePositions, balanceUsd] = await Promise.all([
      fetchRemoteOrders(),
      fetchRemotePositions(),
      fetchRemoteBalanceUsd(),
    ]);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unknown Kalshi reconciliation error.");
  }

  const liveLocal = local.filter((intent) => isKalshiLiveClientOrderId(intent.clientOrderId));
  const liveRemoteOrders = remoteOrders.filter((order) => isKalshiLiveClientOrderId(order.client_order_id));
  const remoteByClient = new Map(liveRemoteOrders.map((order) => [order.client_order_id, order]));
  let mismatchCount = errors.length;
  for (const intent of liveLocal) {
    const terminal = new Set<KalshiLiveIntentStatus>(["skipped", "filled", "canceled", "rejected"]);
    const remote = remoteByClient.get(intent.clientOrderId);
    if (!remote && !terminal.has(intent.status)) {
      mismatchCount += 1;
      continue;
    }
    if (remote) {
      const nextStatus = rawStatusToLocal(remote.status);
      if (nextStatus !== intent.status || intent.remoteStatus !== remote.status) {
        await updateIntent({
          ...intent,
          status: nextStatus,
          remoteOrderId: remote.order_id ?? remote.id,
          remoteStatus: remote.status,
          rawRemote: remote as Record<string, unknown>,
        });
      }
    }
  }

  const localClientIds = new Set(liveLocal.map((intent) => intent.clientOrderId));
  for (const remote of liveRemoteOrders) {
    const clientOrderId = remote.client_order_id;
    if (!isKalshiLiveClientOrderId(clientOrderId)) continue;
    if (localClientIds.has(clientOrderId)) continue;
    mismatchCount += 1;
    await upsertIntent({
      clientOrderId,
      createdAt: startedAt,
      updatedAt: startedAt,
      status: "orphan_remote",
      runId: "remote",
      genomeId: "remote",
      marketTicker: remote.ticker ?? remote.market_ticker ?? "unknown",
      side: remote.side ?? "yes",
      action: remote.action ?? "buy",
      signalAt: startedAt,
      price: 0,
      count: 0,
      notionalUsd: 0,
      reduceOnly: false,
      reason: "Remote Kalshi order did not match a local live intent.",
      remoteOrderId: remote.order_id ?? remote.id,
      remoteStatus: remote.status,
      rawRemote: remote as Record<string, unknown>,
    });
  }

  const run: KalshiLiveReconciliationRun = {
    runId,
    startedAt,
    finishedAt: nowIso(),
    ok: mismatchCount === 0,
    mismatchCount,
    localOrderCount: liveLocal.length,
    remoteOrderCount: liveRemoteOrders.length,
    remotePositionCount: remotePositions.length,
    remoteExposureUsd: remotePositionExposureUsd(remotePositions),
    remotePositions,
    balanceUsd,
    errors,
  };
  await recordReconciliation(run);
  if (!run.ok) await setSafetyHalt(`Kalshi live reconciliation mismatch count ${mismatchCount}.`);
  else await clearSafetyHaltIfHealthy();
  await appendLedger({
    type: "observation",
    source: "kalshi",
    payload: { kind: "kalshi_live_reconciliation", run },
  });
  return run;
}

export async function readKalshiLiveStatus(): Promise<KalshiLiveStatus> {
  const cfg = kalshiLiveConfig();
  const doc = await readLiveDocument();
  const recentIntents = (await readIntents(100))
    .filter((intent) => isKalshiLiveClientOrderId(intent.clientOrderId))
    .slice(0, 20);
  const liveIntents = (await readIntents(500)).filter((intent) => isKalshiLiveClientOrderId(intent.clientOrderId));
  const remotePositions = doc.latestReconciliation?.remotePositions ?? [];
  const pendingOrderUsd = pendingOrderExposureUsd(liveIntents);
  const remotePositionUsd = doc.latestReconciliation?.remoteExposureUsd ?? remotePositionExposureUsd(remotePositions);
  const latestEvent =
    (await readKalshiOrderbookEvents({
      limit: 1,
      seriesTicker: cfg.seriesTicker,
    })).at(-1) ?? null;
  const now = Date.now();
  const feedAgeMs = latestEvent ? now - Date.parse(latestEvent.receivedAt) : null;
  const reconciliationAgeMs = doc.latestReconciliation ? now - Date.parse(doc.latestReconciliation.finishedAt) : null;
  const dbKill = doc.killSwitch ?? {
    active: false,
    reason: "No operator kill switch state recorded.",
    source: "system" as const,
    updatedAt: new Date(0).toISOString(),
  };
  const effectiveKill = cfg.envKillSwitchActive || dbKill.active || Boolean(doc.safetyHalt?.active);
  const blockers: string[] = [];
  if (!cfg.tradingEnabled) blockers.push("trading-disabled");
  if (effectiveKill) blockers.push("kill-switch");
  if (storageMode() !== "postgres" && cfg.tradingEnabled && cfg.requireDurableStorage) {
    blockers.push("non-durable-storage");
  }
  if (feedAgeMs == null || feedAgeMs < 0 || feedAgeMs > cfg.maxFeedAgeMs) blockers.push("feed-stale");
  if (reconciliationAgeMs == null || reconciliationAgeMs < 0 || reconciliationAgeMs > cfg.maxReconciliationAgeMs) {
    blockers.push("reconciliation-stale");
  }

  return {
    generatedAt: nowIso(),
    tradingEnabled: cfg.tradingEnabled,
    storage: {
      mode: storageMode(),
      durable: storageMode() === "postgres",
      liveReady: storageMode() === "postgres" || !cfg.tradingEnabled,
    },
    killSwitch: {
      ...dbKill,
      envActive: cfg.envKillSwitchActive,
      effectiveActive: effectiveKill,
    },
    safetyHalt: doc.safetyHalt,
    feed: {
      latestEventAt: latestEvent?.receivedAt ?? null,
      ageMs: feedAgeMs,
      maxAgeMs: cfg.maxFeedAgeMs,
      stale: feedAgeMs == null || feedAgeMs < 0 || feedAgeMs > cfg.maxFeedAgeMs,
      marketTicker: latestEvent?.marketTicker ?? null,
    },
    reconciliation: {
      latest: doc.latestReconciliation,
      ageMs: reconciliationAgeMs,
      maxAgeMs: cfg.maxReconciliationAgeMs,
      stale:
        reconciliationAgeMs == null ||
        reconciliationAgeMs < 0 ||
        reconciliationAgeMs > cfg.maxReconciliationAgeMs,
    },
    exposure: {
      openUsd: pendingOrderUsd + remotePositionUsd,
      pendingOrderUsd,
      remotePositionUsd,
      maxOpenUsd: cfg.maxOpenUsd,
      maxOrderUsd: cfg.maxOrderUsd,
    },
    remotePositions,
    recentIntents,
    blockers,
  };
}

export async function runKalshiLiveTick(): Promise<{
  ok: boolean;
  generatedAt: string;
  tick: KalshiOrderbookEvent | null;
  reconciliation: KalshiLiveReconciliationRun | null;
  submitted: KalshiLiveOrderIntent[];
  skipped: KalshiLiveOrderIntent[];
  status: KalshiLiveStatus;
}> {
  let tick: KalshiOrderbookEvent | null = null;
  const submitted: KalshiLiveOrderIntent[] = [];
  const skipped: KalshiLiveOrderIntent[] = [];
  const cfg = kalshiLiveConfig();

  try {
    tick = await fetchKalshiLiveMarketTick();
    await appendKalshiOrderbookEvents([tick]);
    await recordHeartbeat(tick.receivedAt);
  } catch (error) {
    await setSafetyHalt(error instanceof Error ? error.message : "Kalshi live feed failed.");
  }

  const reconciliation = await runKalshiLiveReconciliation().catch(async (error) => {
    await setSafetyHalt(error instanceof Error ? error.message : "Kalshi reconciliation failed.");
    return null;
  });

  const statusBeforeOrders = await readKalshiLiveStatus();
  if (!tick || statusBeforeOrders.blockers.length) {
    return {
      ok: true,
      generatedAt: nowIso(),
      tick,
      reconciliation,
      submitted,
      skipped,
      status: await readKalshiLiveStatus(),
    };
  }

  const quoteProblem = validQuoteForOrder(tick, cfg.maxFeedAgeMs);
  if (quoteProblem) {
    await setSafetyHalt(`Kalshi live order blocked: ${quoteProblem}.`);
    return {
      ok: true,
      generatedAt: nowIso(),
      tick,
      reconciliation,
      submitted,
      skipped,
      status: await readKalshiLiveStatus(),
    };
  }

  const summary = await readKalshiRlSummary();
  const candidates = buildCandidates(summary, tick);
  let exposure = statusBeforeOrders.exposure.openUsd;
  for (const candidate of candidates) {
    if (exposure + candidate.notionalUsd > cfg.maxOpenUsd) {
      skipped.push(await updateIntent({ ...(await upsertIntent(candidate)), status: "skipped", error: "max-open-exposure" }));
      continue;
    }
    const intent = await upsertIntent(candidate);
    if (intent.status !== "planned") continue;
    const result = await submitKalshiOrder(intent);
    submitted.push(result);
    exposure += result.notionalUsd;
  }

  return {
    ok: true,
    generatedAt: nowIso(),
    tick,
    reconciliation,
    submitted,
    skipped,
    status: await readKalshiLiveStatus(),
  };
}

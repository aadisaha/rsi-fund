import "server-only";

import { appendLedger } from "@/lib/ledger";
import { readKalshiOrderbookEvents } from "@/lib/kalshi-orderbook";
import { pgQuery, readDocument, storageMode, writeDocument } from "@/lib/storage";
import type {
  GeneticPolicyGenome,
  GeneticTrainingRun,
  KalshiRlAgentTier,
  KalshiOrderbookEvent,
  KalshiPaperRlOpenPosition,
  KalshiPaperRlPerformance,
  KalshiPaperRlTrade,
  KalshiRlEliteArchiveEntry,
  KalshiRlEliteTag,
  KalshiRlGenerationComparison,
  KalshiRlGenerationStats,
  KalshiRlChampion,
  KalshiRlSummary,
} from "@/lib/types";

const RL_NAMESPACE = "kalshi-rl";
const CHAMPION_FILE = "kalshi-rl-champion.json";
const LAST_RUN_FILE = "kalshi-rl-last-run.json";
const RUN_HISTORY_FILE = "kalshi-rl-run-history.json";
const ELITE_ARCHIVE_FILE = "kalshi-rl-elite-archive.json";
const LIVE_LEADERBOARD_SIZE = 32;
const DEFAULT_VALIDATED_PNL_USD = 20;
const ELITE_SEED_SIZE = 24;
const ELITE_VISIBLE_SIZE = 12;
const REWARD_EXPERIMENTS = [
  {
    id: "early",
    name: "Vega",
    note: "profitable early entries below 90c",
  },
  {
    id: "pulse",
    name: "Quinn",
    note: "more valid entries and moderate exposure",
  },
  {
    id: "scout",
    name: "Navarro",
    note: "cheap profitable entries with stronger low-price curve",
  },
  {
    id: "stride",
    name: "Iyer",
    note: "trade efficiency and ROI quality",
  },
  {
    id: "anchor",
    name: "Sloan",
    note: "lower drawdown and cleaner exits",
  },
  {
    id: "spark",
    name: "Marquez",
    note: "higher exploration pressure with tighter loss penalties",
  },
] as const;

type RewardExperimentId = (typeof REWARD_EXPERIMENTS)[number]["id"];

type RewardProfile = {
  pnlPositiveMultiplier: number;
  pnlNegativeMultiplier: number;
  entryBonusPerTrade: number;
  entryBonusCap: number;
  noTradePenalty: number;
  exposureBonusRate: number;
  exposureBonusCap: number;
  efficiencyMultiplier: number;
  efficiencyCap: number;
  efficiencyFloor: number;
  earlyEntryTotalCap: number;
  earlyEntryPerTradeCap: number;
  earlyEntryCurve: number;
  drawdownMultiplier: number;
  churnPerTrade: number;
  unresolvedPenalty: number;
};

const DEFAULT_REWARD_PROFILE: RewardProfile = {
  pnlPositiveMultiplier: 25,
  pnlNegativeMultiplier: 35,
  entryBonusPerTrade: 0.03,
  entryBonusCap: 0.25,
  noTradePenalty: -0.25,
  exposureBonusRate: 0.001,
  exposureBonusCap: 0.15,
  efficiencyMultiplier: 2,
  efficiencyCap: 0.25,
  efficiencyFloor: -0.25,
  earlyEntryTotalCap: 2,
  earlyEntryPerTradeCap: 0.35,
  earlyEntryCurve: 2.2,
  drawdownMultiplier: 1.25,
  churnPerTrade: 0.015,
  unresolvedPenalty: 2.5,
};

const REWARD_PROFILE_BY_EXPERIMENT: Record<RewardExperimentId, RewardProfile> = {
  early: {
    ...DEFAULT_REWARD_PROFILE,
    earlyEntryTotalCap: 2.4,
    earlyEntryPerTradeCap: 0.42,
    earlyEntryCurve: 2.6,
  },
  pulse: {
    ...DEFAULT_REWARD_PROFILE,
    entryBonusPerTrade: 0.065,
    entryBonusCap: 0.65,
    noTradePenalty: -0.5,
    exposureBonusRate: 0.002,
    exposureBonusCap: 0.45,
    churnPerTrade: 0.022,
    drawdownMultiplier: 1.4,
    pnlNegativeMultiplier: 38,
  },
  scout: {
    ...DEFAULT_REWARD_PROFILE,
    earlyEntryTotalCap: 3,
    earlyEntryPerTradeCap: 0.7,
    earlyEntryCurve: 3.4,
    entryBonusPerTrade: 0.035,
    entryBonusCap: 0.3,
    noTradePenalty: -0.35,
    pnlNegativeMultiplier: 40,
  },
  stride: {
    ...DEFAULT_REWARD_PROFILE,
    efficiencyMultiplier: 6,
    efficiencyCap: 1.25,
    efficiencyFloor: -1,
    entryBonusPerTrade: 0.02,
    entryBonusCap: 0.18,
    pnlPositiveMultiplier: 26,
    pnlNegativeMultiplier: 42,
  },
  anchor: {
    ...DEFAULT_REWARD_PROFILE,
    entryBonusPerTrade: 0.018,
    entryBonusCap: 0.16,
    noTradePenalty: -0.2,
    drawdownMultiplier: 2.1,
    churnPerTrade: 0.03,
    pnlPositiveMultiplier: 27,
    pnlNegativeMultiplier: 45,
  },
  spark: {
    ...DEFAULT_REWARD_PROFILE,
    entryBonusPerTrade: 0.08,
    entryBonusCap: 0.85,
    noTradePenalty: -0.65,
    exposureBonusRate: 0.003,
    exposureBonusCap: 0.8,
    efficiencyMultiplier: 3.5,
    efficiencyCap: 0.75,
    efficiencyFloor: -0.75,
    drawdownMultiplier: 1.8,
    churnPerTrade: 0.028,
    pnlNegativeMultiplier: 46,
  },
};

type EvalResult = {
  genome: GeneticPolicyGenome;
  reward: number;
  pnlUsd: number;
  trades: KalshiPaperRlTrade[];
  openPositions: KalshiPaperRlOpenPosition[];
  drawdownUsd: number;
  unresolved: number;
};

type LineageStats = {
  pnlLast4: number;
  pnlLast10: number;
  generationsSeen: number;
  deprecatedReason?: string;
};

type ArchiveCandidate = {
  genome: GeneticPolicyGenome;
  reward: number;
  pnlUsd: number;
  trades: number;
  status?: GeneticTrainingRun["leaderboard"][number]["status"];
  runId: string;
  generatedAt: string;
};

type PaperConfig = {
  seriesTicker: string;
  bankrollUsd: number;
  maxMarketUsd: number;
  maxOpenUsd: number;
  populationSize: number;
};

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function config(): PaperConfig {
  return {
    seriesTicker: process.env.KALSHI_RL_SERIES?.trim() || "KXBTC15M",
    bankrollUsd: envNumber("KALSHI_RL_BANKROLL_USD", 1_000),
    maxMarketUsd: envNumber("KALSHI_RL_MAX_MARKET_USD", 25),
    maxOpenUsd: envNumber("KALSHI_RL_MAX_OPEN_USD", 100),
    populationSize: Math.max(4, Math.min(512, Math.round(envNumber("KALSHI_RL_POPULATION", 64)))),
  };
}

function validatedPnlThresholdUsd(): number {
  return envNumber("KALSHI_RL_VALIDATED_PNL_USD", DEFAULT_VALIDATED_PNL_USD);
}

function validQuoteEvent(event: KalshiOrderbookEvent): boolean {
  return (
    event.yesAsk != null &&
    event.noAsk != null &&
    event.yesAsk > 0 &&
    event.noAsk > 0 &&
    event.yesAsk <= 1 &&
    event.noAsk <= 1
  );
}

function marketUrlForTicker(marketTicker: string): string | null {
  const eventTicker = marketTicker.replace(/-\d+$/, "").toLowerCase();
  if (!eventTicker.startsWith("kxbtc15m-")) return null;
  return `https://kalshi.com/markets/kxbtc15m/bitcoin-price-up-down/${eventTicker}`;
}

function hashSeed(raw: string): number {
  let h = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function between(rand: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rand();
}

function intBetween(rand: () => number, lo: number, hi: number): number {
  return Math.round(between(rand, lo, hi));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function makeGenome(rand: () => number, prefix: string): GeneticPolicyGenome {
  const entry = between(rand, 0.006, 0.055);
  return {
    genomeId: `${prefix}-${Math.round(rand() * 1e9).toString(36)}`,
    parentGenomeIds: [],
    generation: 1,
    entryThreshold: Number(entry.toFixed(4)),
    exitThreshold: Number(between(rand, 0.001, Math.max(0.004, entry * 0.8)).toFixed(4)),
    maxHoldSeconds: intBetween(rand, 90, 720),
    momentumWindow: intBetween(rand, 3, 28),
    spreadCap: Number(between(rand, 0.015, 0.14).toFixed(4)),
    depthFloor: intBetween(rand, 1, 250),
    minSecondsToClose: intBetween(rand, 10, 90),
    maxSecondsToClose: intBetween(rand, 240, 900),
    stopLoss: Number(between(rand, 0.04, 0.32).toFixed(4)),
    takeProfit: Number(between(rand, 0.04, 0.45).toFixed(4)),
    positionSizeFraction: Number(between(rand, 0.004, 0.035).toFixed(4)),
  };
}

function mutateGenome(parent: GeneticPolicyGenome, rand: () => number, prefix: string): GeneticPolicyGenome {
  const wobble = (value: number, pct: number, lo: number, hi: number) =>
    Number(clamp(value * (1 + between(rand, -pct, pct)), lo, hi).toFixed(4));
  return {
    genomeId: `${prefix}-${Math.round(rand() * 1e9).toString(36)}`,
    parentGenomeIds: [parent.genomeId],
    generation: (parent.generation ?? 1) + 1,
    entryThreshold: wobble(parent.entryThreshold, 0.55, 0.002, 0.08),
    exitThreshold: wobble(parent.exitThreshold, 0.6, 0.0005, 0.04),
    maxHoldSeconds: Math.round(clamp(parent.maxHoldSeconds + intBetween(rand, -120, 120), 60, 840)),
    momentumWindow: Math.round(clamp(parent.momentumWindow + intBetween(rand, -6, 6), 2, 36)),
    spreadCap: wobble(parent.spreadCap, 0.5, 0.005, 0.2),
    depthFloor: Math.round(clamp(parent.depthFloor + intBetween(rand, -40, 40), 0, 500)),
    minSecondsToClose: Math.round(clamp(parent.minSecondsToClose + intBetween(rand, -20, 20), 0, 180)),
    maxSecondsToClose: Math.round(clamp(parent.maxSecondsToClose + intBetween(rand, -120, 120), 120, 900)),
    stopLoss: wobble(parent.stopLoss, 0.45, 0.015, 0.5),
    takeProfit: wobble(parent.takeProfit, 0.45, 0.015, 0.7),
    positionSizeFraction: wobble(parent.positionSizeFraction, 0.55, 0.001, 0.05),
  };
}

function dedupeGenomes(genomes: GeneticPolicyGenome[]): GeneticPolicyGenome[] {
  const seen = new Set<string>();
  return genomes.filter((genome) => {
    if (seen.has(genome.genomeId)) return false;
    seen.add(genome.genomeId);
    return true;
  });
}

function experimentForGenome(genomeId: string): RewardExperimentId | null {
  return REWARD_EXPERIMENTS.find((experiment) => genomeId.startsWith(`${experiment.id}-`))?.id ?? null;
}

function rewardProfileForGenome(genomeId: string): RewardProfile {
  const experimentId = experimentForGenome(genomeId);
  return experimentId ? REWARD_PROFILE_BY_EXPERIMENT[experimentId] : DEFAULT_REWARD_PROFILE;
}

function mid(event: KalshiOrderbookEvent): number | null {
  if (event.yesBid == null || event.yesAsk == null) return null;
  return (event.yesBid + event.yesAsk) / 2;
}

function secondsToClose(event: KalshiOrderbookEvent): number | null {
  if (!event.windowCloseTime) return null;
  const seconds = (Date.parse(event.windowCloseTime) - Date.parse(event.receivedAt)) / 1000;
  return Number.isFinite(seconds) ? seconds : null;
}

function priceFor(event: KalshiOrderbookEvent, side: "yes" | "no", action: "enter" | "exit"): number | null {
  if (side === "yes") return action === "enter" ? event.yesAsk : event.yesBid;
  return action === "enter" ? event.noAsk : event.noBid;
}

function settlementFor(event: KalshiOrderbookEvent, side: "yes" | "no"): number | null {
  const settlementValue = inferredYesSettlementValue(event);
  if (settlementValue == null) return null;
  return side === "yes" ? settlementValue : 1 - settlementValue;
}

function explicitSettlementFor(event: KalshiOrderbookEvent, side: "yes" | "no"): number | null {
  if (event.settlementValue == null) return null;
  return side === "yes" ? event.settlementValue : 1 - event.settlementValue;
}

function marketStillOpen(event: KalshiOrderbookEvent, cutoffMs: number): boolean {
  if (!event.windowCloseTime) return true;
  const closeMs = Date.parse(event.windowCloseTime);
  return Number.isFinite(closeMs) && closeMs > cutoffMs;
}

function rawNumber(event: KalshiOrderbookEvent, key: string): number | null {
  const value = event.raw?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function inferredYesSettlementValue(event: KalshiOrderbookEvent): number | null {
  if (event.settlementValue != null) return event.settlementValue;
  const currentPrice = rawNumber(event, "currentPrice");
  const targetPrice = rawNumber(event, "targetPrice");
  if (currentPrice == null || targetPrice == null) return null;
  return currentPrice > targetPrice ? 1 : 0;
}

function openPositionFor(
  trade: KalshiPaperRlTrade,
  event: KalshiOrderbookEvent,
): KalshiPaperRlOpenPosition | null {
  const markPrice = priceFor(event, trade.side, "exit");
  if (markPrice == null) return null;
  const yesContracts = trade.side === "yes" ? trade.contracts : 0;
  const noContracts = trade.side === "no" ? trade.contracts : 0;
  const netContracts = yesContracts - noContracts;
  const markValueUsd = trade.contracts * markPrice;
  return {
    marketTicker: trade.marketTicker,
    side: netContracts > 0 ? "yes" : netContracts < 0 ? "no" : "flat",
    yesContracts,
    noContracts,
    netContracts: Math.abs(netContracts),
    costBasisUsd: trade.notionalUsd,
    markValueUsd,
    unrealizedPnlUsd: markValueUsd - trade.notionalUsd,
    averageEntryPrice: trade.entryPrice,
    markPrice,
    openedAt: trade.openedAt,
    markedAt: event.receivedAt,
    secondsToClose: secondsToClose(event),
  };
}

function quoteDepthFor(event: KalshiOrderbookEvent): number {
  if (event.yesDepth == null && event.noDepth == null) return Infinity;
  return Math.min(event.yesDepth ?? 0, event.noDepth ?? 0);
}

function groupByMarket(events: KalshiOrderbookEvent[]): Map<string, KalshiOrderbookEvent[]> {
  const byMarket = new Map<string, KalshiOrderbookEvent[]>();
  for (const event of events) {
    byMarket.set(event.marketTicker, [...(byMarket.get(event.marketTicker) ?? []), event]);
  }
  return byMarket;
}

export function simulateKalshiPaperRl(
  events: KalshiOrderbookEvent[],
  genome: GeneticPolicyGenome,
  paper: Pick<PaperConfig, "bankrollUsd" | "maxMarketUsd" | "maxOpenUsd">,
): EvalResult {
  const trades: KalshiPaperRlTrade[] = [];
  const openPositions: KalshiPaperRlOpenPosition[] = [];
  let cashPnl = 0;
  let equity = 0;
  let peak = 0;
  let drawdownUsd = 0;
  let unresolved = 0;
  const cutoffMs = Math.max(
    ...events
      .map((event) => Date.parse(event.receivedAt))
      .filter((timestamp) => Number.isFinite(timestamp)),
    0,
  );

  for (const [marketTicker, marketEvents] of groupByMarket(events)) {
    const clean = marketEvents.filter((event) => mid(event) != null).sort(
      (a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt),
    );
    let open: KalshiPaperRlTrade | null = null;

    for (let i = genome.momentumWindow; i < clean.length; i += 1) {
      const event = clean[i];
      const currentMid = mid(event);
      const priorMid = mid(clean[i - genome.momentumWindow]);
      if (currentMid == null || priorMid == null) continue;
      const momentum = currentMid - priorMid;
      const seconds = secondsToClose(event);
      const quoteDepth = quoteDepthFor(event);
      const tradable =
        (event.spread ?? Infinity) <= genome.spreadCap &&
        quoteDepth >= genome.depthFloor &&
        (seconds == null || (seconds >= genome.minSecondsToClose && seconds <= genome.maxSecondsToClose));

      if (!open && tradable && Math.abs(momentum) >= genome.entryThreshold) {
        const side = momentum > 0 ? "yes" : "no";
        const entryPrice = priceFor(event, side, "enter");
        if (entryPrice == null || entryPrice <= 0 || entryPrice >= 1) continue;
        const budget = Math.min(
          paper.maxMarketUsd,
          paper.maxOpenUsd,
          paper.bankrollUsd * genome.positionSizeFraction,
        );
        const contracts = Math.max(0, budget / entryPrice);
        if (contracts <= 0) continue;
        open = {
          tradeId: `${genome.genomeId}-${marketTicker}-${i}`,
          marketTicker,
          side,
          openedAt: event.receivedAt,
          closedAt: null,
          entryPrice,
          exitPrice: null,
          contracts,
          notionalUsd: contracts * entryPrice,
          pnlUsd: 0,
          reason: `entered on ${side} momentum ${momentum.toFixed(4)}`,
        };
        continue;
      }

      if (!open) continue;
      const mark = priceFor(event, open.side, "exit");
      if (mark == null) continue;
      const holdSeconds = (Date.parse(event.receivedAt) - Date.parse(open.openedAt)) / 1000;
      const openReturn = (mark - open.entryPrice) / Math.max(open.entryPrice, 0.01);
      const shouldExit =
        Math.abs(momentum) <= genome.exitThreshold ||
        holdSeconds >= genome.maxHoldSeconds ||
        openReturn <= -genome.stopLoss ||
        openReturn >= genome.takeProfit;
      if (!shouldExit) continue;
      const feePenalty = open.notionalUsd * 0.004;
      open.closedAt = event.receivedAt;
      open.exitPrice = mark;
      open.pnlUsd = open.contracts * (mark - open.entryPrice) - feePenalty;
      open.reason = `${open.reason}; exited with return ${openReturn.toFixed(4)}`;
      trades.push(open);
      cashPnl += open.pnlUsd;
      equity = cashPnl;
      peak = Math.max(peak, equity);
      drawdownUsd = Math.max(drawdownUsd, peak - equity);
      open = null;
    }

    if (open) {
      const settlementEvent = [...marketEvents].reverse().find((event) => explicitSettlementFor(event, open!.side) != null);
      const lastEvent = clean.at(-1);
      const closedWithoutSettlement = lastEvent ? !marketStillOpen(lastEvent, cutoffMs) : false;
      const inferredCloseEvent =
        !settlementEvent && closedWithoutSettlement && lastEvent && inferredYesSettlementValue(lastEvent) != null
          ? lastEvent
          : null;
      const exit = settlementEvent
        ? settlementFor(settlementEvent, open.side)
        : inferredCloseEvent
          ? settlementFor(inferredCloseEvent, open.side)
          : lastEvent
            ? priceFor(lastEvent, open.side, "exit")
            : null;
      if (!settlementEvent && !inferredCloseEvent && lastEvent && marketStillOpen(lastEvent, cutoffMs)) {
        const position = openPositionFor(open, lastEvent);
        if (position) openPositions.push(position);
        continue;
      }
      if (exit == null) {
        unresolved += 1;
        open.pnlUsd = -Math.min(open.notionalUsd, 1);
      } else {
        const feePenalty = open.notionalUsd * 0.002;
        open.closedAt = (settlementEvent ?? inferredCloseEvent ?? lastEvent)?.receivedAt ?? null;
        open.exitPrice = exit;
        open.pnlUsd = open.contracts * (exit - open.entryPrice) - feePenalty;
      }
      open.reason = `${open.reason}; ${
        settlementEvent ? "settled" : inferredCloseEvent ? "settled from final BTC vs target" : "marked at final quote"
      }`;
      trades.push(open);
      cashPnl += open.pnlUsd;
      equity = cashPnl;
      peak = Math.max(peak, equity);
      drawdownUsd = Math.max(drawdownUsd, peak - equity);
    }
  }

  const profile = rewardProfileForGenome(genome.genomeId);
  const churnPenalty = trades.length * profile.churnPerTrade;
  const unresolvedPenalty = unresolved * profile.unresolvedPenalty;
  const totalNotional = trades.reduce((sum, trade) => sum + trade.notionalUsd, 0);
  const entryBonus = trades.length
    ? Math.min(profile.entryBonusCap, trades.length * profile.entryBonusPerTrade)
    : profile.noTradePenalty;
  const exposureBonus = Math.min(profile.exposureBonusCap, totalNotional * profile.exposureBonusRate);
  const efficiency = totalNotional > 0 ? cashPnl / totalNotional : 0;
  const pnlReward =
    cashPnl >= 0 ? cashPnl * profile.pnlPositiveMultiplier : cashPnl * profile.pnlNegativeMultiplier;
  const efficiencyBonus = trades.length
    ? efficiency >= 0
      ? clamp(efficiency * profile.efficiencyMultiplier, 0, profile.efficiencyCap)
      : clamp(efficiency * profile.efficiencyMultiplier, profile.efficiencyFloor, 0)
    : 0;
  const earlyEntryBonus = Math.min(
    profile.earlyEntryTotalCap,
    trades.reduce((sum, trade) => sum + earlyEntryBonusForTrade(trade, profile), 0),
  );
  const reward =
    pnlReward +
    entryBonus +
    exposureBonus +
    efficiencyBonus +
    earlyEntryBonus -
    drawdownUsd * profile.drawdownMultiplier -
    churnPenalty -
    unresolvedPenalty;
  return { genome, reward, pnlUsd: cashPnl, trades, openPositions, drawdownUsd, unresolved };
}

async function readChampion(): Promise<KalshiRlChampion | null> {
  return readDocument<KalshiRlChampion | null>(RL_NAMESPACE, CHAMPION_FILE, null, (value) => {
    const parsed = value as Partial<KalshiRlChampion>;
    return parsed.genome && typeof parsed.reward === "number" ? (parsed as KalshiRlChampion) : null;
  });
}

async function readLastRun(): Promise<GeneticTrainingRun | null> {
  return readDocument<GeneticTrainingRun | null>(RL_NAMESPACE, LAST_RUN_FILE, null, (value) => {
    const parsed = value as Partial<GeneticTrainingRun>;
    return parsed.runId ? (parsed as GeneticTrainingRun) : null;
  });
}

async function readRunHistory(limit?: number): Promise<GeneticTrainingRun[]> {
  const rowLimit = Number.isFinite(limit) && limit ? Math.max(1, Math.floor(limit)) : null;
  if (storageMode() === "postgres" && rowLimit) {
    const rows = await pgQuery<{ value: unknown }>(
      `select coalesce(jsonb_agg(elem.value order by elem.ordinality), '[]'::jsonb) as value
         from quant_documents d
         cross join lateral jsonb_array_elements(d.value) with ordinality as elem(value, ordinality)
        where d.namespace = $1
          and d.file_name = $2
          and elem.ordinality <= $3`,
      [RL_NAMESPACE, RUN_HISTORY_FILE, rowLimit],
    );
    return Array.isArray(rows[0]?.value) ? (rows[0].value as GeneticTrainingRun[]) : [];
  }
  return readDocument<GeneticTrainingRun[]>(RL_NAMESPACE, RUN_HISTORY_FILE, [], (value) => {
    const history = Array.isArray(value) ? (value as GeneticTrainingRun[]) : [];
    return rowLimit ? history.slice(0, rowLimit) : history;
  });
}

async function appendRunHistory(run: GeneticTrainingRun): Promise<void> {
  const history = await readRunHistory();
  await writeDocument(RL_NAMESPACE, RUN_HISTORY_FILE, [run, ...history.filter((r) => r.runId !== run.runId)].slice(0, 500));
}

async function readEliteArchive(): Promise<KalshiRlEliteArchiveEntry[]> {
  return readDocument<KalshiRlEliteArchiveEntry[]>(RL_NAMESPACE, ELITE_ARCHIVE_FILE, [], (value) => {
    return Array.isArray(value) ? (value as KalshiRlEliteArchiveEntry[]) : [];
  });
}

async function writeEliteArchive(archive: KalshiRlEliteArchiveEntry[]): Promise<void> {
  await writeDocument(RL_NAMESPACE, ELITE_ARCHIVE_FILE, archive);
}

function eliteTagsForCandidate(
  candidate: Pick<ArchiveCandidate, "pnlUsd" | "reward" | "trades" | "status">,
  existing: KalshiRlEliteTag[] = [],
): KalshiRlEliteTag[] {
  const tags = new Set<KalshiRlEliteTag>(existing);
  const threshold = validatedPnlThresholdUsd();
  if (candidate.pnlUsd >= threshold) {
    tags.add("validated");
    if (threshold === DEFAULT_VALIDATED_PNL_USD) tags.add("profit-20");
  }
  if (candidate.pnlUsd > 0) tags.add("profitable");
  if (candidate.status === "champion") tags.add("champion");
  if (candidate.reward > 0 && candidate.trades > 0) tags.add("interesting");
  return [...tags];
}

function archiveReasonFor(tags: KalshiRlEliteTag[]): string {
  if (tags.includes("validated")) return `paper PnL cleared validation threshold ${validatedPnlThresholdUsd()}`;
  if (tags.includes("champion")) return "promoted champion";
  if (tags.includes("interesting")) return "positive reward with live trades";
  if (tags.includes("profitable")) return "positive paper PnL";
  return "historical top performer";
}

function tierForTags(tags: KalshiRlEliteTag[]): KalshiRlAgentTier {
  return tags.includes("validated") || tags.includes("profit-20") ? "validated" : "testing";
}

function tierForEval(row: EvalResult, eliteTags: KalshiRlEliteTag[]): KalshiRlAgentTier {
  return row.pnlUsd >= validatedPnlThresholdUsd() || tierForTags(eliteTags) === "validated"
    ? "validated"
    : "testing";
}

function leaderboardRowIsValidated(row: GeneticTrainingRun["leaderboard"][number]): boolean {
  return row.contributesToPerformance === true && typeof row.validationAt === "string";
}

function shouldArchiveCandidate(candidate: Pick<ArchiveCandidate, "pnlUsd" | "reward" | "trades" | "status">): boolean {
  return (
    candidate.pnlUsd > 0 ||
    candidate.reward > 0 ||
    candidate.status === "champion" ||
    candidate.pnlUsd >= validatedPnlThresholdUsd()
  );
}

function upsertEliteArchiveEntry(
  archive: Map<string, KalshiRlEliteArchiveEntry>,
  candidate: ArchiveCandidate,
): void {
  const existing = archive.get(candidate.genome.genomeId);
  const tags = eliteTagsForCandidate(candidate, existing?.tags);
  if (!tags.length && !shouldArchiveCandidate(candidate)) return;
  const clearsValidation = candidate.pnlUsd >= validatedPnlThresholdUsd();
  const bestPnlUsd = Math.max(existing?.bestPnlUsd ?? Number.NEGATIVE_INFINITY, candidate.pnlUsd);
  const bestReward = Math.max(existing?.bestReward ?? Number.NEGATIVE_INFINITY, candidate.reward);
  const bestRunId = candidate.pnlUsd >= (existing?.bestPnlUsd ?? Number.NEGATIVE_INFINITY)
    ? candidate.runId
    : existing?.bestRunId ?? candidate.runId;
  archive.set(candidate.genome.genomeId, {
    genome: candidate.genome,
    tags,
    firstSeenAt: existing?.firstSeenAt ?? candidate.generatedAt,
    firstTaggedAt: existing?.firstTaggedAt ?? candidate.generatedAt,
    firstValidatedAt: existing?.firstValidatedAt ?? (clearsValidation ? candidate.generatedAt : undefined),
    firstValidatedRunId: existing?.firstValidatedRunId ?? (clearsValidation ? candidate.runId : undefined),
    validationPnlUsd: existing?.validationPnlUsd ?? (clearsValidation ? candidate.pnlUsd : undefined),
    lastScoredAt: candidate.generatedAt,
    firstRunId: existing?.firstRunId ?? candidate.runId,
    lastRunId: candidate.runId,
    bestRunId,
    bestPnlUsd,
    latestPnlUsd: candidate.pnlUsd,
    bestReward,
    latestReward: candidate.reward,
    trades: candidate.trades,
    generationsTracked: (existing?.generationsTracked ?? 0) + 1,
    lastStatus: candidate.status ?? existing?.lastStatus ?? "archived",
    archivedReason: archiveReasonFor(tags),
    tier: tierForTags(tags),
  });
}

function archiveFromHistory(runHistory: GeneticTrainingRun[]): KalshiRlEliteArchiveEntry[] {
  const archive = new Map<string, KalshiRlEliteArchiveEntry>();
  const chronological = [...runHistory].sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  for (const run of chronological) {
    for (const row of run.leaderboard ?? []) {
      const candidate: ArchiveCandidate = {
        genome: row.genome,
        reward: row.reward,
        pnlUsd: row.pnlUsd,
        trades: row.trades,
        status: row.status,
        runId: run.runId,
        generatedAt: run.generatedAt,
      };
      if (!shouldArchiveCandidate(candidate)) continue;
      upsertEliteArchiveEntry(archive, candidate);
    }
  }
  return sortEliteArchive([...archive.values()]);
}

function mergeEliteArchive(
  persisted: KalshiRlEliteArchiveEntry[],
  runHistory: GeneticTrainingRun[],
): KalshiRlEliteArchiveEntry[] {
  const archive = new Map<string, KalshiRlEliteArchiveEntry>();
  for (const entry of archiveFromHistory(runHistory)) {
    archive.set(entry.genome.genomeId, entry);
  }
  for (const entry of persisted) {
    const existing = archive.get(entry.genome.genomeId);
    if (!existing || entry.generationsTracked >= existing.generationsTracked || entry.lastScoredAt > existing.lastScoredAt) {
      const tags = eliteTagsForCandidate(
        {
          pnlUsd: entry.bestPnlUsd,
          reward: entry.bestReward,
          trades: entry.trades,
          status: entry.lastStatus,
        },
        entry.tags,
      );
      archive.set(entry.genome.genomeId, {
        ...entry,
        tags,
        firstValidatedAt:
          existing?.firstValidatedAt ??
          entry.firstValidatedAt ??
          (tierForTags(tags) === "validated" ? entry.firstTaggedAt : undefined),
        firstValidatedRunId:
          existing?.firstValidatedRunId ??
          entry.firstValidatedRunId ??
          (tierForTags(tags) === "validated" ? entry.firstRunId : undefined),
        validationPnlUsd:
          existing?.validationPnlUsd ??
          entry.validationPnlUsd ??
          (tierForTags(tags) === "validated" ? entry.bestPnlUsd : undefined),
        tier: tierForTags(tags),
      });
    }
  }
  return sortEliteArchive([...archive.values()]);
}

function sortEliteArchive(archive: KalshiRlEliteArchiveEntry[]): KalshiRlEliteArchiveEntry[] {
  return [...archive].sort((a, b) => {
    const profitTagDelta = Number(b.tags.includes("profit-20")) - Number(a.tags.includes("profit-20"));
    if (profitTagDelta !== 0) return profitTagDelta;
    const bestDelta = b.bestPnlUsd - a.bestPnlUsd;
    if (bestDelta !== 0) return bestDelta;
    return b.latestReward - a.latestReward;
  });
}

function buildPopulation(args: {
  seed: string;
  size: number;
  previousChampion: KalshiRlChampion | null;
  previousRun: GeneticTrainingRun | null;
  eliteArchive: KalshiRlEliteArchiveEntry[];
}): GeneticPolicyGenome[] {
  const rand = rng(hashSeed(args.seed));
  const population: GeneticPolicyGenome[] = [];
  const priorRows = args.previousRun?.leaderboard ?? [];
  const archiveGenomes = args.eliteArchive
    .slice(0, ELITE_SEED_SIZE)
    .map((entry) => entry.genome);
  const elites = dedupeGenomes([
    ...(args.previousChampion ? [args.previousChampion.genome] : []),
    ...archiveGenomes,
    ...priorRows
      .filter((row) => !row.deprecatedReason && row.trades > 0)
      .sort((a, b) => b.reward - a.reward)
      .slice(0, Math.max(4, Math.ceil(args.size * 0.18)))
      .map((row) => row.genome),
  ]);

  population.push(...elites.slice(0, Math.ceil(args.size * 0.25)));

  const experimentBudget = Math.max(0, args.size - population.length);
  const perExperiment = Math.max(1, Math.floor(experimentBudget / REWARD_EXPERIMENTS.length));
  const extraSlots = experimentBudget % REWARD_EXPERIMENTS.length;
  for (const [experimentIndex, experiment] of REWARD_EXPERIMENTS.entries()) {
    const target = perExperiment + (experimentIndex < extraSlots ? 1 : 0);
    const experimentParents = priorRows
      .filter(
        (row) =>
          !row.deprecatedReason &&
          row.trades > 0 &&
          experimentForGenome(row.genome.genomeId) === experiment.id,
      )
      .sort((a, b) => b.reward - a.reward)
      .slice(0, 8)
      .map((row) => row.genome);

    for (let i = 0; i < target && population.length < args.size; i += 1) {
      if (experimentParents.length && rand() < 0.75) {
        const parent = experimentParents[Math.floor(rand() * experimentParents.length)] ?? experimentParents[0];
        population.push(mutateGenome(parent, rand, `${experiment.id}-kid-g${population.length}`));
      } else {
        population.push(makeGenome(rand, `${experiment.id}-gen-g${population.length}`));
      }
    }
  }

  let fillIndex = 0;
  while (population.length < args.size) {
    const experiment = REWARD_EXPERIMENTS[fillIndex % REWARD_EXPERIMENTS.length];
    const experimentParents = priorRows
      .filter((row) => !row.deprecatedReason && row.trades > 0 && experimentForGenome(row.genome.genomeId) === experiment.id)
      .sort((a, b) => b.reward - a.reward)
      .slice(0, 8)
      .map((row) => row.genome);
    if (experimentParents.length && rand() < 0.75) {
      const parent = experimentParents[Math.floor(rand() * experimentParents.length)] ?? experimentParents[0];
      population.push(mutateGenome(parent, rand, `${experiment.id}-kid-g${population.length}`));
    } else {
      population.push(makeGenome(rand, `${experiment.id}-gen-g${population.length}`));
    }
    fillIndex += 1;
  }
  return dedupeGenomes(population).slice(0, args.size);
}

function statsForGenome(
  genomeId: string,
  currentPnlUsd: number,
  runHistory: GeneticTrainingRun[],
): LineageStats {
  const prior = runHistory
    .flatMap((run) => run.leaderboard ?? [])
    .filter((row) => row.genome.genomeId === genomeId)
    .map((row) => row.pnlUsd);
  const pnls = [currentPnlUsd, ...prior];
  const pnlLast4 = pnls.slice(0, 4).reduce((sum, pnl) => sum + pnl, 0);
  const pnlLast10 = pnls.slice(0, 10).reduce((sum, pnl) => sum + pnl, 0);
  const generationsSeen = pnls.length;
  return {
    pnlLast4,
    pnlLast10,
    generationsSeen,
    deprecatedReason:
      generationsSeen >= 10 && pnlLast10 < 0
        ? "negative 10-generation PnL"
      : undefined,
  };
}

function tradeTimestamp(trade: KalshiPaperRlTrade): number {
  return Date.parse(trade.closedAt ?? trade.openedAt);
}

function pnlForRecentMinutes(trades: KalshiPaperRlTrade[], generatedAt: string, minutes: number): number {
  const cutoff = Date.parse(generatedAt) - minutes * 60_000;
  return trades
    .filter((trade) => {
      const ts = tradeTimestamp(trade);
      return Number.isFinite(ts) && ts >= cutoff;
    })
    .reduce((sum, trade) => sum + trade.pnlUsd, 0);
}

function performanceForPaper(
  trades: KalshiPaperRlTrade[],
  openPositions: KalshiPaperRlOpenPosition[],
  bankrollUsd: number,
): KalshiPaperRlPerformance {
  const closedTrades = trades.filter((trade) => trade.closedAt);
  const openTrades = trades.filter((trade) => !trade.closedAt);
  const openPnl = openPositions.reduce((sum, position) => sum + position.unrealizedPnlUsd, 0);
  const openRisked = openPositions.reduce((sum, position) => sum + position.costBasisUsd, 0);
  const markedOpenPnl = openPositions.length ? openPnl : openTrades.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const markedOpenRisked = openPositions.length
    ? openRisked
    : openTrades.reduce((sum, trade) => sum + trade.notionalUsd, 0);
  const grossGainedUsd =
    closedTrades.filter((trade) => trade.pnlUsd > 0).reduce((sum, trade) => sum + trade.pnlUsd, 0) +
    Math.max(markedOpenPnl, 0);
  const grossLostUsd =
    Math.abs(closedTrades.filter((trade) => trade.pnlUsd < 0).reduce((sum, trade) => sum + trade.pnlUsd, 0)) +
    Math.abs(Math.min(markedOpenPnl, 0));
  const riskedUsd = closedTrades.reduce((sum, trade) => sum + trade.notionalUsd, 0) + markedOpenRisked;
  const netPnlUsd = closedTrades.reduce((sum, trade) => sum + trade.pnlUsd, 0) + markedOpenPnl;
  return {
    bankrollUsd,
    riskedUsd,
    netPnlUsd,
    grossGainedUsd,
    grossLostUsd,
    returnOnBankroll: bankrollUsd > 0 ? netPnlUsd / bankrollUsd : 0,
    returnOnRisk: riskedUsd > 0 ? netPnlUsd / riskedUsd : 0,
    betsWon: closedTrades.filter((trade) => trade.pnlUsd > 0).length,
    betsLost: closedTrades.filter((trade) => trade.pnlUsd < 0).length,
  };
}

function tradeAt(trade: KalshiPaperRlTrade): string {
  return trade.closedAt ?? trade.openedAt;
}

function afterIso(value: string, cutoff: string): boolean {
  return Date.parse(value) > Date.parse(cutoff);
}

function accountingPerformanceForEval(
  row: EvalResult,
  validationAt: string | undefined,
  bankrollUsd: number,
): KalshiPaperRlPerformance {
  if (!validationAt) return performanceForPaper([], [], bankrollUsd);
  return performanceForPaper(
    row.trades.filter((trade) => afterIso(tradeAt(trade), validationAt)),
    row.openPositions.filter((position) => afterIso(position.openedAt, validationAt)),
    bankrollUsd,
  );
}

function earlyEntryBonusForTrade(trade: KalshiPaperRlTrade, profile: RewardProfile): number {
  if (trade.pnlUsd <= 0 || trade.entryPrice >= 0.9) return 0;
  const early = clamp((0.9 - trade.entryPrice) / 0.8, 0, 1);
  const curve = (Math.exp(profile.earlyEntryCurve * early) - 1) / (Math.exp(profile.earlyEntryCurve) - 1);
  const positiveRoi = clamp(trade.pnlUsd / Math.max(trade.notionalUsd, 0.01), 0, 1);
  const sizeWeight = clamp(trade.notionalUsd / 5, 0, 1);
  return Math.min(
    profile.earlyEntryPerTradeCap,
    profile.earlyEntryPerTradeCap * curve * positiveRoi * sizeWeight,
  );
}

function visibleEvaluations(
  evaluated: EvalResult[],
  size = 12,
  eliteArchive: KalshiRlEliteArchiveEntry[] = [],
): EvalResult[] {
  const evaluatedById = new Map(evaluated.map((row) => [row.genome.genomeId, row]));
  const archivedRows = eliteArchive
    .slice(0, ELITE_VISIBLE_SIZE)
    .map((entry) => evaluatedById.get(entry.genome.genomeId))
    .filter((row): row is EvalResult => Boolean(row));
  const rows = [
    ...archivedRows,
    ...evaluated.slice(0, Math.ceil(size * 0.55)),
    ...REWARD_EXPERIMENTS.flatMap((experiment) =>
      evaluated.filter((row) => experimentForGenome(row.genome.genomeId) === experiment.id).slice(0, 2),
    ),
    ...evaluated.filter((row) => (row.genome.parentGenomeIds ?? []).length > 0).slice(0, Math.floor(size * 0.33)),
  ];
  const seen = new Set<string>();
  const visible = rows.filter((row) => {
    if (seen.has(row.genome.genomeId)) return false;
    seen.add(row.genome.genomeId);
    return true;
  });
  for (const row of evaluated) {
    if (visible.length >= size) break;
    if (!seen.has(row.genome.genomeId)) {
      seen.add(row.genome.genomeId);
      visible.push(row);
    }
  }
  return visible;
}

function championFromEval(
  result: EvalResult,
  generation: number,
  markets: string[],
): KalshiRlChampion {
  return {
    genome: result.genome,
    promotedAt: new Date().toISOString(),
    generation,
    reward: result.reward,
    pnlUsd: result.pnlUsd,
    trades: result.trades.length,
    drawdownUsd: result.drawdownUsd,
    sampleMarkets: markets,
  };
}

function statusForEval(
  row: EvalResult,
  champion: KalshiRlChampion | null,
  stats?: LineageStats,
  eliteTags: KalshiRlEliteTag[] = [],
): GeneticTrainingRun["leaderboard"][number]["status"] {
  if (champion && row.genome.genomeId === champion.genome.genomeId) return "champion";
  if (stats?.deprecatedReason && eliteTags.length) return "archived";
  if (stats?.deprecatedReason) return "deprecated";
  if (row.reward > 0 && row.trades.length > 0) return "candidate";
  if (eliteTags.length) return "archived";
  return "exploring";
}

function tagsForEval(row: EvalResult, champion: KalshiRlChampion | null, archiveById: Map<string, KalshiRlEliteArchiveEntry>) {
  return eliteTagsForCandidate(
    {
      pnlUsd: row.pnlUsd,
      reward: row.reward,
      trades: row.trades.length,
      status: champion && row.genome.genomeId === champion.genome.genomeId ? "champion" : undefined,
    },
    archiveById.get(row.genome.genomeId)?.tags,
  );
}

function leaderboardRowForEval(args: {
  row: EvalResult;
  champion: KalshiRlChampion | null;
  runHistory: GeneticTrainingRun[];
  runId: string;
  generatedAt: string;
  bankrollUsd: number;
  archiveById: Map<string, KalshiRlEliteArchiveEntry>;
}): GeneticTrainingRun["leaderboard"][number] {
  const stats = statsForGenome(args.row.genome.genomeId, args.row.pnlUsd, args.runHistory);
  const eliteTags = tagsForEval(args.row, args.champion, args.archiveById);
  const archiveEntry = args.archiveById.get(args.row.genome.genomeId);
  const tier = tierForEval(args.row, eliteTags);
  const validationAt = archiveEntry?.firstValidatedAt;
  const validationRunId = archiveEntry?.firstValidatedRunId;
  const isValidationRun = Boolean(validationRunId && validationRunId === args.runId);
  const hasPostValidationWindow = Boolean(validationAt && afterIso(args.generatedAt, validationAt));
  const contributesToPerformance = tier === "validated" && hasPostValidationWindow;
  return {
    genome: args.row.genome,
    status: statusForEval(args.row, args.champion, stats, eliteTags),
    parentGenomeIds: args.row.genome.parentGenomeIds ?? [],
    tier,
    contributesToPerformance,
    validationAt,
    validationRunId,
    validationPnlUsd: archiveEntry?.validationPnlUsd,
    isValidationRun,
    eliteTags: eliteTags.length ? eliteTags : undefined,
    archivedReason: archiveEntry?.archivedReason ?? (eliteTags.length ? archiveReasonFor(eliteTags) : undefined),
    reward: args.row.reward,
    pnlUsd: args.row.pnlUsd,
    trades: args.row.trades.length,
    drawdownUsd: args.row.drawdownUsd,
    pnlLast4: stats.pnlLast4,
    pnlLast10: stats.pnlLast10,
    pnlLast20m: pnlForRecentMinutes(args.row.trades, args.generatedAt, 20),
    pnlLast50m: pnlForRecentMinutes(args.row.trades, args.generatedAt, 50),
    generationsSeen: stats.generationsSeen,
    deprecatedReason: eliteTags.length ? undefined : stats.deprecatedReason,
    recentTrades: args.row.trades.slice(-8),
    openPositions: args.row.openPositions,
    performance: accountingPerformanceForEval(args.row, validationAt, args.bankrollUsd),
  };
}

function statsForRun(run: GeneticTrainingRun | null): KalshiRlGenerationStats {
  const rows = (run?.leaderboard ?? []).filter(leaderboardRowIsValidated);
  const totalPnlUsd = rows.reduce((sum, row) => sum + (row.performance?.netPnlUsd ?? 0), 0);
  const riskedUsd = rows.reduce((sum, row) => sum + (row.performance?.riskedUsd ?? 0), 0);
  const betsWon = rows.reduce((sum, row) => sum + (row.performance?.betsWon ?? 0), 0);
  const betsLost = rows.reduce((sum, row) => sum + (row.performance?.betsLost ?? 0), 0);
  const pnls = rows.map((row) => row.performance?.netPnlUsd ?? 0);
  return {
    runId: run?.runId ?? null,
    generatedAt: run?.generatedAt ?? null,
    agents: rows.length,
    totalPnlUsd,
    averagePnlUsd: rows.length ? totalPnlUsd / rows.length : 0,
    bestPnlUsd: pnls.length ? Math.max(...pnls) : null,
    worstPnlUsd: pnls.length ? Math.min(...pnls) : null,
    totalTrades: betsWon + betsLost,
    returnOnRisk: riskedUsd > 0 ? totalPnlUsd / riskedUsd : null,
    betsWon,
    betsLost,
    winRate: betsWon + betsLost > 0 ? betsWon / (betsWon + betsLost) : null,
  };
}

function buildGenerationComparison(
  currentRun: GeneticTrainingRun | null,
  runHistory: GeneticTrainingRun[],
  eliteArchive: KalshiRlEliteArchiveEntry[],
): KalshiRlGenerationComparison {
  const current = currentRun ?? runHistory[0] ?? null;
  const previous =
    (current ? runHistory.find((run) => run.runId !== current.runId && run.generatedAt < current.generatedAt) : null) ??
    runHistory.find((run) => run.runId !== current?.runId) ??
    null;
  const currentStats = statsForRun(current);
  const previousStats = previous ? statsForRun(previous) : null;
  const currentRowsById = new Map((current?.leaderboard ?? []).map((row) => [row.genome.genomeId, row]));
  const previousRowsById = new Map((previous?.leaderboard ?? []).map((row) => [row.genome.genomeId, row]));
  const sameGenomeDeltas = [...currentRowsById.entries()]
    .map(([genomeId, currentRow]) => {
      const previousRow = previousRowsById.get(genomeId);
      if (!previousRow) return null;
      return {
        genomeId,
        currentPnlUsd: currentRow.pnlUsd,
        previousPnlUsd: previousRow.pnlUsd,
        deltaPnlUsd: currentRow.pnlUsd - previousRow.pnlUsd,
        currentTrades: currentRow.trades,
        previousTrades: previousRow.trades,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => Math.abs(b.deltaPnlUsd) - Math.abs(a.deltaPnlUsd))
    .slice(0, 16);
  const scoredLatest = current
    ? eliteArchive.filter((entry) => entry.lastRunId === current.runId || entry.lastScoredAt === current.generatedAt)
    : [];
  const averageLatestPnlUsd = scoredLatest.length
    ? scoredLatest.reduce((sum, entry) => sum + entry.latestPnlUsd, 0) / scoredLatest.length
    : null;
  const bestLatestPnlUsd = scoredLatest.length ? Math.max(...scoredLatest.map((entry) => entry.latestPnlUsd)) : null;
  return {
    current: currentStats,
    previous: previousStats,
    delta: {
      totalPnlUsd: previousStats ? currentStats.totalPnlUsd - previousStats.totalPnlUsd : null,
      averagePnlUsd: previousStats ? currentStats.averagePnlUsd - previousStats.averagePnlUsd : null,
      returnOnRisk:
        previousStats?.returnOnRisk != null && currentStats.returnOnRisk != null
          ? currentStats.returnOnRisk - previousStats.returnOnRisk
          : null,
      winRate:
        previousStats?.winRate != null && currentStats.winRate != null
          ? currentStats.winRate - previousStats.winRate
          : null,
      agents: previousStats ? currentStats.agents - previousStats.agents : null,
    },
    eliteArchive: {
      total: eliteArchive.length,
      validated: eliteArchive.filter((entry) => entry.tier === "validated" || entry.tags.includes("validated")).length,
      profit20: eliteArchive.filter((entry) => entry.tags.includes("profit-20")).length,
      champions: eliteArchive.filter((entry) => entry.tags.includes("champion")).length,
      scoredLatest: scoredLatest.length,
      averageLatestPnlUsd,
      bestLatestPnlUsd,
    },
    topElites: sortEliteArchive(eliteArchive)
      .slice(0, 18)
      .map((entry) => ({
        genomeId: entry.genome.genomeId,
        tier: entry.tier ?? tierForTags(entry.tags),
        tags: entry.tags,
        bestPnlUsd: entry.bestPnlUsd,
        latestPnlUsd: entry.latestPnlUsd,
        latestReward: entry.latestReward,
        trades: entry.trades,
        generationsTracked: entry.generationsTracked,
        lastScoredAt: entry.lastScoredAt,
      })),
    sameGenomeDeltas,
  };
}

export async function runKalshiRlOnce(): Promise<GeneticTrainingRun> {
  const cfg = config();
  const [previousChampion, previousRun, runHistory, persistedArchive] = await Promise.all([
    readChampion(),
    readLastRun(),
    readRunHistory(),
    readEliteArchive(),
  ]);
  const eliteArchive = mergeEliteArchive(persistedArchive, runHistory);
  const events = await readKalshiOrderbookEvents({ limit: 50_000, seriesTicker: cfg.seriesTicker });
  const markets = [...new Set(events.map((event) => event.marketTicker))].sort();
  const runId = `kalshi-rl-${Date.now().toString(36)}`;
  const generatedAt = new Date().toISOString();

  if (!events.length) {
    const emptyRun: GeneticTrainingRun = {
      runId,
      generatedAt,
      seriesTicker: cfg.seriesTicker,
      populationSize: cfg.populationSize,
      evaluatedMarkets: [],
      eventCount: 0,
      best: null,
      previousChampion,
      champion: previousChampion,
      promoted: false,
      baselineReward: 0,
      leaderboard: [],
      paper: {
        bankrollUsd: cfg.bankrollUsd,
        maxMarketUsd: cfg.maxMarketUsd,
        maxOpenUsd: cfg.maxOpenUsd,
      },
      notes: ["Waiting for Kalshi orderbook ingestion before training."],
    };
    await writeDocument(RL_NAMESPACE, LAST_RUN_FILE, emptyRun);
    await appendRunHistory(emptyRun);
    return emptyRun;
  }

  const population = buildPopulation({
    seed: `${runId}:${events.length}:${events.at(-1)?.receivedAt ?? ""}`,
    size: cfg.populationSize,
    previousChampion,
    previousRun,
    eliteArchive,
  });
  const evaluationPopulation = dedupeGenomes([
    ...population,
    ...eliteArchive.map((entry) => entry.genome),
  ]);
  const evaluated = evaluationPopulation
    .map((genome) => simulateKalshiPaperRl(events, genome, cfg))
    .sort((a, b) => b.reward - a.reward);
  const bestEval = evaluated[0] ?? null;
  const best = bestEval ? championFromEval(bestEval, (previousChampion?.generation ?? 0) + 1, markets) : null;
  const hurdle = Math.max(0, previousChampion?.reward ?? 0);
  const promoted = Boolean(best && best.reward > hurdle && best.trades > 0);
  const champion = promoted ? best : previousChampion;

  if (promoted && champion) await writeDocument(RL_NAMESPACE, CHAMPION_FILE, champion);
  const archiveById = new Map(eliteArchive.map((entry) => [entry.genome.genomeId, entry]));
  for (const row of evaluated) {
    const status: ArchiveCandidate["status"] =
      champion && row.genome.genomeId === champion.genome.genomeId
        ? "champion"
        : row.reward > 0 && row.trades.length > 0
          ? "candidate"
          : "exploring";
    const candidate = {
      genome: row.genome,
      reward: row.reward,
      pnlUsd: row.pnlUsd,
      trades: row.trades.length,
      status,
      runId,
      generatedAt,
    };
    if (archiveById.has(row.genome.genomeId) || shouldArchiveCandidate(candidate)) {
      upsertEliteArchiveEntry(archiveById, candidate);
    }
  }
  const updatedArchive = sortEliteArchive([...archiveById.values()]);
  await writeEliteArchive(updatedArchive);
  const updatedArchiveById = new Map(updatedArchive.map((entry) => [entry.genome.genomeId, entry]));

  const run: GeneticTrainingRun = {
    runId,
    generatedAt,
    seriesTicker: cfg.seriesTicker,
    populationSize: evaluationPopulation.length,
    evaluatedMarkets: markets,
    eventCount: events.length,
    best,
    previousChampion,
    champion,
    promoted,
    baselineReward: 0,
    leaderboard: visibleEvaluations(evaluated, LIVE_LEADERBOARD_SIZE, updatedArchive).map((row) =>
      leaderboardRowForEval({
        row,
        champion,
        runHistory,
        runId,
        generatedAt,
        bankrollUsd: cfg.bankrollUsd,
        archiveById: updatedArchiveById,
      }),
    ),
    paper: {
      bankrollUsd: cfg.bankrollUsd,
      maxMarketUsd: cfg.maxMarketUsd,
      maxOpenUsd: cfg.maxOpenUsd,
    },
    notes: [
      "Paper-only genetic policy search; no Kalshi orders are created.",
      "Parallel reward experiments run as separate surname lineages and do not replace existing Brooks/Torres-style lines.",
      `Active reward experiments: ${REWARD_EXPERIMENTS.map((experiment) => `${experiment.name} (${experiment.note})`).join("; ")}.`,
      "Reward is PnL-dominant; small bounded exploration and efficiency terms only nudge early learning.",
      `Elite archive protected ${updatedArchive.length} historical profitable or interesting genomes; ${updatedArchive.filter((entry) => entry.tier === "validated").length} are validated for performance accounting at threshold ${validatedPnlThresholdUsd()}.`,
      "The validation run is treated as the gate; performance accounting only includes trades after firstValidatedAt.",
      promoted ? "Best genome beat the no-trade and incumbent hurdle." : "No new genome cleared promotion hurdles.",
      "Neural RL remains a staged hook after enough orderbook history is captured.",
    ],
  };

  await writeDocument(RL_NAMESPACE, LAST_RUN_FILE, run);
  await appendRunHistory(run);
  await appendLedger({
    type: "model_version",
    modelId: `kalshi-rl-${best?.genome.genomeId ?? "no-winner"}`,
    dataCutoff: events.at(-1)?.receivedAt ?? generatedAt,
    score: best?.reward ?? 0,
    payload: run,
  });
  await appendLedger({
    type: "paper_action",
    action: promoted ? "simulated_fill" : "rejected",
    channel: "portfolio",
    notionalUsd: 0,
    reason: promoted ? "Kalshi RL champion promoted in paper mode." : "Kalshi RL training completed without promotion.",
    payload: run,
  });
  return run;
}

export async function waitForKalshiRlEvents(timeoutMs = 0, pollMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  do {
    const events = await readKalshiOrderbookEvents({ limit: 1, seriesTicker: config().seriesTicker });
    if (events.length) return true;
    if (timeoutMs <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, Math.max(250, pollMs)));
  } while (Date.now() < deadline);
  return false;
}

export async function readKalshiRlSummary(): Promise<KalshiRlSummary> {
  const cfg = config();
  const [events, champion, lastRun, runHistory, persistedArchive] = await Promise.all([
    readKalshiOrderbookEvents({ limit: 10_000, seriesTicker: cfg.seriesTicker }),
    readChampion(),
    readLastRun(),
    readRunHistory(40),
    readEliteArchive(),
  ]);
  const eliteArchive = mergeEliteArchive(persistedArchive, runHistory);
  const archiveById = new Map(eliteArchive.map((entry) => [entry.genome.genomeId, entry]));
  const quoteEvents = events.filter(validQuoteEvent);
  const latestEvent = quoteEvents.at(-1) ?? events.at(-1) ?? null;
  const liveLeaderboard = lastRun?.leaderboard?.length
    ? lastRun.leaderboard.slice(0, LIVE_LEADERBOARD_SIZE).map((row) => {
        const live = simulateKalshiPaperRl(events, row.genome, cfg);
        return leaderboardRowForEval({
          row: live,
          champion,
          runHistory,
          runId: "live",
          generatedAt: latestEvent?.receivedAt ?? new Date().toISOString(),
          bankrollUsd: cfg.bankrollUsd,
          archiveById,
        });
      })
    : undefined;
  const comparison = buildGenerationComparison(lastRun, runHistory, eliteArchive);
  return {
    enabled: envFlag("KALSHI_RL_ENABLED", false),
    seriesTicker: cfg.seriesTicker,
    bankrollUsd: cfg.bankrollUsd,
    maxMarketUsd: cfg.maxMarketUsd,
    maxOpenUsd: cfg.maxOpenUsd,
    recentEvents: events.length,
    latestEventAt: events.at(-1)?.receivedAt ?? null,
    latestEvent,
    recentQuoteEvents: quoteEvents.slice(-96),
    latestMarketUrl: latestEvent ? marketUrlForTicker(latestEvent.marketTicker) : null,
    liveLeaderboard,
    eliteArchive,
    generationComparison: comparison,
    champion,
    lastRun,
    runHistory,
  };
}

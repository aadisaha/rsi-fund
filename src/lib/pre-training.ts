import "server-only";

import { appendLedger } from "@/lib/ledger";
import {
  readKalshiCandles,
  readKalshiHistoryManifest,
  type KalshiCandle,
} from "@/lib/kalshi-history";
import { readDocument, writeDocument } from "@/lib/storage";
import type {
  PreTrainingAgentGenome,
  PreTrainingAgentScore,
  PreTrainingCycleSummary,
  PreTrainingPaperTrade,
  PreTrainingRun,
  PreTrainingSummary,
} from "@/lib/types";

const PRETRAINING_NAMESPACE = "pre-training";
const LAST_RUN_FILE = "pre-training-last-run.json";
const RUN_HISTORY_FILE = "pre-training-run-history.json";
const CHAMPION_FILE = "pre-training-champion.json";
const DEFAULT_BANKROLL_USD = 1_000;
const FAMILY_ORDER: PreTrainingAgentGenome["family"][] = ["momentum", "reversal", "breakout", "risk-scout"];

type PreTrainingOptions = {
  cycles?: number;
  populationSize?: number;
  marketLimit?: number;
  seriesTicker?: string;
};

type TrainingConfig = {
  cycles: number;
  populationSize: number;
  marketLimit: number;
  seriesTicker: string;
  bankrollUsd: number;
  maxMarketUsd: number;
};

type MarketSlice = {
  marketTicker: string;
  candles: KalshiCandle[];
};

type EvalResult = Omit<PreTrainingAgentScore, "familyRank" | "trainReward" | "validationReward">;

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

function optionNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function config(options: PreTrainingOptions = {}): TrainingConfig {
  const cycles = optionNumber(options.cycles, envNumber("PRE_TRAINING_CYCLES", 8));
  const populationSize = optionNumber(options.populationSize, envNumber("PRE_TRAINING_POPULATION", 48));
  const marketLimit = optionNumber(options.marketLimit, envNumber("PRE_TRAINING_MARKETS", 160));
  return {
    cycles: Math.max(1, Math.min(50, Math.round(cycles))),
    populationSize: Math.max(8, Math.min(400, Math.round(populationSize))),
    marketLimit: Math.max(1, Math.min(2_000, Math.round(marketLimit))),
    seriesTicker: options.seriesTicker?.trim() || process.env.PRE_TRAINING_SERIES?.trim() || "KXBTC15M",
    bankrollUsd: envNumber("PRE_TRAINING_BANKROLL_USD", DEFAULT_BANKROLL_USD),
    maxMarketUsd: envNumber("PRE_TRAINING_MAX_MARKET_USD", 25),
  };
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

function round(n: number, digits = 4): number {
  return Number(n.toFixed(digits));
}

function priceYes(candle: KalshiCandle): number | null {
  return candle.price.close ?? candle.yesAsk.close ?? candle.yesBid.close;
}

function yesAsk(candle: KalshiCandle): number | null {
  return candle.yesAsk.close ?? candle.price.close;
}

function yesBid(candle: KalshiCandle): number | null {
  return candle.yesBid.close ?? candle.price.close;
}

function spread(candle: KalshiCandle): number {
  if (candle.yesAsk.close == null || candle.yesBid.close == null) return 0.02;
  return Math.max(0, candle.yesAsk.close - candle.yesBid.close);
}

function sidePrice(candle: KalshiCandle, side: "yes" | "no", action: "enter" | "exit"): number | null {
  const yAsk = yesAsk(candle);
  const yBid = yesBid(candle);
  if (side === "yes") return action === "enter" ? yAsk : yBid;
  return action === "enter" ? (yBid == null ? null : 1 - yBid) : yAsk == null ? null : 1 - yAsk;
}

function marketIso(candle: KalshiCandle): string {
  return new Date(candle.endPeriodTs * 1000).toISOString();
}

function makeGenome(rand: () => number, generation: number, prefix: string): PreTrainingAgentGenome {
  const family = FAMILY_ORDER[Math.floor(rand() * FAMILY_ORDER.length)] ?? "momentum";
  const allocationPct = family === "risk-scout" ? between(rand, 0.004, 0.018) : between(rand, 0.008, 0.035);
  return {
    genomeId: `${prefix}-${Math.round(rand() * 1e9).toString(36)}`,
    generation,
    parentGenomeIds: [],
    family,
    lookbackMinutes: intBetween(rand, family === "breakout" ? 6 : 2, family === "breakout" ? 24 : 16),
    entryEdge: round(between(rand, family === "risk-scout" ? 0.012 : 0.018, 0.09)),
    exitEdge: round(between(rand, 0.002, 0.035)),
    maxHoldMinutes: intBetween(rand, 2, 20),
    maxSpread: round(between(rand, 0.015, family === "risk-scout" ? 0.08 : 0.14)),
    minVolume: intBetween(rand, 0, 250),
    stopLoss: round(between(rand, 0.04, family === "risk-scout" ? 0.18 : 0.32)),
    takeProfit: round(between(rand, 0.04, family === "breakout" ? 0.55 : 0.35)),
    allocationPct: round(allocationPct),
    riskPenalty: round(between(rand, family === "risk-scout" ? 1.8 : 0.8, family === "risk-scout" ? 4.5 : 3.2)),
  };
}

function crossover(a: PreTrainingAgentGenome, b: PreTrainingAgentGenome, rand: () => number, generation: number): PreTrainingAgentGenome {
  const pick = <K extends keyof PreTrainingAgentGenome>(key: K): PreTrainingAgentGenome[K] => (rand() < 0.5 ? a[key] : b[key]);
  return {
    genomeId: `child-g${generation}-${Math.round(rand() * 1e9).toString(36)}`,
    generation,
    parentGenomeIds: [a.genomeId, b.genomeId],
    family: pick("family"),
    lookbackMinutes: pick("lookbackMinutes"),
    entryEdge: pick("entryEdge"),
    exitEdge: pick("exitEdge"),
    maxHoldMinutes: pick("maxHoldMinutes"),
    maxSpread: pick("maxSpread"),
    minVolume: pick("minVolume"),
    stopLoss: pick("stopLoss"),
    takeProfit: pick("takeProfit"),
    allocationPct: pick("allocationPct"),
    riskPenalty: pick("riskPenalty"),
  };
}

function mutate(genome: PreTrainingAgentGenome, rand: () => number, mutationRate: number): PreTrainingAgentGenome {
  const wobble = (value: number, pct: number, lo: number, hi: number) =>
    round(clamp(value * (1 + between(rand, -pct, pct)), lo, hi));
  const maybe = <T>(current: T, next: () => T): T => (rand() < mutationRate ? next() : current);
  return {
    ...genome,
    family: maybe(genome.family, () => FAMILY_ORDER[Math.floor(rand() * FAMILY_ORDER.length)] ?? genome.family),
    lookbackMinutes: maybe(genome.lookbackMinutes, () => Math.round(clamp(genome.lookbackMinutes + intBetween(rand, -5, 5), 2, 30))),
    entryEdge: maybe(genome.entryEdge, () => wobble(genome.entryEdge, 0.55, 0.004, 0.12)),
    exitEdge: maybe(genome.exitEdge, () => wobble(genome.exitEdge, 0.65, 0.0005, 0.06)),
    maxHoldMinutes: maybe(genome.maxHoldMinutes, () => Math.round(clamp(genome.maxHoldMinutes + intBetween(rand, -4, 6), 1, 30))),
    maxSpread: maybe(genome.maxSpread, () => wobble(genome.maxSpread, 0.45, 0.006, 0.2)),
    minVolume: maybe(genome.minVolume, () => Math.round(clamp(genome.minVolume + intBetween(rand, -50, 80), 0, 1_000))),
    stopLoss: maybe(genome.stopLoss, () => wobble(genome.stopLoss, 0.45, 0.015, 0.55)),
    takeProfit: maybe(genome.takeProfit, () => wobble(genome.takeProfit, 0.45, 0.015, 0.75)),
    allocationPct: maybe(genome.allocationPct, () => wobble(genome.allocationPct, 0.5, 0.002, 0.05)),
    riskPenalty: maybe(genome.riskPenalty, () => wobble(genome.riskPenalty, 0.4, 0.2, 6)),
  };
}

function groupCandles(candles: KalshiCandle[], cfg: TrainingConfig): MarketSlice[] {
  const byMarket = new Map<string, KalshiCandle[]>();
  for (const candle of candles) {
    if (candle.seriesTicker && candle.seriesTicker !== cfg.seriesTicker) continue;
    if (priceYes(candle) == null) continue;
    byMarket.set(candle.marketTicker, [...(byMarket.get(candle.marketTicker) ?? []), candle]);
  }
  return [...byMarket.entries()]
    .map(([marketTicker, rows]) => ({
      marketTicker,
      candles: rows.sort((a, b) => a.endPeriodTs - b.endPeriodTs),
    }))
    .filter((market) => market.candles.length >= 8)
    .sort((a, b) => a.candles[0].endPeriodTs - b.candles[0].endPeriodTs)
    .slice(-cfg.marketLimit);
}

function splitMarkets(markets: MarketSlice[]): { train: MarketSlice[]; validation: MarketSlice[] } {
  if (markets.length <= 1) return { train: markets, validation: markets };
  const split = Math.max(1, Math.floor(markets.length * 0.72));
  return {
    train: markets.slice(0, split),
    validation: markets.slice(split),
  };
}

export function simulatePreTrainingAgent(
  markets: MarketSlice[],
  genome: PreTrainingAgentGenome,
  paper: { bankrollUsd: number; maxMarketUsd: number },
): EvalResult {
  const trades: PreTrainingPaperTrade[] = [];
  let pnlUsd = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  let totalRisked = 0;

  for (const market of markets) {
    const rows = market.candles;
    let open:
      | {
          side: "yes" | "no";
          openedAt: string;
          openedIndex: number;
          entryPrice: number;
          contracts: number;
          notionalUsd: number;
          reason: string;
        }
      | null = null;

    for (let i = genome.lookbackMinutes; i < rows.length; i += 1) {
      const current = rows[i];
      const prior = rows[i - genome.lookbackMinutes];
      const currentPrice = priceYes(current);
      const priorPrice = priceYes(prior);
      if (currentPrice == null || priorPrice == null) continue;

      const rawMomentum = currentPrice - priorPrice;
      const momentum =
        genome.family === "reversal"
          ? -rawMomentum
          : genome.family === "breakout"
            ? rawMomentum * (1 + Math.abs(rawMomentum) * 4)
            : rawMomentum;
      const edge = Math.abs(momentum);
      const volumeOk = (current.volume ?? Infinity) >= genome.minVolume;
      const spreadOk = spread(current) <= genome.maxSpread;

      if (!open && edge >= genome.entryEdge && volumeOk && spreadOk) {
        const side = momentum >= 0 ? "yes" : "no";
        const entryPrice = sidePrice(current, side, "enter");
        if (entryPrice == null || entryPrice <= 0 || entryPrice >= 1) continue;
        const notionalUsd = Math.min(paper.maxMarketUsd, paper.bankrollUsd * genome.allocationPct);
        const contracts = notionalUsd / entryPrice;
        open = {
          side,
          openedAt: marketIso(current),
          openedIndex: i,
          entryPrice,
          contracts,
          notionalUsd,
          reason: `entered ${genome.family} ${side} edge ${edge.toFixed(4)}`,
        };
        continue;
      }

      if (!open) continue;
      const exitPrice = sidePrice(current, open.side, "exit");
      if (exitPrice == null) continue;
      const heldMinutes = i - open.openedIndex;
      const tradeReturn = (exitPrice - open.entryPrice) / Math.max(open.entryPrice, 0.01);
      const shouldExit =
        edge <= genome.exitEdge ||
        heldMinutes >= genome.maxHoldMinutes ||
        tradeReturn <= -genome.stopLoss ||
        tradeReturn >= genome.takeProfit;
      if (!shouldExit) continue;

      const fee = open.notionalUsd * 0.003;
      const tradePnl = open.contracts * (exitPrice - open.entryPrice) - fee;
      trades.push({
        tradeId: `${genome.genomeId}-${market.marketTicker}-${open.openedIndex}-${i}`,
        marketTicker: market.marketTicker,
        side: open.side,
        openedAt: open.openedAt,
        closedAt: marketIso(current),
        entryPrice: open.entryPrice,
        exitPrice,
        contracts: open.contracts,
        notionalUsd: open.notionalUsd,
        pnlUsd: tradePnl,
        reason: `${open.reason}; exited after ${heldMinutes}m`,
      });
      pnlUsd += tradePnl;
      totalRisked += open.notionalUsd;
      peak = Math.max(peak, pnlUsd);
      maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - pnlUsd);
      open = null;
    }

    if (open) {
      const final = rows.at(-1);
      const exitPrice = final ? sidePrice(final, open.side, "exit") : null;
      if (final && exitPrice != null) {
        const fee = open.notionalUsd * 0.002;
        const tradePnl = open.contracts * (exitPrice - open.entryPrice) - fee;
        trades.push({
          tradeId: `${genome.genomeId}-${market.marketTicker}-${open.openedIndex}-final`,
          marketTicker: market.marketTicker,
          side: open.side,
          openedAt: open.openedAt,
          closedAt: marketIso(final),
          entryPrice: open.entryPrice,
          exitPrice,
          contracts: open.contracts,
          notionalUsd: open.notionalUsd,
          pnlUsd: tradePnl,
          reason: `${open.reason}; marked at historical close`,
        });
        pnlUsd += tradePnl;
        totalRisked += open.notionalUsd;
        peak = Math.max(peak, pnlUsd);
        maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - pnlUsd);
      }
    }
  }

  const wins = trades.filter((trade) => trade.pnlUsd > 0).length;
  const losses = trades.filter((trade) => trade.pnlUsd < 0).length;
  const winRate = wins + losses ? wins / (wins + losses) : null;
  const returnOnRisk = totalRisked > 0 ? pnlUsd / totalRisked : null;
  const tradePressure = trades.length ? Math.min(1.2, trades.length * 0.035) : -0.45;
  const winBonus = winRate == null ? 0 : (winRate - 0.5) * 2;
  const roiBonus = returnOnRisk == null ? 0 : clamp(returnOnRisk * 8, -2, 2);
  const reward =
    pnlUsd * (pnlUsd >= 0 ? 24 : 34) +
    tradePressure +
    winBonus +
    roiBonus -
    maxDrawdownUsd * genome.riskPenalty -
    trades.length * 0.01;

  return {
    genome,
    reward,
    pnlUsd,
    trades: trades.length,
    winRate,
    maxDrawdownUsd,
    returnOnRisk,
    recentTrades: trades.slice(-8),
  };
}

function rankWithFamilies(rows: EvalResult[], trainById = new Map<string, EvalResult>()): PreTrainingAgentScore[] {
  const familySeen = new Map<PreTrainingAgentGenome["family"], number>();
  return rows.map((row) => {
    const rank = (familySeen.get(row.genome.family) ?? 0) + 1;
    familySeen.set(row.genome.family, rank);
    return {
      ...row,
      familyRank: rank,
      trainReward: trainById.get(row.genome.genomeId)?.reward,
      validationReward: row.reward,
    };
  });
}

function cycleSummary(
  cycle: number,
  populationSize: number,
  evaluated: EvalResult[],
  mutationRate: number,
  eliteCount: number,
): PreTrainingCycleSummary {
  const rewards = evaluated.map((row) => row.reward);
  const pnls = evaluated.map((row) => row.pnlUsd);
  const families = new Set(evaluated.map((row) => row.genome.family));
  const lookbacks = new Set(evaluated.map((row) => row.genome.lookbackMinutes));
  return {
    cycle,
    populationSize,
    bestGenomeId: evaluated[0]?.genome.genomeId ?? null,
    bestReward: evaluated[0]?.reward ?? null,
    averageReward: rewards.length ? rewards.reduce((sum, value) => sum + value, 0) / rewards.length : 0,
    averagePnlUsd: pnls.length ? pnls.reduce((sum, value) => sum + value, 0) / pnls.length : 0,
    tradedAgents: evaluated.filter((row) => row.trades > 0).length,
    mutationRate,
    eliteCount,
    diversity: evaluated.length ? (families.size + lookbacks.size) / evaluated.length : 0,
  };
}

function nextPopulation(args: {
  evaluated: EvalResult[];
  size: number;
  cycle: number;
  rand: () => number;
  mutationRate: number;
}): PreTrainingAgentGenome[] {
  const eliteCount = Math.max(2, Math.ceil(args.size * 0.22));
  const elites = args.evaluated.slice(0, eliteCount).map((row) => row.genome);
  const next = [...elites];
  while (next.length < args.size) {
    const a = elites[Math.floor(args.rand() * elites.length)] ?? elites[0];
    const b = elites[Math.floor(args.rand() * elites.length)] ?? a;
    const child = mutate(crossover(a, b, args.rand, args.cycle + 1), args.rand, args.mutationRate);
    next.push(child);
  }
  return next;
}

function initialPopulation(args: {
  size: number;
  rand: () => number;
  previousChampion: PreTrainingAgentScore | null;
}): PreTrainingAgentGenome[] {
  const population: PreTrainingAgentGenome[] = [];
  if (args.previousChampion) {
    population.push(args.previousChampion.genome);
    for (let i = 0; i < Math.min(8, args.size - 1); i += 1) {
      population.push({
        ...mutate(args.previousChampion.genome, args.rand, 0.8),
        genomeId: `champ-child-g1-${Math.round(args.rand() * 1e9).toString(36)}`,
        generation: args.previousChampion.genome.generation + 1,
        parentGenomeIds: [args.previousChampion.genome.genomeId],
      });
    }
  }
  let index = 0;
  while (population.length < args.size) {
    population.push(makeGenome(args.rand, 1, `${FAMILY_ORDER[index % FAMILY_ORDER.length]}-seed`));
    index += 1;
  }
  return population;
}

async function readChampion(): Promise<PreTrainingAgentScore | null> {
  return readDocument<PreTrainingAgentScore | null>(`${PRETRAINING_NAMESPACE}:champion`, CHAMPION_FILE, null, (value) => {
    const parsed = value as Partial<PreTrainingAgentScore>;
    return parsed.genome && typeof parsed.reward === "number" ? (parsed as PreTrainingAgentScore) : null;
  });
}

async function readLastRun(): Promise<PreTrainingRun | null> {
  return readDocument<PreTrainingRun | null>(`${PRETRAINING_NAMESPACE}:last-run`, LAST_RUN_FILE, null, (value) => {
    const parsed = value as Partial<PreTrainingRun>;
    return typeof parsed.runId === "string" ? (parsed as PreTrainingRun) : null;
  });
}

async function readRunHistory(): Promise<PreTrainingRun[]> {
  return readDocument<PreTrainingRun[]>(`${PRETRAINING_NAMESPACE}:run-history`, RUN_HISTORY_FILE, [], (value) =>
    Array.isArray(value) ? (value as PreTrainingRun[]) : [],
  );
}

async function appendRunHistory(run: PreTrainingRun): Promise<void> {
  const history = await readRunHistory();
  await writeDocument(`${PRETRAINING_NAMESPACE}:run-history`, RUN_HISTORY_FILE, [run, ...history.filter((row) => row.runId !== run.runId)].slice(0, 100));
}

export async function runGeneticPreTraining(options: PreTrainingOptions = {}): Promise<PreTrainingRun> {
  const cfg = config(options);
  const [previousChampion, candles] = await Promise.all([
    readChampion(),
    readKalshiCandles({ periodInterval: 1 }),
  ]);
  const markets = groupCandles(candles, cfg);
  const runId = `pre-training-${Date.now().toString(36)}`;
  const generatedAt = new Date().toISOString();

  if (!markets.length) {
    const emptyRun: PreTrainingRun = {
      runId,
      generatedAt,
      seriesTicker: cfg.seriesTicker,
      mode: "historical-genetic",
      cyclesRequested: cfg.cycles,
      populationSize: cfg.populationSize,
      candleCount: 0,
      trainMarkets: [],
      validationMarkets: [],
      champion: previousChampion,
      previousChampion,
      promoted: false,
      cycles: [],
      leaderboard: [],
      notes: ["Waiting for historical Kalshi candles. Run the history backfill before pre-training."],
    };
    await writeDocument(`${PRETRAINING_NAMESPACE}:last-run`, LAST_RUN_FILE, emptyRun);
    await appendRunHistory(emptyRun);
    return emptyRun;
  }

  const split = splitMarkets(markets);
  const rand = rng(hashSeed(`${runId}:${markets.length}:${markets.at(-1)?.marketTicker ?? ""}`));
  let population = initialPopulation({ size: cfg.populationSize, rand, previousChampion });
  const cycles: PreTrainingCycleSummary[] = [];
  let finalTrainEvaluations: EvalResult[] = [];

  for (let cycle = 1; cycle <= cfg.cycles; cycle += 1) {
    const mutationRate = clamp(0.34 - cycle * 0.012, 0.08, 0.34);
    const evaluated = population
      .map((genome) => simulatePreTrainingAgent(split.train, genome, cfg))
      .sort((a, b) => b.reward - a.reward);
    finalTrainEvaluations = evaluated;
    const eliteCount = Math.max(2, Math.ceil(cfg.populationSize * 0.22));
    cycles.push(cycleSummary(cycle, population.length, evaluated, mutationRate, eliteCount));
    if (cycle < cfg.cycles) {
      population = nextPopulation({
        evaluated,
        size: cfg.populationSize,
        cycle,
        rand,
        mutationRate,
      });
    }
  }

  const validationCandidates = finalTrainEvaluations.slice(0, Math.max(8, Math.ceil(cfg.populationSize * 0.35)));
  const trainById = new Map(finalTrainEvaluations.map((row) => [row.genome.genomeId, row]));
  const validated = validationCandidates
    .map((row) => simulatePreTrainingAgent(split.validation, row.genome, cfg))
    .sort((a, b) => b.reward - a.reward);
  const leaderboard = rankWithFamilies(validated, trainById).slice(0, 24);
  const candidate = leaderboard[0] ?? null;
  const hurdle = Math.max(0, previousChampion?.validationReward ?? previousChampion?.reward ?? 0);
  const promoted = Boolean(candidate && candidate.reward > hurdle && candidate.trades > 0);
  const champion = promoted ? candidate : previousChampion;

  if (promoted && champion) await writeDocument(`${PRETRAINING_NAMESPACE}:champion`, CHAMPION_FILE, champion);
  const run: PreTrainingRun = {
    runId,
    generatedAt,
    seriesTicker: cfg.seriesTicker,
    mode: "historical-genetic",
    cyclesRequested: cfg.cycles,
    populationSize: cfg.populationSize,
    candleCount: markets.reduce((sum, market) => sum + market.candles.length, 0),
    trainMarkets: split.train.map((market) => market.marketTicker),
    validationMarkets: split.validation.map((market) => market.marketTicker),
    champion,
    previousChampion,
    promoted,
    cycles,
    leaderboard,
    notes: [
      "Historical pre-training uses cached Kalshi candles only; it never sends live orders.",
      "Each cycle scores a population, keeps elites, crosses parents, mutates children, and validates the final cohort on later markets.",
      promoted ? "A validation champion cleared the incumbent hurdle." : "No validation candidate beat the incumbent hurdle.",
    ],
  };

  await writeDocument(`${PRETRAINING_NAMESPACE}:last-run`, LAST_RUN_FILE, run);
  await appendRunHistory(run);
  await appendLedger({
    type: "model_version",
    modelId: `pre-training-${champion?.genome.genomeId ?? "no-champion"}`,
    dataCutoff: generatedAt,
    score: champion?.reward ?? 0,
    payload: run,
  });
  await appendLedger({
    type: "paper_action",
    action: promoted ? "simulated_fill" : "rejected",
    channel: "portfolio",
    notionalUsd: 0,
    reason: promoted
      ? "Historical genetic pre-training promoted a paper-only champion."
      : "Historical genetic pre-training completed without promotion.",
    payload: run,
  });
  return run;
}

export async function readPreTrainingSummary(): Promise<PreTrainingSummary> {
  const cfg = config();
  const [manifest, lastRun, champion, runHistory] = await Promise.all([
    readKalshiHistoryManifest(),
    readLastRun(),
    readChampion(),
    readRunHistory(),
  ]);
  const availableMarkets = Object.values(manifest.markets).filter((market) =>
    market.seriesTickers.length ? market.seriesTickers.includes(cfg.seriesTicker) : true,
  );
  return {
    enabled: envFlag("PRE_TRAINING_ENABLED", true),
    seriesTicker: cfg.seriesTicker,
    availableMarkets: availableMarkets.length,
    availableCandles: availableMarkets.reduce((sum, market) => sum + market.candles, 0),
    lastRun,
    champion,
    runHistory,
  };
}

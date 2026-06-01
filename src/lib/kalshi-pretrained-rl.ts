import "server-only";

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readKalshiOrderbookEvents } from "@/lib/kalshi-orderbook";
import { appendLedger } from "@/lib/ledger";
import { dataDir } from "@/lib/storage";
import type {
  KalshiPretrainedRlModelCard,
  KalshiPretrainedRlSignal,
  KalshiPretrainedRlSummary,
  KalshiPretrainedRlTrainingRun,
  KalshiMollyAgentSignal,
  KalshiMollyLineRun,
  KalshiOrderbookEvent,
  KalshiPaperRlOpenPosition,
  KalshiPaperRlPerformance,
  KalshiPaperRlTrade,
} from "@/lib/types";

const MODEL_PREFIX = "kalshi-pretrained-rl";

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

function envTrim(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function kalshiPretrainedRlArtifactDir(): string {
  return envTrim(process.env.KALSHI_PRETRAINED_RL_DATA_DIR) || path.join(dataDir(), "kalshi-pretrained-rl");
}

function kalshiHistoryDir(): string {
  return envTrim(process.env.KALSHI_HISTORY_DATA_DIR) || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "kalshi-history");
}

function pythonExecutable(): string {
  return envTrim(process.env.KALSHI_PRETRAINED_RL_PYTHON) || "python3";
}

function sidecarEnv(): NodeJS.ProcessEnv {
  const pretrainingPath = path.join(/*turbopackIgnore: true*/ process.cwd(), "pretraining");
  const priorPythonPath = process.env.PYTHONPATH;
  return {
    ...process.env,
    PYTHONPATH: priorPythonPath ? `${pretrainingPath}${path.delimiter}${priorPythonPath}` : pretrainingPath,
    KALSHI_PRETRAINED_RL_DATA_DIR: kalshiPretrainedRlArtifactDir(),
    KALSHI_HISTORY_DATA_DIR: kalshiHistoryDir(),
    KALSHI_PRETRAINED_RL_SERIES: envTrim(process.env.KALSHI_PRETRAINED_RL_SERIES) || "KXBTC15M",
  };
}

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  const file = path.join(kalshiPretrainedRlArtifactDir(), fileName);
  try {
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function extractJson(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error(`Pretrained RL sidecar did not return JSON: ${trimmed.slice(0, 240)}`);
  }
}

async function runSidecar<T>(args: string[], timeoutMs = 20 * 60_000): Promise<T> {
  await mkdir(kalshiPretrainedRlArtifactDir(), { recursive: true });
  return new Promise<T>((resolve, reject) => {
    const child = spawn(pythonExecutable(), ["-m", "kalshi_pretrained_rl", ...args], {
      cwd: process.cwd(),
      env: sidecarEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Pretrained RL sidecar timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Pretrained RL sidecar exited with code ${code}.`));
        return;
      }
      try {
        resolve(extractJson(stdout) as T);
      } catch (error) {
        reject(error);
      }
    });
  });
}

function normalizeSignal(value: unknown): KalshiPretrainedRlSignal | null {
  if (!value || typeof value !== "object") return null;
  const signal = value as Partial<KalshiPretrainedRlSignal>;
  if (typeof signal.generatedAt !== "string") return null;
  return signal as KalshiPretrainedRlSignal;
}

function normalizeRun(value: unknown): KalshiPretrainedRlTrainingRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Partial<KalshiPretrainedRlTrainingRun>;
  if (typeof run.runId !== "string" || typeof run.generatedAt !== "string") return null;
  return run as KalshiPretrainedRlTrainingRun;
}

function normalizeModelCard(value: unknown): KalshiPretrainedRlModelCard | null {
  if (!value || typeof value !== "object") return null;
  const card = value as Partial<KalshiPretrainedRlModelCard>;
  if (typeof card.modelId !== "string" || !card.modelId.startsWith(MODEL_PREFIX)) return null;
  return card as KalshiPretrainedRlModelCard;
}

export async function runKalshiPretrainedRlTrain(): Promise<KalshiPretrainedRlTrainingRun> {
  const run = normalizeRun(await runSidecar(["train"]));
  if (!run) throw new Error("Pretrained RL training completed without a valid run payload.");
  await appendLedger({
    type: "model_version",
    modelId: `${MODEL_PREFIX}-${run.runId.replace(/^kalshi-pretrained-rl-/, "")}`,
    dataCutoff: run.generatedAt,
    score: run.metrics.validation?.avgReward ?? run.metrics.train?.avgReward ?? 0,
    payload: run,
  });
  await appendLedger({
    type: "paper_action",
    action: "rejected",
    channel: "pretrained-rl-shadow",
    notionalUsd: 0,
    reason: "Pretrained RL completed a paper-shadow CPU training run.",
    payload: run,
  });
  return run;
}

export async function runKalshiPretrainedRlInference(): Promise<KalshiPretrainedRlSignal> {
  const signal = normalizeSignal(await runSidecar(["infer"], 5 * 60_000));
  if (!signal) throw new Error("Pretrained RL inference completed without a valid signal payload.");
  return signal;
}

const MOLLY_AGENTS: Array<
  Pick<KalshiMollyAgentSignal, "agentId" | "displayName" | "minConfidence" | "notionalUsd"> & {
    parentAgentId?: string | null;
    generation: number;
    exitEdge: number;
    sizeMultiplier: number;
  }
> = [
  {
    agentId: "molly-parent",
    displayName: "Molly Parent",
    minConfidence: 0.56,
    notionalUsd: 8,
    parentAgentId: null,
    generation: 1,
    exitEdge: 0.015,
    sizeMultiplier: 1,
  },
  {
    agentId: "molly-kid-ada",
    displayName: "Ada Molly",
    minConfidence: 0.52,
    notionalUsd: 5,
    parentAgentId: "molly-parent",
    generation: 2,
    exitEdge: 0.01,
    sizeMultiplier: 0.75,
  },
  {
    agentId: "molly-kid-grace",
    displayName: "Grace Molly",
    minConfidence: 0.58,
    notionalUsd: 10,
    parentAgentId: "molly-parent",
    generation: 2,
    exitEdge: 0.02,
    sizeMultiplier: 1,
  },
  {
    agentId: "molly-kid-hedy",
    displayName: "Hedy Molly",
    minConfidence: 0.64,
    notionalUsd: 15,
    parentAgentId: "molly-parent",
    generation: 2,
    exitEdge: 0.03,
    sizeMultiplier: 1.15,
  },
  {
    agentId: "molly-kid-katherine",
    displayName: "Katherine Molly",
    minConfidence: 0.7,
    notionalUsd: 20,
    parentAgentId: "molly-parent",
    generation: 2,
    exitEdge: 0.04,
    sizeMultiplier: 1.25,
  },
  {
    agentId: "molly-kid-joan",
    displayName: "Joan Molly",
    minConfidence: 0.78,
    notionalUsd: 25,
    parentAgentId: "molly-parent",
    generation: 2,
    exitEdge: 0.055,
    sizeMultiplier: 1.35,
  },
];

function latestQuoteForSignal(events: KalshiOrderbookEvent[], signal: KalshiPretrainedRlSignal | null): KalshiOrderbookEvent | null {
  return [...events]
    .reverse()
    .find((event) => !signal?.marketTicker || event.marketTicker === signal.marketTicker) ?? events.at(-1) ?? null;
}

function signalMarkPrice(event: KalshiOrderbookEvent | null, side: "yes" | "no" | "flat"): number | null {
  if (!event || side === "flat") return null;
  return side === "yes" ? event.yesBid ?? event.yesAsk : event.noBid ?? event.noAsk;
}

function performanceForMolly(
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

function mollyPaperBook(
  agent: (typeof MOLLY_AGENTS)[number],
  signal: KalshiPretrainedRlSignal | null,
  events: KalshiOrderbookEvent[],
): {
  status: KalshiMollyAgentSignal["status"];
  notionalUsd: number;
  reward: number;
  pnlUsd: number;
  trades: number;
  openPositions: KalshiPaperRlOpenPosition[];
  recentTrades: KalshiPaperRlTrade[];
  performance: KalshiPaperRlPerformance;
  reason: string;
} {
  const confidence = signal?.confidence ?? 0;
  const side = signal?.side ?? "flat";
  const canTrade = Boolean(signal?.ok && side !== "flat" && confidence >= agent.minConfidence);
  if (!canTrade || side === "flat") {
    return {
      status: signal?.ok ? "paper_hold" : "waiting",
      notionalUsd: 0,
      reward: signal?.ok ? confidence - agent.minConfidence : 0,
      pnlUsd: 0,
      trades: 0,
      openPositions: [],
      recentTrades: [],
      performance: performanceForMolly([], [], 1_000),
      reason: signal?.ok
        ? `${agent.displayName} held; confidence below Molly threshold or flat action.`
        : signal?.reason ?? `${agent.displayName} is waiting for a live pretrained signal.`,
    };
  }
  if (!signal) {
    return {
      status: "waiting",
      notionalUsd: 0,
      reward: 0,
      pnlUsd: 0,
      trades: 0,
      openPositions: [],
      recentTrades: [],
      performance: performanceForMolly([], [], 1_000),
      reason: `${agent.displayName} is waiting for a live pretrained signal.`,
    };
  }
  const liveSignal = signal;
  const quote = latestQuoteForSignal(events, liveSignal);
  const entryPrice = liveSignal.entryMark && liveSignal.entryMark > 0 ? liveSignal.entryMark : signalMarkPrice(quote, side);
  const markPrice = signalMarkPrice(quote, side);
  if (entryPrice == null || markPrice == null || entryPrice <= 0) {
    return {
      status: "paper_hold",
      notionalUsd: 0,
      reward: -0.1,
      pnlUsd: 0,
      trades: 0,
      openPositions: [],
      recentTrades: [],
      performance: performanceForMolly([], [], 1_000),
      reason: `${agent.displayName} held; no usable live mark for pretrained signal.`,
    };
  }
  const notionalUsd = Number((agent.notionalUsd * agent.sizeMultiplier).toFixed(2));
  const contracts = notionalUsd / entryPrice;
  const markValueUsd = contracts * markPrice;
  const pnlUsd = markValueUsd - notionalUsd;
  const reward =
    pnlUsd * (pnlUsd >= 0 ? 22 : 34) +
    Math.max(0, confidence - agent.minConfidence) * 2.5 -
    Math.max(0, agent.minConfidence - confidence) * 1.5;
  const openedAt = signal.generatedAt ?? new Date().toISOString();
  const markedAt = quote?.receivedAt ?? openedAt;
  const trade: KalshiPaperRlTrade = {
    tradeId: `${agent.agentId}-${liveSignal.marketTicker ?? "unknown"}-${liveSignal.inputWindowHash ?? openedAt}`,
    marketTicker: liveSignal.marketTicker ?? quote?.marketTicker ?? "unknown",
    side,
    openedAt,
    closedAt: null,
    entryPrice,
    exitPrice: markPrice,
    contracts,
    notionalUsd,
    pnlUsd,
    reason: `${agent.displayName} child policy followed pretrained ${liveSignal.action ?? side} signal at confidence ${confidence.toFixed(3)}.`,
  };
  const openPosition: KalshiPaperRlOpenPosition = {
    marketTicker: trade.marketTicker,
    side,
    yesContracts: side === "yes" ? contracts : 0,
    noContracts: side === "no" ? contracts : 0,
    netContracts: contracts,
    costBasisUsd: notionalUsd,
    markValueUsd,
    unrealizedPnlUsd: pnlUsd,
    averageEntryPrice: entryPrice,
    markPrice,
    openedAt,
    markedAt,
    secondsToClose: quote?.windowCloseTime
      ? Math.max(0, Math.round((Date.parse(quote.windowCloseTime) - Date.parse(markedAt)) / 1000))
      : null,
  };
  return {
    status: "paper_live_trade",
    notionalUsd,
    reward,
    pnlUsd,
    trades: 1,
    openPositions: [openPosition],
    recentTrades: [trade],
    performance: performanceForMolly([trade], [openPosition], 1_000),
    reason: trade.reason,
  };
}

function mollyAgentSignals(signal: KalshiPretrainedRlSignal | null, events: KalshiOrderbookEvent[]): KalshiMollyAgentSignal[] {
  const generatedAt = new Date().toISOString();
  return MOLLY_AGENTS.map((agent) => {
    const confidence = signal?.confidence ?? 0;
    const side = signal?.side ?? "flat";
    const paper = mollyPaperBook(agent, signal, events);
    return {
      agentId: agent.agentId,
      displayName: agent.displayName,
      familyName: "Molly",
      lineage: "molly",
      parentAgentId: agent.parentAgentId ?? null,
      generation: agent.generation,
      generatedAt,
      marketTicker: signal?.marketTicker ?? null,
      modelId: signal?.modelId ?? null,
      action: signal?.action ?? "flat",
      side,
      size: signal?.size ?? "none",
      confidence,
      minConfidence: agent.minConfidence,
      status: paper.status,
      notionalUsd: paper.notionalUsd,
      reward: paper.reward,
      pnlUsd: paper.pnlUsd,
      trades: paper.trades,
      openPositions: paper.openPositions,
      recentTrades: paper.recentTrades,
      performance: paper.performance,
      reason: paper.reason,
    };
  });
}

export async function runKalshiMollyLineOnce(): Promise<KalshiMollyLineRun> {
  const seriesTicker = envTrim(process.env.KALSHI_PRETRAINED_RL_SERIES) || "KXBTC15M";
  const artifactDir = kalshiPretrainedRlArtifactDir();
  await mkdir(artifactDir, { recursive: true });
  const events = await readKalshiOrderbookEvents({ limit: 2_000, seriesTicker });
  const inputFile = path.join(artifactDir, "molly-live-input.json");
  await writeFile(inputFile, `${JSON.stringify({ events }, null, 2)}\n`, "utf8");
  const baseSignal = normalizeSignal(
    await runSidecar(["infer-json", "--input-json", inputFile, "--lineage", "molly"], 5 * 60_000),
  );
  const run: KalshiMollyLineRun = {
    runId: `kalshi-pretrained-rl-molly-${Date.now().toString(36)}`,
    generatedAt: new Date().toISOString(),
    mode: "paper-live-shadow",
    lineage: "molly",
    seriesTicker,
    recentEvents: events.length,
    baseSignal,
    agents: mollyAgentSignals(baseSignal, events),
    notes: [
      "Molly agents use live orderbook events and the pretrained RL checkpoint in paper-shadow mode.",
      "No broker or Kalshi live order route is called.",
      "Learning happens through the isolated pretrained RL retraining/promotion loop.",
    ],
  };
  await writeFile(path.join(artifactDir, "molly-line-latest.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await appendLedger({
    type: "paper_action",
    action: run.agents.some((agent) => agent.status === "paper_live_trade") ? "proposal" : "rejected",
    channel: "pretrained-rl-shadow",
    notionalUsd: run.agents.reduce((sum, agent) => sum + agent.notionalUsd, 0),
    reason: "Molly line evaluated a paper-live pretrained RL signal.",
    payload: run,
  });
  return run;
}

export async function readKalshiPretrainedRlSummary(): Promise<KalshiPretrainedRlSummary> {
  const [lastRun, champion, latestSignal, mollyLine, runHistory] = await Promise.all([
    readJson<unknown>("last-run.json", null),
    readJson<unknown>("champion-metadata.json", null),
    readJson<unknown>("latest-shadow-signal.json", null),
    readJson<KalshiMollyLineRun | null>("molly-line-latest.json", null),
    readJson<unknown[]>("run-history.json", []),
  ]);
  return {
    enabled: envFlag("KALSHI_PRETRAINED_RL_ENABLED", false),
    seriesTicker: envTrim(process.env.KALSHI_PRETRAINED_RL_SERIES) || "KXBTC15M",
    artifactDir: kalshiPretrainedRlArtifactDir(),
    lastRun: normalizeRun(lastRun),
    champion: normalizeModelCard(champion),
    latestSignal: normalizeSignal(latestSignal),
    mollyLine,
    runHistory: Array.isArray(runHistory) ? runHistory.map(normalizeRun).filter((row): row is KalshiPretrainedRlTrainingRun => Boolean(row)).slice(0, 20) : [],
  };
}

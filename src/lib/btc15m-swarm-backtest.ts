import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

export type Btc15mSourceMode = "historical" | "live" | "combined";
export type Btc15mSettlementMode = "permissive" | "strict";

type BacktestMetric = {
  agent: string;
  predictions: number;
  correct: number;
  trades: number;
  wins: number;
  losses: number;
  pnlUsd: number;
  notionalUsd: number;
  roi: number;
  winRate: number | null;
  accuracy: number | null;
  sharpe: number;
  maxDrawdownUsd: number;
  alphaBeta?: Record<
    "buyYes" | "buyNo" | "random",
    {
      alphaPerMarket: number;
      beta: number;
      correlation: number;
      rSquared: number;
      activeReturnPerMarket: number;
      observations: number;
    }
  >;
};

type BacktestSummary = {
  generatedAt: string;
  seriesTicker: string;
  sourceMode?: Btc15mSourceMode;
  settlementMode?: Btc15mSettlementMode;
  assumptions: {
    oneDecisionPerMarket: boolean;
    entryLookbackMinutes: number;
    maxMarkets: number;
    warmupEpisodes?: number;
    testStartRequested?: string;
    testEndRequested?: string;
    notionalUsd: number;
    feeRate: number;
    minConfidence: number;
    settlementInference: string;
  };
  data: {
    manifestMarkets: number;
    loadedMarkets: number;
    usableEpisodes: number;
    fitEpisodes: number;
    validationEpisodes: number;
    testEpisodes: number;
    priorEpisodesAvailable?: number;
    testStart: string | null;
    testEnd: string | null;
    ambiguousSettlements: number;
  };
  metrics: Record<string, BacktestMetric>;
  leaderboard: Array<BacktestMetric & { rank: number }>;
  modelNotes: Record<string, string>;
};

type MatrixFile = {
  generatedAt: string;
  seriesTicker: string;
  periods: Array<{
    key: string;
    label: string;
    testStart: string;
    testEnd: string;
    runs: Record<
      Btc15mSettlementMode,
      Partial<
        Record<
          Btc15mSourceMode,
          {
            summaryFile: string;
            tradesFile: string;
          }
        >
      >
    >;
  }>;
};

export type Btc15mTrade = {
  agent: string;
  marketTicker: string;
  timestamp: string;
  side: "yes" | "no";
  confidence: number;
  score: number;
  selectedAgent?: string;
  routeReason?: string;
  regimeKey?: string;
  entryPrice: number;
  settlement: number;
  contracts: number;
  notionalUsd: number;
  pnlUsd: number;
  correct: boolean;
  ambiguousSettlement: boolean;
};

export type Btc15mModeDashboard = BacktestSummary & {
  mode: Btc15mSettlementMode;
  source: Btc15mSourceMode;
  periodKey: string;
  periodLabel: string;
  label: string;
  sourceLabel: string;
  caveat: string;
  sourceCaveat: string;
  trades: Btc15mTrade[];
  equityCurve: Array<Record<string, number | string>>;
  agentRows: Array<BacktestMetric & { rank: number }>;
};

export type Btc15mSourceComparisonRow = {
  source: Btc15mSourceMode;
  label: string;
  swarmPnl: number;
  swarmRoi: number;
  swarmSharpe: number;
  swarmTrades: number;
  swarmAccuracy: number | null;
  buyYesPnl: number;
  testEpisodes: number;
  fitEpisodes: number;
  validationEpisodes: number;
  priorEpisodesAvailable: number;
};

export type Btc15mSettlementDashboard = {
  mode: Btc15mSettlementMode;
  label: string;
  caveat: string;
  sources: Partial<Record<Btc15mSourceMode, Btc15mModeDashboard>>;
  comparisonRows: Btc15mSourceComparisonRow[];
  verdict: {
    title: string;
    body: string;
    tone: "good" | "warn" | "bad";
  };
};

export type Btc15mPeriodDashboard = {
  key: string;
  label: string;
  testStart: string;
  testEnd: string;
  modes: Record<Btc15mSettlementMode, Btc15mSettlementDashboard>;
};

export type Btc15mSwarmDashboardData = {
  generatedAt: string;
  defaultPeriodKey: string;
  periods: Btc15mPeriodDashboard[];
  verdict: Btc15mSettlementDashboard["verdict"];
};

const DATA_DIR = path.join(process.cwd(), ".data", "btc15m-swarm-backtest");
const SOURCE_MODES: Btc15mSourceMode[] = ["historical", "live", "combined"];
const SETTLEMENT_MODES: Btc15mSettlementMode[] = ["permissive", "strict"];
const DEFAULT_PERIOD = "mar-23-29";

const SETTLEMENT_LABELS: Record<Btc15mSettlementMode, { label: string; caveat: string }> = {
  permissive: {
    label: "Permissive final mark",
    caveat: "Uses final quote/price to infer unresolved markets, so it has many more samples but more label risk.",
  },
  strict: {
    label: "Strict binary settlement",
    caveat: "Keeps only markets whose final candle looks close to a true 0/1 outcome, so it is cleaner but smaller.",
  },
};

const SOURCE_LABELS: Record<Btc15mSourceMode, { label: string; caveat: string }> = {
  historical: {
    label: "Historical only",
    caveat: "Fits on downloaded historical archive rows before the test window and ignores live-captured duplicates.",
  },
  live: {
    label: "Live-captured only",
    caveat: "Fits on locally downloaded live-capture rows before the test window. This is cached live data, not a fresh network pull.",
  },
  combined: {
    label: "Historical + live",
    caveat: "Fits on the union of historical and live-captured rows before the test window, deduped by candle timestamp.",
  },
};

export async function buildBtc15mSwarmDashboardData(): Promise<Btc15mSwarmDashboardData> {
  const matrix = await readMatrix();
  if (!matrix) return buildLegacyDashboardData();

  const periods = await Promise.all(
    matrix.periods.map(async (period) => {
      const modes = Object.fromEntries(
        await Promise.all(
          SETTLEMENT_MODES.map(async (mode) => {
            const sources = Object.fromEntries(
              (
                await Promise.all(
                  SOURCE_MODES.map(async (source) => {
                    const run = period.runs[mode]?.[source];
                    if (!run) return null;
                    const [summaryRaw, tradesRaw] = await Promise.all([
                      readFile(path.join(DATA_DIR, run.summaryFile), "utf8"),
                      readFile(path.join(DATA_DIR, run.tradesFile), "utf8").catch(() => ""),
                    ]);
                    const summary = JSON.parse(summaryRaw) as BacktestSummary;
                    const trades = parseTradesCsv(tradesRaw);
                    const settlementMeta = SETTLEMENT_LABELS[mode];
                    const sourceMeta = SOURCE_LABELS[source];
                    const dashboard: Btc15mModeDashboard = {
                      ...summary,
                      mode,
                      source,
                      periodKey: period.key,
                      periodLabel: period.label,
                      label: settlementMeta.label,
                      sourceLabel: sourceMeta.label,
                      caveat: settlementMeta.caveat,
                      sourceCaveat: sourceMeta.caveat,
                      trades,
                      equityCurve: buildEquityCurve(trades),
                      agentRows: summary.leaderboard.slice().sort((a, b) => a.rank - b.rank),
                    };
                    return [source, dashboard] as const;
                  }),
                )
              ).filter((row): row is readonly [Btc15mSourceMode, Btc15mModeDashboard] => Boolean(row)),
            ) as Partial<Record<Btc15mSourceMode, Btc15mModeDashboard>>;

            const comparisonRows = buildSourceComparisonRows(sources);
            const settlement: Btc15mSettlementDashboard = {
              mode,
              label: SETTLEMENT_LABELS[mode].label,
              caveat: SETTLEMENT_LABELS[mode].caveat,
              sources,
              comparisonRows,
              verdict: sourceVerdict(sources.combined ?? sources.historical),
            };
            return [mode, settlement] as const;
          }),
        ),
      ) as Record<Btc15mSettlementMode, Btc15mSettlementDashboard>;

      return {
        key: period.key,
        label: period.label,
        testStart: period.testStart,
        testEnd: period.testEnd,
        modes,
      };
    }),
  );

  const defaultPeriodKey = periods.some((period) => period.key === DEFAULT_PERIOD) ? DEFAULT_PERIOD : periods[0]?.key;
  const defaultPeriod = periods.find((period) => period.key === defaultPeriodKey) ?? periods[0];
  const verdict = defaultPeriod?.modes.strict.verdict ?? {
    title: "No backtest matrix",
    body: "Generate the BTC 15m swarm matrix before using this dashboard.",
    tone: "bad" as const,
  };

  return {
    generatedAt: matrix.generatedAt,
    defaultPeriodKey: defaultPeriodKey ?? "",
    periods,
    verdict,
  };
}

async function readMatrix() {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, "matrix.json"), "utf8")) as MatrixFile;
  } catch {
    return null;
  }
}

async function buildLegacyDashboardData(): Promise<Btc15mSwarmDashboardData> {
  const period: Btc15mPeriodDashboard = {
    key: "legacy",
    label: "Legacy run",
    testStart: "",
    testEnd: "",
    modes: {
      permissive: await legacySettlement("permissive", "permissive-final-mark.json", "permissive-final-mark-trades.csv"),
      strict: await legacySettlement("strict", "strict-binary.json", "strict-binary-trades.csv"),
    },
  };
  return {
    generatedAt: new Date().toISOString(),
    defaultPeriodKey: period.key,
    periods: [period],
    verdict: period.modes.strict.verdict,
  };
}

async function legacySettlement(mode: Btc15mSettlementMode, json: string, csv: string): Promise<Btc15mSettlementDashboard> {
  const [summaryRaw, tradesRaw] = await Promise.all([
    readFile(path.join(DATA_DIR, json), "utf8"),
    readFile(path.join(DATA_DIR, csv), "utf8").catch(() => ""),
  ]);
  const summary = JSON.parse(summaryRaw) as BacktestSummary;
  const trades = parseTradesCsv(tradesRaw);
  const dashboard: Btc15mModeDashboard = {
    ...summary,
    mode,
    source: "historical",
    periodKey: "legacy",
    periodLabel: "Legacy run",
    label: SETTLEMENT_LABELS[mode].label,
    sourceLabel: SOURCE_LABELS.historical.label,
    caveat: SETTLEMENT_LABELS[mode].caveat,
    sourceCaveat: SOURCE_LABELS.historical.caveat,
    trades,
    equityCurve: buildEquityCurve(trades),
    agentRows: summary.leaderboard.slice().sort((a, b) => a.rank - b.rank),
  };
  const sources = { historical: dashboard };
  return {
    mode,
    label: SETTLEMENT_LABELS[mode].label,
    caveat: SETTLEMENT_LABELS[mode].caveat,
    sources,
    comparisonRows: buildSourceComparisonRows(sources),
    verdict: sourceVerdict(dashboard),
  };
}

function buildSourceComparisonRows(sources: Partial<Record<Btc15mSourceMode, Btc15mModeDashboard>>): Btc15mSourceComparisonRow[] {
  return SOURCE_MODES.filter((source) => sources[source])
    .map((source) => {
      const run = sources[source] as Btc15mModeDashboard;
      const swarm = run.metrics.swarm;
      const buyYes = run.metrics.buyYes;
      return {
        source,
        label: SOURCE_LABELS[source].label,
        swarmPnl: swarm?.pnlUsd ?? 0,
        swarmRoi: swarm?.roi ?? 0,
        swarmSharpe: swarm?.sharpe ?? 0,
        swarmTrades: swarm?.trades ?? 0,
        swarmAccuracy: swarm?.accuracy ?? null,
        buyYesPnl: buyYes?.pnlUsd ?? 0,
        testEpisodes: run.data.testEpisodes,
        fitEpisodes: run.data.fitEpisodes,
        validationEpisodes: run.data.validationEpisodes,
        priorEpisodesAvailable: run.data.priorEpisodesAvailable ?? 0,
      };
    })
    .sort((a, b) => b.swarmPnl - a.swarmPnl);
}

function sourceVerdict(run: Btc15mModeDashboard | undefined): Btc15mSettlementDashboard["verdict"] {
  const swarm = run?.metrics.swarm;
  const buyYes = run?.metrics.buyYes;
  if (!run || !swarm || !buyYes || run.data.testEpisodes === 0) {
    return {
      title: "No comparable run",
      body: "This period/source combination does not have enough pre-window data and test markets.",
      tone: "bad",
    };
  }
  if (swarm.pnlUsd > buyYes.pnlUsd && swarm.pnlUsd > 0) {
    return {
      title: "Research candidate",
      body: "The swarm is positive and beats buy-YES for this selected strictness/source combination.",
      tone: "good",
    };
  }
  if (swarm.pnlUsd > 0) {
    return {
      title: "Positive but not dominant",
      body: "The swarm is positive, but it does not beat the simple buy-YES baseline in this slice.",
      tone: "warn",
    };
  }
  return {
    title: "Do not deploy yet",
    body: "The swarm does not clear this backtest slice. Use this as diagnostics, not a paper-trading signal.",
    tone: "bad",
  };
}

function buildEquityCurve(trades: Btc15mTrade[]): Array<Record<string, number | string>> {
  const agents = [...new Set(trades.map((trade) => trade.agent))].sort();
  const totals = Object.fromEntries(agents.map((agent) => [agent, 0]));
  const byTime = new Map<string, Btc15mTrade[]>();
  for (const trade of trades) byTime.set(trade.timestamp, [...(byTime.get(trade.timestamp) ?? []), trade]);
  return [...byTime.entries()]
    .sort(([a], [b]) => Date.parse(a) - Date.parse(b))
    .map(([timestamp, rows], index) => {
      for (const trade of rows) totals[trade.agent] = (totals[trade.agent] ?? 0) + trade.pnlUsd;
      return {
        index: index + 1,
        timestamp,
        ...totals,
      };
    });
}

function parseTradesCsv(raw: string): Btc15mTrade[] {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
    return {
      agent: row.agent,
      marketTicker: row.marketTicker,
      timestamp: row.timestamp,
      side: row.side === "no" ? "no" : "yes",
      confidence: Number(row.confidence),
      score: Number(row.score),
      selectedAgent: row.selectedAgent,
      routeReason: row.routeReason,
      regimeKey: row.regimeKey,
      entryPrice: Number(row.entryPrice),
      settlement: Number(row.settlement),
      contracts: Number(row.contracts),
      notionalUsd: Number(row.notionalUsd),
      pnlUsd: Number(row.pnlUsd),
      correct: row.correct === "true",
      ambiguousSettlement: row.ambiguousSettlement === "true",
    };
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out;
}

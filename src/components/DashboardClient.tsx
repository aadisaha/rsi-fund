"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  DashboardPayload,
  KalshiRlSummary,
  LedgerRecord,
  MarketLiveSeries,
  ModelComparisonBacktest,
} from "@/lib/types";

type Props = {
  initial: DashboardPayload;
  initialTab?: DashboardTab;
  rlVariant?: RlVariant;
};

type DashboardTab = "cockpit" | "research" | "rl" | "outcomes" | "allocation" | "ops";
type RlVariant = "classic" | "v2";

type ResearchExtras = {
  outcomes?: unknown;
  outcome?: unknown;
  evaluations?: unknown;
  evaluation?: unknown;
  experiments?: unknown;
  experiment?: unknown;
};

type ResearchExtraSection = {
  title: string;
  rows: Array<Record<string, unknown>>;
};

type RecursionGateResult = {
  ok?: boolean;
  passed?: boolean;
  result?: string;
  status?: string;
  reason?: string;
  rejectionReasons?: string[];
  reasons?: string[];
};

type RecursionResearchDecision = {
  id?: string;
  decisionId?: string;
  at?: string;
  createdAt?: string;
  action?: string;
  decision?: string;
  status?: string;
  summary?: string;
  hypothesis?: string;
  reason?: string;
  provider?: string;
  model?: string;
  modelId?: string;
  providerModel?: string | null;
  universe?: string[];
  gate?: RecursionGateResult | null;
  risks?: string[];
  rejectionReasons?: string[];
  validationErrors?: Array<{ field?: string; message: string }>;
};

type RecursionDashboardState = {
  enabled?: boolean;
  activeDecisionId?: string | null;
  activeExperimentId?: string | null;
  activeAutonomousUniverse?: string[];
  autonomousUniverse?: string[];
  universe?: string[];
  provider?: string | null;
  model?: string;
  providerModel?: string | null;
  lastResearchDecision?: RecursionResearchDecision | null;
  lastDecision?: RecursionResearchDecision | null;
  gate?: RecursionGateResult | null;
  rejectionReasons?: string[];
};

type DashboardPayloadWithRecursion = DashboardPayload & {
  recursion?: RecursionDashboardState | null;
  ops: DashboardPayload["ops"] & {
    recursion?: RecursionDashboardState | null;
  };
  research: DashboardPayload["research"] & {
    recursion?: RecursionDashboardState | null;
  };
};

type CycleChartMode = "trsi" | "notional" | "fills";
type ForecastView = "score" | "expectedReturn" | "vol";

type CycleChartPoint = {
  label: string;
  tRsi: number;
  notional: number;
  fills: number;
  approved: number;
};

type ForecastChartPoint = {
  symbol: string;
  score: number;
  expectedReturn: number;
  vol: number;
  confidence: number;
};

type OutcomeChartPoint = {
  label: string;
  returnPct: number;
  alphaPct: number;
  pnl: number;
};

type LivePathPoint = {
  label: string;
  close: number | null;
  modelPrice: number | null;
  phase: "actual" | "forecast";
};

type BacktestChartPoint = {
  model: string;
  accuracy: number;
  strategyReturn: number;
  sharpe: number;
};

type RlQuoteChartPoint = {
  label: string;
  now: number | null;
  up: number | null;
  down: number | null;
  chance: number | null;
};

type AgentPnlChartPoint = Record<string, string | number | null> & {
  label: string;
  at: string;
};

type AgentPnlSeries = {
  key: string;
  label: string;
  color: string;
  deprecated?: boolean;
  family: "genetic";
  role: LineageRoleId;
};

type AgentPnlChartSummary = {
  historicalRuns: number;
  latestTrainingAt: string | null;
  latestTrainingBest: number | null;
  latestTrainingAverage: number | null;
  liveRows: number;
  liveBest: number | null;
  liveAverage: number | null;
  liveWorst: number | null;
  liveOpenPositions: number;
  liveOpenPnl: number;
  liveDeltaAverage: number | null;
};

type AgentPnlChart = {
  points: AgentPnlChartPoint[];
  series: AgentPnlSeries[];
  summary: AgentPnlChartSummary;
};

type LineageRoleId =
  | "early"
  | "pulse"
  | "scout"
  | "stride"
  | "anchor"
  | "spark"
  | "closer"
  | "sprinter"
  | "hedger"
  | "conviction"
  | "scalper"
  | "baseline";

type LatestCyclePayload = {
  forecasts?: Array<{
    symbol: string;
    score: number;
    expectedReturn: number;
    confidence?: number;
    annualizedVol?: number;
    shortMomentum?: number;
    shortLookbackLabel?: string;
  }>;
  simulatedFills?: Array<{ symbol: string; notionalUsd: number; quantity: number }>;
  risk?: {
    ok?: boolean;
    limits?: Array<{ name: string; ok: boolean; actual?: number | string | boolean | null; limit?: number | string | boolean | null }>;
  };
  cadence?: string;
  timeframe?: string;
  reason?: string;
};

const CHART_COLORS = ["#32d6a2", "#7aa7ff", "#f0c75e", "#ff7a90", "#a98cff", "#5fd4e8"];
const LINEAGE_ROLES: Record<LineageRoleId, { label: string; color: string; description: string }> = {
  early: { label: "Early Entry", color: "#32d6a2", description: "profitable entries before prices reach certainty" },
  pulse: { label: "Entry Pulse", color: "#7aa7ff", description: "higher valid-entry cadence" },
  scout: { label: "Cheap Scout", color: "#f0c75e", description: "low-price opportunity search" },
  stride: { label: "Efficiency", color: "#5fd4e8", description: "ROI and trade-quality pressure" },
  anchor: { label: "Risk Anchor", color: "#a98cff", description: "lower drawdown and cleaner exits" },
  spark: { label: "Explorer", color: "#ff7a90", description: "more exploration with loss pressure" },
  closer: { label: "Closer", color: "#2dd4bf", description: "future line: exits early unless edge is huge" },
  sprinter: { label: "Sprinter", color: "#60a5fa", description: "future line: trades only late windows" },
  hedger: { label: "Hedger", color: "#f59e0b", description: "future line: cuts adverse exposure" },
  conviction: { label: "Conviction", color: "#fb7185", description: "future line: holds close only with strong edge" },
  scalper: { label: "Scalper", color: "#c084fc", description: "future line: closes before final minute" },
  baseline: { label: "Baseline", color: "#94a3b8", description: "unassigned genetic families" },
};
const LINEAGE_ROLE_ORDER: LineageRoleId[] = [
  "early",
  "pulse",
  "scout",
  "stride",
  "anchor",
  "spark",
  "baseline",
  "closer",
  "sprinter",
  "hedger",
  "conviction",
  "scalper",
];
const SPECIALIZED_LINEAGE_ROLES = new Set<LineageRoleId>([
  "closer",
  "sprinter",
  "hedger",
  "conviction",
  "scalper",
]);
const TOOLTIP_STYLE = {
  background: "rgba(17, 19, 24, 0.96)",
  border: "1px solid rgba(185, 197, 216, 0.22)",
  borderRadius: 8,
  color: "#f3f7fb",
};

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function money2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(v) < 10 ? 2 : 0,
    maximumFractionDigits: Math.abs(v) < 10 ? 2 : 0,
  });
}

function priceUsd(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function signedPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(2)}%`;
}

function cents(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "n/a" : `${fixed(v * 100, 1)}c`;
}

function fixed(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "n/a";
}

function compact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
}

function shortTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function emptyPaperBook(): DashboardPayload["paperBook"] {
  return {
    generatedAt: new Date().toISOString(),
    openPositions: [],
    cycleOutcomes: [],
    totals: {
      openCount: 0,
      notionalUsd: 0,
      currentValueUsd: 0,
      unrealizedPnlUsd: 0,
      returnPct: 0,
      benchmarkReturnPct: null,
      alphaVsBenchmarkPct: null,
    },
  };
}

function emptyInvestmentCalibration(): DashboardPayload["investmentCalibration"] {
  return {
    channel: {
      id: "I",
      name: "Investments",
      description: "Paper outcome-calibrated rebalance budget.",
      meanReturn: 0.075,
      sigma: 0.042,
      readiness: 0.74,
      source: "Paper book prior; waiting for simulated fills and marks",
    },
    diagnostics: {
      sampleSize: 0,
      evidenceWeight: 0,
      hitRate: null,
      avgForecastScore: 0,
      realizedReturn: 0,
      alphaVsBenchmark: null,
      evidenceMean: 0,
      drawdownProxy: 0,
      priorMeanReturn: 0.075,
      priorSigma: 0.042,
      priorReadiness: 0.74,
      blendedMeanReturn: 0.075,
      blendedSigma: 0.042,
      blendedReadiness: 0.74,
    },
  };
}

export function DashboardClient({ initial, initialTab = "cockpit", rlVariant = "classic" }: Props) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [symbol, setSymbol] = useState("BTC");
  const [cycleSymbols, setCycleSymbols] = useState("BTC, ETH, SOL");
  const [liveSymbol, setLiveSymbol] = useState("BTC/USD");
  const [message, setMessage] = useState<string | null>(null);
  const [cycleChartMode, setCycleChartMode] = useState<"trsi" | "notional" | "fills">("trsi");
  const [forecastView, setForecastView] = useState<"score" | "expectedReturn" | "vol">("score");
  const [isPending, startTransition] = useTransition();
  const rlOnly = initialTab === "rl";

  useEffect(() => {
    if (tab !== "rl") return;
    let cancelled = false;
    let inFlight = false;

    async function refreshRlSummary() {
      if (inFlight) return;
      inFlight = true;
      try {
        const rlRes = await fetch("/api/kalshi/rl/summary", { cache: "no-store" });
        const json = (await rlRes.json().catch(() => ({}))) as {
          ok?: boolean;
          generatedAt?: string;
          summary?: KalshiRlSummary;
        };
        if (!cancelled && rlRes.ok && json.ok !== false && json.summary) {
          setData((current) => ({
            ...current,
            generatedAt: json.generatedAt ?? new Date().toISOString(),
            research: {
              ...current.research,
              kalshiRl: json.summary,
            },
          }));
        }
      } catch {
        // The stale/live badges already make missing ticks visible, so avoid noisy UI errors here.
      } finally {
        inFlight = false;
      }
    }

    void refreshRlSummary();
    const id = window.setInterval(refreshRlSummary, 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tab]);

  const allocationChart = useMemo(
    () =>
      data.proposal.channels.map((c) => ({
        name: c.id,
        dollars: c.proposedUsd,
        score: Number(c.riskAdjustedScore.toFixed(2)),
        readiness: Number((c.readiness * 100).toFixed(1)),
      })),
    [data.proposal.channels],
  );

  const cycleChart = useMemo(() => buildCycleChart(data), [data]);
  const latestCycle = useMemo(() => latestCyclePayload(data), [data]);
  const forecastChart = useMemo(() => buildForecastChart(latestCycle), [latestCycle]);
  const outcomeChart = useMemo(() => buildOutcomeChart(data), [data]);
  const latestBacktest = useMemo(() => latestBacktestComparison(data), [data]);

  async function refresh() {
    try {
      if (rlOnly) {
        const res = await fetch("/api/kalshi/rl/summary", { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; generatedAt?: string; summary?: KalshiRlSummary; error?: string };
        if (!res.ok || json.ok === false || !json.summary) throw new Error(json.error ?? "Refresh failed.");
        setData((current) => ({
          ...current,
          generatedAt: json.generatedAt ?? new Date().toISOString(),
          research: {
            ...current.research,
            kalshiRl: json.summary,
          },
        }));
        return;
      }
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Refresh failed.");
      setData(json);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Refresh failed.");
    }
  }

  async function postJson<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok || json.ok === false) {
      throw new Error(json.error ?? `${path} failed.`);
    }
    return json as T;
  }

  function runBacktest() {
    startTransition(async () => {
      try {
        setMessage("Running walk-forward model comparison...");
        await postJson<{ ok: boolean }>("/api/research/backtest", { symbol });
        setMessage(`Model comparison recorded for ${symbol.toUpperCase()}.`);
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Backtest failed.");
      }
    });
  }

  function proposePaperAllocation() {
    startTransition(async () => {
      try {
        setMessage("Creating paper allocation proposal...");
        await postJson<{ ok: boolean }>("/api/paper/propose");
        setMessage("Paper proposal recorded. No live orders were sent.");
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Proposal failed.");
      }
    });
  }

  function runPaperCycle() {
    startTransition(async () => {
      try {
        setMessage("Running paper cycle: refreshing bars, forecasting, and simulating fills...");
        await postJson<{ ok: boolean }>("/api/cycle/run", { symbols: cycleSymbols });
        setMessage("Paper cycle recorded. Simulated fills only; no live orders were sent.");
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Paper cycle failed.");
      }
    });
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-[color:var(--line)] bg-[rgba(10,12,15,0.92)]">
        <div
          className={`mx-auto flex flex-col gap-4 px-5 py-5 md:flex-row md:items-end md:justify-between ${
            tab === "rl" ? "max-w-[1680px]" : "max-w-7xl"
          }`}
        >
          <div>
            <p className="mono text-xs uppercase text-[color:var(--accent)]">
              {rlOnly ? "Kalshi agent swarm" : "paper-only 24/7 crypto cockpit"}
            </p>
            <h1 className="mt-2 text-3xl font-semibold">
              {tab === "rl"
                ? rlVariant === "v2"
                  ? "Recursive Quant Fund RL V2"
                  : "Recursive Quant Fund RL"
                : "Recursive Quant Fund Cockpit"}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--muted)]">
              {rlOnly
                ? "Validated genetic agents, live Kalshi ticks, paper performance, and live-safety gates."
                : "Read-only Alpaca/Kalshi integrations, 15-minute BTC/ETH/SOL paper cycles, local ledger feedback, optimizer proposals, and experimental t-RSI certificate tracking."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="control-button border-[color:var(--line)] text-white hover:border-[color:var(--accent)]"
              disabled={isPending}
              onClick={() => startTransition(refresh)}
              type="button"
            >
              Refresh
            </button>
            {!rlOnly ? (
              <>
                <button
                  className="control-button border-transparent bg-[color:var(--accent)] font-semibold text-[#07110f] hover:brightness-110 disabled:opacity-50"
                  disabled={isPending}
                  onClick={proposePaperAllocation}
                  type="button"
                >
                  Paper Proposal
                </button>
                <button
                  className="control-button border-transparent bg-[color:var(--info)] font-semibold text-[#07111f] hover:brightness-110 disabled:opacity-50"
                  disabled={isPending}
                  onClick={runPaperCycle}
                  type="button"
                >
                  Run Cycle
                </button>
              </>
            ) : null}
          </div>
        </div>
      </header>

      <div className={`mx-auto px-5 py-5 ${tab === "rl" ? "max-w-[1680px]" : "max-w-7xl"}`}>
        <nav className="mb-5 flex w-full max-w-2xl rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-1">
          {(rlOnly ? (["rl"] as const) : (["cockpit", "research", "rl", "outcomes", "allocation", "ops"] as const)).map((id) => (
            <button
              key={id}
              className={`flex-1 rounded px-3 py-2 text-sm capitalize transition ${
                tab === id ? "bg-[color:var(--panel-strong)] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]" : "text-[color:var(--muted)] hover:text-white"
              }`}
              onClick={() => {
                setTab(id);
                const rlPath = rlVariant === "v2" ? "/rlv2" : "/rl";
                if (id === "rl" && window.location.pathname !== rlPath) {
                  window.history.pushState(null, "", rlPath);
                } else if (id !== "rl" && ["/rl", "/rlv2"].includes(window.location.pathname)) {
                  window.history.pushState(null, "", "/");
                }
              }}
              type="button"
            >
              {id}
            </button>
          ))}
        </nav>

        {message && (
          <div className="mb-5 rounded-md border border-[color:var(--line)] bg-[#101927] px-4 py-3 text-sm text-[color:var(--foreground)]">
            {message} {isPending ? "Working..." : null}
          </div>
        )}

        {tab === "cockpit" && (
          <Cockpit
            data={data}
            cycleSymbols={cycleSymbols}
            setCycleSymbols={setCycleSymbols}
            runPaperCycle={runPaperCycle}
            disabled={isPending}
            cycleChart={cycleChart}
            cycleChartMode={cycleChartMode}
            setCycleChartMode={setCycleChartMode}
            forecastChart={forecastChart}
            forecastView={forecastView}
            setForecastView={setForecastView}
            liveSymbol={liveSymbol}
            setLiveSymbol={setLiveSymbol}
          />
        )}
        {tab === "research" && (
          <ResearchLab
            data={data}
            symbol={symbol}
            setSymbol={setSymbol}
            runBacktest={runBacktest}
            disabled={isPending}
            latestBacktest={latestBacktest}
          />
        )}
        {tab === "rl" && <RlVisibility data={data} variant={rlVariant} />}
        {tab === "outcomes" && <OutcomesExperiments data={data} outcomeChart={outcomeChart} />}
        {tab === "allocation" && (
          <Allocation data={data} allocationChart={allocationChart} />
        )}
        {tab === "ops" && <OpsPanel data={data} />}
      </div>
    </main>
  );
}

function Cockpit({
  data,
  cycleSymbols,
  setCycleSymbols,
  runPaperCycle,
  disabled,
  cycleChart,
  cycleChartMode,
  setCycleChartMode,
  forecastChart,
  forecastView,
  setForecastView,
  liveSymbol,
  setLiveSymbol,
}: {
  data: DashboardPayload;
  cycleSymbols: string;
  setCycleSymbols: (s: string) => void;
  runPaperCycle: () => void;
  disabled: boolean;
  cycleChart: CycleChartPoint[];
  cycleChartMode: CycleChartMode;
  setCycleChartMode: (mode: CycleChartMode) => void;
  forecastChart: ForecastChartPoint[];
  forecastView: ForecastView;
  setForecastView: (view: ForecastView) => void;
  liveSymbol: string;
  setLiveSymbol: (symbol: string) => void;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.08fr_0.92fr]">
      <section className="lg:col-span-2">
        <OverviewDeck data={data} />
      </section>
      <section className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <Metric label="Alpaca equity" value={money(data.accounts.alpaca.equityUsd)} />
          <Metric label="Alpaca cash" value={money(data.accounts.alpaca.cashUsd)} />
          <Metric label="Buying power" value={money(data.accounts.alpaca.buyingPowerUsd)} />
          <Metric label="Kalshi balance" value={money(data.accounts.kalshi.balanceUsd)} />
          <Metric label="Kalshi value" value={money(data.accounts.kalshi.portfolioValueUsd)} />
          <Metric label="Generated" value={shortTime(data.generatedAt)} />
        </div>
        <Panel title="Cycle Controls">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              className="h-10 min-w-0 flex-1 rounded-md border border-[color:var(--line)] bg-[#0b1018] px-3 text-sm text-white"
              value={cycleSymbols}
              onChange={(e) => setCycleSymbols(e.target.value)}
              aria-label="Cycle symbols"
              placeholder="BTC, ETH, SOL"
            />
            <button
              className="h-10 rounded-md bg-[color:var(--info)] px-4 text-sm font-semibold text-[#07111f] disabled:opacity-50"
              disabled={disabled}
              onClick={runPaperCycle}
              type="button"
            >
              Run Cycle
            </button>
          </div>
          <p className="mt-3 text-xs text-[color:var(--muted)]">
            Up to 12 comma-separated symbols. Crypto aliases are normalized to Alpaca slash pairs.
          </p>
        </Panel>
        <LiveModelPath
          series={data.research.marketSeries ?? []}
          selectedSymbol={liveSymbol}
          setSelectedSymbol={setLiveSymbol}
        />
        <CycleTimeline
          points={cycleChart}
          mode={cycleChartMode}
          setMode={setCycleChartMode}
        />
        <ForecastVisual
          points={forecastChart}
          view={forecastView}
          setView={setForecastView}
        />
        <Panel title="System Status">
          <div className="grid gap-3 md:grid-cols-3">
            {data.services.map((s) => (
              <div key={s.name} className="rounded-md border border-[color:var(--line)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">{s.name}</h3>
                  <span className={`rounded px-2 py-1 text-xs ${s.ok ? "bg-emerald-400/15 text-emerald-200" : "bg-red-400/15 text-red-200"}`}>
                    {s.ok ? "ok" : "attention"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-[color:var(--muted)]">{s.message}</p>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Open Positions">
          <div className="grid gap-4 md:grid-cols-2">
            <PositionList
              title="Alpaca"
              rows={data.accounts.alpaca.positions.map((p) => ({
                key: p.symbol,
                left: p.symbol,
                right: `${p.qty} ${p.side ?? ""}`,
                sub: money(Number(p.market_value ?? 0)),
              }))}
            />
            <PositionList
              title="Kalshi"
              rows={data.accounts.kalshi.positions.map((p) => ({
                key: p.ticker,
                left: p.ticker,
                right: p.position_fp ?? "position",
                sub: p.market_exposure_dollars ?? "exposure unavailable",
              }))}
            />
          </div>
        </Panel>
        <PaperBookPanel data={data} />
      </section>
      <section className="space-y-5">
        <Certificate data={data} />
        <KalshiRlPanel data={data} />
        <RiskVisual data={data} />
        <CyclePanel data={data} />
        <Ledger records={data.ledger.slice(0, 8)} />
      </section>
    </div>
  );
}

function OverviewDeck({ data }: { data: DashboardPayload }) {
  const book = data.paperBook ?? emptyPaperBook();
  const tRsiState = data.tRsi.approved ? "Cleared" : "Withheld";
  const evidence = data.tRsi.evidence;
  const engine = data.tRsi.engine === "kalshi-empirical" ? "Kalshi empirical" : "Synthetic prior";
  const paperNotional = data.proposal.channels.find((c) => c.id === "I")?.proposedUsd ?? 0;
  return (
    <section className="overflow-hidden rounded-md border border-[color:var(--line)] bg-[linear-gradient(135deg,rgba(50,214,162,0.12),rgba(122,167,255,0.08)_46%,rgba(240,199,94,0.10))] p-5">
      <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone={data.tRsi.approved ? "good" : "warn"}>{tRsiState}</StatusPill>
            <StatusPill tone="info">{engine}</StatusPill>
            <StatusPill tone="neutral">Paper only</StatusPill>
          </div>
          <h2 className="mt-4 max-w-3xl text-2xl font-semibold">
            Paper cycles are running, empirical t-RSI is active, and live orders remain locked out.
          </h2>
          <p className="mt-3 max-w-3xl text-sm text-[color:var(--muted)]">
            The cockpit now blends local paper outcomes with Kalshi 15-minute market history,
            operator controls, and audit-friendly ledger records.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <GlassMetric label="t-RSI" value={fixed(data.tRsi.tRsi, 2)} sub={`threshold ${fixed(data.tRsi.threshold, 2)}`} />
          <GlassMetric label="Evidence" value={evidence ? compact(evidence.sampleSize) : "none"} sub={evidence ? `${evidence.horizonMinutes}m market paths` : "waiting for cache"} />
          <GlassMetric label="Deployable" value={money(data.proposal.deployableCapitalUsd)} sub={`I row ${money(paperNotional)}`} />
          <GlassMetric label="Paper PnL" value={money(book.totals.unrealizedPnlUsd)} sub={`${book.totals.openCount} open positions`} />
        </div>
      </div>
    </section>
  );
}

function LiveModelPath({
  series,
  selectedSymbol,
  setSelectedSymbol,
}: {
  series: MarketLiveSeries[];
  selectedSymbol: string;
  setSelectedSymbol: (symbol: string) => void;
}) {
  const selected = series.find((row) => row.symbol === selectedSymbol) ?? series[0] ?? null;
  const points = selected ? buildLivePathChart(selected) : [];
  const forecast = selected?.forecast ?? null;
  return (
    <Panel title="Live Model Path">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {series.length ? (
          <Segmented<string>
            value={selected?.symbol ?? selectedSymbol}
            options={series.map((row) => ({ id: row.symbol, label: row.symbol.replace("/USD", "") }))}
            onChange={setSelectedSymbol}
          />
        ) : (
          <span className="mono text-xs text-[color:var(--muted)]">waiting for market cache</span>
        )}
        <span className="mono text-xs text-[color:var(--muted)]">
          {selected ? `${selected.bars} bars · ${selected.timeframe}` : "no series"}
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_0.34fr]">
        <div className="h-72 min-w-0">
          {selected && points.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points}>
                <CartesianGrid stroke="rgba(185,197,216,0.14)" />
                <XAxis dataKey="label" stroke="#9aa7b8" tick={{ fontSize: 11 }} minTickGap={18} />
                <YAxis stroke="#9aa7b8" tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Line type="monotone" dataKey="close" name="Actual" stroke="#32d6a2" strokeWidth={2} dot={false} />
                <Line
                  type="monotone"
                  dataKey="modelPrice"
                  name="Model path"
                  stroke="#f0c75e"
                  strokeDasharray="5 4"
                  strokeWidth={2}
                  dot={false}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyVisual text="Run a paper cycle to cache live bars and publish a model path." />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <GlassMetric
            label="Last close"
            value={selected?.points.at(-1)?.close ? fixed(selected.points.at(-1)!.close, 2) : "n/a"}
            sub={selected?.end ? shortTime(selected.end) : "waiting"}
          />
          <GlassMetric
            label="Model target"
            value={forecast ? fixed(forecast.targetPrice, 2) : "n/a"}
            sub={forecast ? `${pct(forecast.expectedReturn)} expected` : "no forecast"}
          />
          <GlassMetric
            label="Confidence"
            value={forecast ? pct(forecast.confidence) : "n/a"}
            sub={forecast?.modelId ?? "run cycle first"}
          />
        </div>
      </div>
    </Panel>
  );
}

function CycleTimeline({
  points,
  mode,
  setMode,
}: {
  points: CycleChartPoint[];
  mode: CycleChartMode;
  setMode: (mode: CycleChartMode) => void;
}) {
  const metric = mode === "trsi" ? "tRsi" : mode;
  return (
    <Panel title="Cycle Timeline">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<CycleChartMode>
          value={mode}
          options={[
            { id: "trsi", label: "t-RSI" },
            { id: "notional", label: "Notional" },
            { id: "fills", label: "Fills" },
          ]}
          onChange={setMode}
        />
        <span className="mono text-xs text-[color:var(--muted)]">
          {points.length ? `${points.length} recent cycles` : "waiting for cycles"}
        </span>
      </div>
      <div className="h-64 w-full min-w-0">
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points}>
              <defs>
                <linearGradient id="cycleFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#32d6a2" stopOpacity={0.38} />
                  <stop offset="95%" stopColor="#32d6a2" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(185,197,216,0.14)" />
              <XAxis dataKey="label" stroke="#9aa7b8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#9aa7b8" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              {mode === "trsi" ? <ReferenceLine y={1} stroke="#f0c75e" strokeDasharray="4 4" /> : null}
              <Area type="monotone" dataKey={metric} stroke="#32d6a2" strokeWidth={2} fill="url(#cycleFill)" />
              <Line type="monotone" dataKey="approved" stroke="#f0c75e" strokeWidth={1.5} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <EmptyVisual text="Run paper cycles to build a timeline." />
        )}
      </div>
    </Panel>
  );
}

function ForecastVisual({
  points,
  view,
  setView,
}: {
  points: ForecastChartPoint[];
  view: ForecastView;
  setView: (view: ForecastView) => void;
}) {
  const metric = view === "vol" ? "vol" : view;
  return (
    <Panel title="Forecast Surface">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<ForecastView>
          value={view}
          options={[
            { id: "score", label: "Score" },
            { id: "expectedReturn", label: "Return" },
            { id: "vol", label: "Vol" },
          ]}
          onChange={setView}
        />
        <span className="mono text-xs text-[color:var(--muted)]">{points.length} symbols</span>
      </div>
      <div className="h-64 w-full min-w-0">
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={points}>
              <CartesianGrid stroke="rgba(185,197,216,0.14)" />
              <XAxis dataKey="symbol" stroke="#9aa7b8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#9aa7b8" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <ReferenceLine y={0} stroke="rgba(185,197,216,0.28)" />
              <Bar dataKey={metric} radius={[4, 4, 0, 0]}>
                {points.map((point, index) => (
                  <Cell
                    key={point.symbol}
                    fill={point[metric] >= 0 ? CHART_COLORS[index % CHART_COLORS.length] : "#ff7a90"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <EmptyVisual text="Run a paper cycle to render forecast bars." />
        )}
      </div>
    </Panel>
  );
}

function KalshiRlPanel({ data }: { data: DashboardPayload }) {
  const rl = data.research.kalshiRl;
  const champion = rl?.champion ?? null;
  const lastRun = rl?.lastRun ?? null;
  const latest = rl?.latestEvent ?? null;
  const raw = latest?.raw as { currentPrice?: number; targetPrice?: number; chance?: number } | undefined;
  return (
    <Panel title="Kalshi BTC 15m RL">
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Metric label="Series" value={rl?.seriesTicker ?? "KXBTC15M"} />
        <Metric label="Recent events" value={compact(rl?.recentEvents ?? 0)} />
        <Metric label="Bankroll" value={money(rl?.bankrollUsd ?? 1000)} />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Metric label="Kalshi now" value={priceUsd(raw?.currentPrice)} />
        <Metric label="Up price" value={cents(latest?.yesAsk)} />
        <Metric label="Down price" value={cents(latest?.noAsk)} />
      </div>
      <div className="rounded-md border border-[color:var(--line)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase text-[color:var(--muted)]">Champion policy</p>
            <h3
              className="mt-2 text-sm font-medium"
              title={champion ? `Genome: ${champion.genome.genomeId}` : undefined}
            >
              {champion ? agentName(champion.genome.genomeId, lastRun?.leaderboard) : "waiting-for-training"}
            </h3>
          </div>
          <StatusPill tone={champion ? "good" : rl?.recentEvents ? "warn" : "neutral"}>
            {champion ? "active" : rl?.recentEvents ? "trainable" : "waiting"}
          </StatusPill>
        </div>
        <p className="mt-3 text-sm text-[color:var(--muted)]">
          {champion
            ? `Reward ${fixed(champion.reward, 3)}, PnL ${money(champion.pnlUsd)}, ${champion.trades} paper trades, generation ${champion.generation}.`
            : lastRun?.notes[0] ?? "Waiting for ingestion agents to append orderbook JSONL records."}
        </p>
        {latest ? (
          <p className="mt-2 mono text-xs text-[color:var(--muted)]">
            {latest.marketTicker} · target {priceUsd(raw?.targetPrice)} · chance{" "}
            {raw?.chance == null ? "n/a" : pct(raw.chance)}
          </p>
        ) : null}
      </div>
      {lastRun?.leaderboard?.length ? (
        <div className="mt-4 space-y-2">
          {lastRun.leaderboard.slice(0, 5).map((row) => (
            <div
              key={row.genome.genomeId}
              className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] px-3 py-2 text-sm"
            >
              <span className="truncate" title={agentLineageTitle(row, lastRun.leaderboard)}>
                {agentName(row.genome.genomeId, lastRun.leaderboard)}
              </span>
              <span className="text-[color:var(--muted)]">
                {fixed(row.reward, 2)} · {money(row.pnlUsd)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function RlVisibility({ data, variant = "classic" }: { data: DashboardPayload; variant?: RlVariant }) {
  const [agentSort, setAgentSort] = useState<{ key: LiveAgentSortKey; direction: "asc" | "desc" }>({
    key: "totalPnl",
    direction: "desc",
  });
  const rl = data.research.kalshiRl;
  const lastRun = rl?.lastRun ?? null;
  const champion = rl?.champion ?? null;
  const generationComparison = rl?.generationComparison ?? null;
  const latest = rl?.latestEvent ?? null;
  const raw = latest?.raw as { currentPrice?: number; targetPrice?: number; chance?: number; source?: string } | undefined;
  const expectedMarket = inferKalshiBtc15mMarket(data.generatedAt);
  const marketMatchesClock = latest?.marketTicker.toLowerCase().startsWith(expectedMarket.ticker.toLowerCase()) ?? false;
  type LeaderboardRow = NonNullable<typeof lastRun>["leaderboard"][number];
  const rawRows: LeaderboardRow[] = rl?.liveLeaderboard ?? lastRun?.leaderboard ?? [];
  const allRows: LeaderboardRow[] = rawRows.filter((row) =>
    variant === "v2" ? isSpecializedGenome(row.genome.genomeId) : !isSpecializedGenome(row.genome.genomeId),
  );
  const rows: LeaderboardRow[] = allRows.filter((row) => row.status !== "deprecated");
  const routeEliteArchive = (rl?.eliteArchive ?? []).filter((entry) =>
    variant === "v2" ? isSpecializedGenome(entry.genome.genomeId) : !isSpecializedGenome(entry.genome.genomeId),
  );
  const routeTopElites = (generationComparison?.topElites ?? []).filter((entry) =>
    variant === "v2" ? isSpecializedGenome(entry.genomeId) : !isSpecializedGenome(entry.genomeId),
  );
  const quoteChart = buildRlQuoteChart(rl);
  const agentPnlChart = buildAgentPnlChart(rl, allRows, data.generatedAt, variant);
  const latestAgeSeconds = latest
    ? Math.max(0, Math.round((Date.parse(data.generatedAt) - Date.parse(latest.receivedAt)) / 1000))
    : null;
  const feedStale = latestAgeSeconds == null || latestAgeSeconds > 45;
  const ageLabel =
    latestAgeSeconds == null
      ? "no tick"
      : latestAgeSeconds < 60
        ? `${latestAgeSeconds}s ago`
        : `${Math.floor(latestAgeSeconds / 60)}m ${latestAgeSeconds % 60}s ago`;
  const childCount = new Map<string, number>();
  for (const row of rows) {
    for (const parent of row.parentGenomeIds ?? row.genome.parentGenomeIds ?? []) {
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    }
  }
  const candidates = rows.filter((row) => row.status === "candidate").length;
  const exploring = rows.filter((row) => row.status === "exploring").length;
  const statusTone = (status: LeaderboardRow["status"]): "good" | "warn" | "bad" | "info" | "neutral" =>
    status === "champion"
      ? "good"
      : status === "candidate" || status === "archived"
        ? "info"
        : status === "exploring"
          ? "warn"
          : "bad";
  const openRows = rows
    .map((row) => ({ row, summary: openPositionSummary(row.openPositions ?? []) }))
    .filter(({ row }) => (row.openPositions ?? []).length > 0);
  const openPaidUsd = openRows.reduce((sum, item) => sum + item.summary.costBasisUsd, 0);
  const openMarkUsd = openRows.reduce((sum, item) => sum + item.summary.markValueUsd, 0);
  const openPnlUsd = openMarkUsd - openPaidUsd;
  const openContracts = openRows.reduce((sum, item) => {
    const net = item.row.openPositions?.reduce((positionSum, position) => positionSum + Math.abs(position.netContracts), 0);
    return sum + (net ?? 0);
  }, 0);
  const validatedRows = rows.filter((row) => row.tier === "validated");
  const accountingRows = rows.filter((row) => row.contributesToPerformance);
  const testingRows = rows.filter((row) => !validatedRows.includes(row));
  const visiblePerformance = [
    ...accountingRows.map((row) => rowPerformance(row, rl?.bankrollUsd ?? 1000)),
  ];
  const aggregatePerformance = aggregatePerformances(visiblePerformance, rl?.bankrollUsd ?? 1000);
  const toggleAgentSort = (key: LiveAgentSortKey) => {
    setAgentSort((current) => ({
      key,
      direction: current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };
  const sortableHeader = (key: LiveAgentSortKey, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-left uppercase hover:text-[color:var(--foreground)]"
      onClick={() => toggleAgentSort(key)}
    >
      <span>{label}</span>
      <span className="mono w-3 text-[10px]">
        {agentSort.key === key ? (agentSort.direction === "asc" ? "↑" : "↓") : ""}
      </span>
    </button>
  );
  const liveAgentRows: LiveAgentTableRow[] = [
    ...rows.map((row) => {
      const latestTrade = row.recentTrades?.at(-1) ?? null;
      const openPosition = openPositionSummary(row.openPositions ?? []);
      const performance = rowPerformance(row, rl?.bankrollUsd ?? 1000);
      const statusLabel = row.status;
      const lastSide = latestTrade ? latestTrade.side.toUpperCase() : "none";
      const entryPrice = latestTrade?.entryPrice ?? null;
      const exitPrice = latestTrade?.exitPrice ?? null;
      const lastPnl = latestTrade?.pnlUsd ?? null;
      const lastAction = row.deprecatedReason
        ? row.deprecatedReason
        : latestTrade
          ? `${shortTime(latestTrade.openedAt)} · ${latestTrade.reason}`
          : "waiting for entry";
      return {
        id: row.genome.genomeId,
        agentLabel: agentName(row.genome.genomeId, rows),
        subLabel: row.genome.genomeId,
        title: agentLineageTitle(row, rows),
        statusLabel,
        statusTone: statusTone(row.status),
        tier: row.tier ?? "testing",
        contributesToPerformance: Boolean(row.contributesToPerformance),
        eliteTags: row.eliteTags ?? [],
        archivedReason: row.archivedReason,
        trades: row.trades,
        openPosition,
        pnl20m: row.pnlLast20m ?? 0,
        pnl50m: row.pnlLast50m ?? 0,
        seen: row.generationsSeen ?? 1,
        lastSide,
        entryPrice,
        exitPrice,
        lastPnl,
        reward: row.reward,
        totalPnl: row.pnlUsd,
        performance,
        lastAction,
        sort: {
          agent: agentName(row.genome.genomeId, rows),
          status: statusLabel,
          tier: row.tier ?? "testing",
          trades: row.trades,
          openNet: Math.abs(openPosition.netContracts),
          openPaid: openPosition.costBasisUsd,
          markValue: openPosition.markValueUsd,
          openPnl: openPosition.unrealizedPnlUsd,
          pnl20m: row.pnlLast20m ?? 0,
          pnl50m: row.pnlLast50m ?? 0,
          seen: row.generationsSeen ?? 1,
          lastSide,
          entry: entryPrice ?? Number.NEGATIVE_INFINITY,
          exit: exitPrice ?? Number.NEGATIVE_INFINITY,
          lastPnl: lastPnl ?? Number.NEGATIVE_INFINITY,
          reward: row.reward,
          totalPnl: row.pnlUsd,
          bankrollReturn: performance.returnOnBankroll,
          riskReturn: performance.returnOnRisk,
          gained: performance.grossGainedUsd,
          lost: performance.grossLostUsd,
          winLoss: performance.betsWon - performance.betsLost,
          lastAction,
        },
      };
    }),
  ].sort((a, b) => compareLiveAgentRows(a, b, agentSort));

  return (
    <div className="space-y-6">
      <section
        className={`overflow-hidden rounded-md border bg-[linear-gradient(135deg,rgba(20,24,31,0.98),rgba(20,30,34,0.94)_48%,rgba(20,22,31,0.98))] shadow-[0_18px_70px_rgba(0,0,0,0.24)] ${
          feedStale ? "border-amber-300/30" : "border-emerald-300/25"
        }`}
      >
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
          <div className="p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="mono text-xs uppercase text-[color:var(--accent)]">BTC 15m paper RL</p>
                <h2 className="mt-3 break-words text-3xl font-semibold md:text-4xl">
                  {latest?.marketTicker ?? "Waiting for Kalshi tick"}
                </h2>
                <p className="mt-2 text-sm text-[color:var(--muted)]">
                  {rl?.recentEvents ? `${compact(rl.recentEvents)} ticks captured` : "No ticks captured"}
                  {" · "}
                  last tick {ageLabel}
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <StatusPill tone={feedStale ? "warn" : "good"}>{feedStale ? "feed stale" : "live"}</StatusPill>
                <StatusPill tone={marketMatchesClock && !feedStale ? "good" : "warn"}>
                  {marketMatchesClock ? "clock match" : "clock mismatch"}
                </StatusPill>
                <StatusPill tone={latest ? "info" : "neutral"}>{raw?.source ?? "screen/orderbook"}</StatusPill>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <RlStat label="Kalshi now" value={priceUsd(raw?.currentPrice)} tone="neutral" />
              <RlStat label="Target" value={priceUsd(raw?.targetPrice)} tone="neutral" />
              <RlStat label="Chance" value={raw?.chance == null ? "n/a" : pct(raw.chance)} tone="info" />
              <RlStat label="Up ask" value={cents(latest?.yesAsk)} tone="up" />
              <RlStat label="Down ask" value={cents(latest?.noAsk)} tone="down" />
            </div>
          </div>

          <div className="border-t border-[color:var(--line)] bg-black/18 p-5 md:p-6 xl:border-l xl:border-t-0">
            <p className="text-xs uppercase text-[color:var(--muted)]">Market routing</p>
            <a
              className="mt-3 block break-all mono text-sm text-[color:var(--accent)] hover:underline"
              href={expectedMarket.url}
              rel="noreferrer"
              target="_blank"
            >
              {expectedMarket.ticker}
            </a>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <RlStat label="YES bid" value={cents(latest?.yesBid)} tone="up" />
              <RlStat label="NO bid" value={cents(latest?.noBid)} tone="down" />
            </div>
            {rl?.latestMarketUrl ? (
              <a
                className="mt-5 inline-flex text-sm text-[color:var(--accent)] hover:underline"
                href={rl.latestMarketUrl}
                rel="noreferrer"
                target="_blank"
              >
                Open displayed market
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.75fr)]">
        <Panel title="Changing Prices">
          <div className="h-[360px] min-w-0">
            {quoteChart.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={quoteChart} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="rgba(185,197,216,0.10)" />
                  <XAxis dataKey="label" stroke="#9aa7b8" tick={{ fontSize: 11 }} minTickGap={24} />
                  <YAxis yAxisId="price" stroke="#9aa7b8" tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                  <YAxis
                    yAxisId="cents"
                    orientation="right"
                    stroke="#9aa7b8"
                    tick={{ fontSize: 11 }}
                    domain={[0, 100]}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="now"
                    name="BTC now"
                    stroke="#7aa7ff"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    yAxisId="cents"
                    type="monotone"
                    dataKey="up"
                    name="Up ask c"
                    stroke="#32d6a2"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    yAxisId="cents"
                    type="monotone"
                    dataKey="down"
                    name="Down ask c"
                    stroke="#ff7a90"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyVisual text="Changing prices will render here after two valid live ticks." />
            )}
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="Agent Population">
            <div className="grid grid-cols-2 gap-3">
              <RlStat label="Active" value={String(rows.length)} tone="up" />
              <RlStat label="Testing tier" value={String(testingRows.length)} tone="info" />
              <RlStat label="Validated tier" value={String(validatedRows.length)} tone="up" />
              <RlStat label="Accounting" value={String(accountingRows.length)} tone="info" />
              <RlStat
                label="Validated archive"
                value={String(routeEliteArchive.filter((entry) => entry.tier === "validated" || entry.tags.includes("validated")).length)}
                tone="info"
              />
            </div>
            <p className="mt-3 text-xs text-[color:var(--muted)]">
              Testing agents can explore and breed but do not count in the fund-level PnL stats. Validated agents are
              the only genetic agents included in performance accounting. Candidates: {candidates}; exploring:{" "}
              {exploring}.
            </p>
          </Panel>

          <Panel title="Current Champion">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h3 className="mono max-w-full break-all text-sm font-medium">
                {champion ? (
                  <>
                    <span className="font-sans text-base">{agentName(champion.genome.genomeId, rows)}</span>
                    <span className="mt-1 block text-xs text-[color:var(--muted)]">{champion.genome.genomeId}</span>
                  </>
                ) : (
                  "waiting-for-champion"
                )}
              </h3>
              <StatusPill tone={champion ? "good" : rl?.recentEvents ? "warn" : "neutral"}>
                {champion ? "promoted" : rl?.recentEvents ? "learning" : "waiting"}
              </StatusPill>
            </div>
            <p className="mt-4 text-sm leading-6 text-[color:var(--muted)]">
              {champion
                ? `Generation ${champion.generation}, reward ${fixed(champion.reward, 3)}, PnL ${money(
                    champion.pnlUsd,
                  )}, ${champion.trades} paper trades.`
                : "No policy has cleared the promotion hurdle yet."}
            </p>
          </Panel>
        </div>
      </div>

      <Panel title="Open Positions">
        {openRows.length ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <RlStat label="Agents holding" value={String(openRows.length)} tone="info" />
              <RlStat label="Net contracts" value={fixed(openContracts, 2)} tone="neutral" />
              <RlStat label="Open paid" value={money(openPaidUsd)} tone="neutral" />
              <RlStat label="Marked PnL" value={money(openPnlUsd)} tone={openPnlUsd >= 0 ? "up" : "down"} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase text-[color:var(--muted)]">
                  <tr>
                    <th className="pb-3 pr-4 font-medium">Agent</th>
                    <th className="pb-3 pr-4 font-medium">Market</th>
                    <th className="pb-3 pr-4 font-medium">Net side</th>
                    <th className="pb-3 pr-4 font-medium">Avg entry</th>
                    <th className="pb-3 pr-4 font-medium">Mark</th>
                    <th className="pb-3 pr-4 font-medium">Paid</th>
                    <th className="pb-3 pr-4 font-medium">5m mark value</th>
                    <th className="pb-3 pr-4 font-medium">Open PnL</th>
                    <th className="pb-3 font-medium">Opened</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color:var(--line)]">
                  {openRows.map(({ row, summary }) => {
                    const positions = row.openPositions ?? [];
                    const primary = positions[0];
                    return (
                      <tr key={row.genome.genomeId} title={summary.title}>
                        <td className="max-w-56 truncate py-3 pr-4" title={agentLineageTitle(row, rows)}>
                          <span className="font-medium">{agentName(row.genome.genomeId, rows)}</span>
                          <span className="mt-1 block truncate mono text-xs text-[color:var(--muted)]">
                            {row.genome.genomeId}
                          </span>
                        </td>
                        <td className="max-w-64 truncate py-3 pr-4 mono">
                          {positions.length > 1 ? `${positions.length} markets` : primary?.marketTicker ?? "n/a"}
                        </td>
                        <td className="py-3 pr-4 mono">{summary.sideLabel}</td>
                        <td className="py-3 pr-4 mono">
                          {primary ? cents(primary.averageEntryPrice) : "n/a"}
                        </td>
                        <td className="py-3 pr-4 mono">{primary ? cents(primary.markPrice) : "n/a"}</td>
                        <td className="py-3 pr-4 mono">{money(summary.costBasisUsd)}</td>
                        <td className="py-3 pr-4 mono">{money(summary.markValueUsd)}</td>
                        <td
                          className={`py-3 pr-4 mono ${
                            summary.unrealizedPnlUsd >= 0 ? "text-emerald-200" : "text-rose-200"
                          }`}
                        >
                          {money(summary.unrealizedPnlUsd)}
                        </td>
                        <td className="py-3 mono text-xs text-[color:var(--muted)]">
                          {primary ? `${shortTime(primary.openedAt)} · ${primary.secondsToClose ?? "?"}s to close` : "n/a"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[color:var(--muted)]">
              Open positions are marked at the current evaluation tick. Final settlement remains binary at the
              15-minute close: one side resolves to 100c, the other to 0c.
            </p>
          </div>
        ) : (
          <EmptyVisual text="No active paper positions are open at the latest tick." />
        )}
      </Panel>

      <Panel title={variant === "v2" ? "Agent PnL Logs · Training History" : "Agent PnL Logs"}>
        {variant === "v2" ? (
          <div className="mb-4 space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <RlStat
                label="Training runs"
                value={String(agentPnlChart.summary.historicalRuns)}
                tone="info"
              />
              <RlStat
                label="Latest train best"
                value={money(agentPnlChart.summary.latestTrainingBest)}
                tone={(agentPnlChart.summary.latestTrainingBest ?? 0) >= 0 ? "up" : "down"}
              />
              <RlStat
                label="Latest train avg"
                value={money(agentPnlChart.summary.latestTrainingAverage)}
                tone={(agentPnlChart.summary.latestTrainingAverage ?? 0) >= 0 ? "up" : "down"}
              />
              <RlStat
                label="Live 10k avg"
                value={money(agentPnlChart.summary.liveAverage)}
                tone={(agentPnlChart.summary.liveAverage ?? 0) >= 0 ? "up" : "down"}
              />
              <RlStat
                label="Open mark PnL"
                value={money(agentPnlChart.summary.liveOpenPnl)}
                tone={agentPnlChart.summary.liveOpenPnl >= 0 ? "up" : "down"}
              />
            </div>
            <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-5">
              {LINEAGE_ROLE_ORDER.filter((roleId) => SPECIALIZED_LINEAGE_ROLES.has(roleId)).map((roleId) => {
                const role = LINEAGE_ROLES[roleId];
                const count = agentPnlChart.series.filter((series) => series.role === roleId).length;
                return (
                  <div
                    key={roleId}
                    className="rounded-md border border-[color:var(--line)] bg-black/10 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: role.color }} />
                      <span className="text-sm font-medium">{role.label}</span>
                    </div>
                    <p className="mt-1 text-xs text-[color:var(--muted)]">
                      {count} lines · {role.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
        <div className={variant === "v2" ? "h-[520px] min-w-0" : "h-[340px] min-w-0"}>
          {agentPnlChart.points.length > 1 && agentPnlChart.series.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={agentPnlChart.points} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgba(185,197,216,0.10)" />
                <XAxis dataKey="label" stroke="#9aa7b8" tick={{ fontSize: 11 }} minTickGap={24} />
                <YAxis
                  stroke="#9aa7b8"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(value, name) => [money(typeof value === "number" ? value : Number(value)), name]}
                />
                <ReferenceLine y={0} stroke="rgba(185,197,216,0.32)" />
                {agentPnlChart.series.map((series) => (
                  <Line
                    key={series.key}
                    type="monotone"
                    dataKey={series.key}
                    name={series.label}
                    stroke={series.color}
                    strokeOpacity={series.deprecated ? (variant === "v2" ? 0.28 : 0.32) : 0.88}
                    strokeWidth={series.deprecated ? 1 : 2}
                    dot={false}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyVisual
              text={
                variant === "v2"
                  ? "Specialized Closer, Sprinter, Hedger, Conviction, and Scalper lines will render here after they are added to the population and produce training snapshots."
                  : "Agent PnL lines will render after at least two logged training snapshots."
              }
            />
          )}
        </div>
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          Plotting {agentPnlChart.series.length} total agent lines from{" "}
          {variant === "v2" ? "the full stored training-run history" : "recent run logs"}, including{" "}
          {agentPnlChart.series.filter((series) => series.deprecated).length} deprecated genetic agents. Lines are
          color-coded by lineage role; hover the graph to inspect names and values.
          {variant === "v2"
            ? " The live rolling 10k mark is shown only in the cards above, not connected to this historical chart."
            : ""}
        </p>
      </Panel>

      <Panel title="Validated Performance Accounting">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <RlStat label="Return bankroll" value={signedPct(aggregatePerformance.returnOnBankroll)} tone={aggregatePerformance.returnOnBankroll >= 0 ? "up" : "down"} />
          <RlStat label="Return at risk" value={signedPct(aggregatePerformance.returnOnRisk)} tone={aggregatePerformance.returnOnRisk >= 0 ? "up" : "down"} />
          <RlStat label="Money gained" value={money2(aggregatePerformance.grossGainedUsd)} tone="up" />
          <RlStat label="Money lost" value={money2(aggregatePerformance.grossLostUsd)} tone="down" />
          <RlStat label="Bets won" value={String(aggregatePerformance.betsWon)} tone="up" />
          <RlStat label="Bets lost" value={String(aggregatePerformance.betsLost)} tone="down" />
        </div>
        <p className="mt-3 text-xs text-[color:var(--muted)]">
          Only post-validation genetic performance is counted here. The run that first clears the validation threshold is
          treated as the gate; testing-tier kids, random probes, and validation-run PnL are excluded.
        </p>
      </Panel>

      <Panel title="Elite Archive & Generation Comparison">
        {generationComparison ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <RlStat label="Protected agents" value={String(routeEliteArchive.length)} tone="info" />
              <RlStat
                label="Validated"
                value={String(routeEliteArchive.filter((entry) => entry.tier === "validated" || entry.tags.includes("validated")).length)}
                tone="up"
              />
              <RlStat
                label="Scored latest"
                value={String(generationComparison.eliteArchive.scoredLatest)}
                tone="info"
              />
              <RlStat
                label="Gen PnL delta"
                value={generationComparison.delta.totalPnlUsd == null ? "n/a" : money(generationComparison.delta.totalPnlUsd)}
                tone={(generationComparison.delta.totalPnlUsd ?? 0) >= 0 ? "up" : "down"}
              />
              <RlStat
                label="Gen risk delta"
                value={signedPct(generationComparison.delta.returnOnRisk)}
                tone={(generationComparison.delta.returnOnRisk ?? 0) >= 0 ? "up" : "down"}
              />
              <RlStat
                label="Gen win delta"
                value={signedPct(generationComparison.delta.winRate)}
                tone={(generationComparison.delta.winRate ?? 0) >= 0 ? "up" : "down"}
              />
            </div>

            <div className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="text-xs uppercase text-[color:var(--muted)]">
                    <tr>
                      <th className="pb-3 pr-4 font-medium">Archived agent</th>
                      <th className="pb-3 pr-4 font-medium">Tier</th>
                      <th className="pb-3 pr-4 font-medium">Tags</th>
                      <th className="pb-3 pr-4 font-medium">Best PnL</th>
                      <th className="pb-3 pr-4 font-medium">Latest PnL</th>
                      <th className="pb-3 pr-4 font-medium">Tracked</th>
                      <th className="pb-3 font-medium">Last scored</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[color:var(--line)]">
                    {routeTopElites.slice(0, 10).map((entry) => (
                      <tr key={entry.genomeId}>
                        <td className="max-w-52 truncate py-3 pr-4" title={entry.genomeId}>
                          <span className="font-medium">{agentName(entry.genomeId, rows)}</span>
                          <span className="mt-1 block truncate mono text-xs text-[color:var(--muted)]">
                            {entry.genomeId}
                          </span>
                        </td>
                        <td className="py-3 pr-4">
                          <StatusPill tone={entry.tier === "validated" ? "good" : "warn"}>{entry.tier}</StatusPill>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {entry.tags.map((tag) => (
                              <span
                                key={tag}
                                className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                                  tag === "validated" || tag === "profit-20"
                                    ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
                                    : "border-sky-300/20 bg-sky-300/10 text-sky-100"
                                }`}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 pr-4 mono text-emerald-200">{money(entry.bestPnlUsd)}</td>
                        <td className={`py-3 pr-4 mono ${entry.latestPnlUsd >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                          {money(entry.latestPnlUsd)}
                        </td>
                        <td className="py-3 pr-4 mono">{entry.generationsTracked}</td>
                        <td className="py-3 mono text-xs text-[color:var(--muted)]">{shortTime(entry.lastScoredAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border border-[color:var(--line)] bg-black/10 p-4">
                <h3 className="text-sm font-semibold">Same-genome movement</h3>
                <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">
                  These are agents present in both the current and previous generation snapshots. The archive table
                  above covers agents that were protected even after leaving the active leaderboard.
                </p>
                <div className="mt-4 space-y-2">
                  {generationComparison.sameGenomeDeltas.slice(0, 8).map((delta) => (
                    <div
                      key={delta.genomeId}
                      className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded border border-[color:var(--line)] bg-black/10 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium" title={delta.genomeId}>
                          {agentName(delta.genomeId, rows)}
                        </p>
                        <p className="truncate mono text-xs text-[color:var(--muted)]">{delta.genomeId}</p>
                      </div>
                      <div className={`mono text-sm ${delta.deltaPnlUsd >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                        {money(delta.deltaPnlUsd)}
                      </div>
                    </div>
                  ))}
                  {!generationComparison.sameGenomeDeltas.length ? (
                    <p className="text-sm text-[color:var(--muted)]">
                      No overlapping genomes between the latest two generation snapshots.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <p className="text-xs text-[color:var(--muted)]">
              Agents above the validation threshold receive the validated tag, but their first qualifying run is not
              counted in performance accounting. Archived agents are not removed from the protected set; each training
              run re-scores archived genomes alongside the current breeding population.
            </p>
          </div>
        ) : (
          <EmptyVisual text="Generation comparison will appear after at least one RL training run is scored." />
        )}
      </Panel>

      <Panel title="Live Agent Table">
        {liveAgentRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[2100px] text-left text-sm">
              <thead className="text-xs uppercase text-[color:var(--muted)]">
                <tr>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("agent", "Agent")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("status", "Status")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("tier", "Tier")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("trades", "Trades")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("openNet", "Open net")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("openPaid", "Open paid")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("markValue", "5m mark value")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("openPnl", "Open PnL")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("pnl20m", "PnL 20m")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("pnl50m", "PnL 50m")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("seen", "Seen")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("lastSide", "Last side")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("entry", "Entry")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("exit", "Exit/mark")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("lastPnl", "Last PnL")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("reward", "Reward")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("totalPnl", "Total PnL")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("bankrollReturn", "Bankroll ret")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("riskReturn", "Risk ret")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("gained", "Gained")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("lost", "Lost")}</th>
                  <th className="pb-3 pr-4 font-medium">{sortableHeader("winLoss", "W/L")}</th>
                  <th className="pb-3 font-medium">{sortableHeader("lastAction", "Last action")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--line)]">
                {liveAgentRows.map((agent) => (
                  <tr key={agent.id}>
                    <td className="max-w-52 truncate py-3 pr-4" title={agent.title}>
                      <span className="font-medium">{agent.agentLabel}</span>
                      {agent.eliteTags.length ? (
                        <span className="ml-2 inline-flex gap-1 align-middle">
                          {agent.eliteTags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="rounded border border-amber-300/25 bg-amber-300/10 px-1.5 py-0.5 text-[10px] uppercase text-amber-100"
                              title={agent.archivedReason}
                            >
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                      <span className="mt-1 block truncate mono text-xs text-[color:var(--muted)]">{agent.subLabel}</span>
                    </td>
                    <td className="py-3 pr-4">
                      <StatusPill tone={agent.statusTone}>{agent.statusLabel}</StatusPill>
                    </td>
                    <td className="py-3 pr-4">
                      <StatusPill tone={agent.tier === "validated" ? "good" : "warn"}>
                        {agent.tier === "validated" && !agent.contributesToPerformance ? "validated gate" : agent.tier}
                      </StatusPill>
                    </td>
                    <td className="py-3 pr-4 mono text-[color:var(--foreground)]">{agent.trades}</td>
                    <td className="py-3 pr-4 mono" title={agent.openPosition.title}>
                      {agent.openPosition.sideLabel}
                    </td>
                    <td className="py-3 pr-4 mono">{money(agent.openPosition.costBasisUsd)}</td>
                    <td className="py-3 pr-4 mono">{money(agent.openPosition.markValueUsd)}</td>
                    <td
                      className={`py-3 pr-4 mono ${
                        agent.openPosition.unrealizedPnlUsd >= 0 ? "text-emerald-200" : "text-rose-200"
                      }`}
                    >
                      {money(agent.openPosition.unrealizedPnlUsd)}
                    </td>
                    <td className={`py-3 pr-4 mono ${agent.pnl20m >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                      {money(agent.pnl20m)}
                    </td>
                    <td className={`py-3 pr-4 mono ${agent.pnl50m >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                      {money(agent.pnl50m)}
                    </td>
                    <td className="py-3 pr-4 mono">{agent.seen}</td>
                    <td className="py-3 pr-4 mono">{agent.lastSide}</td>
                    <td className="py-3 pr-4 mono">{agent.entryPrice == null ? "n/a" : cents(agent.entryPrice)}</td>
                    <td className="py-3 pr-4 mono">{agent.exitPrice == null ? "n/a" : cents(agent.exitPrice)}</td>
                    <td
                      className={`py-3 pr-4 mono ${
                        (agent.lastPnl ?? 0) >= 0 ? "text-emerald-200" : "text-rose-200"
                      }`}
                    >
                      {agent.lastPnl == null ? "n/a" : money(agent.lastPnl)}
                    </td>
                    <td className="py-3 pr-4 mono">{fixed(agent.reward, 3)}</td>
                    <td className={`py-3 pr-4 mono ${agent.totalPnl >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                      {money(agent.totalPnl)}
                    </td>
                    <td
                      className={`py-3 pr-4 mono ${
                        agent.performance.returnOnBankroll >= 0 ? "text-emerald-200" : "text-rose-200"
                      }`}
                    >
                      {signedPct(agent.performance.returnOnBankroll)}
                    </td>
                    <td
                      className={`py-3 pr-4 mono ${
                        agent.performance.returnOnRisk >= 0 ? "text-emerald-200" : "text-rose-200"
                      }`}
                    >
                      {signedPct(agent.performance.returnOnRisk)}
                    </td>
                    <td className="py-3 pr-4 mono text-emerald-200">{money2(agent.performance.grossGainedUsd)}</td>
                    <td className="py-3 pr-4 mono text-rose-200">{money2(agent.performance.grossLostUsd)}</td>
                    <td className="py-3 pr-4 mono">
                      {agent.performance.betsWon}/{agent.performance.betsLost}
                    </td>
                    <td className="max-w-80 truncate py-3 text-xs text-[color:var(--muted)]">{agent.lastAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-[color:var(--muted)]">
              Rows are re-scored from the latest tick path every second. Promotion still happens on the generation
              cadence. Open value is the marked notional at the current 5-minute evaluation cut; final binary
              settlement still sends one side to 100c and the other to 0c at the 15-minute close. Testing-tier rows are
              excluded from fund-level PnL accounting and future live execution gates.
            </p>
          </div>
        ) : (
          <EmptyVisual text="Live agent rows will appear after the next scored generation." />
        )}
      </Panel>

      <Panel title="Latest Generation">
        {rows.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => {
              const parents = row.parentGenomeIds.length ? row.parentGenomeIds : row.genome.parentGenomeIds ?? [];
              const latestTrade = row.recentTrades?.at(-1) ?? null;
              return (
                <div
                  key={row.genome.genomeId}
                  className="rounded-md border border-[color:var(--line)] bg-black/10 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" title={agentLineageTitle(row, rows)}>
                        {agentName(row.genome.genomeId, rows)}
                      </p>
                      <p className="mt-1 truncate text-xs text-[color:var(--muted)]">
                        {row.genome.genomeId} · parent {parents.map((id) => agentName(id, rows)).join(", ") || "seed"}
                      </p>
                    </div>
                    <StatusPill tone={statusTone(row.status)}>{row.status}</StatusPill>
                  </div>
                  {row.eliteTags?.length ? (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {row.eliteTags.map((tag) => (
                        <span
                          key={tag}
                          className={`rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                            tag === "validated" || tag === "profit-20"
                              ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
                              : "border-sky-300/20 bg-sky-300/10 text-sky-100"
                          }`}
                          title={row.archivedReason}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase text-[color:var(--muted)]">Reward</p>
                      <p className="mt-1 mono">{fixed(row.reward, 3)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[color:var(--muted)]">PnL</p>
                      <p className="mt-1 mono">{money(row.pnlUsd)}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[color:var(--muted)]">Trades</p>
                      <p className="mt-1 mono">{row.trades}</p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[color:var(--muted)]">Kids</p>
                      <p className="mt-1 mono">{childCount.get(row.genome.genomeId) ?? 0}</p>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase text-[color:var(--muted)]">PnL 20m</p>
                      <p className={`mt-1 mono ${(row.pnlLast20m ?? 0) >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                        {money(row.pnlLast20m ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[color:var(--muted)]">PnL 50m</p>
                      <p className={`mt-1 mono ${(row.pnlLast50m ?? 0) >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                        {money(row.pnlLast50m ?? 0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase text-[color:var(--muted)]">Seen</p>
                      <p className="mt-1 mono">{row.generationsSeen ?? 1}</p>
                    </div>
                  </div>
                  {latestTrade ? (
                    <div className="mt-4 rounded-md border border-[color:var(--line)] bg-black/10 p-3 text-xs text-[color:var(--muted)]">
                      <p className="mono text-[color:var(--foreground)]">
                        last action: {latestTrade.side.toUpperCase()} {cents(latestTrade.entryPrice)} →{" "}
                        {cents(latestTrade.exitPrice)}
                      </p>
                      <p className="mt-1">
                        {shortTime(latestTrade.openedAt)} · PnL {money(latestTrade.pnlUsd)}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyVisual text="No scored generation yet. Start the one-second screen tick stream, then run or wait for the RL daemon." />
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
        <Panel title="Recent Training Runs">
          {(rl?.runHistory ?? []).length ? (
            <div className="space-y-3">
              {(rl?.runHistory ?? []).slice(0, 6).map((run) => (
                <div key={run.runId} className="rounded-md border border-[color:var(--line)] bg-black/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="mono text-xs">{run.runId}</span>
                    <StatusPill tone={run.promoted ? "good" : run.eventCount ? "warn" : "neutral"}>
                      {run.promoted ? "promoted" : run.eventCount ? "evaluated" : "waiting"}
                    </StatusPill>
                  </div>
                  <p className="mt-2 text-sm text-[color:var(--muted)]">
                    {compact(run.eventCount)} events · {run.evaluatedMarkets.length} markets · best{" "}
                    {run.best ? fixed(run.best.reward, 3) : "n/a"}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyVisual text="Training history will appear after the first RL pass." />
          )}
        </Panel>

        <Panel title="Genome Parameters">
          {champion ? (
            <div className="grid gap-3 md:grid-cols-3">
              {Object.entries(champion.genome)
                .filter(([, value]) => typeof value === "number")
                .map(([key, value]) => (
                  <Metric key={key} label={key} value={fixed(value as number, 4)} />
                ))}
            </div>
          ) : (
            <EmptyVisual text="A promoted champion's policy parameters will appear here." />
          )}
        </Panel>
      </div>
    </div>
  );
}

function RiskVisual({ data }: { data: DashboardPayload }) {
  const latest = latestCyclePayload(data);
  const limits = latest?.risk?.limits ?? [];
  const pass = limits.filter((limit) => limit.ok).length;
  const rows = [
    { name: "Pass", value: pass, fill: "#32d6a2" },
    { name: "Review", value: Math.max(0, limits.length - pass), fill: "#ff7a90" },
  ];
  return (
    <Panel title="Risk Gates">
      <div className="grid gap-4 md:grid-cols-[0.72fr_1fr]">
        <div className="h-52 min-w-0">
          {limits.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={rows} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={4}>
                  {rows.map((row) => (
                    <Cell key={row.name} fill={row.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyVisual text="No risk result yet." />
          )}
        </div>
        <div className="space-y-2">
          {limits.length ? (
            limits.slice(0, 7).map((limit) => (
              <div key={limit.name} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] px-3 py-2 text-sm">
                <span>{limit.name}</span>
                <StatusPill tone={limit.ok ? "good" : "bad"}>{limit.ok ? "pass" : "review"}</StatusPill>
              </div>
            ))
          ) : (
            <p className="text-sm text-[color:var(--muted)]">Run a paper cycle to render limit state.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ResearchLab({
  data,
  symbol,
  setSymbol,
  runBacktest,
  disabled,
  latestBacktest,
}: {
  data: DashboardPayload;
  symbol: string;
  setSymbol: (s: string) => void;
  runBacktest: () => void;
  disabled: boolean;
  latestBacktest: ModelComparisonBacktest | null;
}) {
  const runRows = data.research.runs.slice(0, 8);
  return (
    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
      <Panel title="Model Backtest Runner">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            className="h-10 rounded-md border border-[color:var(--line)] bg-[#0b1018] px-3 text-sm text-white"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            placeholder="BTC"
            aria-label="Market symbol"
          />
          <button
            className="h-10 rounded-md bg-[color:var(--accent)] px-4 text-sm font-semibold text-[#07110f] disabled:opacity-50"
            disabled={disabled}
            onClick={runBacktest}
            type="button"
          >
            Compare Models
          </button>
        </div>
        <div className="mt-5 grid gap-3">
          {data.research.notes.map((n) => (
            <div key={n} className="rounded-md border border-[color:var(--line)] p-3 text-sm text-[color:var(--muted)]">
              {n}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Research Runs">
        <RecordTable records={runRows} empty="No backtests recorded yet." />
      </Panel>
      <Panel title="Market Data Cache">
        <div className="grid gap-3 md:grid-cols-2">
          {(data.research.cache?.entries ?? []).length ? (
            (data.research.cache?.entries ?? []).map((entry) => (
              <div key={entry.symbol} className="rounded-md border border-[color:var(--line)] p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium">{entry.symbol}</h3>
                  <span className="mono text-xs text-[color:var(--muted)]">{entry.bars} bars</span>
                </div>
                <p className="mt-2 text-xs text-[color:var(--muted)]">
                  {entry.assetClass} · {entry.timeframe} · {entry.source}
                </p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">
                  {entry.start ? shortTime(entry.start) : "n/a"} to{" "}
                  {entry.end ? shortTime(entry.end) : "n/a"}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-[color:var(--muted)]">
              No cached bars yet. Run a paper cycle to populate `.data/market-cache.json`.
            </p>
          )}
        </div>
      </Panel>
      <BacktestComparisonVisual comparison={latestBacktest} />
      <Panel title="Model Registry">
        <RecordTable records={data.research.models.slice(0, 8)} empty="No model records yet." />
      </Panel>
      <Panel title="Paper Cycles">
        <RecordTable records={(data.research.cycles ?? []).slice(0, 8)} empty="No paper cycles recorded yet." />
      </Panel>
    </div>
  );
}

function BacktestComparisonVisual({ comparison }: { comparison: ModelComparisonBacktest | null }) {
  const chart = comparison ? buildBacktestChart(comparison) : [];
  const best = comparison?.results.find((row) => row.modelId === comparison.bestModelId) ?? null;
  return (
    <Panel title="Model Comparison">
      {comparison ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="Symbol" value={comparison.symbol} />
            <Metric label="Bars tested" value={compact(comparison.observations)} />
            <Metric label="Best model" value={best?.label ?? "n/a"} />
          </div>
          <div className="h-72 min-w-0">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart}>
                <CartesianGrid stroke="rgba(185,197,216,0.14)" />
                <XAxis dataKey="model" stroke="#9aa7b8" tick={{ fontSize: 11 }} />
                <YAxis stroke="#9aa7b8" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Legend />
                <Bar dataKey="accuracy" name="Accuracy %" fill="#32d6a2" radius={[4, 4, 0, 0]} />
                <Bar dataKey="strategyReturn" name="Strategy %" fill="#f0c75e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-[color:var(--muted)]">
                <tr>
                  <th className="pb-2 font-medium">Model</th>
                  <th className="pb-2 font-medium">Accuracy</th>
                  <th className="pb-2 font-medium">RMSE</th>
                  <th className="pb-2 font-medium">Strategy</th>
                  <th className="pb-2 font-medium">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[color:var(--line)]">
                {comparison.results.map((row) => (
                  <tr key={row.modelId}>
                    <td className="py-2 pr-3">{row.label}</td>
                    <td className="py-2 pr-3 text-[color:var(--muted)]">
                      {row.directionalAccuracy == null ? "n/a" : pct(row.directionalAccuracy)}
                    </td>
                    <td className="py-2 pr-3 text-[color:var(--muted)]">
                      {row.rmseBps == null ? "n/a" : `${fixed(row.rmseBps, 1)} bps`}
                    </td>
                    <td className="py-2 pr-3 text-[color:var(--muted)]">
                      {row.strategyReturnPct == null ? "n/a" : `${fixed(row.strategyReturnPct, 2)}%`}
                    </td>
                    <td className="py-2 text-[color:var(--muted)]">
                      {row.lastTargetPrice == null ? "n/a" : fixed(row.lastTargetPrice, 2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyVisual text="Run Compare Models to evaluate simple walk-forward predictors." />
      )}
    </Panel>
  );
}

function OutcomesExperiments({
  data,
  outcomeChart,
}: {
  data: DashboardPayload;
  outcomeChart: OutcomeChartPoint[];
}) {
  const book = data.paperBook ?? emptyPaperBook();
  const extraSections = researchExtraSections(data);
  const payloadExtras = data as unknown as {
    outcomeEvaluation?: { horizons?: unknown; evaluations?: unknown };
    experimentRegistry?: { activeExperimentId?: unknown; experiments?: unknown };
  };
  const horizonRows = normalizeResearchRows(payloadExtras.outcomeEvaluation?.horizons);
  const evaluationRows = normalizeResearchRows(payloadExtras.outcomeEvaluation?.evaluations);
  const experimentRows = normalizeResearchRows(payloadExtras.experimentRegistry?.experiments);
  const activeExperimentId = payloadExtras.experimentRegistry?.activeExperimentId;
  const latestOutcome = book.cycleOutcomes[0];
  const latestCycle = data.research.cycles?.[0];

  return (
    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
      <Panel title="Outcome Snapshot">
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Metric label="Outcome cycles" value={String(book.cycleOutcomes.length)} />
          <Metric label="Open paper positions" value={String(book.totals.openCount)} />
          <Metric label="Unrealized PnL" value={money(book.totals.unrealizedPnlUsd)} />
          <Metric
            label="Alpha vs benchmark"
            value={book.totals.alphaVsBenchmarkPct == null ? "n/a" : pct(book.totals.alphaVsBenchmarkPct)}
          />
        </div>
        <div className="rounded-md border border-[color:var(--line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase text-[color:var(--muted)]">Latest cycle evidence</p>
              <h3 className="mt-2 mono text-sm font-medium">
                {latestOutcome?.cycleId ?? latestCycle?.id ?? "waiting-for-cycle"}
              </h3>
            </div>
            <span className="rounded px-2 py-1 text-xs bg-emerald-400/15 text-emerald-200">
              paper only
            </span>
          </div>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            {latestOutcome
              ? `${latestOutcome.positions} positions opened ${shortTime(latestOutcome.openedAt)} with average forecast score ${fixed(latestOutcome.avgForecastScore, 2)}.`
              : "Run a paper cycle, then refresh after new bars arrive to attribute marks and benchmark-relative alpha."}
          </p>
        </div>
      </Panel>
      <OutcomeVisual points={outcomeChart} />
      <CycleOutcomesPanel data={data} />
      {horizonRows.length ? (
        <Panel title="Evaluation Horizons">
          <ResearchExtraRows rows={horizonRows} />
        </Panel>
      ) : null}
      {evaluationRows.length ? (
        <Panel title="Outcome Evaluations">
          <ResearchExtraRows rows={evaluationRows} />
        </Panel>
      ) : null}
      {experimentRows.length ? (
        <Panel title="Experiments">
          {typeof activeExperimentId === "string" ? (
            <p className="mb-4 text-sm text-[color:var(--muted)]">
              Active experiment: <span className="mono text-[color:var(--accent)]">{activeExperimentId}</span>
            </p>
          ) : null}
          <ResearchExtraRows rows={experimentRows} />
        </Panel>
      ) : null}
      {extraSections.length ? (
        extraSections.map((section) => (
          <Panel key={section.title} title={section.title}>
            <ResearchExtraRows rows={section.rows} />
          </Panel>
        ))
      ) : !horizonRows.length && !evaluationRows.length && !experimentRows.length ? (
        <Panel title="Experiment Registry">
          <p className="text-sm text-[color:var(--muted)]">
            No outcome evaluation or experiment registry payloads are present yet. This view will
            render top-level backend fields or `research.outcomes`, `research.evaluations`, and
            `research.experiments` automatically when they arrive.
          </p>
        </Panel>
      ) : null}
      <Panel title="Evaluation Trail">
        <RecordTable records={data.research.models.slice(0, 6)} empty="No evaluation model records yet." />
      </Panel>
    </div>
  );
}

function OutcomeVisual({ points }: { points: OutcomeChartPoint[] }) {
  return (
    <Panel title="Outcome Curves">
      <div className="h-72 w-full min-w-0">
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <CartesianGrid stroke="rgba(185,197,216,0.14)" />
              <XAxis dataKey="label" stroke="#9aa7b8" tick={{ fontSize: 11 }} />
              <YAxis stroke="#9aa7b8" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
              <ReferenceLine y={0} stroke="rgba(185,197,216,0.28)" />
              <Line type="monotone" dataKey="returnPct" name="Return %" stroke="#32d6a2" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="alphaPct" name="Alpha %" stroke="#f0c75e" strokeWidth={2} dot={{ r: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <EmptyVisual text="Outcome curves appear after simulated fills are marked." />
        )}
      </div>
    </Panel>
  );
}

function Allocation({
  data,
  allocationChart,
}: {
  data: DashboardPayload;
  allocationChart: Array<{ name: string; dollars: number; score: number }>;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <Panel title="Paper Allocation">
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <Metric label="Deployable" value={money(data.proposal.deployableCapitalUsd)} />
          <Metric label="Shadow price" value={fixed(data.proposal.shadowPrice, 3)} />
          <Metric label="Mode" value={data.proposal.mode} />
        </div>
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={allocationChart}>
              <CartesianGrid stroke="rgba(164,177,198,0.16)" />
              <XAxis dataKey="name" stroke="#8b98a9" />
              <YAxis stroke="#8b98a9" />
              <Tooltip contentStyle={{ background: "#101927", border: "1px solid rgba(164,177,198,0.2)" }} />
              <Legend />
              <Bar dataKey="dollars" fill="#39d0a4" />
              <Bar dataKey="score" fill="#79a8ff" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="Channel Rows">
        <div className="space-y-3">
          {data.proposal.channels.map((c) => (
            <div key={c.id} className="rounded-md border border-[color:var(--line)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">
                    {c.id} · {c.name}
                  </h3>
                  <p className="mt-1 text-sm text-[color:var(--muted)]">{c.description}</p>
                </div>
                <span className="mono text-sm text-[color:var(--accent)]">{money(c.proposedUsd)}</span>
              </div>
              <div className="mt-3 grid gap-2 text-xs text-[color:var(--muted)] md:grid-cols-4">
                <span>mean {pct(c.meanReturn)}</span>
                <span>sigma {pct(c.sigma)}</span>
                <span>ready {pct(c.readiness)}</span>
                <span>score {fixed(c.riskAdjustedScore, 2)}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
      <InvestmentCalibrationPanel data={data} />
      <Certificate data={data} />
      <Panel title="Constraints">
        <div className="space-y-3">
          {data.proposal.constraints.map((c) => (
            <div key={c.name} className="flex gap-3 rounded-md border border-[color:var(--line)] p-3">
              <span className={c.ok ? "text-[color:var(--accent)]" : "text-[color:var(--danger)]"}>
                {c.ok ? "pass" : "fail"}
              </span>
              <div>
                <h3 className="font-medium">{c.name}</h3>
                <p className="text-sm text-[color:var(--muted)]">{c.message}</p>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function InvestmentCalibrationPanel({ data }: { data: DashboardPayload }) {
  const calibration = data.investmentCalibration ?? emptyInvestmentCalibration();
  const d = calibration.diagnostics;
  return (
    <Panel title="Investment Row Calibration">
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Metric label="Outcome samples" value={String(d.sampleSize)} />
        <Metric label="Evidence weight" value={pct(d.evidenceWeight)} />
        <Metric label="Hit rate" value={d.hitRate == null ? "n/a" : pct(d.hitRate)} />
        <Metric
          label="Alpha evidence"
          value={d.alphaVsBenchmark == null ? pct(d.realizedReturn) : pct(d.alphaVsBenchmark)}
        />
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-[color:var(--line)] p-4">
          <p className="text-xs uppercase text-[color:var(--muted)]">Prior</p>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            mean {pct(d.priorMeanReturn)} · sigma {pct(d.priorSigma)} · ready{" "}
            {pct(d.priorReadiness)}
          </p>
        </div>
        <div className="rounded-md border border-[color:var(--line)] p-4">
          <p className="text-xs uppercase text-[color:var(--muted)]">Evidence</p>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            mean {pct(d.evidenceMean)} · drawdown {pct(d.drawdownProxy)} · forecast{" "}
            {fixed(d.avgForecastScore, 2)}
          </p>
        </div>
        <div className="rounded-md border border-[color:var(--line)] p-4">
          <p className="text-xs uppercase text-[color:var(--muted)]">Blended I row</p>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            mean {pct(d.blendedMeanReturn)} · sigma {pct(d.blendedSigma)} · ready{" "}
            {pct(d.blendedReadiness)}
          </p>
        </div>
      </div>
      <p className="mt-4 text-sm text-[color:var(--muted)]">{calibration.channel.source}</p>
    </Panel>
  );
}

function OpsPanel({ data }: { data: DashboardPayload }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <RecursionStatusPanel data={data} />
      <Panel title="Persistence">
        <div className="rounded-md border border-[color:var(--line)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">Authoritative Store</h3>
            <span
              className={
                data.ops.storage.durable
                  ? "rounded px-2 py-1 text-xs bg-emerald-400/15 text-emerald-200"
                  : "rounded px-2 py-1 text-xs bg-amber-400/15 text-amber-200"
              }
            >
              {data.ops.storage.mode}
            </span>
          </div>
          <p className="mt-2 text-sm text-[color:var(--muted)]">{data.ops.storage.message}</p>
        </div>
      </Panel>
      <Panel title="Build Surface">
        <div className="space-y-3">
          {data.ops.capabilities.map((group) => (
            <div key={group.name} className="rounded-md border border-[color:var(--line)] p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">{group.name}</h3>
                <span
                  className={
                    group.status === "ready"
                      ? "rounded px-2 py-1 text-xs bg-emerald-400/15 text-emerald-200"
                      : "rounded px-2 py-1 text-xs bg-amber-400/15 text-amber-200"
                  }
                >
                  {group.status}
                </span>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-[color:var(--muted)]">
                {group.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Secret Readiness">
        <div className="space-y-3">
          {data.ops.secrets.map((secret) => (
            <div key={secret.name} className="rounded-md border border-[color:var(--line)] p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">{secret.name}</h3>
                <span
                  className={
                    secret.configured
                      ? "rounded px-2 py-1 text-xs bg-emerald-400/15 text-emerald-200"
                      : "rounded px-2 py-1 text-xs bg-red-400/15 text-red-200"
                  }
                >
                  {secret.configured ? "configured" : "missing"}
                </span>
              </div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">{secret.purpose}</p>
              <p className="mt-2 mono text-xs text-[color:var(--muted)]">
                {secret.variables.join(", ")}
              </p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Local Operations">
        <div className="space-y-3">
          {data.ops.localCommands.map((cmd) => (
            <div key={cmd.name} className="rounded-md border border-[color:var(--line)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="font-medium">{cmd.name}</h3>
                <code className="rounded bg-[#071018] px-2 py-1 text-xs text-[color:var(--accent)]">
                  {cmd.command}
                </code>
              </div>
              <p className="mt-2 text-sm text-[color:var(--muted)]">{cmd.purpose}</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Safety Boundary">
        <div className="space-y-3 text-sm text-[color:var(--muted)]">
          <p>No route in this app submits live Alpaca or Kalshi orders.</p>
          <p>Cycle runs record forecasts, certificates, and simulated fills only.</p>
          <p>Production autonomy still needs managed persistence, queueing, monitoring, access control, and an explicit live-execution design review.</p>
        </div>
      </Panel>
    </div>
  );
}

function RecursionStatusPanel({ data }: { data: DashboardPayload }) {
  const recursion = getRecursionState(data);
  const decision = recursion?.lastResearchDecision ?? recursion?.lastDecision ?? null;
  const gate = decision?.gate ?? recursion?.gate ?? null;
  const rejectionReasons = recursion ? recursionRejectionReasons(recursion, decision, gate) : [];
  const universe = recursionUniverse(recursion);
  const enabledLabel = recursion ? (recursion.enabled ? "enabled" : "disabled") : "not wired";
  const gateLabel = gateResultLabel(gate, decision);
  const provider = decision?.provider ?? recursion?.provider ?? "n/a";
  const model = decision?.providerModel ?? decision?.model ?? decision?.modelId ?? recursion?.providerModel ?? recursion?.model ?? "n/a";

  return (
    <Panel title="Recursion Status">
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Metric label="Status" value={enabledLabel} />
        <Metric label="Provider" value={provider} />
        <Metric label="Model" value={model} />
      </div>
      <div className="space-y-3">
        <div className="rounded-md border border-[color:var(--line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">Active Autonomous Universe</h3>
            <span className="mono text-xs text-[color:var(--muted)]">
              {universe.length ? `${universe.length} symbols` : "unavailable"}
            </span>
          </div>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            {universe.length ? universe.join(", ") : "Recursion payload has not exposed an autonomous universe yet."}
          </p>
        </div>
        <div className="rounded-md border border-[color:var(--line)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-medium">Last Research Decision</h3>
              <p className="mt-1 mono text-xs text-[color:var(--muted)]">
                {decision?.at || decision?.createdAt
                  ? shortTime(decision.at ?? decision.createdAt ?? "")
                  : decision?.decisionId ?? decision?.id ?? recursion?.activeDecisionId ?? "waiting for decision"}
              </p>
            </div>
            <span className="rounded px-2 py-1 text-xs bg-[color:var(--panel-strong)] text-[color:var(--foreground)]">
              {decision?.decision ?? decision?.action ?? decision?.status ?? "n/a"}
            </span>
          </div>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            {decision?.summary ??
              decision?.reason ??
              decision?.hypothesis ??
              "No research decision has been published to the dashboard payload."}
          </p>
        </div>
        <div className="rounded-md border border-[color:var(--line)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-medium">Gate Result</h3>
            <span className={gateResultClass(gate, decision)}>{gateLabel}</span>
          </div>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            {gate?.reason ?? (recursion ? "No gate reason was provided." : "Wire recursion state to show gate decisions.")}
          </p>
          <div className="mt-3 space-y-2">
            {rejectionReasons.length ? (
              rejectionReasons.map((reason) => (
                <p key={reason} className="rounded-md border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--muted)]">
                  {reason}
                </p>
              ))
            ) : (
              <p className="rounded-md border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--muted)]">
                No rejection reasons recorded.
              </p>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function getRecursionState(data: DashboardPayload): RecursionDashboardState | null {
  const extended = data as DashboardPayloadWithRecursion;
  return extended.ops.recursion ?? extended.recursion ?? extended.research.recursion ?? null;
}

function recursionUniverse(recursion: RecursionDashboardState | null | undefined): string[] {
  return (
    recursion?.activeAutonomousUniverse ??
    recursion?.autonomousUniverse ??
    recursion?.universe ??
    recursion?.lastResearchDecision?.universe ??
    recursion?.lastDecision?.universe ??
    []
  );
}

function recursionRejectionReasons(
  recursion: RecursionDashboardState,
  decision: RecursionResearchDecision | null,
  gate: RecursionGateResult | null,
): string[] {
  return [
    ...(gate?.rejectionReasons ?? []),
    ...(gate?.reasons ?? []),
    ...(decision?.rejectionReasons ?? []),
    ...(decision?.validationErrors ?? []).map((error) =>
      error.field ? `${error.field}: ${error.message}` : error.message,
    ),
    ...(decision?.status === "rejected" && decision.reason ? [decision.reason] : []),
    ...(recursion.rejectionReasons ?? []),
  ].filter((reason, index, reasons) => reason.trim().length > 0 && reasons.indexOf(reason) === index);
}

function gateResultLabel(
  gate: RecursionGateResult | null | undefined,
  decision?: RecursionResearchDecision | null,
): string {
  if (!gate) return decision?.status ?? "n/a";
  if (gate.result) return gate.result;
  if (gate.status) return gate.status;
  if (gate.ok === false || gate.passed === false) return "rejected";
  if (gate.ok === true || gate.passed === true) return "passed";
  return "n/a";
}

function gateResultClass(
  gate: RecursionGateResult | null | undefined,
  decision?: RecursionResearchDecision | null,
): string {
  const label = gateResultLabel(gate, decision).toLowerCase();
  if (label === "passed" || label === "pass" || label === "approved" || gate?.ok === true || gate?.passed === true) {
    return "rounded px-2 py-1 text-xs bg-emerald-400/15 text-emerald-200";
  }
  if (label === "rejected" || label === "blocked" || label === "failed" || gate?.ok === false || gate?.passed === false) {
    return "rounded px-2 py-1 text-xs bg-red-400/15 text-red-200";
  }
  return "rounded px-2 py-1 text-xs bg-amber-400/15 text-amber-200";
}

function Certificate({ data }: { data: DashboardPayload }) {
  const quantiles = data.tRsi.samples.map((sample) => ({
    bucket: sample.bucket,
    create: Number((sample.create * 100).toFixed(3)),
    decay: Number((sample.decay * 100).toFixed(3)),
  }));
  return (
    <Panel title="t-RSI Certificate">
      <div className="grid gap-4 md:grid-cols-3">
        <Metric label="t-RSI" value={fixed(data.tRsi.tRsi, 2)} />
        <Metric label="Create mean" value={pct(data.tRsi.alphaCreateMean)} />
        <Metric label="Decay mean" value={pct(data.tRsi.alphaDecayMean)} />
      </div>
      <div className="mt-4 rounded-md border border-[color:var(--line)] p-4">
        <div className="flex items-center justify-between gap-3">
          <span className={data.tRsi.approved ? "text-[color:var(--accent)]" : "text-[color:var(--accent-2)]"}>
            {data.tRsi.approved ? "paper certificate clears" : "paper certificate withheld"}
          </span>
          <span className="mono text-xs text-[color:var(--muted)]">
            {(data.tRsi.engine ?? data.tRsi.status).replaceAll("_", " ")}
          </span>
        </div>
        <p className="mt-2 text-sm text-[color:var(--muted)]">{data.tRsi.reason}</p>
        {data.tRsi.evidence ? (
          <p className="mt-2 mono text-xs text-[color:var(--muted)]">
            {data.tRsi.evidence.sampleSize} Kalshi samples · {data.tRsi.evidence.horizonMinutes}m horizon
          </p>
        ) : null}
      </div>
      <div className="mt-4 h-48 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={quantiles}>
            <CartesianGrid stroke="rgba(185,197,216,0.14)" />
            <XAxis dataKey="bucket" stroke="#9aa7b8" tick={{ fontSize: 11 }} />
            <YAxis stroke="#9aa7b8" tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend />
            <Bar dataKey="create" name="Create %" fill="#32d6a2" radius={[4, 4, 0, 0]} />
            <Bar dataKey="decay" name="Decay %" fill="#ff7a90" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function CyclePanel({ data }: { data: DashboardPayload }) {
  const latest = data.research.cycles?.[0];
  const payload = latest?.payload as
    | {
        forecasts?: Array<{
          symbol: string;
          score: number;
          expectedReturn: number;
          shortMomentum?: number;
          shortLookbackLabel?: string;
        }>;
        simulatedFills?: Array<{ symbol: string; notionalUsd: number; quantity: number }>;
        cadence?: string;
        timeframe?: string;
        reason?: string;
      }
    | undefined;
  return (
    <Panel title="Latest Paper Cycle">
      {latest ? (
        <div className="space-y-4">
          <p className="text-sm text-[color:var(--muted)]">
            {payload?.reason ?? recordSummary(latest)}
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Metric label="Cadence" value={payload?.cadence ?? "paper"} />
            <Metric label="Bar timeframe" value={payload?.timeframe ?? "n/a"} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-medium">Top Forecasts</h3>
              <div className="space-y-2">
                {(payload?.forecasts ?? []).slice(0, 5).map((f) => (
                  <div key={f.symbol} className="flex justify-between rounded-md border border-[color:var(--line)] px-3 py-2 text-sm">
                    <span>{f.symbol}</span>
                    <span className="mono text-[color:var(--muted)]">
                      score {fixed(f.score, 2)} · {f.shortLookbackLabel ?? "exp"}{" "}
                      {pct(f.shortMomentum ?? f.expectedReturn)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Simulated Fills</h3>
              <div className="space-y-2">
                {(payload?.simulatedFills ?? []).length ? (
                  (payload?.simulatedFills ?? []).map((f) => (
                    <div key={f.symbol} className="flex justify-between rounded-md border border-[color:var(--line)] px-3 py-2 text-sm">
                      <span>{f.symbol}</span>
                      <span className="mono text-[color:var(--muted)]">
                        {money(f.notionalUsd)} · {fixed(f.quantity, 6)} units
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="rounded-md border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--muted)]">
                    No simulated fills.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-[color:var(--muted)]">
          No cycle yet. Use Run Cycle to cache bars, score the universe, and record simulated fills.
        </p>
      )}
    </Panel>
  );
}

function PaperBookPanel({ data }: { data: DashboardPayload }) {
  const book = data.paperBook ?? emptyPaperBook();
  return (
    <Panel title="Paper Book">
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Metric label="Open paper positions" value={String(book.totals.openCount)} />
        <Metric label="Paper notional" value={money(book.totals.notionalUsd)} />
        <Metric label="Unrealized PnL" value={money(book.totals.unrealizedPnlUsd)} />
        <Metric
          label="Alpha vs benchmark"
          value={book.totals.alphaVsBenchmarkPct == null ? "n/a" : pct(book.totals.alphaVsBenchmarkPct)}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs uppercase text-[color:var(--muted)]">
            <tr>
              <th className="pb-2 font-medium">Symbol</th>
              <th className="pb-2 font-medium">Entry</th>
              <th className="pb-2 font-medium">Mark</th>
              <th className="pb-2 font-medium">Notional</th>
              <th className="pb-2 font-medium">PnL</th>
              <th className="pb-2 font-medium">Return</th>
              <th className="pb-2 font-medium">Alpha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[color:var(--line)]">
            {book.openPositions.length ? (
              book.openPositions.slice(0, 10).map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-3 font-medium">{p.symbol}</td>
                  <td className="py-2 pr-3 mono text-xs text-[color:var(--muted)]">
                    {fixed(p.entryPrice, 2)}
                  </td>
                  <td className="py-2 pr-3 mono text-xs text-[color:var(--muted)]">
                    {p.markPrice == null ? "n/a" : fixed(p.markPrice, 2)}
                  </td>
                  <td className="py-2 pr-3">{money(p.notionalUsd)}</td>
                  <td className={p.unrealizedPnlUsd >= 0 ? "py-2 pr-3 text-[color:var(--accent)]" : "py-2 pr-3 text-[color:var(--danger)]"}>
                    {money(p.unrealizedPnlUsd)}
                  </td>
                  <td className="py-2 pr-3">{pct(p.returnPct)}</td>
                  <td className="py-2 pr-3">
                    {p.alphaVsBenchmarkPct == null ? "n/a" : pct(p.alphaVsBenchmarkPct)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="py-3 text-[color:var(--muted)]" colSpan={7}>
                  No paper positions yet. Run Cycle to create simulated fills.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CycleOutcomesPanel({ data }: { data: DashboardPayload }) {
  const outcomes = (data.paperBook ?? emptyPaperBook()).cycleOutcomes;
  return (
    <Panel title="Cycle Outcomes">
      {outcomes.length ? (
        <div className="space-y-3">
          {outcomes.slice(0, 8).map((o) => (
            <div key={o.cycleId} className="rounded-md border border-[color:var(--line)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="mono text-sm font-medium">{o.cycleId}</h3>
                  <p className="mt-1 text-xs text-[color:var(--muted)]">
                    {shortTime(o.openedAt)} · {o.positions} positions · avg score{" "}
                    {fixed(o.avgForecastScore, 2)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={o.unrealizedPnlUsd >= 0 ? "font-medium text-[color:var(--accent)]" : "font-medium text-[color:var(--danger)]"}>
                    {money(o.unrealizedPnlUsd)}
                  </p>
                  <p className="text-xs text-[color:var(--muted)]">
                    return {pct(o.returnPct)} · alpha{" "}
                    {o.alphaVsBenchmarkPct == null ? "n/a" : pct(o.alphaVsBenchmarkPct)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[color:var(--muted)]">
          No attributable outcomes yet. Run a paper cycle, then refresh after new bars arrive.
        </p>
      )}
    </Panel>
  );
}

function researchExtraSections(data: DashboardPayload): ResearchExtraSection[] {
  const extras = data.research as DashboardPayload["research"] & ResearchExtras;
  return [
    { title: "Research Outcomes", rows: normalizeResearchRows(extras.outcomes ?? extras.outcome) },
    { title: "Evaluations", rows: normalizeResearchRows(extras.evaluations ?? extras.evaluation) },
    { title: "Experiments", rows: normalizeResearchRows(extras.experiments ?? extras.experiment) },
  ].filter((section) => section.rows.length);
}

function normalizeResearchRows(value: unknown): Array<Record<string, unknown>> {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeResearchRows(item));
  }
  if (isPlainRecord(value)) return [value];
  return [{ value }];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function latestCyclePayload(data: DashboardPayload): LatestCyclePayload | null {
  const latest = data.research.cycles?.[0];
  if (!latest?.payload || typeof latest.payload !== "object") return null;
  return latest.payload as LatestCyclePayload;
}

function buildCycleChart(data: DashboardPayload): CycleChartPoint[] {
  const cycles = (data.research.cycles ?? []).slice(0, 18).reverse();
  return cycles.map((record, index) => {
    const payload = record.payload as LatestCyclePayload & {
      tRsi?: { tRsi?: number; approved?: boolean };
      proposal?: { channels?: Array<{ id: string; proposedUsd: number }> };
    };
    const fills = payload.simulatedFills ?? [];
    const notional = fills.reduce((sum, fill) => sum + (Number(fill.notionalUsd) || 0), 0);
    const paperActionNotional = record.type === "paper_action" ? Number(record.notionalUsd) || 0 : 0;
    return {
      label: `${index + 1}`,
      tRsi: Number(payload.tRsi?.tRsi ?? 0),
      notional: notional || paperActionNotional,
      fills: fills.length,
      approved: payload.tRsi?.approved ? 1 : 0,
    };
  });
}

function buildForecastChart(cycle: LatestCyclePayload | null): ForecastChartPoint[] {
  return (cycle?.forecasts ?? []).slice(0, 8).map((forecast) => ({
    symbol: forecast.symbol.replace("/USD", ""),
    score: Number(forecast.score.toFixed(4)),
    expectedReturn: Number((forecast.expectedReturn * 100).toFixed(3)),
    vol: Number(((forecast.annualizedVol ?? 0) * 100).toFixed(2)),
    confidence: Number(((forecast.confidence ?? 0) * 100).toFixed(1)),
  }));
}

function buildOutcomeChart(data: DashboardPayload): OutcomeChartPoint[] {
  const outcomes = (data.paperBook ?? emptyPaperBook()).cycleOutcomes.slice(0, 14).reverse();
  return outcomes.map((outcome, index) => ({
    label: `${index + 1}`,
    returnPct: Number((outcome.returnPct * 100).toFixed(3)),
    alphaPct: Number(((outcome.alphaVsBenchmarkPct ?? 0) * 100).toFixed(3)),
    pnl: Number(outcome.unrealizedPnlUsd.toFixed(2)),
  }));
}

function chartStepMs(timeframe: MarketLiveSeries["timeframe"]): number {
  return timeframe === "15Min" ? 15 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function shortChartLabel(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildLivePathChart(series: MarketLiveSeries): LivePathPoint[] {
  const actual = series.points.slice(-96).map((point) => ({
    label: shortChartLabel(point.at),
    close: Number(point.close.toFixed(2)),
    modelPrice: null,
    phase: "actual" as const,
  }));
  if (!series.forecast || !series.points.length) return actual;

  const last = series.points.at(-1)!;
  const lastTs = Date.parse(last.at);
  const stepMs = chartStepMs(series.timeframe);
  const horizon = Math.max(1, series.forecast.horizonBars);
  const future: LivePathPoint[] = [
    {
      label: shortChartLabel(last.at),
      close: Number(last.close.toFixed(2)),
      modelPrice: Number(series.forecast.startPrice.toFixed(2)),
      phase: "forecast",
    },
  ];
  for (let i = 1; i <= horizon; i += 1) {
    const at = Number.isFinite(lastTs)
      ? new Date(lastTs + stepMs * i).toISOString()
      : `${last.at}+${i}`;
    const progress = i / horizon;
    const modelPrice =
      series.forecast.startPrice +
      (series.forecast.targetPrice - series.forecast.startPrice) * progress;
    future.push({
      label: shortChartLabel(at),
      close: null,
      modelPrice: Number(modelPrice.toFixed(2)),
      phase: "forecast",
    });
  }
  return [...actual.slice(0, -1), ...future];
}

function latestBacktestComparison(data: DashboardPayload): ModelComparisonBacktest | null {
  const records = [...data.research.runs, ...data.research.models];
  for (const record of records) {
    const payload = record.payload as Partial<ModelComparisonBacktest> | undefined;
    if (
      payload &&
      typeof payload.symbol === "string" &&
      Array.isArray(payload.results) &&
      typeof payload.generatedAt === "string"
    ) {
      return payload as ModelComparisonBacktest;
    }
  }
  return null;
}

function buildBacktestChart(comparison: ModelComparisonBacktest): BacktestChartPoint[] {
  return comparison.results.map((row) => ({
    model: row.label
      .replace(" momentum", "")
      .replace(" persistence", "")
      .replace("z-score", "z")
      .slice(0, 16),
    accuracy: Number(((row.directionalAccuracy ?? 0) * 100).toFixed(2)),
    strategyReturn: Number((row.strategyReturnPct ?? 0).toFixed(2)),
    sharpe: Number((row.sharpeProxy ?? 0).toFixed(2)),
  }));
}

function buildRlQuoteChart(rl: DashboardPayload["research"]["kalshiRl"]): RlQuoteChartPoint[] {
  return (rl?.recentQuoteEvents ?? []).map((event) => {
    const raw = event.raw as { currentPrice?: number; chance?: number } | undefined;
    return {
      label: new Date(event.receivedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      now: typeof raw?.currentPrice === "number" && Number.isFinite(raw.currentPrice) ? raw.currentPrice : null,
      up: event.yesAsk == null ? null : Number((event.yesAsk * 100).toFixed(2)),
      down: event.noAsk == null ? null : Number((event.noAsk * 100).toFixed(2)),
      chance: typeof raw?.chance === "number" && Number.isFinite(raw.chance)
        ? Number((raw.chance * 100).toFixed(2))
        : null,
    };
  });
}

const AGENT_FIRST_NAMES = [
  "Maya",
  "Ethan",
  "Ava",
  "Noah",
  "Lina",
  "Owen",
  "Sofia",
  "Miles",
  "Nora",
  "Julian",
  "Iris",
  "Caleb",
  "Amara",
  "Theo",
  "Zara",
  "Leo",
];

const AGENT_LAST_NAMES = [
  "Chen",
  "Patel",
  "Morgan",
  "Rivera",
  "Singh",
  "Brooks",
  "Kim",
  "Hayes",
  "Nguyen",
  "Carter",
  "Shah",
  "Bennett",
  "Ali",
  "Reed",
  "Torres",
  "Park",
];

const EXPERIMENT_LAST_NAMES: Array<[string, string]> = [
  ["early-", "Vega"],
  ["pulse-", "Quinn"],
  ["scout-", "Navarro"],
  ["stride-", "Iyer"],
  ["anchor-", "Sloan"],
  ["spark-", "Marquez"],
];

function stableNameHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

type RlLeaderboardRow = NonNullable<
  NonNullable<DashboardPayload["research"]["kalshiRl"]>["lastRun"]
>["leaderboard"][number];
type PaperPerformance = NonNullable<RlLeaderboardRow["performance"]>;
type StatusTone = "good" | "warn" | "bad" | "info" | "neutral";
type LiveAgentSortKey =
  | "agent"
  | "status"
  | "tier"
  | "trades"
  | "openNet"
  | "openPaid"
  | "markValue"
  | "openPnl"
  | "pnl20m"
  | "pnl50m"
  | "seen"
  | "lastSide"
  | "entry"
  | "exit"
  | "lastPnl"
  | "reward"
  | "totalPnl"
  | "bankrollReturn"
  | "riskReturn"
  | "gained"
  | "lost"
  | "winLoss"
  | "lastAction";
type LiveAgentSortValue = string | number;
type LiveAgentTableRow = {
  id: string;
  agentLabel: string;
  subLabel: string;
  title: string;
  statusLabel: string;
  statusTone: StatusTone;
  tier: "testing" | "validated";
  contributesToPerformance: boolean;
  eliteTags: string[];
  archivedReason?: string;
  trades: number;
  openPosition: ReturnType<typeof openPositionSummary>;
  pnl20m: number;
  pnl50m: number;
  seen: number;
  lastSide: string;
  entryPrice: number | null;
  exitPrice: number | null;
  lastPnl: number | null;
  reward: number;
  totalPnl: number;
  performance: PaperPerformance;
  lastAction: string;
  sort: Record<LiveAgentSortKey, LiveAgentSortValue>;
};

function performanceFromPaper(
  trades: NonNullable<RlLeaderboardRow["recentTrades"]>,
  openPositions: NonNullable<RlLeaderboardRow["openPositions"]>,
  bankrollUsd: number,
  fallbackNetPnlUsd = 0,
): PaperPerformance {
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
  const netPnlUsd =
    closedTrades.length || openTrades.length || openPositions.length
      ? closedTrades.reduce((sum, trade) => sum + trade.pnlUsd, 0) + markedOpenPnl
      : fallbackNetPnlUsd;
  return {
    bankrollUsd,
    riskedUsd,
    netPnlUsd,
    grossGainedUsd: grossGainedUsd || Math.max(fallbackNetPnlUsd, 0),
    grossLostUsd: grossLostUsd || Math.abs(Math.min(fallbackNetPnlUsd, 0)),
    returnOnBankroll: bankrollUsd > 0 ? netPnlUsd / bankrollUsd : 0,
    returnOnRisk: riskedUsd > 0 ? netPnlUsd / riskedUsd : 0,
    betsWon: closedTrades.filter((trade) => trade.pnlUsd > 0).length,
    betsLost: closedTrades.filter((trade) => trade.pnlUsd < 0).length,
  };
}

function rowPerformance(row: RlLeaderboardRow, bankrollUsd: number): PaperPerformance {
  return row.performance ?? performanceFromPaper(row.recentTrades ?? [], row.openPositions ?? [], bankrollUsd, row.pnlUsd);
}

function aggregatePerformances(performances: PaperPerformance[], bankrollUsd: number): PaperPerformance {
  const netPnlUsd = performances.reduce((sum, item) => sum + item.netPnlUsd, 0);
  const riskedUsd = performances.reduce((sum, item) => sum + item.riskedUsd, 0);
  return {
    bankrollUsd,
    riskedUsd,
    netPnlUsd,
    grossGainedUsd: performances.reduce((sum, item) => sum + item.grossGainedUsd, 0),
    grossLostUsd: performances.reduce((sum, item) => sum + item.grossLostUsd, 0),
    returnOnBankroll: bankrollUsd > 0 ? netPnlUsd / bankrollUsd : 0,
    returnOnRisk: riskedUsd > 0 ? netPnlUsd / riskedUsd : 0,
    betsWon: performances.reduce((sum, item) => sum + item.betsWon, 0),
    betsLost: performances.reduce((sum, item) => sum + item.betsLost, 0),
  };
}

function averagePnl(rows: RlLeaderboardRow[]): number | null {
  const values = rows.map((row) => row.pnlUsd).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function bestPnl(rows: RlLeaderboardRow[]): number | null {
  const values = rows.map((row) => row.pnlUsd).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function worstPnl(rows: RlLeaderboardRow[]): number | null {
  const values = rows.map((row) => row.pnlUsd).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function compareLiveAgentRows(
  a: LiveAgentTableRow,
  b: LiveAgentTableRow,
  sort: { key: LiveAgentSortKey; direction: "asc" | "desc" },
): number {
  const left = a.sort[sort.key];
  const right = b.sort[sort.key];
  const direction = sort.direction === "asc" ? 1 : -1;
  const comparison =
    typeof left === "number" && typeof right === "number"
      ? left === right
        ? 0
        : left > right
          ? 1
          : -1
      : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  if (comparison !== 0) return comparison * direction;
  return a.agentLabel.localeCompare(b.agentLabel, undefined, { numeric: true, sensitivity: "base" });
}

function chartLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function agentPnlKey(id: string): string {
  return `agent_${stableNameHash(id).toString(36)}`;
}

function lineageRoleForGenome(genomeId: string): LineageRoleId {
  if (genomeId.startsWith("early-")) return "early";
  if (genomeId.startsWith("pulse-")) return "pulse";
  if (genomeId.startsWith("scout-")) return "scout";
  if (genomeId.startsWith("stride-")) return "stride";
  if (genomeId.startsWith("anchor-")) return "anchor";
  if (genomeId.startsWith("spark-")) return "spark";
  if (genomeId.startsWith("closer-")) return "closer";
  if (genomeId.startsWith("sprinter-")) return "sprinter";
  if (genomeId.startsWith("hedger-")) return "hedger";
  if (genomeId.startsWith("conviction-")) return "conviction";
  if (genomeId.startsWith("scalper-")) return "scalper";
  return "baseline";
}

function isSpecializedGenome(genomeId: string): boolean {
  return SPECIALIZED_LINEAGE_ROLES.has(lineageRoleForGenome(genomeId));
}

function buildAgentPnlChart(
  rl: DashboardPayload["research"]["kalshiRl"],
  currentRows: RlLeaderboardRow[],
  generatedAt: string,
  variant: RlVariant,
): AgentPnlChart {
  const history = (variant === "v2" ? (rl?.runHistory ?? []) : (rl?.runHistory ?? []).slice(0, 30)).reverse();
  const latestTraining = rl?.runHistory?.[0] ?? rl?.lastRun ?? null;
  const latestTrainingRows = (latestTraining?.leaderboard ?? []).filter((row) =>
    variant === "v2" ? isSpecializedGenome(row.genome.genomeId) : !isSpecializedGenome(row.genome.genomeId),
  );
  const rowsById = new Map<string, RlLeaderboardRow>();
  for (const run of history) {
    for (const row of run.leaderboard) {
      if (variant === "v2" ? !isSpecializedGenome(row.genome.genomeId) : isSpecializedGenome(row.genome.genomeId)) {
        continue;
      }
      if (!rowsById.has(row.genome.genomeId)) rowsById.set(row.genome.genomeId, row);
    }
  }
  for (const row of currentRows) {
    if (variant === "v2" ? !isSpecializedGenome(row.genome.genomeId) : isSpecializedGenome(row.genome.genomeId)) {
      continue;
    }
    rowsById.set(row.genome.genomeId, row);
  }
  const currentIds = new Set(currentRows.map((row) => row.genome.genomeId));
  const selectedRows = [...rowsById.values()].sort((a, b) => {
    const aInactive = a.status === "deprecated" || !currentIds.has(a.genome.genomeId);
    const bInactive = b.status === "deprecated" || !currentIds.has(b.genome.genomeId);
    const deprecatedDelta = Number(aInactive) - Number(bInactive);
    if (deprecatedDelta !== 0) return deprecatedDelta;
    return Math.abs(b.pnlUsd ?? 0) - Math.abs(a.pnlUsd ?? 0);
  });
  const allKnownRows = [...selectedRows, ...currentRows];
  const geneticSeries = selectedRows.map((row, index) => {
    const inactive = row.status === "deprecated" || !currentIds.has(row.genome.genomeId);
    return {
      id: row.genome.genomeId,
      key: agentPnlKey(row.genome.genomeId),
      label: `${agentName(row.genome.genomeId, allKnownRows)}${inactive ? " (inactive)" : ""}`,
      color:
        variant === "v2"
          ? LINEAGE_ROLES[lineageRoleForGenome(row.genome.genomeId)].color
          : CHART_COLORS[index % CHART_COLORS.length],
      deprecated: inactive,
      family: "genetic" as const,
      role: lineageRoleForGenome(row.genome.genomeId),
    };
  });
  const series = geneticSeries;
  const points = history.map((run) => {
    const point: AgentPnlChartPoint = {
      label: chartLabel(run.generatedAt),
      at: run.generatedAt,
    };
    for (const item of geneticSeries) {
      const row = run.leaderboard.find((candidate) => candidate.genome.genomeId === item.id);
      point[item.key] = row?.pnlUsd ?? null;
    }
    return point;
  });

  if (series.length && variant !== "v2") {
    const currentPoint: AgentPnlChartPoint = {
      label: "live",
      at: generatedAt,
    };
    for (const item of geneticSeries) {
      const row = currentRows.find((candidate) => candidate.genome.genomeId === item.id);
      currentPoint[item.key] = row?.pnlUsd ?? null;
    }
    points.push(currentPoint);
  }

  const latestTrainingById = new Map(latestTrainingRows.map((row) => [row.genome.genomeId, row.pnlUsd]));
  const liveDeltas = currentRows
    .map((row) => {
      const prior = latestTrainingById.get(row.genome.genomeId);
      return prior == null ? null : row.pnlUsd - prior;
    })
    .filter((value): value is number => value != null && Number.isFinite(value));
  const liveOpenPositions = currentRows.reduce((sum, row) => sum + (row.openPositions?.length ?? 0), 0);
  const liveOpenPnl = currentRows.reduce(
    (sum, row) => sum + (row.openPositions ?? []).reduce((positionSum, position) => positionSum + position.unrealizedPnlUsd, 0),
    0,
  );

  return {
    points,
    series,
    summary: {
      historicalRuns: history.length,
      latestTrainingAt: latestTraining?.generatedAt ?? null,
      latestTrainingBest: bestPnl(latestTrainingRows),
      latestTrainingAverage: averagePnl(latestTrainingRows),
      liveRows: currentRows.length,
      liveBest: bestPnl(currentRows),
      liveAverage: averagePnl(currentRows),
      liveWorst: worstPnl(currentRows),
      liveOpenPositions,
      liveOpenPnl,
      liveDeltaAverage: liveDeltas.length ? liveDeltas.reduce((sum, value) => sum + value, 0) / liveDeltas.length : null,
    },
  };
}

function agentParents(row: RlLeaderboardRow): string[] {
  return row.parentGenomeIds.length ? row.parentGenomeIds : row.genome.parentGenomeIds ?? [];
}

function agentFamilyRootId(genomeId: string, rows?: RlLeaderboardRow[]): string {
  if (!rows?.length) return genomeId;
  const byId = new Map(rows.map((row) => [row.genome.genomeId, row]));
  const visited = new Set<string>();
  let current = genomeId;
  while (!visited.has(current)) {
    visited.add(current);
    const row = byId.get(current);
    if (!row) return current;
    const parent = agentParents(row)[0];
    if (!parent) return current;
    current = parent;
  }
  return current;
}

function agentName(genomeId: string, rows?: RlLeaderboardRow[]): string {
  const individualHash = stableNameHash(genomeId);
  const experimentLast = EXPERIMENT_LAST_NAMES.find(([prefix]) => genomeId.startsWith(prefix))?.[1];
  const familyRootId = agentFamilyRootId(genomeId, rows);
  const familyHash = stableNameHash(familyRootId);
  const first = AGENT_FIRST_NAMES[individualHash % AGENT_FIRST_NAMES.length];
  const last = experimentLast ?? AGENT_LAST_NAMES[familyHash % AGENT_LAST_NAMES.length];
  return `${first} ${last}`;
}

function agentFamilyName(genomeId: string, rows?: RlLeaderboardRow[]): string {
  const experimentLast = EXPERIMENT_LAST_NAMES.find(([prefix]) => genomeId.startsWith(prefix))?.[1];
  if (experimentLast) return experimentLast;
  return agentName(agentFamilyRootId(genomeId, rows), rows).split(" ").at(-1) ?? "unknown";
}

function agentLineageTitle(
  row: RlLeaderboardRow,
  rows: RlLeaderboardRow[],
): string {
  const parentIds = agentParents(row);
  const parentNames = parentIds.map((id) => `${agentName(id, rows)} (${id})`);
  const kids = rows
    .filter((candidate) => agentParents(candidate).includes(row.genome.genomeId))
    .map((candidate) => `${agentName(candidate.genome.genomeId, rows)} (${candidate.genome.genomeId})`);
  return [
    `${agentName(row.genome.genomeId, rows)} (${row.genome.genomeId})`,
    `Family: ${agentFamilyName(row.genome.genomeId, rows)}`,
    `Genome generation: ${row.genome.generation ?? 1}`,
    `Tier: ${row.tier ?? "testing"}`,
    `Performance accounting: ${row.contributesToPerformance ? "post-validation included" : "excluded"}`,
    row.validationAt ? `Validated at: ${shortTime(row.validationAt)}` : null,
    row.validationPnlUsd != null ? `Validation PnL: ${money2(row.validationPnlUsd)}` : null,
    `Parents: ${parentNames.join(", ") || "seed"}`,
    `Visible kids: ${kids.join(", ") || "none"}`,
    `Seen: ${row.generationsSeen ?? 1}`,
    row.eliteTags?.length ? `Tags: ${row.eliteTags.join(", ")}` : null,
    row.archivedReason ? `Archived: ${row.archivedReason}` : null,
    row.deprecatedReason ? `Deprecated: ${row.deprecatedReason}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function openPositionSummary(positions: NonNullable<RlLeaderboardRow["openPositions"]>) {
  const yesContracts = positions.reduce((sum, position) => sum + position.yesContracts, 0);
  const noContracts = positions.reduce((sum, position) => sum + position.noContracts, 0);
  const netContracts = yesContracts - noContracts;
  const costBasisUsd = positions.reduce((sum, position) => sum + position.costBasisUsd, 0);
  const markValueUsd = positions.reduce((sum, position) => sum + position.markValueUsd, 0);
  const unrealizedPnlUsd = markValueUsd - costBasisUsd;
  const sideLabel =
    positions.length === 0
      ? "none"
      : netContracts > 0
        ? `YES ${fixed(Math.abs(netContracts), 2)}`
        : netContracts < 0
          ? `NO ${fixed(Math.abs(netContracts), 2)}`
          : "flat";
  const title = positions.length
    ? positions
        .map(
          (position) =>
            `${position.marketTicker}: ${position.side.toUpperCase()} ${fixed(position.netContracts, 2)} contracts, paid ${money(
              position.costBasisUsd,
            )}, marked ${money(position.markValueUsd)} at ${cents(position.markPrice)}`,
        )
        .join("\n")
    : "No open paper position at the latest tick.";
  return {
    sideLabel,
    netContracts,
    costBasisUsd,
    markValueUsd,
    unrealizedPnlUsd,
    title,
  };
}

function inferKalshiBtc15mMarket(iso: string): { ticker: string; url: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    year: "2-digit",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(new Date(iso))
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});
  const monthIndex = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(
    (parts.month ?? "JAN").toUpperCase(),
  );
  const minute = Number(parts.minute ?? "0");
  const second = Number(parts.second ?? "0");
  const addMinutes = minute % 15 === 0 && second <= 5 ? 0 : 15 - (minute % 15);
  const close = new Date(
    Date.UTC(
      2000 + Number(parts.year ?? "0"),
      Math.max(0, monthIndex),
      Number(parts.day ?? "1"),
      Number(parts.hour ?? "0"),
      minute + addMinutes,
    ),
  );
  const year = String(close.getUTCFullYear()).slice(-2);
  const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][
    close.getUTCMonth()
  ];
  const day = String(close.getUTCDate()).padStart(2, "0");
  const hour = String(close.getUTCHours()).padStart(2, "0");
  const closeMinute = String(close.getUTCMinutes()).padStart(2, "0");
  const ticker = `KXBTC15M-${year}${month}${day}${hour}${closeMinute}`;
  return {
    ticker,
    url: `https://kalshi.com/markets/kxbtc15m/bitcoin-price-up-down/${ticker.toLowerCase()}`,
  };
}

function ResearchExtraRows({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = researchColumns(rows);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead className="text-xs uppercase text-[color:var(--muted)]">
          <tr>
            {columns.map((column) => (
              <th key={column} className="pb-2 pr-4 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--line)]">
          {rows.slice(0, 12).map((row, index) => (
            <tr key={researchRowKey(row, index)}>
              {columns.map((column) => (
                <td key={column} className="py-2 pr-4 align-top text-[color:var(--muted)]">
                  {formatResearchValue(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function researchColumns(rows: Array<Record<string, unknown>>): string[] {
  const preferred = ["id", "name", "experimentId", "modelId", "symbol", "status", "score", "returnPct", "alphaVsBenchmarkPct", "createdAt", "at"];
  const discovered = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const ordered = preferred.filter((key) => discovered.includes(key));
  const remaining = discovered.filter((key) => !ordered.includes(key));
  return [...ordered, ...remaining].slice(0, 6);
}

function researchRowKey(row: Record<string, unknown>, index: number): string {
  const id = row.id ?? row.experimentId ?? row.modelId ?? row.name;
  return typeof id === "string" || typeof id === "number" ? `${id}-${index}` : `research-extra-${index}`;
}

function formatResearchValue(value: unknown): string {
  if (value == null) return "n/a";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "n/a";
    if (Math.abs(value) <= 1) return fixed(value, 4);
    return fixed(value, 2);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function Ledger({ records }: { records: LedgerRecord[] }) {
  return (
    <Panel title="Recent Ledger">
      <RecordTable records={records} empty="No ledger rows yet." />
    </Panel>
  );
}

function RecordTable({ records, empty }: { records: LedgerRecord[]; empty: string }) {
  if (!records.length) {
    return <p className="text-sm text-[color:var(--muted)]">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="text-xs uppercase text-[color:var(--muted)]">
          <tr>
            <th className="pb-2 font-medium">Time</th>
            <th className="pb-2 font-medium">Type</th>
            <th className="pb-2 font-medium">Summary</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[color:var(--line)]">
          {records.map((r) => (
            <tr key={r.id}>
              <td className="py-2 pr-3 mono text-xs text-[color:var(--muted)]">{shortTime(r.at)}</td>
              <td className="py-2 pr-3">{r.type}</td>
              <td className="py-2 text-[color:var(--muted)]">{recordSummary(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function recordSummary(r: LedgerRecord): string {
  if (r.type === "certificate") return `${r.approved ? "approved" : "withheld"} · t-RSI ${fixed(r.tRsi, 2)}`;
  if (r.type === "paper_action") return `${r.action} · ${r.channel} · ${money(r.notionalUsd)}`;
  if (r.type === "forecast") return `${r.modelId} · ${r.target} · mean ${fixed(r.mean, 2)}`;
  if (r.type === "model_version") return `${r.modelId} · score ${fixed(r.score, 2)}`;
  if (r.type === "research_decision") {
    return `${r.accepted ? "accepted" : "rejected"} · ${r.decisionId} · ${r.reason}`;
  }
  return `${r.source} observation`;
}

function PositionList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; left: string; right: string; sub: string }>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-medium text-white">{title}</h3>
      <div className="space-y-2">
        {rows.length ? (
          rows.slice(0, 8).map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-3 rounded-md border border-[color:var(--line)] px-3 py-2">
              <div>
                <p className="font-medium">{r.left}</p>
                <p className="text-xs text-[color:var(--muted)]">{r.sub}</p>
              </div>
              <span className="mono text-xs text-[color:var(--muted)]">{r.right}</span>
            </div>
          ))
        ) : (
          <p className="rounded-md border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--muted)]">
            No positions available.
          </p>
        )}
      </div>
    </div>
  );
}

function RlStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "info" | "up" | "down";
}) {
  const accent = {
    neutral: "border-white/10 bg-black/20 text-white",
    info: "border-sky-300/20 bg-sky-400/10 text-sky-100",
    up: "border-emerald-300/25 bg-emerald-400/10 text-emerald-100",
    down: "border-rose-300/25 bg-rose-400/10 text-rose-100",
  }[tone];
  return (
    <div className={`min-w-0 rounded-md border p-3 ${accent}`}>
      <p className="truncate text-xs uppercase text-[color:var(--muted)]">{label}</p>
      <p className="mt-2 truncate text-xl font-semibold">{value}</p>
    </div>
  );
}

function StatusPill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "good" | "warn" | "bad" | "info" | "neutral";
}) {
  const classes = {
    good: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/20",
    warn: "bg-amber-400/15 text-amber-200 ring-amber-300/20",
    bad: "bg-rose-400/15 text-rose-200 ring-rose-300/20",
    info: "bg-sky-400/15 text-sky-200 ring-sky-300/20",
    neutral: "bg-white/10 text-[color:var(--foreground)] ring-white/10",
  }[tone];
  return (
    <span className={`inline-flex h-7 items-center rounded px-2.5 text-xs ring-1 ${classes}`}>
      {children}
    </span>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-[color:var(--line)] bg-[rgba(8,10,13,0.45)] p-1">
      {options.map((option) => (
        <button
          key={option.id}
          className={`rounded px-3 py-1.5 text-xs transition ${
            value === option.id
              ? "bg-[color:var(--panel-strong)] text-white"
              : "text-[color:var(--muted)] hover:text-white"
          }`}
          onClick={() => onChange(option.id)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function GlassMetric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/20 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <p className="text-xs uppercase text-[color:var(--muted)]">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-[color:var(--muted)]">{sub}</p>
    </div>
  );
}

function EmptyVisual({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-40 items-center justify-center rounded-md border border-dashed border-[color:var(--line)] bg-black/10 px-4 text-center text-sm text-[color:var(--muted)]">
      {text}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-5 shadow-[0_12px_40px_rgba(0,0,0,0.16)]">
      <h2 className="mb-4 text-base font-semibold text-[color:var(--foreground)]">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <p className="text-xs uppercase text-[color:var(--muted)]">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold">{value}</p>
    </div>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DashboardPayload, LedgerRecord } from "@/lib/types";

type Props = {
  initial: DashboardPayload;
};

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

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "unavailable";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function fixed(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "n/a";
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

export function DashboardClient({ initial }: Props) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<"cockpit" | "research" | "outcomes" | "allocation" | "ops">("cockpit");
  const [symbol, setSymbol] = useState("BTC");
  const [cycleSymbols, setCycleSymbols] = useState("BTC, ETH, SOL");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const allocationChart = useMemo(
    () =>
      data.proposal.channels.map((c) => ({
        name: c.id,
        dollars: c.proposedUsd,
        score: Number(c.riskAdjustedScore.toFixed(2)),
      })),
    [data.proposal.channels],
  );

  async function refresh() {
    try {
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
        setMessage("Running baseline backtest...");
        await postJson<{ ok: boolean }>("/api/research/backtest", { symbol });
        setMessage(`Backtest recorded for ${symbol.toUpperCase()}.`);
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
      <header className="border-b border-[color:var(--line)] bg-[#0b1018]/90">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-5 py-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mono text-xs uppercase tracking-[0.18em] text-[color:var(--accent)]">
              paper-only 24/7 crypto cockpit
            </p>
            <h1 className="mt-2 text-3xl font-semibold">Recursive Quant Fund Cockpit</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--muted)]">
              Read-only Alpaca/Kalshi integrations, 15-minute BTC/ETH/SOL paper cycles,
              local ledger feedback, optimizer proposals, and experimental t-RSI certificate tracking.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-md border border-[color:var(--line)] px-3 py-2 text-sm text-white hover:border-[color:var(--accent)]"
              disabled={isPending}
              onClick={() => startTransition(refresh)}
              type="button"
            >
              Refresh
            </button>
            <button
              className="rounded-md bg-[color:var(--accent)] px-3 py-2 text-sm font-semibold text-[#07110f] hover:brightness-110 disabled:opacity-50"
              disabled={isPending}
              onClick={proposePaperAllocation}
              type="button"
            >
              Paper Proposal
            </button>
            <button
              className="rounded-md bg-[color:var(--info)] px-3 py-2 text-sm font-semibold text-[#07111f] hover:brightness-110 disabled:opacity-50"
              disabled={isPending}
              onClick={runPaperCycle}
              type="button"
            >
              Run Cycle
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-5 py-5">
        <nav className="mb-5 flex w-full max-w-2xl rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-1">
          {(["cockpit", "research", "outcomes", "allocation", "ops"] as const).map((id) => (
            <button
              key={id}
              className={`flex-1 rounded px-3 py-2 text-sm capitalize ${
                tab === id ? "bg-[color:var(--panel-strong)] text-white" : "text-[color:var(--muted)]"
              }`}
              onClick={() => setTab(id)}
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
          />
        )}
        {tab === "research" && (
          <ResearchLab
            data={data}
            symbol={symbol}
            setSymbol={setSymbol}
            runBacktest={runBacktest}
            disabled={isPending}
          />
        )}
        {tab === "outcomes" && <OutcomesExperiments data={data} />}
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
}: {
  data: DashboardPayload;
  cycleSymbols: string;
  setCycleSymbols: (s: string) => void;
  runPaperCycle: () => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
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
        <CyclePanel data={data} />
        <Ledger records={data.ledger.slice(0, 8)} />
      </section>
    </div>
  );
}

function ResearchLab({
  data,
  symbol,
  setSymbol,
  runBacktest,
  disabled,
}: {
  data: DashboardPayload;
  symbol: string;
  setSymbol: (s: string) => void;
  runBacktest: () => void;
  disabled: boolean;
}) {
  const runRows = data.research.runs.slice(0, 8);
  return (
    <div className="grid gap-5 lg:grid-cols-[0.95fr_1.05fr]">
      <Panel title="Baseline Backtest Runner">
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
            Run Diagnostic
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
      <Panel title="Scaling Law Placeholders">
        <div className="h-72 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={[
                { x: "1x", sensors: 0.7, actuators: 1.1, rd: 0.8 },
                { x: "3x", sensors: 1.0, actuators: 1.5, rd: 1.1 },
                { x: "10x", sensors: 1.3, actuators: 1.9, rd: 1.35 },
              ]}
            >
              <CartesianGrid stroke="rgba(164,177,198,0.16)" />
              <XAxis dataKey="x" stroke="#8b98a9" />
              <YAxis stroke="#8b98a9" />
              <Tooltip contentStyle={{ background: "#101927", border: "1px solid rgba(164,177,198,0.2)" }} />
              <Legend />
              <Line type="monotone" dataKey="sensors" stroke="#39d0a4" strokeWidth={2} />
              <Line type="monotone" dataKey="actuators" stroke="#79a8ff" strokeWidth={2} />
              <Line type="monotone" dataKey="rd" stroke="#f2c14e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>
      <Panel title="Model Registry">
        <RecordTable records={data.research.models.slice(0, 8)} empty="No model records yet." />
      </Panel>
      <Panel title="Paper Cycles">
        <RecordTable records={(data.research.cycles ?? []).slice(0, 8)} empty="No paper cycles recorded yet." />
      </Panel>
    </div>
  );
}

function OutcomesExperiments({ data }: { data: DashboardPayload }) {
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-5">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
      <p className="text-xs uppercase text-[color:var(--muted)]">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold">{value}</p>
    </div>
  );
}

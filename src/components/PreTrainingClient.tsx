"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  PreTrainingAgentScore,
  PreTrainingCycleSummary,
  PreTrainingRun,
  PreTrainingSummary,
} from "@/lib/types";

type Props = {
  initial: PreTrainingSummary;
};

type SummaryResponse = {
  ok?: boolean;
  summary?: PreTrainingSummary;
  error?: string;
};

type TrainResponse = {
  ok?: boolean;
  result?: PreTrainingRun;
  error?: string;
};

const TOOLTIP_STYLE = {
  background: "rgba(17, 19, 24, 0.96)",
  border: "1px solid rgba(185, 197, 216, 0.22)",
  borderRadius: 8,
  color: "#f3f7fb",
};

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Math.abs(value) < 10 ? 2 : 0,
    maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0,
  });
}

function fixed(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
}

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function compact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function shortTime(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function cycleChart(cycles: PreTrainingCycleSummary[]) {
  return cycles.map((cycle) => ({
    label: `C${cycle.cycle}`,
    bestReward: Number((cycle.bestReward ?? 0).toFixed(3)),
    avgReward: Number(cycle.averageReward.toFixed(3)),
    avgPnl: Number(cycle.averagePnlUsd.toFixed(3)),
    tradedAgents: cycle.tradedAgents,
    diversity: Number(cycle.diversity.toFixed(3)),
  }));
}

function familyTone(family: PreTrainingAgentScore["genome"]["family"]): string {
  if (family === "momentum") return "border-emerald-300/30 bg-emerald-300/10 text-emerald-100";
  if (family === "reversal") return "border-sky-300/30 bg-sky-300/10 text-sky-100";
  if (family === "breakout") return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  return "border-fuchsia-300/30 bg-fuchsia-300/10 text-fuchsia-100";
}

export function PreTrainingClient({ initial }: Props) {
  const [summary, setSummary] = useState(initial);
  const [cycles, setCycles] = useState("8");
  const [populationSize, setPopulationSize] = useState("48");
  const [marketLimit, setMarketLimit] = useState("160");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const run = summary.lastRun;
  const champion = summary.champion ?? run?.champion ?? null;
  const chartData = useMemo(() => cycleChart(run?.cycles ?? []), [run]);

  async function refresh() {
    const res = await fetch("/api/pre-training/summary", { cache: "no-store" });
    const json = (await res.json()) as SummaryResponse;
    if (!res.ok || json.ok === false || !json.summary) {
      throw new Error(json.error ?? "Refresh failed.");
    }
    setSummary(json.summary);
  }

  function runTraining() {
    startTransition(async () => {
      try {
        setMessage("Running historical genetic pre-training...");
        const res = await fetch("/api/pre-training/train", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cycles: Number(cycles),
            populationSize: Number(populationSize),
            marketLimit: Number(marketLimit),
          }),
        });
        const json = (await res.json()) as TrainResponse;
        if (!res.ok || json.ok === false || !json.result) {
          throw new Error(json.error ?? "Pre-training failed.");
        }
        setMessage(json.result.promoted ? "Validation champion promoted." : "Run completed without promotion.");
        await refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Pre-training failed.");
      }
    });
  }

  function refreshTransition() {
    startTransition(async () => {
      try {
        await refresh();
        setMessage("Pre-training summary refreshed.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Refresh failed.");
      }
    });
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-[color:var(--line)] bg-[rgba(10,12,15,0.92)]">
        <div className="mx-auto flex max-w-[1480px] flex-col gap-4 px-5 py-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mono text-xs uppercase text-[color:var(--accent)]">historical agent pre-training</p>
            <h1 className="mt-2 text-3xl font-semibold">Pre-Training</h1>
            <p className="mt-2 max-w-3xl text-sm text-[color:var(--muted)]">
              Genetic populations train on cached Kalshi market history, validate on later markets, and promote only
              paper-only champions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="control-button border border-[color:var(--line)] text-white hover:border-[color:var(--accent)]"
              href="/"
            >
              Cockpit
            </Link>
            <Link
              className="control-button border border-[color:var(--line)] text-white hover:border-[color:var(--accent)]"
              href="/rl"
            >
              RL
            </Link>
            <button
              className="control-button border-[color:var(--line)] text-white hover:border-[color:var(--accent)]"
              disabled={isPending}
              onClick={refreshTransition}
              type="button"
            >
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-5 py-5">
        {message ? (
          <div className="mb-5 rounded-md border border-[color:var(--line)] bg-[#101927] px-4 py-3 text-sm text-[color:var(--foreground)]">
            {message} {isPending ? "Working..." : null}
          </div>
        ) : null}

        <section className="mb-5 overflow-hidden rounded-md border border-[color:var(--line)] bg-[linear-gradient(135deg,rgba(50,214,162,0.12),rgba(122,167,255,0.08)_48%,rgba(240,199,94,0.10))] p-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <div className="flex flex-wrap gap-2">
                <StatusPill tone={summary.enabled ? "good" : "neutral"}>
                  {summary.enabled ? "enabled" : "paused"}
                </StatusPill>
                <StatusPill tone={run?.promoted ? "good" : "info"}>
                  {run?.promoted ? "promoted" : "paper only"}
                </StatusPill>
                <StatusPill tone="neutral">{summary.seriesTicker}</StatusPill>
              </div>
              <h2 className="mt-4 max-w-4xl text-2xl font-semibold">
                {champion
                  ? `${champion.genome.family} champion ${champion.genome.genomeId}`
                  : "Waiting for the first historical champion"}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[color:var(--muted)]">
                {run?.notes[1] ??
                  "Backfill historical candles, then run a multi-cycle population search to seed stronger paper agents."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="Markets" value={compact(summary.availableMarkets)} />
              <Metric label="Candles" value={compact(summary.availableCandles)} />
              <Metric label="Last run" value={shortTime(run?.generatedAt)} />
              <Metric label="Champion PnL" value={money(champion?.pnlUsd)} />
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
          <section className="space-y-5">
            <Panel title="Run Controls">
              <div className="grid gap-3">
                <LabeledInput label="Cycles" value={cycles} onChange={setCycles} />
                <LabeledInput label="Population" value={populationSize} onChange={setPopulationSize} />
                <LabeledInput label="Market limit" value={marketLimit} onChange={setMarketLimit} />
              </div>
              <button
                className="mt-4 h-10 w-full rounded-md bg-[color:var(--accent)] px-4 text-sm font-semibold text-[#07110f] disabled:opacity-50"
                disabled={isPending}
                onClick={runTraining}
                type="button"
              >
                Run Pre-Training
              </button>
            </Panel>

            <Panel title="Champion Genome">
              {champion ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-2 py-1 text-xs ${familyTone(champion.genome.family)}`}>
                      {champion.genome.family}
                    </span>
                    <span className="mono text-xs text-[color:var(--muted)]">gen {champion.genome.generation}</span>
                  </div>
                  <p className="break-all mono text-sm">{champion.genome.genomeId}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <SmallStat label="Reward" value={fixed(champion.reward, 3)} />
                    <SmallStat label="Trades" value={String(champion.trades)} />
                    <SmallStat label="Win rate" value={pct(champion.winRate)} />
                    <SmallStat label="Risk return" value={pct(champion.returnOnRisk)} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-[color:var(--muted)]">No champion has been promoted yet.</p>
              )}
            </Panel>

            <Panel title="Run History">
              <div className="space-y-2">
                {summary.runHistory.slice(0, 6).map((historyRun) => (
                  <div key={historyRun.runId} className="rounded-md border border-[color:var(--line)] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate mono text-xs">{historyRun.runId}</span>
                      <StatusPill tone={historyRun.promoted ? "good" : "neutral"}>
                        {historyRun.promoted ? "promoted" : "held"}
                      </StatusPill>
                    </div>
                    <p className="mt-2 text-xs text-[color:var(--muted)]">
                      {historyRun.cyclesRequested} cycles · {compact(historyRun.candleCount)} candles
                    </p>
                  </div>
                ))}
                {!summary.runHistory.length ? (
                  <p className="text-sm text-[color:var(--muted)]">No historical runs recorded.</p>
                ) : null}
              </div>
            </Panel>
          </section>

          <section className="space-y-5">
            <Panel title="Cycle Evolution">
              <div className="h-[360px] min-w-0">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 12, bottom: 0, left: 4 }}>
                      <CartesianGrid stroke="rgba(185,197,216,0.10)" />
                      <XAxis dataKey="label" stroke="#9aa7b8" tick={{ fontSize: 11 }} />
                      <YAxis stroke="#9aa7b8" tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} />
                      <Legend />
                      <Line type="monotone" dataKey="bestReward" name="Best reward" stroke="#32d6a2" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="avgReward" name="Avg reward" stroke="#7aa7ff" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="diversity" name="Diversity" stroke="#f0c75e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyVisual text="Cycle metrics render after a pre-training run." />
                )}
              </div>
            </Panel>

            <Panel title="Validation Leaderboard">
              {run?.leaderboard?.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse text-sm">
                    <thead className="text-left text-xs uppercase text-[color:var(--muted)]">
                      <tr>
                        <th className="border-b border-[color:var(--line)] py-2 pr-3">Agent</th>
                        <th className="border-b border-[color:var(--line)] py-2 pr-3">Family</th>
                        <th className="border-b border-[color:var(--line)] py-2 pr-3 text-right">Reward</th>
                        <th className="border-b border-[color:var(--line)] py-2 pr-3 text-right">PnL</th>
                        <th className="border-b border-[color:var(--line)] py-2 pr-3 text-right">Trades</th>
                        <th className="border-b border-[color:var(--line)] py-2 pr-3 text-right">Win</th>
                        <th className="border-b border-[color:var(--line)] py-2 pr-3 text-right">Drawdown</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.leaderboard.slice(0, 18).map((row) => (
                        <tr key={row.genome.genomeId} className="border-b border-[color:var(--line)]/70">
                          <td className="max-w-[260px] truncate py-3 pr-3 mono text-xs" title={row.genome.genomeId}>
                            {row.genome.genomeId}
                          </td>
                          <td className="py-3 pr-3">
                            <span className={`rounded border px-2 py-1 text-xs ${familyTone(row.genome.family)}`}>
                              {row.genome.family}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-right mono">{fixed(row.reward, 3)}</td>
                          <td className="py-3 pr-3 text-right mono">{money(row.pnlUsd)}</td>
                          <td className="py-3 pr-3 text-right mono">{row.trades}</td>
                          <td className="py-3 pr-3 text-right mono">{pct(row.winRate)}</td>
                          <td className="py-3 pr-3 text-right mono">{money(row.maxDrawdownUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyVisual text="Validation scores will appear here after training." />
              )}
            </Panel>
          </section>
        </div>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
      <h2 className="mb-4 text-sm font-semibold uppercase text-[color:var(--muted)]">{title}</h2>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[color:var(--line)] bg-black/12 p-4">
      <p className="text-xs uppercase text-[color:var(--muted)]">{label}</p>
      <p className="mt-2 break-words text-xl font-semibold">{value}</p>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[color:var(--line)] bg-black/12 p-3">
      <p className="text-[11px] uppercase text-[color:var(--muted)]">{label}</p>
      <p className="mt-1 break-words mono text-sm">{value}</p>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase text-[color:var(--muted)]">{label}</span>
      <input
        className="h-10 w-full rounded-md border border-[color:var(--line)] bg-[#0b1018] px-3 text-sm text-white"
        inputMode="numeric"
        min="1"
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
    </label>
  );
}

type StatusTone = "good" | "warn" | "bad" | "info" | "neutral";

function StatusPill({ tone, children }: { tone: StatusTone; children: React.ReactNode }) {
  const className =
    tone === "good"
      ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-100"
      : tone === "warn"
        ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
        : tone === "bad"
          ? "border-rose-300/30 bg-rose-300/10 text-rose-100"
          : tone === "info"
            ? "border-sky-300/30 bg-sky-300/10 text-sky-100"
            : "border-white/15 bg-white/5 text-[color:var(--muted)]";
  return <span className={`rounded border px-2 py-1 text-xs ${className}`}>{children}</span>;
}

function EmptyVisual({ text }: { text: string }) {
  return (
    <div className="flex h-full min-h-[180px] items-center justify-center rounded-md border border-dashed border-[color:var(--line)] text-sm text-[color:var(--muted)]">
      {text}
    </div>
  );
}

"use client";

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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  Btc15mModeDashboard,
  Btc15mSettlementMode,
  Btc15mSourceMode,
  Btc15mSwarmDashboardData,
  Btc15mTrade,
} from "@/lib/btc15m-swarm-backtest";

type Props = {
  data: Btc15mSwarmDashboardData;
};

const AGENT_COLORS: Record<string, string> = {
  swarm: "#56cfe8",
  pretrained: "#74a7ff",
  online: "#2ed09c",
  hybrid: "#a58cff",
  transformer: "#f5a25d",
  evolutionary: "#ff718d",
  buyYes: "#f2c75c",
  buyNo: "#ff4f6f",
  random: "#38bdf8",
  regimeAdaptive: "#c084fc",
  noTrade: "#9aa8b4",
};

const DISPLAY_AGENTS = ["swarm", "regimeAdaptive", "pretrained", "online", "hybrid", "transformer", "evolutionary", "buyYes", "buyNo", "random"];
const SOURCE_ORDER: Btc15mSourceMode[] = ["historical", "live", "combined"];
const SETTLEMENT_ORDER: Btc15mSettlementMode[] = ["strict", "permissive"];

export function Btc15mSwarmDashboard({ data }: Props) {
  const [periodKey, setPeriodKey] = useState(data.defaultPeriodKey);
  const [modeKey, setModeKey] = useState<Btc15mSettlementMode>("strict");
  const [sourceKey, setSourceKey] = useState<Btc15mSourceMode>("combined");

  const period = data.periods.find((item) => item.key === periodKey) ?? data.periods[0];
  const settlement = period.modes[modeKey] ?? period.modes.strict;
  const availableSources = SOURCE_ORDER.filter((source) => settlement.sources[source]);
  const selectedSourceKey = availableSources.includes(sourceKey) ? sourceKey : (availableSources[0] ?? "historical");
  const run = settlement.sources[selectedSourceKey] ?? availableSources.map((source) => settlement.sources[source]).find(Boolean);

  const selectedSwarm = run?.metrics.swarm;
  const selectedRegimeAdaptive = run?.metrics.regimeAdaptive;
  const selectedBuyYes = run?.metrics.buyYes;
  const selectedRandom = run?.metrics.random;
  const verdict = sourceVerdict(run);
  const topTrades = (run?.trades ?? [])
    .slice()
    .sort((a, b) => Math.abs(b.pnlUsd) - Math.abs(a.pnlUsd))
    .slice(0, 12);
  const swarmTradeStats = tradeStats(run?.trades ?? [], "swarm");
  const buyYesTradeStats = tradeStats(run?.trades ?? [], "buyYes");
  const routerRows = routeStats(run?.trades ?? []);
  const riskRows = (run?.agentRows ?? [])
    .filter((row) => DISPLAY_AGENTS.includes(row.agent))
    .map((row) => ({
      agent: row.agent,
      label: labelForAgent(row.agent),
      sharpe: row.sharpe,
      maxDrawdownUsd: row.maxDrawdownUsd,
    }));
  const sourceComparisonChart = settlement.comparisonRows.map((row) => ({
    ...row,
    edgeOverBuyYes: row.swarmPnl - row.buyYesPnl,
  }));
  const alphaBetaRows = (run?.agentRows ?? [])
    .filter((row) => ["swarm", "regimeAdaptive", "pretrained", "online", "hybrid", "transformer", "evolutionary"].includes(row.agent))
    .map((row) => ({
      agent: row.agent,
      label: labelForAgent(row.agent),
      buyYes: row.alphaBeta?.buyYes,
      buyNo: row.alphaBeta?.buyNo,
      random: row.alphaBeta?.random,
    }));
  const labelRisk = run?.data.testEpisodes ? (run.data.ambiguousSettlements ?? 0) / run.data.testEpisodes : 0;

  if (!period || !run) {
    return (
      <main className="min-h-screen bg-[#080b0f] px-5 py-10 text-slate-100">
        <section className="mx-auto max-w-2xl rounded-md border border-rose-400/40 bg-rose-400/10 p-6">
          <p className="mono text-xs uppercase text-rose-200">BTC 15m dashboard</p>
          <h1 className="mt-3 text-2xl font-semibold">No backtest data found</h1>
          <p className="mt-3 text-sm leading-6 text-rose-100/80">
            Generate the matrix with <code>npm run btc15m:swarm-backtest -- --matrix --all --warmup=200</code>.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#080b0f] text-slate-100">
      <section className="border-b border-slate-800 bg-[#0c1117]">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-5 px-5 py-6 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mono text-xs uppercase text-emerald-300">KXBTC15M backtest dashboard</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal text-slate-50 md:text-4xl">
              BTC 15m swarm regime audit
            </h1>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-400">
              Walk-forward paper backtest over downloaded Kalshi BTC 15-minute market candles. Each selected test
              window is traded from the beginning, while the models fit on the 200 eligible market episodes before that
              window. Compare historical-only, live-captured-only, and combined training data directly.
            </p>
          </div>
          <div className={`rounded-md border px-4 py-3 ${verdictClasses(verdict.tone)}`}>
            <p className="mono text-xs uppercase">Selected verdict</p>
            <p className="mt-1 text-lg font-semibold">{verdict.title}</p>
            <p className="mt-1 max-w-xl text-sm opacity-90">{verdict.body}</p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1500px] gap-4 px-5 py-5 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Selected swarm PnL"
          value={usd(selectedSwarm?.pnlUsd ?? 0)}
          sub={`${pct(selectedSwarm?.roi)} ROI / ${num(selectedSwarm?.sharpe)} Sharpe`}
          tone={(selectedSwarm?.pnlUsd ?? 0) > 0 ? "good" : "bad"}
        />
        <MetricCard
          label="Vs buy-YES baseline"
          value={usd((selectedSwarm?.pnlUsd ?? 0) - (selectedBuyYes?.pnlUsd ?? 0))}
          sub={`Buy-YES ${usd(selectedBuyYes?.pnlUsd ?? 0)}`}
          tone={(selectedSwarm?.pnlUsd ?? 0) > (selectedBuyYes?.pnlUsd ?? 0) ? "good" : "bad"}
        />
        <MetricCard
          label="Regime router vs swarm"
          value={usd((selectedRegimeAdaptive?.pnlUsd ?? 0) - (selectedSwarm?.pnlUsd ?? 0))}
          sub={`Router ${usd(selectedRegimeAdaptive?.pnlUsd ?? 0)}`}
          tone={(selectedRegimeAdaptive?.pnlUsd ?? 0) > (selectedSwarm?.pnlUsd ?? 0) ? "good" : "warn"}
        />
        <MetricCard
          label="Vs random baseline"
          value={usd((selectedSwarm?.pnlUsd ?? 0) - (selectedRandom?.pnlUsd ?? 0))}
          sub={`Random ${usd(selectedRandom?.pnlUsd ?? 0)}`}
          tone={(selectedSwarm?.pnlUsd ?? 0) > (selectedRandom?.pnlUsd ?? 0) ? "good" : "bad"}
        />
        <MetricCard
          label="Traded test window"
          value={String(run.data.testEpisodes)}
          sub={`${shortDate(run.data.testStart)} to ${shortDate(run.data.testEnd)}`}
        />
      </section>

      <section className="mx-auto grid max-w-[1500px] gap-4 px-5 pb-8 xl:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <ControlPanel title="Test period">
            {data.periods.map((item) => (
              <ChoiceButton
                key={item.key}
                active={item.key === period.key}
                title={item.label}
                subtitle={`${shortDate(item.testStart)} to ${shortDate(item.testEnd)}`}
                onClick={() => setPeriodKey(item.key)}
              />
            ))}
          </ControlPanel>

          <ControlPanel title="Settlement labels">
            {SETTLEMENT_ORDER.map((mode) => (
              <ChoiceButton
                key={mode}
                active={mode === settlement.mode}
                title={period.modes[mode].label}
                subtitle={period.modes[mode].caveat}
                onClick={() => setModeKey(mode)}
              />
            ))}
          </ControlPanel>

          <ControlPanel title="Training data source">
            {availableSources.map((source) => {
              const sourceRun = settlement.sources[source];
              return (
                <ChoiceButton
                  key={source}
                  active={source === selectedSourceKey}
                  title={sourceRun?.sourceLabel ?? source}
                  subtitle={`${sourceRun?.data.fitEpisodes ?? 0} fit / ${sourceRun?.data.validationEpisodes ?? 0} validation`}
                  onClick={() => setSourceKey(source)}
                />
              );
            })}
          </ControlPanel>

          <section className="rounded-md border border-slate-800 bg-[#0f151d] p-4">
            <p className="mono text-xs uppercase text-slate-400">Selected slice</p>
            <dl className="mt-4 space-y-2 text-sm">
              <KeyValue label="Source" value={run.sourceLabel} />
              <KeyValue label="Label mode" value={run.label} />
              <KeyValue label="Warmup" value={`${run.assumptions.warmupEpisodes ?? 0} pre-window episodes`} />
              <KeyValue label="Notional" value={usd(run.assumptions.notionalUsd)} />
              <KeyValue label="Fee proxy" value={pct(run.assumptions.feeRate)} />
              <KeyValue label="Label risk" value={pct(labelRisk)} />
            </dl>
            <p className="mt-4 text-sm leading-6 text-slate-300">{run.sourceCaveat}</p>
          </section>
        </aside>

        <div className="space-y-4">
          <section className="rounded-md border border-slate-800 bg-[#0f151d]">
            <div className="flex flex-col gap-2 border-b border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold">Training source comparison</h2>
                <p className="text-sm text-slate-400">
                  Same period and settlement rules, three separate fits: historical-only, live-captured-only, combined.
                </p>
              </div>
              <span className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300">{period.label}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Source fit</th>
                    <th className="px-4 py-3 text-right">Swarm PnL</th>
                    <th className="px-4 py-3 text-right">ROI</th>
                    <th className="px-4 py-3 text-right">Sharpe</th>
                    <th className="px-4 py-3 text-right">Trades</th>
                    <th className="px-4 py-3 text-right">Accuracy</th>
                    <th className="px-4 py-3 text-right">Buy-YES PnL</th>
                    <th className="px-4 py-3 text-right">Fit / val / test</th>
                  </tr>
                </thead>
                <tbody>
                  {SOURCE_ORDER.filter((source) => settlement.sources[source]).map((source) => {
                    const row = settlement.comparisonRows.find((item) => item.source === source);
                    if (!row) return null;
                    return (
                      <tr key={row.source} className="border-b border-slate-900/80">
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            className={`rounded-md border px-2 py-1 text-left ${
                              row.source === selectedSourceKey
                                ? "border-emerald-400 bg-emerald-400/10 text-emerald-100"
                                : "border-slate-800 text-slate-300 hover:border-slate-600"
                            }`}
                            onClick={() => setSourceKey(row.source)}
                          >
                            {row.label}
                          </button>
                        </td>
                        <td className={`px-4 py-3 text-right ${row.swarmPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{usd(row.swarmPnl)}</td>
                        <td className="px-4 py-3 text-right">{pct(row.swarmRoi)}</td>
                        <td className="px-4 py-3 text-right">{num(row.swarmSharpe)}</td>
                        <td className="px-4 py-3 text-right">{row.swarmTrades}</td>
                        <td className="px-4 py-3 text-right">{pct(row.swarmAccuracy)}</td>
                        <td className={`px-4 py-3 text-right ${row.buyYesPnl >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{usd(row.buyYesPnl)}</td>
                        <td className="px-4 py-3 text-right">
                          {row.fitEpisodes} / {row.validationEpisodes} / {row.testEpisodes}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
            <ChartPanel title="Source-regime PnL comparison" subtitle="Red line is $0. Edge-over-baseline bars show whether swarm beats buy-YES.">
              <ResponsiveContainer width="100%" height={440}>
                <BarChart data={sourceComparisonChart} margin={{ top: 12, right: 16, bottom: 14, left: 0 }}>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} interval={0} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(value) => `$${value}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => usd(Number(value))} />
                  <Legend />
                  <ReferenceLine y={0} stroke="#ff4f6f" strokeWidth={2} />
                  <Bar dataKey="swarmPnl" name="Swarm PnL" fill="#56cfe8" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="buyYesPnl" name="Buy-YES PnL" fill="#f2c75c" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="edgeOverBuyYes" name="Swarm edge" fill="#2ed09c" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel
              title={`${run.sourceLabel}: cumulative PnL`}
              subtitle="X-axis is chronological market timestamp. The selected period is traded from the first eligible episode."
            >
              <ResponsiveContainer width="100%" height={500}>
                <LineChart data={run.equityCurve} margin={{ top: 12, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="timestamp" stroke="#94a3b8" fontSize={11} minTickGap={30} tickFormatter={shortAxisDate} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(value) => `$${value}`} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, name) => [usd(Number(value)), labelForAgent(String(name))]}
                    labelFormatter={(label) => `Trade timestamp: ${shortDate(String(label ?? ""))}`}
                  />
                  <Legend />
                  <ReferenceLine y={0} stroke="#ff4f6f" strokeWidth={2} />
                  {DISPLAY_AGENTS.filter((agent) => run.metrics[agent]).map((agent) => (
                    <Line
                      key={agent}
                      type="monotone"
                      dataKey={agent}
                      name={labelForAgent(agent)}
                      stroke={AGENT_COLORS[agent]}
                      strokeWidth={agent === "swarm" ? 3 : 1.8}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Regime router Sharpe"
              value={num(selectedRegimeAdaptive?.sharpe)}
              sub={`${pct(selectedRegimeAdaptive?.roi)} ROI`}
              tone={(selectedRegimeAdaptive?.sharpe ?? 0) > 1 ? "good" : (selectedRegimeAdaptive?.sharpe ?? 0) > 0 ? "warn" : "bad"}
            />
            <MetricCard
              label="Swarm Sharpe"
              value={num(selectedSwarm?.sharpe)}
              sub="Annualized from trade returns"
              tone={(selectedSwarm?.sharpe ?? 0) > 1 ? "good" : (selectedSwarm?.sharpe ?? 0) > 0 ? "warn" : "bad"}
            />
            <MetricCard
              label="Swarm drawdown"
              value={usd(selectedSwarm?.maxDrawdownUsd ?? 0)}
              sub={`${pct(drawdownRatio(selectedSwarm))} of traded notional`}
              tone={(selectedSwarm?.maxDrawdownUsd ?? 0) <= Math.max(1, selectedSwarm?.pnlUsd ?? 0) ? "good" : "warn"}
            />
            <MetricCard
              label="Profit factor"
              value={finiteOrInfinity(swarmTradeStats.profitFactor)}
              sub={`${usd(swarmTradeStats.grossProfit)} wins / ${usd(swarmTradeStats.grossLoss)} losses`}
              tone={swarmTradeStats.profitFactor > 1.25 ? "good" : swarmTradeStats.profitFactor > 1 ? "warn" : "bad"}
            />
            <MetricCard
              label="Expectancy / trade"
              value={usd(swarmTradeStats.expectancy)}
              sub={`${usd(swarmTradeStats.avgWin)} avg win / ${usd(swarmTradeStats.avgLoss)} avg loss`}
              tone={swarmTradeStats.expectancy > 0 ? "good" : "bad"}
            />
            <MetricCard
              label="Avg confidence"
              value={pct(swarmTradeStats.avgConfidence)}
              sub={`${pct(run.assumptions.minConfidence)} entry threshold`}
            />
          </section>

          <section className="rounded-md border border-slate-800 bg-[#0f151d]">
            <div className="flex flex-col gap-2 border-b border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold">Alpha and beta vs baselines</h2>
                <p className="text-sm text-slate-400">
                  Regression is run on aligned per-market returns. Alpha is the intercept per market; beta is exposure
                  to the baseline return stream.
                </p>
              </div>
              <span className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300">
                YES / NO / random
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1120px] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3 text-right">Alpha vs YES</th>
                    <th className="px-4 py-3 text-right">Beta vs YES</th>
                    <th className="px-4 py-3 text-right">Alpha vs NO</th>
                    <th className="px-4 py-3 text-right">Beta vs NO</th>
                    <th className="px-4 py-3 text-right">Alpha vs random</th>
                    <th className="px-4 py-3 text-right">Beta vs random</th>
                    <th className="px-4 py-3 text-right">R2 vs random</th>
                  </tr>
                </thead>
                <tbody>
                  {alphaBetaRows.map((row) => (
                    <tr key={row.agent} className="border-b border-slate-900/80">
                      <td className="px-4 py-3">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: AGENT_COLORS[row.agent] ?? "#94a3b8" }} />
                        {row.label}
                      </td>
                      <td className={`px-4 py-3 text-right ${alphaTone(row.buyYes?.alphaPerMarket)}`}>{pct(row.buyYes?.alphaPerMarket)}</td>
                      <td className="px-4 py-3 text-right">{num(row.buyYes?.beta)}</td>
                      <td className={`px-4 py-3 text-right ${alphaTone(row.buyNo?.alphaPerMarket)}`}>{pct(row.buyNo?.alphaPerMarket)}</td>
                      <td className="px-4 py-3 text-right">{num(row.buyNo?.beta)}</td>
                      <td className={`px-4 py-3 text-right ${alphaTone(row.random?.alphaPerMarket)}`}>{pct(row.random?.alphaPerMarket)}</td>
                      <td className="px-4 py-3 text-right">{num(row.random?.beta)}</td>
                      <td className="px-4 py-3 text-right">{pct(row.random?.rSquared)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="rounded-md border border-slate-800 bg-[#0f151d] p-4">
              <div className="mb-3">
                <h2 className="text-base font-semibold">Swarm trade diagnostics</h2>
                <p className="mt-1 text-sm text-slate-400">Distribution stats derived from the selected source trade log.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <StatTile label="Trades" value={String(swarmTradeStats.trades)} sub={`${pct(selectedSwarm?.winRate)} win rate`} />
                <StatTile label="Payoff ratio" value={finiteOrInfinity(swarmTradeStats.payoffRatio)} sub="avg win divided by avg loss" />
                <StatTile label="Best trade" value={usd(swarmTradeStats.bestTrade)} sub={`Worst ${usd(swarmTradeStats.worstTrade)}`} />
                <StatTile label="Baseline profit factor" value={finiteOrInfinity(buyYesTradeStats.profitFactor)} sub="buy-YES reference" />
              </div>
            </section>

            <ChartPanel title="Sharpe and drawdown by agent" subtitle="High Sharpe is useful only if drawdown and sample size are acceptable.">
              <ResponsiveContainer width="100%" height={420}>
                <BarChart data={riskRows} margin={{ top: 12, right: 16, bottom: 28, left: 0 }}>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} interval={0} angle={-24} textAnchor="end" height={58} />
                  <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} />
                  <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={11} tickFormatter={(value) => `$${value}`} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [name === "Drawdown" ? usd(Number(value)) : num(Number(value)), name]} />
                  <Legend />
                  <ReferenceLine yAxisId="left" y={0} stroke="#ff4f6f" strokeWidth={2} />
                  <Bar yAxisId="left" dataKey="sharpe" name="Sharpe" fill="#2ed09c" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="right" dataKey="maxDrawdownUsd" name="Drawdown" fill="#ff718d" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
          </section>

          <section className="rounded-md border border-slate-800 bg-[#0f151d]">
            <div className="flex flex-col gap-2 border-b border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold">Regime router behavior</h2>
                <p className="text-sm text-slate-400">
                  The router defaults to swarm, uses online/RL during rapid-shift regimes, and uses evolution only for
                  efficient/noisy or crowded-alpha proxies.
                </p>
              </div>
              <span className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300">
                {routerRows.reduce((sum, row) => sum + row.trades, 0)} routed trades
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Selected member</th>
                    <th className="px-4 py-3 text-right">Trades</th>
                    <th className="px-4 py-3 text-right">PnL</th>
                    <th className="px-4 py-3 text-right">Win rate</th>
                    <th className="px-4 py-3">Route reason</th>
                    <th className="px-4 py-3">Most common regime</th>
                  </tr>
                </thead>
                <tbody>
                  {routerRows.map((row) => (
                    <tr key={row.selectedAgent} className="border-b border-slate-900/80">
                      <td className="px-4 py-3">{labelForAgent(row.selectedAgent)}</td>
                      <td className="px-4 py-3 text-right">{row.trades}</td>
                      <td className={`px-4 py-3 text-right ${row.pnlUsd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{usd(row.pnlUsd)}</td>
                      <td className="px-4 py-3 text-right">{pct(row.winRate)}</td>
                      <td className="px-4 py-3 text-slate-300">{row.topReason}</td>
                      <td className="mono px-4 py-3 text-xs text-slate-400">{row.topRegime}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <ChartPanel title={`${run.sourceLabel}: ROI by agent`} subtitle="ROI normalizes PnL by notional traded. Red line is 0%.">
              <ResponsiveContainer width="100%" height={420}>
                <BarChart data={run.agentRows} margin={{ top: 12, right: 16, bottom: 28, left: 0 }}>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="agent" tickFormatter={labelForAgent} stroke="#94a3b8" fontSize={11} interval={0} angle={-24} textAnchor="end" height={58} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(value) => pct(Number(value))} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => pct(Number(value))} labelFormatter={(label) => labelForAgent(String(label ?? ""))} />
                  <ReferenceLine y={0} stroke="#ff4f6f" strokeWidth={2} />
                  <Bar dataKey="roi" name="ROI" radius={[4, 4, 0, 0]}>
                    {run.agentRows.map((row) => (
                      <Cell key={row.agent} fill={AGENT_COLORS[row.agent] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Trade quality" subtitle="Accuracy line at 50%; accuracy can look good while PnL loses to price asymmetry.">
              <ResponsiveContainer width="100%" height={420}>
                <AreaChart data={run.agentRows} margin={{ top: 12, right: 16, bottom: 28, left: 0 }}>
                  <CartesianGrid stroke="#1f2937" vertical={false} />
                  <XAxis dataKey="agent" tickFormatter={labelForAgent} stroke="#94a3b8" fontSize={11} interval={0} angle={-24} textAnchor="end" height={58} />
                  <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(value) => pct(Number(value))} domain={[0, 1]} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value) => pct(Number(value))} labelFormatter={(label) => labelForAgent(String(label ?? ""))} />
                  <ReferenceLine y={0.5} stroke="#ff4f6f" strokeWidth={2} />
                  <Area type="monotone" dataKey="accuracy" name="Accuracy" stroke="#2ed09c" fill="#2ed09c33" />
                  <Area type="monotone" dataKey="winRate" name="Win rate" stroke="#f2c75c" fill="#f2c75c2b" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartPanel>
          </section>

          <section className="rounded-md border border-slate-800 bg-[#0f151d]">
            <div className="flex flex-col gap-2 border-b border-slate-800 px-4 py-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold">Leaderboard</h2>
                <p className="text-sm text-slate-400">Ranked by PnL in the selected period/source/settlement slice.</p>
              </div>
              <span className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300">
                {run.data.testEpisodes} test markets
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3 text-right">PnL</th>
                    <th className="px-4 py-3 text-right">ROI</th>
                    <th className="px-4 py-3 text-right">Sharpe</th>
                    <th className="px-4 py-3 text-right">Trades</th>
                    <th className="px-4 py-3 text-right">Accuracy</th>
                    <th className="px-4 py-3 text-right">Win rate</th>
                    <th className="px-4 py-3 text-right">Drawdown</th>
                  </tr>
                </thead>
                <tbody>
                  {run.agentRows.map((row) => (
                    <tr key={row.agent} className="border-b border-slate-900/80">
                      <td className="px-4 py-3 text-slate-400">{row.rank}</td>
                      <td className="px-4 py-3">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: AGENT_COLORS[row.agent] ?? "#94a3b8" }} />
                        {labelForAgent(row.agent)}
                      </td>
                      <td className={`px-4 py-3 text-right ${row.pnlUsd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{usd(row.pnlUsd)}</td>
                      <td className="px-4 py-3 text-right">{pct(row.roi)}</td>
                      <td className="px-4 py-3 text-right">{num(row.sharpe)}</td>
                      <td className="px-4 py-3 text-right">{row.trades}</td>
                      <td className="px-4 py-3 text-right">{pct(row.accuracy)}</td>
                      <td className="px-4 py-3 text-right">{pct(row.winRate)}</td>
                      <td className="px-4 py-3 text-right">{usd(row.maxDrawdownUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-md border border-slate-800 bg-[#0f151d]">
            <div className="border-b border-slate-800 px-4 py-3">
              <h2 className="text-base font-semibold">Largest trade impacts</h2>
              <p className="text-sm text-slate-400">Sorted by absolute PnL contribution in the selected slice.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Market</th>
                    <th className="px-4 py-3">Side</th>
                    <th className="px-4 py-3 text-right">Entry</th>
                    <th className="px-4 py-3 text-right">Settlement</th>
                    <th className="px-4 py-3 text-right">Confidence</th>
                    <th className="px-4 py-3 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {topTrades.map((trade) => (
                    <tr key={`${trade.agent}-${trade.marketTicker}-${trade.timestamp}`} className="border-b border-slate-900/80">
                      <td className="px-4 py-3">{labelForAgent(trade.agent)}</td>
                      <td className="mono px-4 py-3 text-xs text-slate-400">{trade.marketTicker}</td>
                      <td className="px-4 py-3 uppercase">{trade.side}</td>
                      <td className="px-4 py-3 text-right">{pct(trade.entryPrice)}</td>
                      <td className="px-4 py-3 text-right">{pct(trade.settlement)}</td>
                      <td className="px-4 py-3 text-right">{pct(trade.confidence)}</td>
                      <td className={`px-4 py-3 text-right ${trade.pnlUsd >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{usd(trade.pnlUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function ControlPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-800 bg-[#0f151d] p-3">
      <p className="mono mb-3 text-xs uppercase text-slate-400">{title}</p>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function ChoiceButton({ active, title, subtitle, onClick }: { active: boolean; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button
      className={`rounded-md border px-3 py-3 text-left text-sm transition ${
        active
          ? "border-emerald-400 bg-emerald-400/10 text-emerald-100"
          : "border-slate-800 bg-slate-950/40 text-slate-300 hover:border-slate-600"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="block font-semibold">{title}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-400">{subtitle}</span>
    </button>
  );
}

function MetricCard({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub: string; tone?: "good" | "warn" | "bad" | "neutral" }) {
  return (
    <article className={`rounded-md border p-4 ${metricTone(tone)}`}>
      <p className="mono text-xs uppercase opacity-75">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm opacity-75">{sub}</p>
    </article>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <article className="rounded-md border border-slate-800 bg-slate-950/45 p-3">
      <p className="mono text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-slate-100">{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-400">{sub}</p>
    </article>
  );
}

function ChartPanel({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-slate-800 bg-[#0f151d] p-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-800 pb-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right text-slate-200">{value}</dd>
    </div>
  );
}

function sourceVerdict(run: Btc15mModeDashboard | undefined) {
  const swarm = run?.metrics.swarm;
  const buyYes = run?.metrics.buyYes;
  if (!run || !swarm || !buyYes || run.data.testEpisodes === 0) {
    return {
      title: "No comparable run",
      body: "This source/period combination does not have enough data to evaluate.",
      tone: "bad" as const,
    };
  }
  if (swarm.pnlUsd > buyYes.pnlUsd && swarm.pnlUsd > 0) {
    return {
      title: "Research candidate",
      body: "The selected swarm run is positive and beats buy-YES in this slice.",
      tone: "good" as const,
    };
  }
  if (swarm.pnlUsd > 0) {
    return {
      title: "Positive but not dominant",
      body: "The selected swarm is positive, but it does not beat the simple buy-YES baseline.",
      tone: "warn" as const,
    };
  }
  return {
    title: "Do not deploy yet",
    body: "The selected swarm loses money in this slice. Treat this as a diagnostic, not a paper-trading signal.",
    tone: "bad" as const,
  };
}

function labelForAgent(agent: string) {
  const labels: Record<string, string> = {
    swarm: "Swarm",
    pretrained: "Pretrained",
    online: "Online",
    hybrid: "Pre+post",
    transformer: "Transformer",
    evolutionary: "Evolution",
    regimeAdaptive: "Regime router",
    buyYes: "Buy YES",
    buyNo: "Buy NO",
    random: "Random",
    noTrade: "No trade",
  };
  return labels[agent] ?? agent;
}

function usd(value: number | null | undefined) {
  const n = Number(value ?? 0);
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function num(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toFixed(2);
}

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function shortDate(value: string | null | undefined) {
  if (!value) return "n/a";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortAxisDate(value: string | null | undefined) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
  }).format(new Date(value));
}

function verdictClasses(tone: "good" | "warn" | "bad") {
  if (tone === "good") return "border-emerald-400/50 bg-emerald-400/10 text-emerald-100";
  if (tone === "bad") return "border-rose-400/50 bg-rose-400/10 text-rose-100";
  return "border-amber-300/50 bg-amber-300/10 text-amber-100";
}

function metricTone(tone: "good" | "warn" | "bad" | "neutral") {
  if (tone === "good") return "border-emerald-400/40 bg-emerald-400/10 text-emerald-100";
  if (tone === "warn") return "border-amber-300/40 bg-amber-300/10 text-amber-100";
  if (tone === "bad") return "border-rose-400/40 bg-rose-400/10 text-rose-100";
  return "border-slate-800 bg-[#0f151d] text-slate-100";
}

function alphaTone(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "text-slate-300";
  if (value > 0) return "text-emerald-300";
  if (value < 0) return "text-rose-300";
  return "text-slate-300";
}

function tradeStats(trades: Btc15mTrade[], agent: string) {
  const rows = trades.filter((trade) => trade.agent === agent);
  const wins = rows.filter((trade) => trade.pnlUsd > 0);
  const losses = rows.filter((trade) => trade.pnlUsd < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnlUsd, 0));
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = rows.length ? rows.reduce((sum, trade) => sum + trade.pnlUsd, 0) / rows.length : 0;
  const avgConfidence = rows.length ? rows.reduce((sum, trade) => sum + trade.confidence, 0) / rows.length : 0;
  return {
    trades: rows.length,
    grossProfit,
    grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : 0,
    avgWin,
    avgLoss,
    payoffRatio: avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Number.POSITIVE_INFINITY : 0,
    expectancy,
    avgConfidence,
    bestTrade: rows.length ? Math.max(...rows.map((trade) => trade.pnlUsd)) : 0,
    worstTrade: rows.length ? Math.min(...rows.map((trade) => trade.pnlUsd)) : 0,
  };
}

function routeStats(trades: Btc15mTrade[]) {
  const rows = trades.filter((trade) => trade.agent === "regimeAdaptive");
  const groups = new Map<string, { selectedAgent: string; trades: number; wins: number; pnlUsd: number; regimes: Map<string, number>; reasons: Map<string, number> }>();
  for (const trade of rows) {
    const selectedAgent = trade.selectedAgent || "unknown";
    if (!groups.has(selectedAgent)) {
      groups.set(selectedAgent, {
        selectedAgent,
        trades: 0,
        wins: 0,
        pnlUsd: 0,
        regimes: new Map(),
        reasons: new Map(),
      });
    }
    const group = groups.get(selectedAgent);
    if (!group) continue;
    group.trades += 1;
    group.wins += trade.pnlUsd > 0 ? 1 : 0;
    group.pnlUsd += trade.pnlUsd;
    const regime = trade.regimeKey || "unknown";
    group.regimes.set(regime, (group.regimes.get(regime) ?? 0) + 1);
    const reason = trade.routeReason || "unknown";
    group.reasons.set(reason, (group.reasons.get(reason) ?? 0) + 1);
  }
  return [...groups.values()]
    .map((group) => ({
      selectedAgent: group.selectedAgent,
      trades: group.trades,
      pnlUsd: group.pnlUsd,
      winRate: group.trades ? group.wins / group.trades : null,
      topRegime: [...group.regimes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "n/a",
      topReason: [...group.reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "n/a",
    }))
    .sort((a, b) => b.pnlUsd - a.pnlUsd);
}

function finiteOrInfinity(value: number) {
  if (value === Number.POSITIVE_INFINITY) return "∞";
  return num(value);
}

function drawdownRatio(metric: { maxDrawdownUsd?: number; notionalUsd?: number } | undefined) {
  if (!metric?.notionalUsd) return 0;
  return (metric.maxDrawdownUsd ?? 0) / metric.notionalUsd;
}

const tooltipStyle = {
  background: "#0c1117",
  border: "1px solid #334155",
  borderRadius: 6,
  color: "#e2e8f0",
};

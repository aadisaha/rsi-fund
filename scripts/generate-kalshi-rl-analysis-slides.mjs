import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const historyPath = path.join(root, ".data", "kalshi-rl-run-history.json");
const outputPath = path.join(root, "docs", "kalshi-rl-generation-analysis-slides.html");

const specializedRoles = new Set(["closer", "sprinter", "hedger", "conviction", "scalper"]);
const palette = {
  green: "#32d6a2",
  mint: "#68e4bd",
  blue: "#7aa7ff",
  cyan: "#6ed3ed",
  yellow: "#f0c75e",
  red: "#ff7a90",
  purple: "#aa8cff",
  muted: "#9aa7ba",
  grid: "rgba(191,203,222,0.16)",
  text: "#f3f6fb",
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtUsd(value, digits = 0) {
  const abs = Math.abs(value ?? 0);
  const text = abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${(value ?? 0) < 0 ? "-" : ""}$${text}`;
}

function fmtPct(value, digits = 1) {
  return `${((value ?? 0) * 100).toFixed(digits)}%`;
}

function fmtTime(iso) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Los_Angeles",
  }).format(new Date(iso));
}

function roleOf(id = "") {
  const lower = id.toLowerCase();
  if (lower.includes("molly")) return "molly";
  const prefix = lower.split("-")[0];
  if (specializedRoles.has(prefix)) return prefix;
  if (["anchor", "spark", "early", "stride", "pulse", "scout"].includes(prefix)) return prefix;
  return "general";
}

function isGeneralGenetic(row) {
  const id = row?.genome?.genomeId ?? "";
  const role = roleOf(id);
  return role !== "molly" && !specializedRoles.has(role);
}

function rowPnl(row) {
  return Number(row?.performance?.netPnlUsd ?? row?.pnlUsd ?? 0);
}

function rowRisk(row) {
  return Number(row?.performance?.riskedUsd ?? 0);
}

function rowWon(row) {
  return Number(row?.performance?.betsWon ?? 0);
}

function rowLost(row) {
  return Number(row?.performance?.betsLost ?? 0);
}

function summarizeRun(run, index) {
  const rows = (run.leaderboard ?? []).filter(isGeneralGenetic);
  const net = rows.reduce((sum, row) => sum + rowPnl(row), 0);
  const risk = rows.reduce((sum, row) => sum + rowRisk(row), 0);
  const won = rows.reduce((sum, row) => sum + rowWon(row), 0);
  const lost = rows.reduce((sum, row) => sum + rowLost(row), 0);
  const trades = rows.reduce((sum, row) => sum + Number(row.trades ?? 0), 0);
  return {
    index,
    runId: run.runId,
    generatedAt: run.generatedAt,
    label: fmtTime(run.generatedAt),
    rows,
    count: rows.length,
    net,
    risk,
    returnAtRisk: risk > 0 ? net / risk : 0,
    won,
    lost,
    winRate: won + lost > 0 ? won / (won + lost) : 0,
    trades,
    best: rows.reduce((best, row) => Math.max(best, rowPnl(row)), -Infinity),
    worst: rows.reduce((worst, row) => Math.min(worst, rowPnl(row)), Infinity),
  };
}

function aggregateBy(rows, getKey) {
  const map = new Map();
  for (const row of rows) {
    const key = getKey(row);
    const bucket = map.get(key) ?? { key, count: 0, net: 0, risk: 0, won: 0, lost: 0, trades: 0 };
    bucket.count += 1;
    bucket.net += rowPnl(row);
    bucket.risk += rowRisk(row);
    bucket.won += rowWon(row);
    bucket.lost += rowLost(row);
    bucket.trades += Number(row.trades ?? 0);
    map.set(key, bucket);
  }
  return [...map.values()].map((bucket) => ({
    ...bucket,
    avgNet: bucket.count ? bucket.net / bucket.count : 0,
    returnAtRisk: bucket.risk > 0 ? bucket.net / bucket.risk : 0,
    winRate: bucket.won + bucket.lost > 0 ? bucket.won / (bucket.won + bucket.lost) : 0,
  }));
}

function lineChart({ series, width = 980, height = 330, yFormat = (v) => v.toFixed(0), yMin, yMax }) {
  const pad = { left: 70, right: 24, top: 28, bottom: 44 };
  const allPoints = series.flatMap((s) => s.values.map((v, i) => ({ x: i, y: v.y })));
  const maxLen = Math.max(...series.map((s) => s.values.length), 1);
  const minY = yMin ?? Math.min(0, ...allPoints.map((p) => p.y));
  const maxY = yMax ?? Math.max(1, ...allPoints.map((p) => p.y));
  const spanY = maxY - minY || 1;
  const x = (i) => pad.left + (i / Math.max(1, maxLen - 1)) * (width - pad.left - pad.right);
  const y = (value) => pad.top + (1 - (value - minY) / spanY) * (height - pad.top - pad.bottom);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const value = minY + spanY * t;
    const yy = y(value);
    return `<line x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" stroke="${palette.grid}" /><text x="12" y="${yy + 5}" fill="${palette.muted}" font-size="13">${esc(yFormat(value))}</text>`;
  }).join("");
  const paths = series.map((s) => {
    const d = s.values.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.y).toFixed(1)}`).join(" ");
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 3}" opacity="${s.opacity ?? 1}" />`;
  }).join("");
  const labels = series[0]?.values ?? [];
  const ticks = [0, Math.floor((labels.length - 1) / 2), labels.length - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
  const xLabels = ticks.map((i) => `<text x="${x(i)}" y="${height - 14}" fill="${palette.muted}" font-size="13" text-anchor="${i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}">${esc(labels[i]?.label ?? "")}</text>`).join("");
  const legend = series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("");
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img">${grid}<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${height - pad.bottom}" stroke="rgba(191,203,222,.42)" /><line x1="${pad.left}" y1="${y(0)}" x2="${width - pad.right}" y2="${y(0)}" stroke="rgba(191,203,222,.38)" />${paths}${xLabels}</svg><div class="legend">${legend}</div></div>`;
}

function barChart({ rows, valueKey = "value", labelKey = "label", colorKey = "color", width = 980, height = 320, valueFormat = fmtUsd }) {
  const pad = { left: 160, right: 30, top: 26, bottom: 34 };
  const max = Math.max(1, ...rows.map((row) => Math.abs(row[valueKey])));
  const zeroX = pad.left + (width - pad.left - pad.right) * 0.42;
  const scale = (width - pad.left - pad.right) * 0.56 / max;
  const rowH = (height - pad.top - pad.bottom) / Math.max(1, rows.length);
  const bars = rows.map((row, i) => {
    const yy = pad.top + i * rowH + rowH * 0.18;
    const value = row[valueKey];
    const barW = Math.abs(value) * scale;
    const x = value >= 0 ? zeroX : zeroX - barW;
    return `<text x="14" y="${yy + rowH * 0.45}" fill="${palette.text}" font-size="14" font-weight="700">${esc(row[labelKey])}</text><rect x="${x}" y="${yy}" width="${barW}" height="${Math.max(10, rowH * 0.58)}" rx="5" fill="${row[colorKey] ?? (value >= 0 ? palette.green : palette.red)}" opacity=".88" /><text x="${value >= 0 ? x + barW + 8 : x - 8}" y="${yy + rowH * 0.45}" fill="${palette.muted}" text-anchor="${value >= 0 ? "start" : "end"}" font-size="13">${esc(valueFormat(value))}</text>`;
  }).join("");
  return `<div class="chart-wrap"><svg viewBox="0 0 ${width} ${height}" role="img"><line x1="${zeroX}" y1="${pad.top - 8}" x2="${zeroX}" y2="${height - pad.bottom + 8}" stroke="rgba(191,203,222,.42)" />${bars}</svg></div>`;
}

function table(headers, rows) {
  const body = Array.isArray(rows) ? rows.join("") : rows;
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>`;
}

const rawHistory = JSON.parse(fs.readFileSync(historyPath, "utf8"));
const runs = rawHistory
  .filter((run) => run.generatedAt)
  .sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt));
const summaries = runs.map(summarizeRun).filter((run) => run.count > 0);
const performanceSummaries = summaries.filter((run) => run.risk > 0);
const latest = performanceSummaries.at(-1);
const peak = performanceSummaries.reduce((best, run) => run.net > best.net ? run : best, performanceSummaries[0]);

const genomeSeen = new Map();
for (const run of summaries) {
  for (const row of run.rows) {
    const id = row.genome?.genomeId;
    if (!id) continue;
    const existing = genomeSeen.get(id) ?? {
      id,
      role: roleOf(id),
      generation: row.genome?.generation ?? 0,
      firstAt: run.generatedAt,
      firstPnl: rowPnl(row),
      peakPnl: rowPnl(row),
      lastAt: run.generatedAt,
      lastPnl: rowPnl(row),
      visibleLatest: false,
    };
    existing.peakPnl = Math.max(existing.peakPnl, rowPnl(row));
    existing.lastAt = run.generatedAt;
    existing.lastPnl = rowPnl(row);
    existing.generation = row.genome?.generation ?? existing.generation;
    genomeSeen.set(id, existing);
  }
}
const latestIds = new Set(latest.rows.map((row) => row.genome?.genomeId));
for (const item of genomeSeen.values()) item.visibleLatest = latestIds.has(item.id);

const peakTop = [...peak.rows]
  .sort((a, b) => rowPnl(b) - rowPnl(a))
  .slice(0, 20)
  .map((row) => {
    const id = row.genome?.genomeId;
    return { id, role: roleOf(id), peakPnl: rowPnl(row), ...genomeSeen.get(id) };
  });

const lineagePeak = aggregateBy(peak.rows, (row) => roleOf(row.genome?.genomeId)).sort((a, b) => b.net - a.net);
const lineageLatest = aggregateBy(latest.rows, (row) => roleOf(row.genome?.genomeId)).sort((a, b) => b.net - a.net);
const latestByRole = new Map(lineageLatest.map((row) => [row.key, row]));

const generationPeak = aggregateBy(peak.rows, (row) => `g${row.genome?.generation ?? "?"}`).sort((a, b) => b.net - a.net).slice(0, 10);
const generationLatest = aggregateBy(latest.rows, (row) => `g${row.genome?.generation ?? "?"}`).sort((a, b) => b.net - a.net).slice(0, 10);

const summaryPoints = performanceSummaries.map((run) => ({
  label: fmtTime(run.generatedAt),
  net: run.net,
  ret: run.returnAtRisk,
  win: run.winRate,
  trades: run.trades,
}));

const topDriftBars = peakTop.slice(0, 12).map((agent) => ({
  label: `${agent.id.split("-").slice(0, 3).join("-")}`,
  value: (agent.lastPnl ?? 0) - (agent.peakPnl ?? 0),
  color: (agent.lastPnl ?? 0) - (agent.peakPnl ?? 0) >= 0 ? palette.green : palette.red,
}));

const lineageRows = lineagePeak.map((peakRole) => {
  const latestRole = latestByRole.get(peakRole.key);
  const delta = (latestRole?.net ?? 0) - peakRole.net;
  return `<tr><td><span class="role ${esc(peakRole.key)}">${esc(peakRole.key)}</span></td><td>${peakRole.count}</td><td>${fmtUsd(peakRole.net)}</td><td>${fmtPct(peakRole.returnAtRisk, 2)}</td><td>${latestRole?.count ?? 0}</td><td>${fmtUsd(latestRole?.net ?? 0)}</td><td class="${delta < 0 ? "bad" : "good"}">${fmtUsd(delta)}</td><td>${fmtPct(latestRole?.winRate ?? 0, 1)}</td></tr>`;
}).join("");

const peakAgentRows = peakTop.slice(0, 12).map((agent) => {
  const delta = agent.lastPnl - agent.peakPnl;
  return `<tr><td>${esc(agent.id)}</td><td><span class="role ${esc(agent.role)}">${esc(agent.role)}</span></td><td>${fmtUsd(agent.peakPnl, 1)}</td><td>${fmtUsd(agent.lastPnl, 1)}</td><td class="${delta < 0 ? "bad" : "good"}">${fmtUsd(delta, 1)}</td><td>${agent.visibleLatest ? "yes" : "no"}</td><td>${esc(fmtTime(agent.lastAt))}</td></tr>`;
}).join("");

const generationRows = [...new Set([...generationPeak.map((g) => g.key), ...generationLatest.map((g) => g.key)])]
  .map((key) => {
    const p = generationPeak.find((g) => g.key === key);
    const l = generationLatest.find((g) => g.key === key);
    return `<tr><td>${esc(key)}</td><td>${p ? p.count : 0}</td><td>${p ? fmtUsd(p.net) : "-"}</td><td>${p ? fmtPct(p.returnAtRisk, 2) : "-"}</td><td>${l ? l.count : 0}</td><td>${l ? fmtUsd(l.net) : "-"}</td><td>${l ? fmtPct(l.returnAtRisk, 2) : "-"}</td></tr>`;
  }).join("");

const survival = {
  topCount: peakTop.length,
  stillVisible: peakTop.filter((agent) => agent.visibleLatest).length,
  avgPeak: peakTop.reduce((sum, agent) => sum + agent.peakPnl, 0) / peakTop.length,
  avgLast: peakTop.reduce((sum, agent) => sum + agent.lastPnl, 0) / peakTop.length,
};

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Kalshi RL Generation Drift Analysis</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #090b10;
        --panel: #11141b;
        --panel-2: #171b24;
        --line: rgba(191, 203, 222, 0.18);
        --text: #f3f6fb;
        --muted: #a8b2c3;
        --green: ${palette.green};
        --blue: ${palette.blue};
        --yellow: ${palette.yellow};
        --red: ${palette.red};
        --purple: ${palette.purple};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        background: linear-gradient(135deg, #07090d, #10131a 48%, #080a0f);
        color: var(--text);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main { width: min(1240px, calc(100vw - 40px)); margin: 0 auto; padding: 28px 0 80px; }
      header { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 22px; }
      h1, h2, h3, p { margin: 0; }
      h1 { margin-top: 8px; font-size: clamp(32px, 4.8vw, 64px); line-height: .98; letter-spacing: 0; }
      h2 { font-size: clamp(30px, 4vw, 52px); line-height: 1.03; letter-spacing: 0; }
      .eyebrow { color: var(--green); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
      .subtitle, .lead { color: var(--muted); font-size: 18px; line-height: 1.55; max-width: 900px; margin-top: 14px; }
      .controls { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
      button { border: 1px solid var(--line); border-radius: 6px; background: rgba(255,255,255,.04); color: var(--text); cursor: pointer; font: inherit; padding: 10px 12px; }
      button:hover { border-color: rgba(50,214,162,.65); }
      .counter { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
      .slide { display: none; min-height: 720px; border: 1px solid var(--line); border-radius: 10px; background: linear-gradient(135deg, rgba(255,255,255,.045), rgba(255,255,255,.015)), rgba(17,20,27,.96); box-shadow: 0 24px 100px rgba(0,0,0,.34); overflow: hidden; }
      .slide.active { display: block; }
      .slide-inner { padding: clamp(28px, 5vw, 58px); }
      .grid { display: grid; gap: 16px; }
      .two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .cards { margin-top: 34px; }
      .card, .metric { border: 1px solid var(--line); border-radius: 8px; background: rgba(8,11,16,.48); padding: 20px; }
      .card h3 { font-size: 18px; }
      .card p, li { color: var(--muted); font-size: 15px; line-height: 1.5; }
      .card p { margin-top: 10px; }
      ul { margin: 14px 0 0; padding-left: 20px; }
      li + li { margin-top: 9px; }
      .metric-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-top: 34px; }
      .metric .label { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; text-transform: uppercase; }
      .metric .value { margin-top: 10px; font-size: 28px; font-weight: 800; }
      .good { color: var(--green); }
      .bad { color: var(--red); }
      .yellow { color: var(--yellow); }
      .chart-wrap { margin-top: 26px; border: 1px solid var(--line); border-radius: 8px; background: rgba(5,7,11,.36); padding: 16px; }
      svg { display: block; width: 100%; height: auto; overflow: visible; }
      .legend { display: flex; flex-wrap: wrap; gap: 14px; color: var(--muted); font-size: 13px; margin-top: 10px; }
      .legend span { display: inline-flex; align-items: center; gap: 7px; }
      .legend i { width: 18px; height: 3px; border-radius: 99px; display: inline-block; }
      table { width: 100%; border-collapse: collapse; margin-top: 22px; font-size: 14px; }
      th, td { padding: 11px 12px; border-bottom: 1px solid rgba(191,203,222,.14); text-align: left; vertical-align: middle; }
      th { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; text-transform: uppercase; }
      td { color: #dfe6f2; }
      .role { display: inline-flex; min-width: 74px; justify-content: center; border-radius: 999px; padding: 5px 9px; border: 1px solid rgba(255,255,255,.12); font-size: 12px; font-weight: 800; text-transform: uppercase; }
      .anchor { background: rgba(122,167,255,.14); color: #9dbbff; }
      .spark { background: rgba(50,214,162,.14); color: #6ee6bd; }
      .early { background: rgba(255,122,144,.14); color: #ff9aac; }
      .stride { background: rgba(240,199,94,.14); color: #f0d27a; }
      .pulse, .scout, .general { background: rgba(170,140,255,.13); color: #bea9ff; }
      .callout { margin-top: 28px; padding: 22px; border-left: 4px solid var(--green); background: rgba(50,214,162,.08); color: #dffcf3; line-height: 1.55; }
      .small { color: var(--muted); font-size: 13px; line-height: 1.5; margin-top: 14px; }
      @media (max-width: 860px) {
        header { align-items: flex-start; flex-direction: column; }
        .two, .three, .metric-row { grid-template-columns: 1fr; }
        .slide { min-height: auto; }
      }
      @media print {
        body { background: #090b10; }
        header { display: none; }
        main { width: 100%; padding: 0; }
        .slide { display: block; break-after: page; min-height: 100vh; border: 0; border-radius: 0; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <div class="eyebrow">Kalshi BTC 15M · Paper Genetic RL</div>
          <h1>Generation Drift Analysis</h1>
          <p class="subtitle">Static slide report generated from <code>.data/kalshi-rl-run-history.json</code>. Scope: general genetic agents only; Molly and specialized role agents are excluded.</p>
        </div>
        <div class="controls">
          <button id="prev">Prev</button>
          <span class="counter"><span id="current">1</span> / <span id="total">7</span></span>
          <button id="next">Next</button>
        </div>
      </header>

      <section class="slide active">
        <div class="slide-inner">
          <div class="eyebrow">Executive read</div>
          <h2>The profitable agents mostly disappeared; the population that replaced them performed worse.</h2>
          <p class="lead">The evidence points more toward selection and retention drift than toward the exact peak winners gradually becoming terrible while still being tracked.</p>
          <div class="metric-row">
            <div class="metric"><div class="label">Peak net PnL</div><div class="value good">${fmtUsd(peak.net)}</div><p class="small">${esc(fmtTime(peak.generatedAt))}</p></div>
            <div class="metric"><div class="label">Latest net PnL</div><div class="value ${latest.net < peak.net ? "bad" : "good"}">${fmtUsd(latest.net)}</div><p class="small">${esc(fmtTime(latest.generatedAt))}</p></div>
            <div class="metric"><div class="label">Peak top agents retained</div><div class="value bad">${survival.stillVisible} / ${survival.topCount}</div><p class="small">Top 20 peak agents visible in latest leaderboard.</p></div>
            <div class="metric"><div class="label">Latest win rate</div><div class="value ${latest.winRate < peak.winRate ? "bad" : "good"}">${fmtPct(latest.winRate, 1)}</div><p class="small">Down from ${fmtPct(peak.winRate, 1)} at peak.</p></div>
          </div>
          <div class="callout">Bottom line: later/replacement cohorts appear to have learned weaker habits, while many of the earlier winners were no longer present for continued scoring.</div>
        </div>
      </section>

      <section class="slide">
        <div class="slide-inner">
          <div class="eyebrow">Timeline</div>
          <h2>Aggregate performance climbed, then rolled over as the live population churned.</h2>
          <p class="lead">The decline is visible in net PnL, return at risk, and win rate. The sharpest deterioration was late in the sample, after the population had already rotated away from the peak cohort.</p>
          ${lineChart({
            series: [
              { name: "Net paper PnL", color: palette.green, values: summaryPoints.map((p) => ({ label: p.label, y: p.net })) },
              { name: "Risked dollars / 20", color: palette.blue, opacity: 0.7, values: summaryPoints.map((p) => ({ label: p.label, y: p.trades ? p.trades * 25 / 20 : 0 })) },
            ],
            yFormat: fmtUsd,
          })}
          ${lineChart({
            series: [
              { name: "Return at risk", color: palette.yellow, values: summaryPoints.map((p) => ({ label: p.label, y: p.ret })) },
              { name: "Win rate", color: palette.purple, values: summaryPoints.map((p) => ({ label: p.label, y: p.win })) },
            ],
            yFormat: (v) => fmtPct(v, 0),
            yMin: 0,
            yMax: Math.max(0.65, ...summaryPoints.map((p) => Math.max(p.ret, p.win))),
          })}
        </div>
      </section>

      <section class="slide">
        <div class="slide-inner">
          <div class="eyebrow">Peak versus latest</div>
          <h2>The latest population is still positive, but much less efficient.</h2>
          <p class="lead">Net PnL fell from ${fmtUsd(peak.net)} to ${fmtUsd(latest.net)}. Return at risk fell from ${fmtPct(peak.returnAtRisk, 2)} to ${fmtPct(latest.returnAtRisk, 2)}. Win rate fell from ${fmtPct(peak.winRate, 1)} to ${fmtPct(latest.winRate, 1)}.</p>
          <div class="grid two cards">
            <div class="card">
              <h3>Peak snapshot</h3>
              <p>${esc(fmtTime(peak.generatedAt))}</p>
              <ul>
                <li>Rows: ${peak.count}</li>
                <li>Net: ${fmtUsd(peak.net)}</li>
                <li>Return at risk: ${fmtPct(peak.returnAtRisk, 2)}</li>
                <li>Wins/losses: ${peak.won.toLocaleString()} / ${peak.lost.toLocaleString()}</li>
              </ul>
            </div>
            <div class="card">
              <h3>Latest snapshot</h3>
              <p>${esc(fmtTime(latest.generatedAt))}</p>
              <ul>
                <li>Rows: ${latest.count}</li>
                <li>Net: ${fmtUsd(latest.net)}</li>
                <li>Return at risk: ${fmtPct(latest.returnAtRisk, 2)}</li>
                <li>Wins/losses: ${latest.won.toLocaleString()} / ${latest.lost.toLocaleString()}</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section class="slide">
        <div class="slide-inner">
          <div class="eyebrow">Same-agent tracking</div>
          <h2>The top peak agents were not the ones dragging the latest leaderboard down.</h2>
          <p class="lead">For the top 20 agents at the peak, ${survival.stillVisible} were still visible in the latest leaderboard. Their average peak PnL was ${fmtUsd(survival.avgPeak, 1)} and their average last-seen PnL was ${fmtUsd(survival.avgLast, 1)}.</p>
          ${barChart({ rows: topDriftBars, valueFormat: (v) => `${v >= 0 ? "+" : ""}${fmtUsd(v, 1)}` })}
          ${table(["Peak agent", "Role", "Peak PnL", "Last seen PnL", "Delta", "Latest?", "Last seen"], peakAgentRows)}
        </div>
      </section>

      <section class="slide">
        <div class="slide-inner">
          <div class="eyebrow">Lineage behavior</div>
          <h2>Anchor survived; early became the clearest bad habit.</h2>
          <p class="lead">At the peak, spark and anchor carried most profit. In the latest population, anchor still contributes, but the early lineage has become a large loss center.</p>
          ${table(["Lineage", "Peak rows", "Peak net", "Peak R@Risk", "Latest rows", "Latest net", "Delta", "Latest win"], lineageRows)}
        </div>
      </section>

      <section class="slide">
        <div class="slide-inner">
          <div class="eyebrow">Generation comparison</div>
          <h2>The visible generation mix changed; the old winners were not kept as an elite archive.</h2>
          <p class="lead">This table compares genome generation numbers present at the peak versus latest snapshots. It is not enough by itself to prove old winners would fail on new markets; it shows that the active population being evaluated changed materially.</p>
          ${table(["Genome gen", "Peak rows", "Peak net", "Peak R@Risk", "Latest rows", "Latest net", "Latest R@Risk"], generationRows)}
          <div class="callout">The missing control is continuous re-scoring of historical elites. Without that, the dashboard can confuse “old agent was removed” with “old agent became bad.”</div>
        </div>
      </section>

      <section class="slide">
        <div class="slide-inner">
          <div class="eyebrow">What to change next</div>
          <h2>Add an elite archive so the system can tell drift from replacement.</h2>
          <div class="grid two cards">
            <div class="card">
              <h3>Preserve winners</h3>
              <p>Keep the top historical genomes in a read-only elite archive and re-score them every generation, even if they are no longer actively trading.</p>
            </div>
            <div class="card">
              <h3>Compare cohorts</h3>
              <p>Show first-seen cohort, latest active cohort, and same-genome drift. This separates bad new children from old winners failing on new market regimes.</p>
            </div>
            <div class="card">
              <h3>Guard retention</h3>
              <p>Do not let short-term reward bonuses replace a high-PnL champion unless the child beats the archive on recent settled windows.</p>
            </div>
            <div class="card">
              <h3>Alert on habits</h3>
              <p>Flag lineages when win rate collapses, loss count accelerates, or they farm trades with poor notional efficiency.</p>
            </div>
          </div>
          <div class="callout">Interpretation: the general agents found something useful, but the population management was too willing to discard winners before proving the replacements were better.</div>
          <p class="small">Generated from ${esc(historyPath)} on ${esc(new Date().toISOString())}. Performance-rich window: ${esc(fmtTime(performanceSummaries[0].generatedAt))} to ${esc(fmtTime(latest.generatedAt))}.</p>
        </div>
      </section>
    </main>
    <script>
      const slides = [...document.querySelectorAll(".slide")];
      const current = document.getElementById("current");
      const total = document.getElementById("total");
      let index = 0;
      total.textContent = slides.length;
      function show(next) {
        index = (next + slides.length) % slides.length;
        slides.forEach((slide, i) => slide.classList.toggle("active", i === index));
        current.textContent = index + 1;
      }
      document.getElementById("prev").addEventListener("click", () => show(index - 1));
      document.getElementById("next").addEventListener("click", () => show(index + 1));
      window.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" || event.key === " ") show(index + 1);
        if (event.key === "ArrowLeft") show(index - 1);
      });
      show(0);
    </script>
  </body>
</html>`;

fs.writeFileSync(outputPath, html);
console.log(`Wrote ${outputPath}`);

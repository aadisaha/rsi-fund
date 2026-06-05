import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const gunzipAsync = promisify(gunzip);

const ROOT = process.cwd();
const HISTORY_ROOT = process.env.KALSHI_HISTORY_DATA_DIR || path.join(ROOT, ".data", "kalshi-history");
const OUT_DIR = path.join(ROOT, ".data", "btc15m-swarm-backtest");
const SERIES = "KXBTC15M";

const AGENTS = ["pretrained", "online", "hybrid", "transformer", "evolutionary", "swarm", "regimeAdaptive"];
const BASE_AGENT_NAMES = ["pretrained", "online", "hybrid", "transformer", "evolutionary"];
const BENCHMARKS = ["buyYes", "buyNo", "random"];
const SOURCE_MODES = ["historical", "live", "combined"];
const DEFAULT_PERIODS = [
  { key: "jan-11-18", label: "Jan 11-18", testStart: "2026-01-11T00:00:00Z", testEnd: "2026-01-18T23:59:59Z" },
  { key: "feb-15-22", label: "Feb 15-22", testStart: "2026-02-15T00:00:00Z", testEnd: "2026-02-22T23:59:59Z" },
  { key: "mar-23-29", label: "Mar 23-29", testStart: "2026-03-23T00:00:00Z", testEnd: "2026-03-29T23:59:59Z" },
  { key: "may-22-29", label: "May 22-29", testStart: "2026-05-22T00:00:00Z", testEnd: "2026-05-29T23:59:59Z" },
];

const options = parseArgs(process.argv.slice(2));

await main();

async function main() {
  if (options.matrix) {
    await runMatrix();
    return;
  }
  const manifest = JSON.parse(await readFile(path.join(HISTORY_ROOT, "manifest.json"), "utf8"));
  const summary = await runBacktest(manifest, options);

  await mkdir(OUT_DIR, { recursive: true });
  const modeName = outputBaseName(options);
  const jsonPath = path.join(OUT_DIR, `${modeName}.json`);
  const csvPath = path.join(OUT_DIR, `${modeName}-trades.csv`);
  await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(csvPath, tradesCsv(summary.trades ?? []));
  await writeFile(path.join(OUT_DIR, "latest.json"), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(OUT_DIR, "trades.csv"), tradesCsv(summary.trades ?? []));

  console.log(JSON.stringify({
    ok: true,
    outputJson: path.relative(ROOT, jsonPath),
    outputCsv: path.relative(ROOT, csvPath),
    data: summary.data,
    leaderboard: summary.leaderboard.map(({ rank, agent, pnlUsd, roi, trades, winRate, accuracy, sharpe, maxDrawdownUsd }) => ({
      rank,
      agent,
      pnlUsd,
      roi,
      trades,
      winRate,
      accuracy,
      sharpe,
      maxDrawdownUsd,
    })),
  }, null, 2));
}

async function runMatrix() {
  const manifest = JSON.parse(await readFile(path.join(HISTORY_ROOT, "manifest.json"), "utf8"));
  const matrix = {
    generatedAt: new Date().toISOString(),
    seriesTicker: SERIES,
    periods: [],
  };
  await mkdir(OUT_DIR, { recursive: true });
  for (const period of DEFAULT_PERIODS) {
    const periodRow = { ...period, runs: { permissive: {}, strict: {} } };
    for (const source of SOURCE_MODES) {
      for (const strict of [false, true]) {
        const runOptions = {
          ...options,
          source,
          testStart: period.testStart,
          testEnd: period.testEnd,
          requireBinarySettlement: strict,
        };
        const summary = await runBacktest(manifest, runOptions);
        const base = outputBaseName(runOptions, period.key);
        const jsonPath = path.join(OUT_DIR, `${base}.json`);
        const csvPath = path.join(OUT_DIR, `${base}-trades.csv`);
        await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
        await writeFile(csvPath, tradesCsv(summary.trades ?? []));
        const settlementMode = strict ? "strict" : "permissive";
        periodRow.runs[settlementMode][source] = {
          summaryFile: path.basename(jsonPath),
          tradesFile: path.basename(csvPath),
          data: summary.data,
          metrics: summary.metrics,
          leaderboard: summary.leaderboard,
        };
      }
    }
    matrix.periods.push(periodRow);
  }
  await writeFile(path.join(OUT_DIR, "matrix.json"), `${JSON.stringify(matrix, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    outputJson: path.relative(ROOT, path.join(OUT_DIR, "matrix.json")),
    periods: matrix.periods.map((period) => ({
      key: period.key,
      label: period.label,
      strict: Object.fromEntries(Object.entries(period.runs.strict).map(([source, run]) => [source, run.data.testEpisodes])),
      permissive: Object.fromEntries(Object.entries(period.runs.permissive).map(([source, run]) => [source, run.data.testEpisodes])),
    })),
  }, null, 2));
}

async function runBacktest(manifest, runOptions) {
  const markets = await loadMarkets(manifest, runOptions);
  const episodes = markets.map((market) => buildEpisode(market, runOptions)).filter(Boolean).sort((a, b) => a.ts - b.ts);
  const split = splitEpisodes(episodes, runOptions);

  const canTrain = split.fit.length >= 20 && split.validation.length >= 5 && split.test.length > 0;
  const models = canTrain ? trainModels(split.fit, split.validation, runOptions) : null;
  const result = canTrain ? evaluate(split.test, models, runOptions) : { metrics: Object.fromEntries(AGENTS.map((agent) => [agent, emptyMetrics(agent)])), trades: [] };
  const buyYesResult = evaluateBaseline(split.test, "yes", runOptions);
  const buyNoResult = evaluateBaseline(split.test, "no", runOptions);
  const randomResult = evaluateRandomBaseline(split.test, runOptions);
  const noTrade = emptyMetrics("noTrade");
  for (const metric of [...Object.values(result.metrics), buyYesResult.metric, buyNoResult.metric, randomResult.metric, noTrade]) finalize(metric);
  const allMetrics = {
    ...Object.fromEntries(AGENTS.map((key) => [key, result.metrics[key]])),
    buyYes: buyYesResult.metric,
    buyNo: buyNoResult.metric,
    random: randomResult.metric,
    noTrade,
  };
  attachAlphaBeta(allMetrics);
  stripInternalSeries(allMetrics);
  const summary = {
    generatedAt: new Date().toISOString(),
    seriesTicker: SERIES,
    sourceMode: runOptions.source,
    settlementMode: runOptions.requireBinarySettlement ? "strict" : "permissive",
    historyRoot: HISTORY_ROOT,
    assumptions: {
      oneDecisionPerMarket: true,
      entryLookbackMinutes: runOptions.lookback,
      maxMarkets: runOptions.maxMarkets,
      warmupEpisodes: runOptions.warmup,
      testStartRequested: runOptions.testStart,
      testEndRequested: runOptions.testEnd,
      notionalUsd: runOptions.notionalUsd,
      feeRate: runOptions.feeRate,
      minConfidence: runOptions.minConfidence,
      settlementInference:
        "Uses final YES bid/ask/last price from downloaded Kalshi candles; near-binary final quotes count as settlement, otherwise final mid/price > 50c infers YES.",
    },
    data: {
      manifestMarkets: Object.keys(manifest.markets ?? {}).length,
      loadedMarkets: markets.length,
      usableEpisodes: episodes.length,
      fitEpisodes: split.fit.length,
      validationEpisodes: split.validation.length,
      testEpisodes: split.test.length,
      priorEpisodesAvailable: split.prior.length,
      testStart: iso(split.test[0]?.ts),
      testEnd: iso(split.test.at(-1)?.ts),
      ambiguousSettlements: split.test.filter((row) => row.ambiguousSettlement).length,
    },
    metrics: {
      ...allMetrics,
    },
    leaderboard: Object.values(allMetrics)
      .sort((a, b) => b.pnlUsd - a.pnlUsd)
      .map((row, index) => ({ rank: index + 1, ...row })),
    modelNotes: models ? modelNotes(models, runOptions) : { note: "Insufficient pre-window training data or empty test window." },
    trades: [...result.trades, ...buyYesResult.trades, ...buyNoResult.trades, ...randomResult.trades],
  };
  return summary;
}

function splitEpisodes(episodes, runOptions) {
  if (runOptions.testStart && runOptions.testEnd) {
    const start = Math.floor(Date.parse(runOptions.testStart) / 1000);
    const end = Math.floor(Date.parse(runOptions.testEnd) / 1000);
    const prior = episodes.filter((episode) => episode.ts < start);
    const warmup = prior.slice(-runOptions.warmup);
    const splitIndex = Math.max(1, Math.floor(warmup.length * runOptions.fitPct));
    return {
      prior,
      fit: warmup.slice(0, splitIndex),
      validation: warmup.slice(splitIndex),
      test: episodes.filter((episode) => episode.ts >= start && episode.ts <= end),
    };
  }
  const fitEnd = Math.max(40, Math.floor(episodes.length * runOptions.fitPct));
  const validationEnd = Math.max(fitEnd + 20, Math.floor(episodes.length * (runOptions.fitPct + runOptions.validationPct)));
  return {
    prior: episodes.slice(0, validationEnd),
    fit: episodes.slice(0, fitEnd),
    validation: episodes.slice(fitEnd, validationEnd),
    test: episodes.slice(validationEnd),
  };
}

async function loadMarkets(manifest, runOptions) {
  const sources = sourceList(runOptions.source);
  const entries = Object.values(manifest.markets ?? {})
    .filter((entry) => entry.seriesTickers?.includes(SERIES))
    .filter((entry) => entry.periodIntervals?.includes(1))
    .filter((entry) => sources.some((source) => entry.sources?.includes(source)))
    .filter((entry) => (entry.files ?? []).some((file) => sources.some((source) => file.includes(`source=${source}`))))
    .filter((entry) => (entry.candles ?? 0) >= runOptions.minCandles)
    .sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0));

  const selected = runOptions.maxMarkets ? entries.slice(-runOptions.maxMarkets) : entries;
  const markets = [];
  for (const entry of selected) {
    const files = [...new Set(entry.files ?? [])].filter((file) => sources.some((source) => file.includes(`source=${source}`)));
    const rows = [];
    for (const file of files) {
      const raw = await gunzipAsync(await readFile(path.join(HISTORY_ROOT, file)));
      for (const line of raw.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        rows.push(JSON.parse(line));
      }
    }
    const deduped = [...new Map(rows.map((row) => [row.endPeriodTs, row])).values()]
      .filter((row) => row.seriesTicker === SERIES)
      .sort((a, b) => a.endPeriodTs - b.endPeriodTs);
    if (deduped.length >= runOptions.minCandles) markets.push({ marketTicker: entry.marketTicker, candles: deduped });
  }
  return markets;
}

function sourceList(source) {
  if (source === "live") return ["live"];
  if (source === "combined") return ["historical", "live"];
  return ["historical"];
}

function outputBaseName(runOptions, periodKey = "") {
  const settlement = runOptions.requireBinarySettlement ? "strict-binary" : "permissive-final-mark";
  const source = SOURCE_MODES.includes(runOptions.source) ? runOptions.source : "historical";
  return [periodKey, source, settlement].filter(Boolean).join("-");
}

function buildEpisode(market, runOptions) {
  const rows = market.candles.filter((row) => yesMid(row) != null && yesAsk(row) != null && yesBid(row) != null);
  if (rows.length < runOptions.lookback + 2) return null;
  const entryIndex = Math.min(runOptions.lookback, rows.length - 2);
  const entry = rows[entryIndex];
  const final = rows.at(-1);
  const settlement = inferYesSettlement(final);
  if (!settlement) return null;
  if (runOptions.requireBinarySettlement && settlement.ambiguous) return null;

  const window = rows.slice(0, entryIndex + 1);
  const p = yesMid(entry);
  const p0 = yesMid(window[0]);
  const p1 = yesMid(window.at(-2)) ?? p;
  const lookbackPrice = yesMid(window[Math.max(0, window.length - runOptions.lookback - 1)]) ?? p0;
  const shortMomentum = p - p1;
  const longMomentum = p - lookbackPrice;
  const prices = window.map((row) => yesMid(row)).filter((v) => v != null);
  const returns = [];
  for (let i = 1; i < prices.length; i += 1) returns.push(prices[i] - prices[i - 1]);
  const vol = std(returns);
  const volume = sum(window.map((row) => Number(row.volume ?? 0)));
  const oi = Number(entry.openInterest ?? 0);
  const spread = Math.max(0, yesAsk(entry) - yesBid(entry));
  const timeInMarket = entryIndex / Math.max(1, rows.length - 1);
  const direction = settlement.yesWin ? 1 : -1;
  return {
    marketTicker: market.marketTicker,
    ts: entry.endPeriodTs,
    entryIndex,
    rows: rows.length,
    yesAsk: yesAsk(entry),
    yesBid: yesBid(entry),
    noAsk: 1 - yesBid(entry),
    noBid: 1 - yesAsk(entry),
    settlementYes: settlement.yesWin ? 1 : 0,
    ambiguousSettlement: settlement.ambiguous,
    direction,
    regimeKey: regimeKey({
      p,
      shortMomentum,
      longMomentum,
      vol,
      spread,
      volume,
      timeInMarket,
    }),
    vector: [
      1,
      clamp((p - 0.5) / 0.5, -2, 2),
      clamp(shortMomentum / 0.08, -3, 3),
      clamp(longMomentum / 0.18, -3, 3),
      clamp((vol - 0.035) / 0.08, -3, 3),
      clamp((0.08 - spread) / 0.08, -3, 3),
      clamp(Math.log1p(volume) / 6, 0, 2),
      clamp(Math.log1p(oi) / 7, 0, 2),
      clamp(timeInMarket * 2 - 1, -1, 1),
    ],
  };
}

function regimeKey({ p, shortMomentum, longMomentum, vol, spread, volume, timeInMarket }) {
  const priceBand = p >= 0.65 ? "favorite" : p <= 0.35 ? "underdog" : "balanced";
  const trend = longMomentum > 0.04 ? "uptrend" : longMomentum < -0.04 ? "downtrend" : Math.abs(shortMomentum) > 0.025 ? "choppy" : "flat";
  const volatility = vol > 0.055 ? "highVol" : vol < 0.018 ? "lowVol" : "midVol";
  const liquidity = spread > 0.09 || volume < 5 ? "thin" : "liquid";
  const timing = timeInMarket < 0.35 ? "early" : timeInMarket > 0.72 ? "late" : "mid";
  return `${priceBand}|${trend}|${volatility}|${liquidity}|${timing}`;
}

function trainModels(fit, validation, runOptions) {
  const pretrained = ridgeFit(fit.map((row) => row.vector), fit.map((row) => row.direction), 0.15);
  const online = { weights: new Array(pretrained.length).fill(0), rate: 0.045 };
  for (const row of fit) updateOnline(online, row, 0.8);

  const hybrid = { weights: pretrained.slice(), rate: 0.018 };
  const transformer = {
    memory: fit.map((row) => ({ vector: row.vector, direction: row.direction })),
    k: Math.max(9, Math.min(41, Math.round(Math.sqrt(fit.length)))),
  };
  const evolutionary = trainEvolutionary(fit, validation, pretrained.length, pretrained, runOptions);

  const models = {
    pretrained: { type: "linear", weights: pretrained },
    online,
    hybrid,
    transformer,
    evolutionary: { type: "linear", weights: evolutionary.weights },
  };

  const validationScores = {};
  for (const agent of BASE_AGENT_NAMES) {
    validationScores[agent] = scoreValidation(agent, models[agent], validation, runOptions);
  }
  models.swarm = {
    validationScores,
    qualities: Object.fromEntries(Object.entries(validationScores).map(([agent, score]) => [agent, Math.max(0.05, score.accuracy - 0.48 + Math.max(0, score.roi) * 2)])),
  };
  models.regimeAdaptive = trainRegimeRouter(validation.length ? validation : fit, models, runOptions);
  return models;
}

function trainRegimeRouter(rows) {
  const routeCounts = { swarm: 0, online: 0, evolutionary: 0 };
  const regimeCounts = new Map();
  for (const episode of rows) {
    const route = policyRouteForEpisode(episode);
    routeCounts[route.agent] = (routeCounts[route.agent] ?? 0) + 1;
    const regimeKey = episode.regimeKey ?? "unknown";
    regimeCounts.set(regimeKey, (regimeCounts.get(regimeKey) ?? 0) + 1);
  }
  return {
    policy: "conservative-specialist",
    defaultAgent: "swarm",
    routeCounts,
    regimesSeen: regimeCounts.size,
  };
}

function policyRouteForEpisode(episode) {
  const [priceBand = "balanced", trend = "flat", volatility = "midVol", liquidity = "liquid", timing = "mid"] = String(episode.regimeKey ?? "").split("|");
  const shortMove = (episode.vector?.[2] ?? 0) * 0.08;
  const longMove = (episode.vector?.[3] ?? 0) * 0.18;
  const signFlip = Math.sign(shortMove) !== 0 && Math.sign(longMove) !== 0 && Math.sign(shortMove) !== Math.sign(longMove);
  const localShock = Math.abs(shortMove) > 0.045 && Math.abs(shortMove) > Math.abs(longMove) * 0.75;
  const rapidShift = volatility === "highVol" && timing === "early" && (trend === "choppy" || signFlip || localShock);
  const efficient = liquidity === "liquid" && priceBand === "balanced" && trend === "flat" && volatility !== "highVol";
  const crowdedAlpha = liquidity === "liquid" && timing === "late" && priceBand !== "balanced" && ["flat", "choppy"].includes(trend) && volatility !== "highVol";

  if (rapidShift) {
    return {
      agent: "online",
      reason: "rapid shift",
    };
  }
  if (efficient || crowdedAlpha) {
    return {
      agent: "evolutionary",
      reason: efficient ? "efficient/noisy" : "crowded alpha",
    };
  }
  return {
    agent: "swarm",
    reason: "default diversified",
  };
}

function trainEvolutionary(fit, validation, dim, pretrained, runOptions) {
  const rand = rng(hashSeed(`evo:${fit.length}:${validation.length}:${fit.at(-1)?.marketTicker ?? ""}`));
  let population = [pretrained.slice(), new Array(dim).fill(0)];
  while (population.length < runOptions.population) {
    population.push(Array.from({ length: dim }, (_, i) => (i === 0 ? between(rand, -0.25, 0.25) : between(rand, -1.5, 1.5))));
  }
  for (let gen = 0; gen < runOptions.generations; gen += 1) {
    const ranked = population
      .map((weights) => ({ weights, score: scoreWeights(weights, validation.length ? validation : fit, runOptions) }))
      .sort((a, b) => b.score - a.score);
    const elites = ranked.slice(0, Math.max(4, Math.ceil(runOptions.population * 0.2))).map((row) => row.weights);
    const next = elites.map((row) => row.slice());
    while (next.length < runOptions.population) {
      const a = elites[Math.floor(rand() * elites.length)];
      const b = elites[Math.floor(rand() * elites.length)];
      next.push(a.map((value, i) => clamp((rand() < 0.5 ? value : b[i]) + normal(rand) * 0.22, -3, 3)));
    }
    population = next;
  }
  return population
    .map((weights) => ({ weights, score: scoreWeights(weights, validation.length ? validation : fit, runOptions) }))
    .sort((a, b) => b.score - a.score)[0];
}

function evaluate(test, models, runOptions) {
  const metrics = Object.fromEntries(AGENTS.map((agent) => [agent, emptyMetrics(agent)]));
  const trades = [];
  for (const episode of test) {
    const predictions = {};
    for (const agent of BASE_AGENT_NAMES) {
      predictions[agent] = predict(agent, models[agent], episode);
    }
    predictions.swarm = swarmPrediction(predictions, models.swarm);
    predictions.regimeAdaptive = regimeAdaptivePrediction(predictions, models.regimeAdaptive, episode);

    for (const agent of AGENTS) {
      const trade = applyTrade(agent, predictions[agent], episode, runOptions);
      record(metrics[agent], trade, predictions[agent], episode);
      if (trade) trades.push(trade);
    }

    updateOnline(models.online, episode, 1);
    updateOnline(models.hybrid, episode, 0.6);
    updateSwarmQualities(models.swarm, predictions, episode);
  }
  return { metrics, trades };
}

function regimeAdaptivePrediction(predictions, router, episode) {
  const route = policyRouteForEpisode(episode);
  const selectedAgent = route.agent ?? router.defaultAgent ?? "swarm";
  const selected = predictions[selectedAgent] ?? predictions.swarm ?? predictions.evolutionary ?? predictions.pretrained;
  return {
    ...selected,
    score: selected.score,
    selectedAgent,
    routeReason: route.reason,
    regimeKey: episode.regimeKey,
  };
}

function evaluateBaseline(test, side, runOptions) {
  const metric = emptyMetrics(`buy${side === "yes" ? "Yes" : "No"}`);
  const trades = [];
  for (const episode of test) {
    const prediction = { direction: side === "yes" ? 1 : -1, confidence: 1, score: side === "yes" ? 1 : -1 };
    const trade = applyTrade(metric.agent, prediction, episode, runOptions);
    record(metric, trade, prediction, episode);
    if (trade) trades.push(trade);
  }
  return { metric, trades };
}

function evaluateRandomBaseline(test, runOptions) {
  const metric = emptyMetrics("random");
  const trades = [];
  for (const episode of test) {
    const rand = rng(hashSeed(`random:${runOptions.source}:${runOptions.requireBinarySettlement}:${episode.marketTicker}`));
    const direction = rand() >= 0.5 ? 1 : -1;
    const prediction = { direction, confidence: 1, score: direction };
    const trade = applyTrade(metric.agent, prediction, episode, runOptions);
    record(metric, trade, prediction, episode);
    if (trade) trades.push(trade);
  }
  return { metric, trades };
}

function predict(agent, model, episode) {
  let score = 0;
  if (model.type === "linear") score = dot(model.weights, episode.vector);
  else if (agent === "transformer") score = transformerScore(model, episode.vector);
  else score = dot(model.weights, episode.vector);
  const direction = score >= 0 ? 1 : -1;
  const confidence = clamp(1 / (1 + Math.exp(-Math.abs(score))) - 0.5, 0, 0.5) * 2;
  return { direction, confidence, score };
}

function transformerScore(model, vector) {
  const neighbors = model.memory
    .map((row) => ({ direction: row.direction, dist: euclidean(row.vector, vector) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, model.k);
  let num = 0;
  let den = 0;
  for (const row of neighbors) {
    const weight = 1 / Math.max(0.05, row.dist);
    num += row.direction * weight;
    den += weight;
  }
  return den ? num / den : 0;
}

function swarmPrediction(predictions, swarm) {
  let vote = 0;
  let total = 0;
  for (const [agent, prediction] of Object.entries(predictions)) {
    const quality = swarm.qualities[agent] ?? 0.1;
    const weight = quality * Math.max(0.15, prediction.confidence);
    vote += prediction.direction * weight;
    total += weight;
  }
  const score = total ? vote / total : 0;
  return { direction: score >= 0 ? 1 : -1, confidence: Math.abs(score), score };
}

function updateSwarmQualities(swarm, predictions, episode) {
  for (const [agent, prediction] of Object.entries(predictions)) {
    if (!(agent in swarm.qualities)) continue;
    const correct = prediction.direction === episode.direction ? 1 : 0;
    swarm.qualities[agent] = clamp(0.96 * swarm.qualities[agent] + 0.04 * (0.05 + correct), 0.03, 1.5);
  }
}

function applyTrade(agent, prediction, episode, runOptions) {
  if (prediction.confidence < runOptions.minConfidence) return null;
  const side = prediction.direction > 0 ? "yes" : "no";
  const entryPrice = side === "yes" ? episode.yesAsk : episode.noAsk;
  if (entryPrice == null || entryPrice <= 0.01 || entryPrice >= 0.99) return null;
  const settlement = side === "yes" ? episode.settlementYes : 1 - episode.settlementYes;
  const contracts = runOptions.notionalUsd / entryPrice;
  const fee = runOptions.notionalUsd * runOptions.feeRate;
  const pnlUsd = contracts * (settlement - entryPrice) - fee;
  return {
    agent,
    marketTicker: episode.marketTicker,
    timestamp: iso(episode.ts),
    side,
    confidence: prediction.confidence,
    score: prediction.score,
    selectedAgent: prediction.selectedAgent ?? "",
    routeReason: prediction.routeReason ?? "",
    regimeKey: prediction.regimeKey ?? episode.regimeKey ?? "",
    entryPrice,
    settlement,
    contracts,
    notionalUsd: runOptions.notionalUsd,
    pnlUsd,
    correct: prediction.direction === episode.direction,
    ambiguousSettlement: episode.ambiguousSettlement,
  };
}

function record(metric, trade, prediction, episode) {
  metric.predictions += 1;
  if (prediction.direction === episode.direction) metric.correct += 1;
  if (!trade) {
    metric.periodReturns.push(0);
    metric.equity.push(metric.pnlUsd);
    return;
  }
  const tradeReturn = trade.pnlUsd / Math.max(1e-9, trade.notionalUsd);
  metric.trades += 1;
  metric.pnlUsd += trade.pnlUsd;
  metric.notionalUsd += trade.notionalUsd;
  metric.wins += trade.pnlUsd > 0 ? 1 : 0;
  metric.losses += trade.pnlUsd < 0 ? 1 : 0;
  metric.returns.push(tradeReturn);
  metric.periodReturns.push(tradeReturn);
  metric.equity.push(metric.pnlUsd);
}

function finalize(metric) {
  const peakSeries = [];
  let peak = 0;
  let drawdown = 0;
  for (const value of metric.equity) {
    peak = Math.max(peak, value);
    peakSeries.push(peak);
    drawdown = Math.max(drawdown, peak - value);
  }
  metric.accuracy = metric.predictions ? metric.correct / metric.predictions : null;
  metric.winRate = metric.wins + metric.losses ? metric.wins / (metric.wins + metric.losses) : null;
  metric.roi = metric.notionalUsd ? metric.pnlUsd / metric.notionalUsd : 0;
  metric.maxDrawdownUsd = drawdown;
  metric.sharpe = sharpe(metric.returns);
  delete metric.returns;
  delete metric.equity;
  return metric;
}

function attachAlphaBeta(metrics) {
  for (const metric of Object.values(metrics)) {
    metric.alphaBeta = {};
    for (const benchmarkName of BENCHMARKS) {
      const benchmark = metrics[benchmarkName];
      metric.alphaBeta[benchmarkName] = regressionStats(metric.periodReturns ?? [], benchmark?.periodReturns ?? []);
    }
  }
}

function stripInternalSeries(metrics) {
  for (const metric of Object.values(metrics)) {
    delete metric.periodReturns;
  }
}

function regressionStats(agentReturns, benchmarkReturns) {
  const n = Math.min(agentReturns.length, benchmarkReturns.length);
  if (n < 2) {
    return {
      alphaPerMarket: 0,
      beta: 0,
      correlation: 0,
      rSquared: 0,
      activeReturnPerMarket: 0,
      observations: n,
    };
  }
  const y = agentReturns.slice(0, n);
  const x = benchmarkReturns.slice(0, n);
  const meanY = mean(y);
  const meanX = mean(x);
  let cov = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }
  const beta = varX > 1e-12 ? cov / varX : 0;
  const alphaPerMarket = meanY - beta * meanX;
  const correlation = varX > 1e-12 && varY > 1e-12 ? cov / Math.sqrt(varX * varY) : 0;
  return {
    alphaPerMarket,
    beta,
    correlation,
    rSquared: correlation ** 2,
    activeReturnPerMarket: meanY - meanX,
    observations: n,
  };
}

function emptyMetrics(agent) {
  return {
    agent,
    predictions: 0,
    correct: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    pnlUsd: 0,
    notionalUsd: 0,
    roi: 0,
    winRate: null,
    accuracy: null,
    sharpe: 0,
    maxDrawdownUsd: 0,
    returns: [],
    periodReturns: [],
    equity: [0],
  };
}

function scoreValidation(agent, model, validation, runOptions) {
  const metric = emptyMetrics(agent);
  for (const episode of validation) {
    const prediction = predict(agent, model, episode);
    record(metric, applyTrade(agent, prediction, episode, runOptions), prediction, episode);
  }
  return finalize(metric);
}

function scoreWeights(weights, rows, runOptions) {
  const metric = emptyMetrics("weights");
  for (const episode of rows) {
    const score = dot(weights, episode.vector);
    const prediction = {
      direction: score >= 0 ? 1 : -1,
      confidence: clamp(Math.abs(score), 0, 1),
      score,
    };
    record(metric, applyTrade("weights", prediction, episode, runOptions), prediction, episode);
  }
  finalize(metric);
  return metric.pnlUsd - metric.maxDrawdownUsd * 0.6 + metric.accuracy * 2;
}

function updateOnline(model, episode, scale) {
  const score = dot(model.weights, episode.vector);
  const margin = episode.direction * score;
  const step = model.rate * scale * clamp(1 - margin, -1, 1);
  for (let i = 0; i < model.weights.length; i += 1) {
    model.weights[i] = clamp(model.weights[i] + step * episode.direction * episode.vector[i], -3, 3);
  }
}

function ridgeFit(xs, ys, lambda) {
  const dim = xs[0]?.length ?? 0;
  const xtx = Array.from({ length: dim }, () => new Array(dim).fill(0));
  const xty = new Array(dim).fill(0);
  for (let i = 0; i < xs.length; i += 1) {
    for (let a = 0; a < dim; a += 1) {
      xty[a] += xs[i][a] * ys[i];
      for (let b = 0; b < dim; b += 1) xtx[a][b] += xs[i][a] * xs[i][b];
    }
  }
  for (let i = 0; i < dim; i += 1) xtx[i][i] += lambda;
  return solveLinear(xtx, xty).map((v) => clamp(v, -3, 3));
}

function solveLinear(a, b) {
  const n = b.length;
  const m = a.map((row, i) => row.concat(b[i]));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-10) return new Array(n).fill(0);
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let j = col; j <= n; j += 1) m[col][j] /= div;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j <= n; j += 1) m[row][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

function yesAsk(row) {
  return number(row.yesAsk?.close ?? row.price?.close);
}

function yesBid(row) {
  return number(row.yesBid?.close ?? row.price?.close);
}

function yesMid(row) {
  const bid = number(row.yesBid?.close);
  const ask = number(row.yesAsk?.close);
  const price = number(row.price?.close ?? row.price?.mean);
  if (bid != null && ask != null) return clamp((bid + ask) / 2, 0, 1);
  return price == null ? null : clamp(price, 0, 1);
}

function inferYesSettlement(row) {
  if (!row) return null;
  const bid = number(row.yesBid?.close);
  const ask = number(row.yesAsk?.close);
  const price = number(row.price?.close ?? row.price?.mean);
  const mid = yesMid(row);
  if (bid != null && bid >= 0.95) return { yesWin: true, ambiguous: false };
  if (ask != null && ask <= 0.05) return { yesWin: false, ambiguous: false };
  if (price != null && price >= 0.85) return { yesWin: true, ambiguous: false };
  if (price != null && price <= 0.15) return { yesWin: false, ambiguous: false };
  if (mid == null) return null;
  return { yesWin: mid >= 0.5, ambiguous: true };
}

function modelNotes(models, runOptions) {
  return {
    pretrained: "Ridge linear classifier on the earliest fit markets; frozen during test.",
    online: "Starts from zero weights, warms through fit markets, then updates after each test market outcome.",
    hybrid: "Starts from pretrained weights and updates more slowly after each test market outcome.",
    transformer: `Nearest-neighbor sequence-memory vote over ${models.transformer.memory.length} fit windows with k=${models.transformer.k}.`,
    evolutionary: `Population search over simple linear policies, ${runOptions.population} candidates for ${runOptions.generations} generations, selected on validation markets.`,
    swarm: "Weighted vote over pretrained, online, hybrid, transformer-lite, and evolutionary members; weights start from validation quality and update with test correctness.",
    regimeAdaptive: `Conservative policy router over ${models.regimeAdaptive.regimesSeen} observed validation regimes. Defaults to swarm, routes to online/RL for rapid-shift high-volatility regimes, and routes to evolution only for efficient/noisy or crowded-alpha proxies. Validation route counts: swarm=${models.regimeAdaptive.routeCounts.swarm}, online=${models.regimeAdaptive.routeCounts.online}, evolution=${models.regimeAdaptive.routeCounts.evolutionary}.`,
  };
}

function tradesCsv(trades) {
  const header = [
    "agent",
    "marketTicker",
    "timestamp",
    "side",
    "confidence",
    "score",
    "selectedAgent",
    "routeReason",
    "regimeKey",
    "entryPrice",
    "settlement",
    "contracts",
    "notionalUsd",
    "pnlUsd",
    "correct",
    "ambiguousSettlement",
  ];
  const rows = trades.map((trade) => header.map((key) => csvCell(trade[key])).join(","));
  return `${header.join(",")}\n${rows.join("\n")}\n`;
}

function parseArgs(args) {
  const out = {
    maxMarkets: 1200,
    minCandles: 8,
    lookback: 4,
    notionalUsd: 10,
    feeRate: 0.003,
    minConfidence: 0.18,
    requireBinarySettlement: false,
    matrix: false,
    source: "historical",
    testStart: "",
    testEnd: "",
    warmup: 200,
    fitPct: 0.6,
    validationPct: 0.2,
    population: 80,
    generations: 10,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const [key, inlineValue] = arg.startsWith("--") ? arg.slice(2).split("=") : [null, null];
    if (!key) continue;
    const value = inlineValue ?? args[i + 1];
    if (inlineValue == null) i += 1;
    if (key === "all") {
      out.maxMarkets = 0;
      i -= inlineValue == null ? 1 : 0;
      continue;
    }
    if (key === "requireBinarySettlement" || key === "require-binary-settlement" || key === "require-binary") {
      out.requireBinarySettlement = true;
      i -= inlineValue == null ? 1 : 0;
      continue;
    }
    if (key === "matrix") {
      out.matrix = true;
      i -= inlineValue == null ? 1 : 0;
      continue;
    }
    if (key === "source") {
      out.source = SOURCE_MODES.includes(value) ? value : "historical";
      continue;
    }
    if (key === "testStart" || key === "test-start") {
      out.testStart = String(value ?? "");
      continue;
    }
    if (key === "testEnd" || key === "test-end") {
      out.testEnd = String(value ?? "");
      continue;
    }
    if (key in out) out[key] = Number(value);
  }
  out.lookback = Math.max(2, Math.round(out.lookback));
  out.minCandles = Math.max(out.lookback + 2, Math.round(out.minCandles));
  out.maxMarkets = Math.max(0, Math.round(out.maxMarkets));
  out.population = Math.max(12, Math.round(out.population));
  out.generations = Math.max(1, Math.round(out.generations));
  out.warmup = Math.max(30, Math.round(out.warmup));
  return out;
}

function number(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += (a[i] || 0) * (b[i] || 0);
  return total;
}

function euclidean(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += ((a[i] || 0) - (b[i] || 0)) ** 2;
  return Math.sqrt(total);
}

function sum(values) {
  return values.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
}

function mean(values) {
  return values.length ? sum(values) / values.length : 0;
}

function std(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

function sharpe(values) {
  const s = std(values);
  return s ? (mean(values) / s) * Math.sqrt(365 * 24 * 4) : 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function between(rand, lo, hi) {
  return lo + (hi - lo) * rand();
}

function normal(rand) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(raw) {
  let h = 2166136261;
  for (let i = 0; i < String(raw).length; i += 1) {
    h ^= String(raw).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function iso(ts) {
  return ts ? new Date(ts * 1000).toISOString() : null;
}

function csvCell(value) {
  const raw = String(value ?? "");
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

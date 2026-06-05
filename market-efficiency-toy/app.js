"use strict";

const COLORS = {
  passive: "#9aa8b4",
  random: "#ff718d",
  oracle: "#f2c75c",
  pretrained: "#74a7ff",
  online: "#2ed09c",
  hybrid: "#a58cff",
  evolutionary: "#56cfe8",
  predRandom: "#ff718d",
  predOracle: "#f2c75c",
  predPretrained: "#74a7ff",
  predOnline: "#2ed09c",
  predHybrid: "#a58cff",
  predTransformer: "#f5a25d",
  predEvolutionary: "#56cfe8",
  predSwarm: "#eef4f8",
  price: "#eef4f8",
  alpha: "#f5a25d",
};

const PRESETS = {
  efficient: {
    label: "Efficient null",
    mode: "efficient",
    lambda: 1,
    noise: 0.018,
    transactionCost: 0.0015,
    marketImpact: 0.001,
    alphaPersistence: 0.96,
    regimeShift: 0.02,
    crowdingDecay: 0,
    trainSize: 900,
    testSize: 260,
    seed: 7,
  },
  unlearnable: {
    label: "Inefficient, unlearnable",
    mode: "unlearnable",
    lambda: 0.15,
    noise: 0.017,
    transactionCost: 0.0015,
    marketImpact: 0.001,
    alphaPersistence: 0.95,
    regimeShift: 0.025,
    crowdingDecay: 0,
    trainSize: 900,
    testSize: 260,
    seed: 11,
  },
  historical: {
    label: "Historically learnable",
    mode: "historical",
    lambda: 0.1,
    noise: 0.016,
    transactionCost: 0.0013,
    marketImpact: 0.0008,
    alphaPersistence: 0.99,
    regimeShift: 0.005,
    crowdingDecay: 0,
    trainSize: 1100,
    testSize: 280,
    seed: 19,
  },
  local: {
    label: "Locally learnable",
    mode: "local",
    lambda: 0.12,
    noise: 0.016,
    transactionCost: 0.0013,
    marketImpact: 0.0008,
    alphaPersistence: 0.965,
    regimeShift: 0.035,
    crowdingDecay: 0.1,
    trainSize: 820,
    testSize: 320,
    seed: 23,
  },
  rapid: {
    label: "Rapidly shifting",
    mode: "rapid",
    lambda: 0.08,
    noise: 0.017,
    transactionCost: 0.0014,
    marketImpact: 0.001,
    alphaPersistence: 0.55,
    regimeShift: 0.18,
    crowdingDecay: 0.12,
    trainSize: 720,
    testSize: 320,
    seed: 31,
  },
  crowded: {
    label: "Crowded/adaptive",
    mode: "crowded",
    lambda: 0.08,
    noise: 0.016,
    transactionCost: 0.0015,
    marketImpact: 0.0013,
    alphaPersistence: 0.93,
    regimeShift: 0.04,
    crowdingDecay: 0.75,
    trainSize: 980,
    testSize: 300,
    seed: 43,
  },
};

const RANGE_CONTROLS = [
  ["lambda", "Market efficiency lambda", 0, 1, 0.01],
  ["noise", "Noise / volatility", 0.004, 0.045, 0.001],
  ["transactionCost", "Transaction cost", 0, 0.01, 0.0001],
  ["marketImpact", "Market impact", 0, 0.012, 0.0001],
  ["alphaPersistence", "Alpha persistence", 0, 0.995, 0.005],
  ["regimeShift", "Regime shift speed", 0, 0.25, 0.005],
  ["crowdingDecay", "Crowding decay", 0, 1, 0.01],
  ["trainSize", "Pre-test history periods", 80, 2400, 10],
  ["testSize", "Test periods", 80, 700, 10],
  ["seed", "Seed", 1, 999, 1],
];

const PREDICTION_RANGE_CONTROLS = [
  ["predictionLookback", "Past window length", 8, 80, 1],
  ["predictionHorizon", "Prediction horizon", 1, 24, 1],
  ["predictionGenerations", "Evolution generations", 1, 24, 1],
  ["predictionSwarmSize", "Swarm population", 12, 180, 4],
];

const AGENTS = [
  ["passive", "Passive cash", "No market timing"],
  ["random", "Random policy", "Null behavior"],
  ["oracle", "Oracle", "Knows latent alpha"],
  ["pretrained", "Pretrained", "Historical estimator"],
  ["online", "Online/post-trained", "Learns current market"],
  ["hybrid", "Pretrained + online", "Historical prior plus adaptation"],
  ["evolutionary", "Evolutionary search", "Validation-selected signal weights"],
];

const PREDICTION_AGENTS = [
  ["predRandom", "Random", "Null direction guesses"],
  ["predOracle", "Future-label oracle", "Privileged upper bound"],
  ["predPretrained", "Pretrained", "Frozen historical predictor"],
  ["predOnline", "RL online", "Updates after each revealed future"],
  ["predHybrid", "Pre + post-trained", "Historical prior plus online updates"],
  ["predTransformer", "Transformer-lite", "Attention over similar past windows"],
  ["predEvolutionary", "Evolution swarm", "Fast validation-selected population"],
  ["predSwarm", "Weighted agent swarm", "Votes by recent prediction quality"],
];

const state = {
  ...PRESETS.efficient,
  predictionLookback: 24,
  predictionHorizon: 4,
  predictionGenerations: 8,
  predictionSwarmSize: 64,
  showOracle: true,
  useCosts: true,
  nullShuffle: false,
  manySeeds: false,
};

const el = {};
let latestResult = null;
let toastTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  buildPresetButtons();
  buildRangeControls();
  buildPredictionRangeControls();
  bindControls();
  applyUrlParams();
  render();
});

function cacheElements() {
  for (const id of [
    "presetGrid",
    "resetPreset",
    "mode",
    "rangeControls",
    "predictionRangeControls",
    "showOracle",
    "useCosts",
    "nullShuffle",
    "manySeeds",
    "downloadCsv",
    "downloadPredictionCsv",
    "copyUrl",
    "regimeTitle",
    "topMetrics",
    "diagnostics",
    "marketChart",
    "equityChart",
    "resultsBody",
    "predictionInsights",
    "predictionEquityChart",
    "predictionAccuracyChart",
    "predictionSeedPnlChart",
    "predictionSeedAccuracyChart",
    "predictionSeedSharpeChart",
    "predictionOracleGapChart",
    "predictionCalibrationChart",
    "predictionDirectionBalanceChart",
    "predictionResultsBody",
    "tableCaption",
    "tradablePill",
    "toast",
  ]) {
    el[id] = document.getElementById(id);
  }
}

function buildPresetButtons() {
  el.presetGrid.innerHTML = "";
  for (const [key, preset] of Object.entries(PRESETS)) {
    const button = document.createElement("button");
    button.className = "preset-button";
    button.type = "button";
    button.dataset.preset = key;
    button.textContent = preset.label;
    button.addEventListener("click", () => {
      Object.assign(state, preset);
      syncControls();
      render();
    });
    el.presetGrid.appendChild(button);
  }
}

function buildRangeControls() {
  el.rangeControls.innerHTML = "";
  for (const [key, label, min, max, step] of RANGE_CONTROLS) {
    const field = document.createElement("label");
    field.className = "field";
    field.innerHTML = `
      <div class="range-head">
        <span>${label}</span>
        <strong id="${key}Value"></strong>
      </div>
      <input id="${key}" type="range" min="${min}" max="${max}" step="${step}" />
    `;
    el.rangeControls.appendChild(field);
    el[key] = field.querySelector("input");
    el[`${key}Value`] = field.querySelector("strong");
  }
}

function buildPredictionRangeControls() {
  el.predictionRangeControls.innerHTML = "";
  for (const [key, label, min, max, step] of PREDICTION_RANGE_CONTROLS) {
    const field = document.createElement("label");
    field.className = "field";
    field.innerHTML = `
      <div class="range-head">
        <span>${label}</span>
        <strong id="${key}Value"></strong>
      </div>
      <input id="${key}" type="range" min="${min}" max="${max}" step="${step}" />
    `;
    el.predictionRangeControls.appendChild(field);
    el[key] = field.querySelector("input");
    el[`${key}Value`] = field.querySelector("strong");
  }
}

function bindControls() {
  el.resetPreset.addEventListener("click", () => {
    Object.assign(state, PRESETS[state.mode] || PRESETS.efficient);
    syncControls();
    render();
  });

  el.mode.addEventListener("change", () => {
    state.mode = el.mode.value;
    render();
  });

  for (const [key] of RANGE_CONTROLS) {
    el[key].addEventListener("input", () => {
      state[key] = Number(el[key].value);
      render();
    });
  }

  for (const [key] of PREDICTION_RANGE_CONTROLS) {
    el[key].addEventListener("input", () => {
      state[key] = Number(el[key].value);
      render();
    });
  }

  for (const key of ["showOracle", "useCosts", "nullShuffle", "manySeeds"]) {
    el[key].addEventListener("change", () => {
      state[key] = el[key].checked;
      render();
    });
  }

  el.downloadCsv.addEventListener("click", downloadCsv);
  el.downloadPredictionCsv.addEventListener("click", downloadPredictionCsv);
  el.copyUrl.addEventListener("click", copyShareUrl);

  window.addEventListener("resize", () => {
    if (latestResult) {
      drawMarketChart(latestResult.chartRun);
      drawEquityChart(latestResult.chartRun, latestResult.visibleAgents);
      drawPredictionEquityChart(latestResult.prediction);
      drawPredictionAccuracyChart(latestResult.prediction);
      drawPredictionAnalyticsCharts(latestResult.prediction);
    }
  });
}

function applyUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.has("mode")) {
    const mode = params.get("mode");
    Object.assign(state, PRESETS[mode] || PRESETS.efficient);
    state.mode = mode;
  }
  for (const [key] of RANGE_CONTROLS) {
    if (params.has(key)) state[key] = Number(params.get(key));
  }
  for (const [key] of PREDICTION_RANGE_CONTROLS) {
    if (params.has(key)) state[key] = Number(params.get(key));
  }
  for (const key of ["showOracle", "useCosts", "nullShuffle", "manySeeds"]) {
    if (params.has(key)) state[key] = params.get(key) === "1";
  }
  syncControls();
}

function syncControls() {
  el.mode.value = state.mode;
  for (const [key] of RANGE_CONTROLS) {
    el[key].value = state[key];
    el[`${key}Value`].textContent = formatControlValue(key, state[key]);
  }
  for (const [key] of PREDICTION_RANGE_CONTROLS) {
    el[key].value = state[key];
    el[`${key}Value`].textContent = formatControlValue(key, state[key]);
  }
  for (const key of ["showOracle", "useCosts", "nullShuffle", "manySeeds"]) {
    el[key].checked = Boolean(state[key]);
  }
}

function render() {
  syncControls();
  const result = runExperiment(state);
  result.prediction = runPredictionArena(state);
  latestResult = result;
  renderShell(result);
  renderDiagnostics(result);
  renderResultsTable(result.metrics, result.visibleAgents);
  renderPredictionArena(result.prediction);
  drawMarketChart(result.chartRun);
  drawEquityChart(result.chartRun, result.visibleAgents);
  drawPredictionEquityChart(result.prediction);
  drawPredictionAccuracyChart(result.prediction);
  drawPredictionAnalyticsCharts(result.prediction);
  updatePresetActive();
  updateUrlSilently();
}

function runExperiment(config) {
  const runs = [];
  const runCount = config.manySeeds ? 24 : 1;
  for (let i = 0; i < runCount; i += 1) {
    const seed = Math.round(config.seed) + i * 101;
    runs.push(runOneSeed({ ...config, seed }));
  }

  const averaged = averageMetrics(runs.map((run) => run.metrics));
  const chartRun = runs[0];
  const visibleAgents = config.showOracle
    ? AGENTS.map(([key]) => key)
    : AGENTS.map(([key]) => key).filter((key) => key !== "oracle");

  return {
    chartRun,
    metrics: averaged,
    visibleAgents,
    runCount,
    config,
    diagnostics: diagnose(averaged, config),
  };
}

function runOneSeed(config) {
  const market = simulateMarket(config);
  const testReturns = config.nullShuffle
    ? shuffleArray(market.returns.slice(market.trainSize), rng(hashSeed(`shuffle-${config.seed}`)))
    : market.returns.slice(market.trainSize);

  const adjustedMarket = {
    ...market,
    testReturns,
  };

  const policies = buildPolicies(adjustedMarket, config);
  const metrics = {};
  for (const [key] of AGENTS) {
    metrics[key] = evaluatePolicy(key, policies[key], adjustedMarket, config);
  }

  return {
    market: adjustedMarket,
    metrics,
    policies,
  };
}

function simulateMarket(config) {
  const trainSize = Math.round(config.trainSize);
  const testSize = Math.round(config.testSize);
  const total = trainSize + testSize;
  const rand = rng(hashSeed(`market-${config.seed}-${config.mode}`));
  const features = [];
  const hidden = [];
  const alpha = [];
  const returns = [];
  const price = [100];
  const fundamental = [100];
  let priorReturn = 0;
  let newsLag = 0;
  let hiddenLag = 0;
  let theta = initialTheta(config.mode, rand);
  let hiddenTheta = between(rand, -0.012, 0.012);
  const baseTheta = theta.slice();

  for (let t = 0; t < total; t += 1) {
    const phase = t < trainSize ? "train" : "test";
    const progress = phase === "test" ? (t - trainSize) / Math.max(1, testSize - 1) : 0;
    const shock = normal(rand);
    const fundamentalShock = 0.00015 + 0.004 * normal(rand);
    const lastPrice = price[price.length - 1];
    const lastFundamental = fundamental[fundamental.length - 1] * Math.exp(fundamentalShock);
    fundamental.push(lastFundamental);

    newsLag = 0.82 * newsLag + 0.45 * shock + 0.16 * normal(rand);
    hiddenLag = 0.76 * hiddenLag + normal(rand);
    const valuationGap = clamp((lastFundamental - lastPrice) / lastPrice, -0.18, 0.18);
    const x = [
      clamp(priorReturn / 0.025, -2.5, 2.5),
      clamp(valuationGap / 0.06, -2.5, 2.5),
      clamp(newsLag, -2.5, 2.5),
    ];
    features.push(x);
    hidden.push(hiddenLag);

    theta = updateTheta(theta, baseTheta, config, phase, progress, rand);
    hiddenTheta = 0.97 * hiddenTheta + config.regimeShift * 0.004 * normal(rand);

    let rawAlpha = dot(theta, x);
    if (config.mode === "efficient") rawAlpha = 0;
    if (config.mode === "unlearnable") rawAlpha = hiddenTheta * clamp(hiddenLag, -2.5, 2.5);
    rawAlpha = clamp(rawAlpha, -0.045, 0.045);

    const expressedAlpha = (1 - config.lambda) * rawAlpha;
    const r = clamp(0.00005 + expressedAlpha + config.noise * normal(rand), -0.16, 0.16);
    returns.push(r);
    priorReturn = r;
    price.push(Math.max(1, lastPrice * Math.exp(r)));
    alpha.push(expressedAlpha);
  }

  return {
    trainSize,
    testSize,
    total,
    features,
    hidden,
    alpha,
    returns,
    price: price.slice(1),
    fundamental: fundamental.slice(1),
  };
}

function initialTheta(mode, rand) {
  if (mode === "efficient") return [0, 0, 0];
  if (mode === "unlearnable") return [0, 0, 0];
  if (mode === "historical") return [0.009, 0.012, 0.006];
  if (mode === "local") return [0.004, 0.01, 0.01];
  if (mode === "rapid") return [0.012, -0.008, 0.01];
  if (mode === "crowded") return [0.011, 0.004, 0.009];
  return [between(rand, -0.01, 0.01), between(rand, -0.01, 0.01), between(rand, -0.01, 0.01)];
}

function updateTheta(theta, baseTheta, config, phase, progress, rand) {
  if (config.mode === "efficient" || config.mode === "unlearnable") return [0, 0, 0];
  if (config.mode === "historical") return baseTheta.slice();

  const noiseScale = config.regimeShift * 0.012;
  let next = theta.map((v, i) => config.alphaPersistence * v + (1 - config.alphaPersistence) * baseTheta[i] + noiseScale * normal(rand));

  if (config.mode === "rapid") {
    next = theta.map((v) => config.alphaPersistence * v + config.regimeShift * 0.028 * normal(rand));
  }

  if (config.mode === "crowded" && phase === "test") {
    const decay = config.crowdingDecay * progress;
    const anti = [-baseTheta[0] * 0.65, baseTheta[1] * 0.35, -baseTheta[2] * 0.45];
    next = baseTheta.map((v, i) => (1 - decay) * v + decay * anti[i] + noiseScale * normal(rand));
  }

  return next.map((v) => clamp(v, -0.03, 0.03));
}

function buildPolicies(market, config) {
  const trainFeatures = market.features.slice(0, market.trainSize);
  const trainReturns = market.returns.slice(0, market.trainSize);
  const split = Math.max(40, Math.floor(market.trainSize * 0.72));
  const fitFeatures = trainFeatures.slice(0, split);
  const fitReturns = trainReturns.slice(0, split);
  const validationFeatures = trainFeatures.slice(split);
  const validationReturns = trainReturns.slice(split);

  const pretrainedTheta = ridgeFit(fitFeatures, fitReturns, 0.02);
  const evolutionaryTheta = selectEvolutionaryWeights(
    fitFeatures,
    fitReturns,
    validationFeatures,
    validationReturns,
    config,
  );

  return {
    passive: { type: "fixed", theta: [0, 0, 0], random: false },
    random: { type: "random" },
    oracle: { type: "oracle" },
    pretrained: { type: "fixed", theta: pretrainedTheta },
    online: { type: "online", theta: [0, 0, 0], rate: 0.045 },
    hybrid: { type: "online", theta: pretrainedTheta.slice(), rate: 0.026 },
    evolutionary: { type: "fixed", theta: evolutionaryTheta },
  };
}

function ridgeFit(xs, ys, lambda) {
  const n = xs.length;
  if (!n) return [0, 0, 0];
  const xtx = [
    [lambda, 0, 0],
    [0, lambda, 0],
    [0, 0, lambda],
  ];
  const xty = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const x = xs[i];
    const y = ys[i];
    for (let a = 0; a < 3; a += 1) {
      xty[a] += x[a] * y;
      for (let b = 0; b < 3; b += 1) xtx[a][b] += x[a] * x[b];
    }
  }
  return solve3(xtx, xty).map((v) => clamp(v, -0.035, 0.035));
}

function solve3(a, b) {
  const m = a.map((row, i) => row.concat(b[i]));
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return [0, 0, 0];
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let j = col; j < 4; j += 1) m[col][j] /= div;
    for (let row = 0; row < 3; row += 1) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j < 4; j += 1) m[row][j] -= factor * m[col][j];
    }
  }
  return [m[0][3], m[1][3], m[2][3]];
}

function selectEvolutionaryWeights(fitX, fitY, valX, valY, config) {
  const rand = rng(hashSeed(`evo-${config.seed}-${config.mode}`));
  let population = [];
  for (let i = 0; i < 80; i += 1) {
    population.push([
      between(rand, -0.02, 0.02),
      between(rand, -0.02, 0.02),
      between(rand, -0.02, 0.02),
    ]);
  }
  const historical = ridgeFit(fitX, fitY, 0.02);
  population.push(historical);

  for (let generation = 0; generation < 4; generation += 1) {
    const scored = population
      .map((theta) => ({ theta, score: policyScore(theta, valX, valY, config) }))
      .sort((a, b) => b.score - a.score);
    const elites = scored.slice(0, 12).map((item) => item.theta);
    const next = elites.slice();
    while (next.length < 80) {
      const a = elites[Math.floor(rand() * elites.length)];
      const b = elites[Math.floor(rand() * elites.length)];
      next.push(a.map((v, i) => clamp((v + b[i]) / 2 + normal(rand) * 0.004, -0.035, 0.035)));
    }
    population = next;
  }

  return population
    .map((theta) => ({ theta, score: policyScore(theta, valX, valY, config) }))
    .sort((a, b) => b.score - a.score)[0].theta;
}

function policyScore(theta, xs, ys, config) {
  let pnl = 0;
  let prev = 0;
  let riskPenalty = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const pos = positionFromSignal(dot(theta, xs[i]), config.noise);
    const turnover = Math.abs(pos - prev);
    pnl += pos * ys[i] - turnover * config.transactionCost - turnover * config.marketImpact;
    riskPenalty += pos * pos * 0.0001;
    prev = pos;
  }
  return pnl - riskPenalty;
}

function evaluatePolicy(agentKey, policy, market, config) {
  const useCosts = config.useCosts;
  const rand = rng(hashSeed(`agent-${agentKey}-${config.seed}`));
  const returns = [];
  const equity = [1];
  const positions = [];
  const estimates = [];
  let theta = policy.theta ? policy.theta.slice() : [0, 0, 0];
  let prevPosition = 0;
  let turnover = 0;
  let costsPaid = 0;
  let peak = 1;
  let maxDrawdown = 0;
  const start = market.trainSize;

  for (let i = 0; i < market.testSize; i += 1) {
    const t = start + i;
    const x = market.features[t];
    const realizedReturn = market.testReturns[i];
    const trueAlpha = market.alpha[t];
    let estimate = 0;
    let position = 0;

    if (policy.type === "oracle") {
      estimate = trueAlpha;
      position = Math.abs(trueAlpha) < 1e-9 ? 0 : Math.sign(trueAlpha);
    } else if (policy.type === "random") {
      estimate = 0;
      position = rand() < 0.34 ? -0.7 : rand() < 0.68 ? 0 : 0.7;
    } else {
      estimate = dot(theta, x);
      position = positionFromSignal(estimate, config.noise);
    }

    const trade = Math.abs(position - prevPosition);
    const cost = useCosts && policy.type !== "oracle" ? trade * config.transactionCost + trade * config.marketImpact : 0;
    const net = position * realizedReturn - cost;
    returns.push(net);
    positions.push(position);
    estimates.push(estimate);
    turnover += trade;
    costsPaid += cost;
    const nextEquity = Math.max(0.02, equity[equity.length - 1] * (1 + net));
    equity.push(nextEquity);
    peak = Math.max(peak, nextEquity);
    maxDrawdown = Math.max(maxDrawdown, (peak - nextEquity) / peak);

    if (policy.type === "online") {
      const error = realizedReturn - estimate;
      const denom = 1 + dot(x, x);
      theta = theta.map((v, k) => clamp(v + policy.rate * error * x[k] / denom, -0.035, 0.035));
    }

    prevPosition = position;
  }

  const pnl = equity[equity.length - 1] - 1;
  const sharpe = annualizedSharpe(returns);
  const alphaError = Math.sqrt(
    estimates.reduce((sum, estimate, i) => {
      const trueAlpha = market.alpha[start + i];
      return sum + (estimate - trueAlpha) * (estimate - trueAlpha);
    }, 0) / Math.max(1, estimates.length),
  );

  return {
    agentKey,
    pnl,
    sharpe,
    maxDrawdown,
    turnover,
    costsPaid,
    alphaError,
    equity,
    positions,
    estimates,
    oracleCapture: 0,
  };
}

function averageMetrics(metricsList) {
  const out = {};
  for (const [key] of AGENTS) {
    const rows = metricsList.map((m) => m[key]);
    const avg = {
      agentKey: key,
      pnl: mean(rows.map((r) => r.pnl)),
      sharpe: mean(rows.map((r) => r.sharpe)),
      maxDrawdown: mean(rows.map((r) => r.maxDrawdown)),
      turnover: mean(rows.map((r) => r.turnover)),
      costsPaid: mean(rows.map((r) => r.costsPaid)),
      alphaError: mean(rows.map((r) => r.alphaError)),
      equity: rows[0].equity,
      positions: rows[0].positions,
      estimates: rows[0].estimates,
      oracleCapture: 0,
    };
    out[key] = avg;
  }
  const oraclePnl = Math.max(0, out.oracle.pnl);
  for (const key of Object.keys(out)) {
    out[key].oracleCapture = oraclePnl > 1e-9 ? out[key].pnl / oraclePnl : 0;
  }
  return out;
}

function diagnose(metrics, config) {
  const nonOracle = Object.values(metrics).filter((m) => m.agentKey !== "oracle" && m.agentKey !== "passive");
  const best = nonOracle.slice().sort((a, b) => b.sharpe - a.sharpe)[0];
  const oracle = metrics.oracle;
  const alphaAvailable = oracle.pnl > 0.025 && oracle.sharpe > 0.55;
  const tradable = best && best.pnl > 0.025 && best.sharpe > 0.55;
  const nullWarning = config.nullShuffle && tradable;
  const costPressure = mean(nonOracle.map((m) => m.costsPaid)) > Math.max(0.015, Math.abs(mean(nonOracle.map((m) => m.pnl))) * 0.65);

  return {
    best,
    oracle,
    alphaAvailable,
    tradable,
    nullWarning,
    costPressure,
  };
}

function renderShell(result) {
  const preset = PRESETS[state.mode] || PRESETS.efficient;
  el.regimeTitle.textContent = preset.label;
  const best = result.diagnostics.best;
  const oracle = result.metrics.oracle;
  el.topMetrics.innerHTML = [
    ["Runs", result.runCount],
    ["Best agent", agentLabel(best.agentKey)],
    ["Oracle PnL", formatPct(oracle.pnl)],
  ]
    .map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");

  el.tableCaption.textContent = result.runCount > 1 ? "24-seed average ranked by net Sharpe." : "Single-seed metrics ranked by net Sharpe.";
  const pill = el.tradablePill;
  pill.className = "status-pill";
  if (result.diagnostics.nullWarning) {
    pill.textContent = "Null-test artifact risk";
    pill.classList.add("bad");
  } else if (result.diagnostics.tradable) {
    pill.textContent = "Tradably inefficient";
    pill.classList.add("good");
  } else if (result.diagnostics.alphaAvailable) {
    pill.textContent = "Alpha exists, hard to trade";
    pill.classList.add("warn");
  } else {
    pill.textContent = "Effectively efficient";
    pill.classList.add("bad");
  }
}

function renderDiagnostics(result) {
  const d = result.diagnostics;
  const cards = [
    {
      tone: d.alphaAvailable ? "good" : "bad",
      title: d.alphaAvailable ? "Latent alpha exists" : "No oracle edge",
      body: d.alphaAvailable
        ? `Oracle Sharpe is ${formatNumber(d.oracle.sharpe)} with ${formatPct(d.oracle.pnl)} PnL. The world has exploitable structure in principle.`
        : "The oracle cannot harvest a durable edge, so ordinary agents should not either.",
    },
    {
      tone: d.tradable ? "good" : "warn",
      title: d.tradable ? "Tradable after costs" : "Not tradable after costs",
      body: d.tradable
        ? `${agentLabel(d.best.agentKey)} is best with Sharpe ${formatNumber(d.best.sharpe)} after costs and impact.`
        : "Non-oracle agents do not clear the cost-adjusted threshold in this configuration.",
    },
    {
      tone: d.nullWarning || d.costPressure ? "bad" : "good",
      title: d.nullWarning ? "Null test failed" : d.costPressure ? "Costs dominate" : "Validation looks clean",
      body: d.nullWarning
        ? "A strategy still looks good after returns were shuffled. Treat this as overfit or simulator artifact."
        : d.costPressure
          ? "Costs and impact are a large share of the apparent edge."
          : "No immediate null-test or friction red flag in the current settings.",
    },
  ];

  el.diagnostics.innerHTML = cards
    .map(
      (card) => `
        <article class="diagnostic-card ${card.tone}">
          <strong>${card.title}</strong>
          <p>${card.body}</p>
        </article>
      `,
    )
    .join("");
}

function renderResultsTable(metrics, visibleAgents) {
  const rows = Object.values(metrics)
    .filter((m) => visibleAgents.includes(m.agentKey))
    .sort((a, b) => b.sharpe - a.sharpe);
  el.resultsBody.innerHTML = rows
    .map((m) => {
      const meta = AGENTS.find(([key]) => key === m.agentKey);
      return `
        <tr>
          <td class="agent-name"><span class="agent-dot" style="background:${COLORS[m.agentKey]}"></span>${meta[1]}</td>
          <td>${meta[2]}</td>
          <td>${formatPct(m.pnl)}</td>
          <td>${formatNumber(m.sharpe)}</td>
          <td>${formatPct(m.maxDrawdown)}</td>
          <td>${formatNumber(m.turnover)}</td>
          <td>${formatPct(m.costsPaid)}</td>
          <td>${formatPct(m.oracleCapture)}</td>
          <td>${formatBps(m.alphaError)}</td>
        </tr>
      `;
    })
    .join("");
}

function runPredictionArena(config) {
  const analyticsRunCount = 24;
  const seedRuns = [];
  for (let i = 0; i < analyticsRunCount; i += 1) {
    const seed = Math.round(config.seed) + i * 211;
    seedRuns.push(runPredictionSeed({ ...config, seed }));
  }
  const displayRuns = config.manySeeds ? seedRuns : seedRuns.slice(0, 1);
  return {
    runCount: displayRuns.length,
    analyticsRunCount,
    config,
    metrics: averagePredictionMetrics(displayRuns.map((run) => run.metrics)),
    aggregateMetrics: averagePredictionMetrics(seedRuns.map((run) => run.metrics)),
    seedSummaries: buildPredictionSeedSummaries(seedRuns),
    chart: seedRuns[0],
  };
}

function runPredictionSeed(config) {
  const market = simulateMarket(config);
  const observedReturns = market.returns.slice();
  if (config.nullShuffle) {
    const shuffled = shuffleArray(market.returns.slice(market.trainSize), rng(hashSeed(`pred-shuffle-${config.seed}`)));
    for (let i = 0; i < shuffled.length; i += 1) observedReturns[market.trainSize + i] = shuffled[i];
  }
  const episodes = buildPredictionEpisodes(market, observedReturns, config);
  const models = trainPredictionModels(episodes.train, config);
  const metrics = evaluatePredictionModels(episodes.test, models, config);
  return { episodes, metrics };
}

function buildPredictionEpisodes(market, observedReturns, config) {
  const lookback = Math.round(config.predictionLookback);
  const horizon = Math.round(config.predictionHorizon);
  const flatThreshold = config.noise * Math.sqrt(horizon) * 0.12;
  const train = [];
  const test = [];
  const lastStart = market.total - horizon;

  for (let t = lookback; t < lastStart; t += 1) {
    const futureReturn = sumSlice(observedReturns, t, t + horizon) - 0.00005 * horizon;
    const direction = directionFromReturn(futureReturn, flatThreshold);
    const episode = {
      t,
      vector: predictionVector(market, observedReturns, t, lookback, config),
      futureReturn,
      direction,
      flatThreshold,
    };
    if (t < market.trainSize - horizon) train.push(episode);
    if (t >= market.trainSize) test.push(episode);
  }

  return { train, test };
}

function predictionVector(market, observedReturns, t, lookback, config) {
  const start = Math.max(0, t - lookback);
  const window = observedReturns.slice(start, t);
  const short = observedReturns.slice(Math.max(start, t - Math.min(6, lookback)), t);
  const longMomentum = sumSlice(observedReturns, start, t) / Math.max(1, window.length);
  const shortMomentum = sumSlice(short, 0, short.length) / Math.max(1, short.length);
  const lastReturn = observedReturns[t - 1] || 0;
  const vol = std(window);
  const feature = market.features[Math.max(0, t - 1)] || [0, 0, 0];
  const oldPrice = market.price[Math.max(0, start)] || market.price[0] || 100;
  const nowPrice = market.price[Math.max(0, t - 1)] || oldPrice;
  const priceTrend = Math.log(Math.max(1e-9, nowPrice / oldPrice));
  const scale = Math.max(0.006, config.noise);

  return [
    1,
    clamp(longMomentum / scale, -4, 4),
    clamp(shortMomentum / scale, -4, 4),
    clamp(lastReturn / scale, -4, 4),
    clamp((vol - config.noise) / scale, -4, 4),
    clamp(feature[1], -3, 3),
    clamp(feature[2], -3, 3),
    clamp(priceTrend / (scale * Math.sqrt(Math.max(1, lookback))), -4, 4),
  ];
}

function trainPredictionModels(trainEpisodes, config) {
  const split = Math.max(30, Math.floor(trainEpisodes.length * 0.72));
  const fit = trainEpisodes.slice(0, split);
  const validation = trainEpisodes.slice(split);
  const pretrainedWeights = ridgeFitN(
    fit.map((episode) => episode.vector),
    fit.map((episode) => episode.futureReturn),
    0.18,
  );
  const evolutionaryWeights = selectPredictionEvolution(fit, validation, config);

  return {
    predRandom: { type: "random" },
    predOracle: { type: "oracle" },
    predPretrained: { type: "linear", weights: pretrainedWeights.slice() },
    predOnline: { type: "online", weights: new Array(pretrainedWeights.length).fill(0), rate: 0.035 },
    predHybrid: { type: "online", weights: pretrainedWeights.slice(), rate: 0.018 },
    predTransformer: { type: "memory", memory: fit.concat(validation).slice(-520) },
    predEvolutionary: { type: "linear", weights: evolutionaryWeights.slice() },
    predSwarm: { type: "swarm" },
  };
}

function selectPredictionEvolution(fit, validation, config) {
  const dim = fit[0]?.vector.length || 8;
  const rand = rng(hashSeed(`pred-evo-${config.seed}-${config.mode}`));
  const populationSize = Math.max(12, Math.round(config.predictionSwarmSize));
  const generations = Math.max(1, Math.round(config.predictionGenerations));
  let population = [];
  const pretrained = ridgeFitN(
    fit.map((episode) => episode.vector),
    fit.map((episode) => episode.futureReturn),
    0.18,
  );
  population.push(pretrained);
  while (population.length < populationSize) {
    population.push(Array.from({ length: dim }, () => between(rand, -0.018, 0.018)));
  }

  for (let generation = 0; generation < generations; generation += 1) {
    const scored = population
      .map((weights) => ({ weights, score: predictionPolicyScore(weights, validation, config) }))
      .sort((a, b) => b.score - a.score);
    const eliteCount = Math.max(4, Math.floor(populationSize * 0.18));
    const elites = scored.slice(0, eliteCount).map((item) => item.weights);
    const next = elites.map((weights) => weights.slice());
    while (next.length < populationSize) {
      const a = elites[Math.floor(rand() * elites.length)];
      const b = elites[Math.floor(rand() * elites.length)];
      next.push(a.map((v, i) => clamp((v + b[i]) / 2 + normal(rand) * 0.004, -0.045, 0.045)));
    }
    population = next;
  }

  return population
    .map((weights) => ({ weights, score: predictionPolicyScore(weights, validation, config) }))
    .sort((a, b) => b.score - a.score)[0].weights;
}

function predictionPolicyScore(weights, episodes, config) {
  let pnl = 0;
  let correct = 0;
  let prevPosition = 0;
  const exposure = predictionExposure();
  for (const episode of episodes) {
    const score = dot(weights, episode.vector);
    const pred = predictionFromScore(score, config);
    const position = pred.direction * pred.confidence;
    const cost =
      exposure *
      Math.abs(position - prevPosition) *
      (config.transactionCost + config.marketImpact) *
      predictionFrictionMultiplier(config);
    pnl += exposure * position * episode.futureReturn - cost;
    correct += pred.direction === episode.direction ? 1 : 0;
    prevPosition = position;
  }
  return pnl + (correct / Math.max(1, episodes.length) - 0.5) * 0.12;
}

function evaluatePredictionModels(testEpisodes, models, config) {
  const rand = rng(hashSeed(`pred-random-${config.seed}-${config.mode}`));
  const metrics = {};
  const swarmMembers = ["predPretrained", "predOnline", "predHybrid", "predTransformer", "predEvolutionary"];
  const rollingSkill = Object.fromEntries(swarmMembers.map((key) => [key, 0.52]));
  for (const [key] of PREDICTION_AGENTS) metrics[key] = emptyPredictionMetric(key);

  for (const episode of testEpisodes) {
    const predictions = {};
    for (const [key] of PREDICTION_AGENTS) {
      if (key === "predSwarm") continue;
      predictions[key] = predictWithModel(key, models[key], episode, config, rand);
    }

    let vote = 0;
    let weightTotal = 0;
    for (const key of swarmMembers) {
      const weight = 0.15 + Math.max(0, rollingSkill[key] - 0.45) * 2.6;
      vote += weight * predictions[key].direction * predictions[key].confidence;
      weightTotal += weight;
    }
    predictions.predSwarm = predictionFromScore((vote / Math.max(1e-9, weightTotal)) * config.noise * 1.8, config);

    for (const [key] of PREDICTION_AGENTS) {
      applyPredictionOutcome(metrics[key], predictions[key], episode, config, key);
    }

    for (const key of ["predOnline", "predHybrid"]) {
      updateOnlinePredictionModel(models[key], predictions[key].score, episode);
    }
    models.predTransformer.memory.push(episode);
    if (models.predTransformer.memory.length > 640) models.predTransformer.memory.shift();

    for (const key of swarmMembers) {
      const correct = predictions[key].direction === episode.direction ? 1 : 0;
      rollingSkill[key] = 0.94 * rollingSkill[key] + 0.06 * correct;
    }
  }

  for (const key of Object.keys(metrics)) finalizePredictionMetric(metrics[key]);
  return metrics;
}

function predictWithModel(key, model, episode, config, rand) {
  if (model.type === "oracle") {
    return {
      direction: episode.direction,
      confidence: episode.direction === 0 ? 0.25 : 1,
      score: episode.futureReturn,
    };
  }
  if (model.type === "random") {
    const roll = rand();
    const direction = roll < 0.42 ? -1 : roll < 0.58 ? 0 : 1;
    return { direction, confidence: direction === 0 ? 0.25 : 0.45, score: direction * config.noise };
  }
  if (model.type === "memory") {
    const score = attentionMemoryScore(model.memory, episode.vector);
    return predictionFromScore(score, config);
  }
  const score = dot(model.weights, episode.vector);
  return predictionFromScore(score, config);
}

function attentionMemoryScore(memory, vector) {
  if (!memory.length) return 0;
  let weighted = 0;
  let total = 0;
  const norm = Math.sqrt(dot(vector, vector)) || 1;
  const start = Math.max(0, memory.length - 520);
  for (let i = start; i < memory.length; i += 1) {
    const item = memory[i];
    const itemNorm = Math.sqrt(dot(item.vector, item.vector)) || 1;
    const similarity = dot(vector, item.vector) / (norm * itemNorm);
    const recency = 0.65 + 0.35 * ((i - start) / Math.max(1, memory.length - start));
    const weight = Math.exp(clamp(similarity * 3.2, -5, 5)) * recency;
    weighted += weight * item.futureReturn;
    total += weight;
  }
  return weighted / Math.max(1e-9, total);
}

function predictionFromScore(score, config) {
  const threshold = config.noise * Math.sqrt(Math.max(1, config.predictionHorizon)) * 0.09;
  const direction = Math.abs(score) < threshold ? 0 : Math.sign(score);
  const confidence = direction === 0 ? 0.28 : clamp(Math.abs(score) / Math.max(threshold * 4, 1e-6), 0.18, 1);
  return { direction, confidence, score };
}

function predictionExposure() {
  return 0.08;
}

function predictionFrictionMultiplier(config) {
  return Math.max(1, Math.sqrt(Math.max(1, config.predictionHorizon)) * 6);
}

function updateOnlinePredictionModel(model, score, episode) {
  const error = episode.futureReturn - score;
  const denom = 1 + dot(episode.vector, episode.vector);
  model.weights = model.weights.map((weight, i) => clamp(weight + model.rate * error * episode.vector[i] / denom, -0.05, 0.05));
}

function emptyPredictionMetric(agentKey) {
  return {
    agentKey,
    count: 0,
    correct: 0,
    upCorrect: 0,
    downCorrect: 0,
    upTotal: 0,
    downTotal: 0,
    confidenceTotal: 0,
    returns: [],
    equity: [1],
    turnover: 0,
    prevPosition: 0,
    bins: Array.from({ length: 5 }, () => ({ count: 0, confidence: 0, correct: 0 })),
  };
}

function applyPredictionOutcome(metric, prediction, episode, config, agentKey) {
  const position = prediction.direction * prediction.confidence;
  const turnover = Math.abs(position - metric.prevPosition);
  const exposure = predictionExposure();
  const cost =
    config.useCosts && agentKey !== "predOracle"
      ? exposure * turnover * (config.transactionCost + config.marketImpact) * predictionFrictionMultiplier(config)
      : 0;
  const net = exposure * position * episode.futureReturn - cost;
  const correct = prediction.direction === episode.direction ? 1 : 0;
  const bin = Math.min(4, Math.max(0, Math.floor(prediction.confidence * 5)));

  metric.count += 1;
  metric.correct += correct;
  metric.confidenceTotal += prediction.confidence;
  metric.returns.push(net);
  metric.turnover += turnover;
  metric.prevPosition = position;
  metric.equity.push(Math.max(0.02, metric.equity[metric.equity.length - 1] + net));
  metric.bins[bin].count += 1;
  metric.bins[bin].confidence += prediction.confidence;
  metric.bins[bin].correct += correct;

  if (episode.direction > 0) {
    metric.upTotal += 1;
    metric.upCorrect += correct;
  }
  if (episode.direction < 0) {
    metric.downTotal += 1;
    metric.downCorrect += correct;
  }
}

function finalizePredictionMetric(metric) {
  metric.accuracy = metric.correct / Math.max(1, metric.count);
  metric.pnl = metric.equity[metric.equity.length - 1] - 1;
  metric.sharpe = annualizedSharpe(metric.returns);
  metric.avgConfidence = metric.confidenceTotal / Math.max(1, metric.count);
  metric.calibrationError =
    metric.bins.reduce((sum, bin) => {
      if (!bin.count) return sum;
      const acc = bin.correct / bin.count;
      const conf = bin.confidence / bin.count;
      return sum + Math.abs(acc - conf) * (bin.count / Math.max(1, metric.count));
    }, 0) || 0;
}

function averagePredictionMetrics(metricsList) {
  const out = {};
  for (const [key] of PREDICTION_AGENTS) {
    const rows = metricsList.map((metrics) => metrics[key]);
    const bins = Array.from({ length: 5 }, (_, index) =>
      rows.reduce(
        (acc, row) => {
          const bin = row.bins?.[index] || { count: 0, confidence: 0, correct: 0 };
          acc.count += bin.count;
          acc.confidence += bin.confidence;
          acc.correct += bin.correct;
          return acc;
        },
        { count: 0, confidence: 0, correct: 0 },
      ),
    );
    out[key] = {
      agentKey: key,
      count: mean(rows.map((row) => row.count)),
      accuracy: mean(rows.map((row) => row.accuracy)),
      pnl: mean(rows.map((row) => row.pnl)),
      sharpe: mean(rows.map((row) => row.sharpe)),
      avgConfidence: mean(rows.map((row) => row.avgConfidence)),
      calibrationError: mean(rows.map((row) => row.calibrationError)),
      turnover: mean(rows.map((row) => row.turnover)),
      upCorrect: mean(rows.map((row) => row.upCorrect)),
      downCorrect: mean(rows.map((row) => row.downCorrect)),
      upTotal: mean(rows.map((row) => row.upTotal)),
      downTotal: mean(rows.map((row) => row.downTotal)),
      equity: rows[0].equity,
      bins,
    };
  }
  return out;
}

function buildPredictionSeedSummaries(seedRuns) {
  return seedRuns.map((run, index) => {
    const metrics = {};
    for (const [key] of PREDICTION_AGENTS) {
      const metric = run.metrics[key];
      metrics[key] = {
        pnl: metric.pnl,
        accuracy: metric.accuracy,
        sharpe: metric.sharpe,
        oracleGap: Math.max(0, run.metrics.predOracle.pnl - metric.pnl),
        calibrationError: metric.calibrationError,
        upAccuracy: metric.upCorrect / Math.max(1, metric.upTotal),
        downAccuracy: metric.downCorrect / Math.max(1, metric.downTotal),
      };
    }
    return {
      seedIndex: index + 1,
      metrics,
    };
  });
}

function renderPredictionArena(prediction) {
  const rows = Object.values(prediction.metrics);
  const aggregateRows = Object.values(prediction.aggregateMetrics);
  const best = rows
    .filter((row) => row.agentKey !== "predOracle" && row.agentKey !== "predRandom")
    .sort((a, b) => b.pnl - a.pnl)[0];
  const oracle = prediction.metrics.predOracle;
  const swarm = prediction.metrics.predSwarm;
  const transformer = prediction.metrics.predTransformer;
  const aggregateBest = aggregateRows
    .filter((row) => row.agentKey !== "predOracle" && row.agentKey !== "predRandom")
    .sort((a, b) => b.pnl - a.pnl)[0];
  const sampleCount = Math.round(mean(rows.map((row) => row.count)));
  const trainingEpisodes = Math.max(
    0,
    Math.round(prediction.config.trainSize) -
      Math.round(prediction.config.predictionLookback) -
      Math.round(prediction.config.predictionHorizon),
  );
  const fitEpisodes = Math.min(trainingEpisodes, Math.max(30, Math.floor(trainingEpisodes * 0.72)));
  const validationEpisodes = Math.max(0, trainingEpisodes - fitEpisodes);
  const cards = [
    {
      tone: "good",
      title: "Initial training data",
      body: `Pretrained and hybrid start with ${trainingEpisodes} historical episodes: ${fitEpisodes} fit examples and ${validationEpisodes} validation examples.`,
    },
    {
      tone: best.pnl > 0 ? "good" : "warn",
      title: best.pnl > 0 ? "Predictable after costs" : "No tradable predictor",
      body: `${predictionAgentLabel(best.agentKey)} leads non-oracles with ${formatPct(best.pnl)} PnL and ${formatPct(best.accuracy)} accuracy.`,
    },
    {
      tone: oracle.accuracy > 0.55 ? "good" : "bad",
      title: "Oracle ceiling",
      body: `${formatPct(oracle.accuracy)} accuracy over ${sampleCount} accelerated prediction episodes.`,
    },
    {
      tone: aggregateBest.pnl > 0 ? "good" : "warn",
      title: "24-seed stability",
      body: `${predictionAgentLabel(aggregateBest.agentKey)} leads across 24 seeds with ${formatPct(aggregateBest.pnl)} average PnL.`,
    },
    {
      tone: transformer.accuracy > 0.52 ? "good" : "warn",
      title: "Sequence memory",
      body: `Transformer-lite attention reaches ${formatPct(transformer.accuracy)} accuracy from similar past windows.`,
    },
  ];

  el.predictionInsights.innerHTML = cards
    .map(
      (card) => `
        <article class="diagnostic-card ${card.tone}">
          <strong>${card.title}</strong>
          <p>${card.body}</p>
        </article>
      `,
    )
    .join("");

  const tableRows = rows.slice().sort((a, b) => b.pnl - a.pnl);
  el.predictionResultsBody.innerHTML = tableRows
    .map((metric) => {
      const meta = PREDICTION_AGENTS.find(([key]) => key === metric.agentKey);
      return `
        <tr>
          <td class="agent-name"><span class="agent-dot" style="background:${COLORS[metric.agentKey]}"></span>${meta[1]}</td>
          <td>${meta[2]}</td>
          <td>${formatPct(metric.accuracy)}</td>
          <td>${formatPct(metric.pnl)}</td>
          <td>${formatNumber(metric.sharpe)}</td>
          <td>${formatPct(metric.avgConfidence)}</td>
          <td>${formatPct(metric.calibrationError)}</td>
          <td>${formatNumber(metric.turnover)}</td>
          <td>${formatRatio(metric.upCorrect, metric.upTotal)} / ${formatRatio(metric.downCorrect, metric.downTotal)}</td>
        </tr>
      `;
    })
    .join("");
}

function drawPredictionEquityChart(prediction) {
  const canvas = el.predictionEquityChart;
  const ctx = setupCanvas(canvas);
  const keys = PREDICTION_AGENTS.map(([key]) => key);
  const rows = keys.map((key) => [key, prediction.chart.metrics[key].equity.map((v) => (v - 1) * 100)]);
  const all = rows.flatMap(([, values]) => values);
  const min = Math.min(-2, ...all);
  const max = Math.max(2, ...all);
  drawAxes(ctx, canvas, "Prediction episodes");
  for (const [key, values] of rows) {
    drawSeries(ctx, canvas, values, COLORS[key], { min, max });
  }
  drawLegend(
    ctx,
    rows.map(([key]) => [predictionAgentLabel(key), COLORS[key]]),
  );
}

function drawPredictionAccuracyChart(prediction) {
  const canvas = el.predictionAccuracyChart;
  const ctx = setupCanvas(canvas);
  const area = chartArea(canvas);
  const rows = Object.values(prediction.metrics).sort((a, b) => b.accuracy - a.accuracy);
  const barGap = 7;
  const barW = Math.max(12, (area.w - barGap * (rows.length - 1)) / rows.length);
  drawAxes(ctx, canvas, "Predictors");
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  rows.forEach((row, i) => {
    const x = area.x + i * (barW + barGap);
    const accuracyH = area.h * clamp(row.accuracy, 0, 1);
    const calH = area.h * clamp(row.calibrationError, 0, 1);
    ctx.fillStyle = COLORS[row.agentKey];
    ctx.fillRect(x, area.y + area.h - accuracyH, barW, accuracyH);
    ctx.fillStyle = "rgba(255, 113, 141, 0.72)";
    ctx.fillRect(x, area.y + area.h - calH, barW, Math.max(2, calH));
    ctx.save();
    ctx.translate(x + 3, area.y + area.h + 12);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = "#c7d2da";
    ctx.fillText(shortPredictionLabel(row.agentKey), 0, 0);
    ctx.restore();
  });
  drawLegend(ctx, [
    ["Accuracy", COLORS.predOnline],
    ["Calibration error", "#ff718d"],
  ]);
}

function drawPredictionAnalyticsCharts(prediction) {
  drawSeedMetricChart(el.predictionSeedPnlChart, prediction, "pnl", "PnL", formatPct);
  drawSeedMetricChart(el.predictionSeedAccuracyChart, prediction, "accuracy", "Accuracy", formatPct);
  drawSeedMetricChart(el.predictionSeedSharpeChart, prediction, "sharpe", "Sharpe", formatNumber);
  drawSeedMetricChart(el.predictionOracleGapChart, prediction, "oracleGap", "Oracle gap", formatPct);
  drawCalibrationCurveChart(prediction);
  drawDirectionBalanceChart(prediction);
}

function drawSeedMetricChart(canvas, prediction, metricKey, label, formatter) {
  const ctx = setupCanvas(canvas);
  const keys = ["predPretrained", "predOnline", "predHybrid", "predTransformer", "predEvolutionary", "predSwarm"];
  const rows = keys.map((key) => [
    key,
    prediction.seedSummaries.map((seed) => seed.metrics[key][metricKey]),
  ]);
  const all = rows.flatMap(([, values]) => values);
  const min = metricKey === "accuracy" ? 0 : Math.min(...all, 0);
  const max = metricKey === "accuracy" ? 1 : Math.max(...all, 0.01);
  drawAxes(ctx, canvas, "24 seeds");
  drawAxisLabels(ctx, canvas, min, max, formatter);
  for (const [key, values] of rows) {
    drawSeries(ctx, canvas, values, COLORS[key], { min, max });
  }
  drawLegend(
    ctx,
    rows.map(([key]) => [shortPredictionLabel(key), COLORS[key]]),
  );
  drawChartTitle(ctx, label);
}

function drawCalibrationCurveChart(prediction) {
  const canvas = el.predictionCalibrationChart;
  const ctx = setupCanvas(canvas);
  const keys = ["predPretrained", "predOnline", "predHybrid", "predTransformer", "predEvolutionary", "predSwarm"];
  drawAxes(ctx, canvas, "Confidence bins");
  drawDiagonal(ctx, canvas);
  for (const key of keys) {
    const bins = prediction.aggregateMetrics[key].bins || [];
    const points = bins.map((bin, index) => {
      if (!bin.count) return { x: (index + 0.5) / 5, y: 0 };
      return {
        x: bin.confidence / bin.count,
        y: bin.correct / bin.count,
      };
    });
    drawPointLine(ctx, canvas, points, COLORS[key]);
  }
  drawLegend(
    ctx,
    keys.map((key) => [shortPredictionLabel(key), COLORS[key]]),
  );
}

function drawDirectionBalanceChart(prediction) {
  const canvas = el.predictionDirectionBalanceChart;
  const ctx = setupCanvas(canvas);
  const area = chartArea(canvas);
  const keys = ["predPretrained", "predOnline", "predHybrid", "predTransformer", "predEvolutionary", "predSwarm"];
  const gap = 9;
  const groupW = (area.w - gap * (keys.length - 1)) / keys.length;
  const barW = Math.max(6, (groupW - 4) / 2);
  drawAxes(ctx, canvas, "Predictors");
  keys.forEach((key, i) => {
    const metric = prediction.aggregateMetrics[key];
    const up = metric.upCorrect / Math.max(1, metric.upTotal);
    const down = metric.downCorrect / Math.max(1, metric.downTotal);
    const x = area.x + i * (groupW + gap);
    const upH = area.h * clamp(up, 0, 1);
    const downH = area.h * clamp(down, 0, 1);
    ctx.fillStyle = COLORS[key];
    ctx.fillRect(x, area.y + area.h - upH, barW, upH);
    ctx.fillStyle = "rgba(255, 113, 141, 0.82)";
    ctx.fillRect(x + barW + 4, area.y + area.h - downH, barW, downH);
    ctx.save();
    ctx.translate(x + 2, area.y + area.h + 12);
    ctx.rotate(-Math.PI / 6);
    ctx.fillStyle = "#c7d2da";
    ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.fillText(shortPredictionLabel(key), 0, 0);
    ctx.restore();
  });
  drawLegend(ctx, [
    ["Up accuracy", COLORS.predOnline],
    ["Down accuracy", "#ff718d"],
  ]);
}

function drawMarketChart(run) {
  const canvas = el.marketChart;
  const ctx = setupCanvas(canvas);
  const testStart = run.market.trainSize;
  const price = run.market.price.slice(testStart);
  const alpha = run.market.alpha.slice(testStart).map((v) => v * 1000);
  drawAxes(ctx, canvas, "Test periods");
  drawSeries(ctx, canvas, price, COLORS.price, { min: Math.min(...price), max: Math.max(...price), label: "Price" });
  drawSeries(ctx, canvas, alpha, COLORS.alpha, {
    min: Math.min(...alpha, -1),
    max: Math.max(...alpha, 1),
    right: true,
    label: "Alpha x1000",
  });
  drawLegend(ctx, [
    ["Price", COLORS.price],
    ["Latent alpha", COLORS.alpha],
  ]);
}

function drawEquityChart(run, visibleAgents) {
  const canvas = el.equityChart;
  const ctx = setupCanvas(canvas);
  const rows = visibleAgents.map((key) => [key, run.metrics[key].equity.map((v) => (v - 1) * 100)]);
  const all = rows.flatMap(([, values]) => values);
  const min = Math.min(-2, ...all);
  const max = Math.max(2, ...all);
  drawAxes(ctx, canvas, "Test periods");
  for (const [key, values] of rows) {
    drawSeries(ctx, canvas, values, COLORS[key], { min, max, label: key });
  }
  drawLegend(
    ctx,
    rows.map(([key]) => [agentLabel(key), COLORS[key]]),
  );
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "rgba(5, 7, 9, 0.42)";
  ctx.fillRect(0, 0, rect.width, rect.height);
  return ctx;
}

function chartArea(canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: 48, y: 18, w: rect.width - 70, h: rect.height - 50 };
}

function drawAxes(ctx, canvas, xLabel) {
  const area = chartArea(canvas);
  ctx.strokeStyle = "rgba(188, 204, 216, 0.14)";
  ctx.lineWidth = 1;
  ctx.font = "12px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillStyle = "#9aa8b4";
  for (let i = 0; i <= 4; i += 1) {
    const y = area.y + (area.h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
    ctx.stroke();
  }
  ctx.fillText(xLabel, area.x, area.y + area.h + 32);
}

function drawSeries(ctx, canvas, values, color, options) {
  const area = chartArea(canvas);
  if (values.length < 2) return;
  const min = options.min;
  const max = options.max;
  const span = Math.max(1e-9, max - min);
  ctx.strokeStyle = color;
  ctx.lineWidth = options.right ? 1.5 : 2;
  ctx.beginPath();
  values.forEach((value, i) => {
    const x = area.x + (area.w * i) / (values.length - 1);
    const y = area.y + area.h - ((value - min) / span) * area.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function drawLegend(ctx, items) {
  const unique = items.slice(0, 7);
  let x = 54;
  const y = 18;
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  for (const [label, color] of unique) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 10, 10);
    ctx.fillStyle = "#c7d2da";
    ctx.fillText(label, x + 15, y + 10);
    x += Math.min(150, label.length * 7 + 34);
  }
}

function drawAxisLabels(ctx, canvas, min, max, formatter) {
  const area = chartArea(canvas);
  ctx.fillStyle = "#9aa8b4";
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillText(formatter(max), 8, area.y + 4);
  ctx.fillText(formatter((min + max) / 2), 8, area.y + area.h / 2 + 4);
  ctx.fillText(formatter(min), 8, area.y + area.h);
}

function drawChartTitle(ctx, title) {
  ctx.fillStyle = "#c7d2da";
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(title, 54, 38);
}

function drawDiagonal(ctx, canvas) {
  const area = chartArea(canvas);
  ctx.strokeStyle = "rgba(238, 244, 248, 0.22)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(area.x, area.y + area.h);
  ctx.lineTo(area.x + area.w, area.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPointLine(ctx, canvas, points, color) {
  const area = chartArea(canvas);
  if (!points.length) return;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = area.x + clamp(point.x, 0, 1) * area.w;
    const y = area.y + area.h - clamp(point.y, 0, 1) * area.h;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  for (const point of points) {
    const x = area.x + clamp(point.x, 0, 1) * area.w;
    const y = area.y + area.h - clamp(point.y, 0, 1) * area.h;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function downloadCsv() {
  if (!latestResult) return;
  const headers = ["agent", "role", "net_pnl", "sharpe", "max_drawdown", "turnover", "costs_paid", "oracle_capture", "alpha_error"];
  const rows = Object.values(latestResult.metrics)
    .filter((m) => latestResult.visibleAgents.includes(m.agentKey))
    .sort((a, b) => b.sharpe - a.sharpe)
    .map((m) => {
      const meta = AGENTS.find(([key]) => key === m.agentKey);
      return [meta[1], meta[2], m.pnl, m.sharpe, m.maxDrawdown, m.turnover, m.costsPaid, m.oracleCapture, m.alphaError];
    });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `market-efficiency-${state.mode}-seed-${Math.round(state.seed)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("CSV downloaded");
}

function downloadPredictionCsv() {
  if (!latestResult?.prediction) return;
  const headers = [
    "predictor",
    "training_regime",
    "accuracy",
    "net_pnl",
    "sharpe",
    "avg_confidence",
    "calibration_error",
    "turnover",
    "up_correct",
    "up_total",
    "down_correct",
    "down_total",
  ];
  const rows = Object.values(latestResult.prediction.metrics)
    .sort((a, b) => b.pnl - a.pnl)
    .map((metric) => {
      const meta = PREDICTION_AGENTS.find(([key]) => key === metric.agentKey);
      return [
        meta[1],
        meta[2],
        metric.accuracy,
        metric.pnl,
        metric.sharpe,
        metric.avgConfidence,
        metric.calibrationError,
        metric.turnover,
        metric.upCorrect,
        metric.upTotal,
        metric.downCorrect,
        metric.downTotal,
      ];
    });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `prediction-arena-${state.mode}-seed-${Math.round(state.seed)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Prediction CSV downloaded");
}

function copyShareUrl() {
  const url = new URL(window.location.href);
  url.search = buildSearchParams().toString();
  navigator.clipboard
    .writeText(url.toString())
    .then(() => showToast("Experiment URL copied"))
    .catch(() => showToast("Copy failed"));
}

function updateUrlSilently() {
  const url = new URL(window.location.href);
  url.search = buildSearchParams().toString();
  window.history.replaceState(null, "", url);
}

function buildSearchParams() {
  const params = new URLSearchParams();
  params.set("mode", state.mode);
  for (const [key] of RANGE_CONTROLS) params.set(key, String(state[key]));
  for (const [key] of PREDICTION_RANGE_CONTROLS) params.set(key, String(state[key]));
  for (const key of ["showOracle", "useCosts", "nullShuffle", "manySeeds"]) {
    params.set(key, state[key] ? "1" : "0");
  }
  return params;
}

function updatePresetActive() {
  document.querySelectorAll(".preset-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === state.mode);
  });
}

function showToast(message) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add("show");
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 1800);
}

function positionFromSignal(signal, noise) {
  const scale = Math.max(0.006, noise * 0.7);
  return clamp(signal / scale, -1, 1);
}

function annualizedSharpe(returns) {
  const avg = mean(returns);
  const sd = std(returns);
  return sd > 1e-9 ? (avg / sd) * Math.sqrt(252) : 0;
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
}

function ridgeFitN(xs, ys, lambda) {
  const dim = xs[0]?.length || 0;
  if (!xs.length || !dim) return [];
  const xtx = Array.from({ length: dim }, (_, i) =>
    Array.from({ length: dim }, (__, j) => (i === j ? lambda : 0)),
  );
  const xty = new Array(dim).fill(0);
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i];
    const y = ys[i];
    for (let a = 0; a < dim; a += 1) {
      xty[a] += x[a] * y;
      for (let b = 0; b < dim; b += 1) xtx[a][b] += x[a] * x[b];
    }
  }
  return solveLinear(xtx, xty).map((value) => clamp(value, -0.05, 0.05));
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

function sumSlice(values, start, end) {
  let total = 0;
  for (let i = start; i < end; i += 1) total += values[i] || 0;
  return total;
}

function directionFromReturn(value, flatThreshold) {
  if (Math.abs(value) < flatThreshold) return 0;
  return value > 0 ? 1 : -1;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) * (v - m))));
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

function shuffleArray(values, rand) {
  const copy = values.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function csvCell(value) {
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function agentLabel(key) {
  return (AGENTS.find(([agentKey]) => agentKey === key) || [key, key])[1];
}

function predictionAgentLabel(key) {
  return (PREDICTION_AGENTS.find(([agentKey]) => agentKey === key) || [key, key])[1];
}

function shortPredictionLabel(key) {
  const labels = {
    predRandom: "Rnd",
    predOracle: "Orc",
    predPretrained: "Pre",
    predOnline: "RL",
    predHybrid: "P+P",
    predTransformer: "Attn",
    predEvolutionary: "Evo",
    predSwarm: "Swm",
  };
  return labels[key] || key;
}

function formatControlValue(key, value) {
  if (
    [
      "trainSize",
      "testSize",
      "seed",
      "predictionLookback",
      "predictionHorizon",
      "predictionGenerations",
      "predictionSwarmSize",
    ].includes(key)
  ) {
    return String(Math.round(value));
  }
  if (["transactionCost", "marketImpact", "noise"].includes(key)) return formatPct(value);
  return Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function formatPct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatBps(value) {
  return `${(value * 10000).toFixed(1)} bps`;
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function formatRatio(correct, total) {
  return `${Math.round(correct)}/${Math.round(total)}`;
}

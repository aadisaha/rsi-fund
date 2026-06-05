"use strict";

const COLORS = {
  oracle: "#f2c75c",
  pretrained: "#74a7ff",
  online: "#2ed09c",
  hybrid: "#a58cff",
  transformer: "#f5a25d",
  evolutionary: "#56cfe8",
  swarm: "#eef4f8",
  random: "#ff718d",
};

const AGENTS = [
  ["pretrained", "Pretrained"],
  ["online", "RL online"],
  ["hybrid", "Pre+post"],
  ["transformer", "Transformer-lite"],
  ["evolutionary", "Evolution"],
  ["swarm", "Swarm"],
];

const ALL_AGENTS = [["oracle", "Oracle"], ["random", "Random"], ...AGENTS];

const TRAINING_REGIMES = [
  {
    key: "random",
    title: "Training Regime: Random Baseline",
    kicker: "Agent Mechanics",
    insight:
      "The random agent is the negative control: it has no learned market view, so persistent profits would indicate luck, leakage, or simulator bias.",
    color: COLORS.random,
    data: "No training data. It samples up/down/flat behavior without estimating alpha.",
    training: "None. Randomness is seeded only for reproducibility, not for learning.",
    testUpdate: "No update. Its behavior should average toward zero before costs and below zero after costs.",
    failureMode: "If this wins repeatedly, the experiment is probably rewarding noise or undercharging turnover.",
    analysis: [
      "Use random as the lower benchmark for all prediction agents.",
      "A good simulator should not let random produce durable post-cost edge across many seeds.",
      "Random is useful because it catches selection artifacts that can hide inside prettier models.",
    ],
  },
  {
    key: "oracle",
    title: "Training Regime: Oracle Benchmark",
    kicker: "Agent Mechanics",
    insight:
      "The oracle is not a tradable model; it knows the future label and measures how much exploitable structure exists in principle.",
    color: COLORS.oracle,
    data: "Privileged future return direction for each prediction episode.",
    training: "None. It is an upper bound, not a learned estimator.",
    testUpdate: "No adaptation needed because it observes the answer before placing the synthetic trade.",
    failureMode: "If oracle cannot profit, the market has little usable alpha after noise, costs, and horizon dilution.",
    analysis: [
      "Read oracle as the ceiling for theoretical alpha capture.",
      "Large oracle gaps mean alpha exists but ordinary information access cannot recover it.",
      "Do not compare oracle as a deployable strategy; it is a diagnostic instrument.",
    ],
  },
  {
    key: "pretrained",
    title: "Training Regime: Pretrained",
    kicker: "Agent Mechanics",
    insight:
      "The pretrained agent learns a frozen mapping from historical windows to future direction, then trades the test market without updating.",
    color: COLORS.pretrained,
    data: "Historical pre-test episodes built from past returns, features, lookback windows, and future labels.",
    training: "Ridge-style linear estimator fit on the early historical split and selected before test begins.",
    testUpdate: "Frozen. It keeps using the same weights even if crowding, regimes, or signal signs change.",
    failureMode: "Strong when train and test share structure; brittle when historical alpha becomes stale or crowded.",
    analysis: [
      "This is the cleanest test of whether old market structure repeats.",
      "It should do well in historically learnable worlds and poorly in rapid/adaptive worlds.",
      "More initial data helps only when that data remains relevant to the test ecology.",
    ],
  },
  {
    key: "online",
    title: "Training Regime: RL Online",
    kicker: "Agent Mechanics",
    insight:
      "The online agent starts with little prior structure and updates from each simulated prediction outcome as time fast-forwards.",
    color: COLORS.online,
    data: "Current-market prediction episodes revealed one by one during the test path.",
    training: "Online reward/sign update after each outcome; it learns from recent mistakes and wins.",
    testUpdate: "Continuous. It can reduce or redirect exposure as the current regime changes.",
    failureMode: "Needs enough repeated local signal to learn; can underperform when alpha is stable but sample-poor.",
    analysis: [
      "This approximates post-training from interaction rather than offline historical fitting.",
      "It should be less explosive early but better at avoiding stale historical priors.",
      "It fails when the market changes faster than feedback can teach it.",
    ],
  },
  {
    key: "hybrid",
    title: "Training Regime: Pretrained + Online",
    kicker: "Agent Mechanics",
    insight:
      "The hybrid agent starts from the pretrained weights, then updates them online, so it tests whether historical priors and current adaptation cooperate or interfere.",
    color: COLORS.hybrid,
    data: "Historical pre-test episodes for initialization plus current test outcomes for adaptation.",
    training: "Pretrained linear weights provide the starting policy; online updates adjust after revealed outcomes.",
    testUpdate: "Partial adaptation. The historical prior remains an anchor unless enough new evidence moves it.",
    failureMode: "Can become a compromise model: too stale during decay, too cautious during re-entry.",
    analysis: [
      "Hybrid only helps if it can decide when to trust history and when to override it.",
      "A simple blend may be worse than either frozen pretraining or pure online learning.",
      "This slide explains why pre+post is a design problem, not an automatic upgrade.",
    ],
  },
  {
    key: "transformer",
    title: "Training Regime: Transformer-Lite",
    kicker: "Agent Mechanics",
    insight:
      "Transformer-lite behaves like a sequence-memory model: it compares the current past window to similar historical windows and votes from their outcomes.",
    color: COLORS.transformer,
    data: "A library of historical windows, summary features, and future labels.",
    training: "Memory/attention over similar windows rather than a deep neural transformer; same idea, toy-scale mechanics.",
    testUpdate: "Mostly historical-memory driven, with limited sensitivity to recent similarity patterns.",
    failureMode: "Can over-trust familiar-looking windows even after the market ecology has changed.",
    analysis: [
      "It captures the intuition of pattern retrieval without needing a heavy model or build step.",
      "It can shine when motifs repeat, especially with enough initial history.",
      "It can bleed in crowded regimes if familiar historical patterns are exactly what everyone exploits.",
    ],
  },
  {
    key: "evolutionary",
    title: "Training Regime: Evolutionary Search",
    kicker: "Agent Mechanics",
    insight:
      "The evolutionary agent searches over many simple signal-weight policies, mutates candidates, and keeps policies that validate best before test.",
    color: COLORS.evolutionary,
    data: "Historical fit and validation episodes, with candidate policies scored under the same budget.",
    training: "Population search across generations: evaluate, select, mutate, and retain high-validation policies.",
    testUpdate: "Selected policy is mostly fixed during evaluation; its advantage comes from broad pre-test search.",
    failureMode: "Selection bias. Too many candidates can discover validation noise that fails on untouched test seeds.",
    analysis: [
      "Evolution is a search-budget regime, not magic market intuition.",
      "It should be compared against other agents under equalized candidate/compute budgets.",
      "Null tests are crucial because evolutionary search is very good at finding accidental structure.",
    ],
  },
  {
    key: "swarm",
    title: "Training Regime: Weighted Swarm",
    kicker: "Agent Mechanics",
    insight:
      "The swarm combines the specialist agents by weighting their votes according to recent or validation quality, trading peak conviction for robustness.",
    color: COLORS.swarm,
    data: "Predictions from pretrained, online, hybrid, transformer-lite, and evolutionary members.",
    training: "Ensemble weighting. The swarm learns which member families deserve more influence.",
    testUpdate: "Weights can shift as member quality changes, so the swarm can diversify away from stale winners.",
    failureMode: "May lag the single best specialist and can inherit correlated mistakes when all members chase the same signal.",
    analysis: [
      "The swarm is an ecological design: preserve multiple hypotheses instead of one hard commitment.",
      "It usually sacrifices early peak PnL for lower regime fragility.",
      "A strong swarm is evidence that model diversity matters when markets adapt and crowd.",
    ],
  },
];

const REGIMES = {
  efficient: {
    label: "Efficient null",
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
    label: "Unlearnable alpha",
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
    label: "Historical alpha",
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
    label: "Local alpha",
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
    label: "Rapid shift",
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
    label: "Crowded alpha",
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

const DEFAULTS = {
  predictionLookback: 24,
  predictionHorizon: 4,
  predictionGenerations: 8,
  predictionSwarmSize: 64,
  useCosts: true,
  nullShuffle: false,
};

window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    const data = buildDeckData();
    document.getElementById("statusPanel").classList.add("done");
    renderSlides(data);
  }, 20);
});

function buildDeckData() {
  const regimes = {};
  for (const [key, preset] of Object.entries(REGIMES)) {
    regimes[key] = runMany({ ...DEFAULTS, ...preset, mode: key }, 24);
  }
  return {
    regimes,
    ecology: runCrowdingEcologyStudy(),
    horizonHistorical: sweep("historical", "predictionHorizon", [1, 2, 4, 8, 12, 16]),
    horizonLocal: sweep("local", "predictionHorizon", [1, 2, 4, 8, 12, 16]),
    lookbackHistorical: sweep("historical", "predictionLookback", [8, 16, 24, 40, 64]),
    lookbackRapid: sweep("rapid", "predictionLookback", [8, 16, 24, 40, 64]),
    costCrowded: sweepCost("crowded", [0, 0.0008, 0.0016, 0.0032, 0.0064]),
    swarmLocal: sweep("local", "predictionSwarmSize", [16, 32, 64, 96, 128]),
  };
}

function sweep(regimeKey, field, values) {
  return values.map((value) => ({
    value,
    result: runMany({ ...DEFAULTS, ...REGIMES[regimeKey], mode: regimeKey, [field]: value }, 10),
  }));
}

function sweepCost(regimeKey, values) {
  return values.map((value) => ({
    value,
    result: runMany({
      ...DEFAULTS,
      ...REGIMES[regimeKey],
      mode: regimeKey,
      transactionCost: value,
      marketImpact: value * 0.65,
    }, 10),
  }));
}

function runMany(config, count) {
  const runs = [];
  for (let i = 0; i < count; i += 1) {
    runs.push(runSeed({ ...config, seed: config.seed + i * 211 }));
  }
  return {
    config,
    runs,
    avg: averageRuns(runs),
    series: buildSeedSeries(runs),
    equitySeries: buildAverageEquitySeries(runs),
  };
}

function runSeed(config) {
  const market = simulateMarket(config);
  const episodes = buildEpisodes(market, config);
  const models = trainModels(episodes.train, config);
  return evaluateModels(episodes.test, models, config);
}

function simulateMarket(config) {
  const total = config.trainSize + config.testSize;
  const rand = rng(hashSeed(`market-${config.seed}-${config.mode}`));
  const features = [];
  const alpha = [];
  const returns = [];
  const price = [100];
  const fundamental = [100];
  let priorReturn = 0;
  let newsLag = 0;
  let hiddenLag = 0;
  let theta = initialTheta(config.mode);
  let hiddenTheta = between(rand, -0.012, 0.012);
  const baseTheta = theta.slice();

  for (let t = 0; t < total; t += 1) {
    const phase = t < config.trainSize ? "train" : "test";
    const progress = phase === "test" ? (t - config.trainSize) / Math.max(1, config.testSize - 1) : 0;
    const shock = normal(rand);
    const lastPrice = price[price.length - 1];
    const nextFundamental = fundamental[fundamental.length - 1] * Math.exp(0.00015 + 0.004 * normal(rand));
    fundamental.push(nextFundamental);
    newsLag = 0.82 * newsLag + 0.45 * shock + 0.16 * normal(rand);
    hiddenLag = 0.76 * hiddenLag + normal(rand);
    const valuationGap = clamp((nextFundamental - lastPrice) / lastPrice, -0.18, 0.18);
    const x = [
      clamp(priorReturn / 0.025, -2.5, 2.5),
      clamp(valuationGap / 0.06, -2.5, 2.5),
      clamp(newsLag, -2.5, 2.5),
    ];
    features.push(x);
    theta = updateTheta(theta, baseTheta, config, phase, progress, rand);
    hiddenTheta = 0.97 * hiddenTheta + config.regimeShift * 0.004 * normal(rand);
    let rawAlpha = dot(theta, x);
    if (config.mode === "efficient") rawAlpha = 0;
    if (config.mode === "unlearnable") rawAlpha = hiddenTheta * clamp(hiddenLag, -2.5, 2.5);
    const expressedAlpha = (1 - config.lambda) * clamp(rawAlpha, -0.045, 0.045);
    const r = clamp(0.00005 + expressedAlpha + config.noise * normal(rand), -0.16, 0.16);
    returns.push(r);
    priorReturn = r;
    price.push(Math.max(1, lastPrice * Math.exp(r)));
    alpha.push(expressedAlpha);
  }
  return { ...config, total, features, alpha, returns, price: price.slice(1) };
}

function initialTheta(mode) {
  if (mode === "efficient" || mode === "unlearnable") return [0, 0, 0];
  if (mode === "historical") return [0.009, 0.012, 0.006];
  if (mode === "local") return [0.004, 0.01, 0.01];
  if (mode === "rapid") return [0.012, -0.008, 0.01];
  return [0.011, 0.004, 0.009];
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

function buildEpisodes(market, config) {
  const lookback = config.predictionLookback;
  const horizon = config.predictionHorizon;
  const threshold = config.noise * Math.sqrt(horizon) * 0.12;
  const train = [];
  const test = [];
  for (let t = lookback; t < market.total - horizon; t += 1) {
    const futureReturn = sumSlice(market.returns, t, t + horizon) - 0.00005 * horizon;
    const episode = {
      t,
      vector: predictionVector(market, t, lookback, config),
      futureReturn,
      direction: directionFromReturn(futureReturn, threshold),
    };
    if (t < market.trainSize - horizon) train.push(episode);
    if (t >= market.trainSize) test.push(episode);
  }
  return { train, test };
}

function predictionVector(market, t, lookback, config) {
  const start = Math.max(0, t - lookback);
  const window = market.returns.slice(start, t);
  const short = market.returns.slice(Math.max(start, t - Math.min(6, lookback)), t);
  const longMomentum = mean(window);
  const shortMomentum = mean(short);
  const lastReturn = market.returns[t - 1] || 0;
  const vol = std(window);
  const feature = market.features[Math.max(0, t - 1)] || [0, 0, 0];
  const oldPrice = market.price[start] || market.price[0] || 100;
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

function trainModels(train, config) {
  const split = Math.max(30, Math.floor(train.length * 0.72));
  const fit = train.slice(0, split);
  const validation = train.slice(split);
  const pretrained = ridgeFitN(
    fit.map((e) => e.vector),
    fit.map((e) => e.futureReturn),
    0.18,
  );
  return {
    random: { type: "random" },
    oracle: { type: "oracle" },
    pretrained: { type: "linear", weights: pretrained.slice() },
    online: { type: "online", weights: new Array(pretrained.length).fill(0), rate: 0.035 },
    hybrid: { type: "online", weights: pretrained.slice(), rate: 0.018 },
    transformer: { type: "memory", memory: fit.concat(validation).slice(-520) },
    evolutionary: { type: "linear", weights: evolveWeights(fit, validation, config) },
    swarm: { type: "swarm" },
  };
}

function evolveWeights(fit, validation, config) {
  const dim = fit[0]?.vector.length || 8;
  const rand = rng(hashSeed(`evo-${config.seed}-${config.mode}-${config.predictionHorizon}`));
  const popSize = Math.max(12, config.predictionSwarmSize);
  let pop = [ridgeFitN(fit.map((e) => e.vector), fit.map((e) => e.futureReturn), 0.18)];
  while (pop.length < popSize) pop.push(Array.from({ length: dim }, () => between(rand, -0.018, 0.018)));
  for (let g = 0; g < config.predictionGenerations; g += 1) {
    const scored = pop.map((weights) => ({ weights, score: policyScore(weights, validation, config) })).sort((a, b) => b.score - a.score);
    const elites = scored.slice(0, Math.max(4, Math.floor(popSize * 0.18))).map((x) => x.weights);
    const next = elites.map((x) => x.slice());
    while (next.length < popSize) {
      const a = elites[Math.floor(rand() * elites.length)];
      const b = elites[Math.floor(rand() * elites.length)];
      next.push(a.map((v, i) => clamp((v + b[i]) / 2 + normal(rand) * 0.004, -0.045, 0.045)));
    }
    pop = next;
  }
  return pop.map((weights) => ({ weights, score: policyScore(weights, validation, config) })).sort((a, b) => b.score - a.score)[0].weights;
}

function policyScore(weights, episodes, config) {
  let pnl = 0;
  let prev = 0;
  let correct = 0;
  for (const episode of episodes) {
    const prediction = predictionFromScore(dot(weights, episode.vector), config);
    const position = prediction.direction * prediction.confidence;
    const cost = predictionExposure() * Math.abs(position - prev) * (config.transactionCost + config.marketImpact) * predictionFriction(config);
    pnl += predictionExposure() * position * episode.futureReturn - cost;
    correct += prediction.direction === episode.direction ? 1 : 0;
    prev = position;
  }
  return pnl + (correct / Math.max(1, episodes.length) - 0.5) * 0.12;
}

function evaluateModels(test, models, config) {
  const rand = rng(hashSeed(`random-${config.seed}-${config.mode}`));
  const metrics = Object.fromEntries(ALL_AGENTS.map(([key]) => [key, emptyMetric(key)]));
  const members = ["pretrained", "online", "hybrid", "transformer", "evolutionary"];
  const skill = Object.fromEntries(members.map((key) => [key, 0.52]));
  for (const episode of test) {
    const predictions = {};
    for (const [key] of ALL_AGENTS) {
      if (key === "swarm") continue;
      predictions[key] = predict(key, models[key], episode, config, rand);
    }
    let vote = 0;
    let total = 0;
    for (const key of members) {
      const weight = 0.15 + Math.max(0, skill[key] - 0.45) * 2.6;
      vote += weight * predictions[key].direction * predictions[key].confidence;
      total += weight;
    }
    predictions.swarm = predictionFromScore((vote / Math.max(1e-9, total)) * config.noise * 1.8, config);
    for (const [key] of ALL_AGENTS) applyOutcome(metrics[key], predictions[key], episode, config, key);
    for (const key of ["online", "hybrid"]) updateOnline(models[key], predictions[key].score, episode);
    models.transformer.memory.push(episode);
    if (models.transformer.memory.length > 640) models.transformer.memory.shift();
    for (const key of members) skill[key] = 0.94 * skill[key] + 0.06 * (predictions[key].direction === episode.direction ? 1 : 0);
  }
  for (const metric of Object.values(metrics)) finalizeMetric(metric);
  return metrics;
}

function predict(key, model, episode, config, rand) {
  if (model.type === "oracle") return { direction: episode.direction, confidence: episode.direction === 0 ? 0.25 : 1, score: episode.futureReturn };
  if (model.type === "random") {
    const roll = rand();
    const direction = roll < 0.42 ? -1 : roll < 0.58 ? 0 : 1;
    return { direction, confidence: direction === 0 ? 0.25 : 0.45, score: direction * config.noise };
  }
  if (model.type === "memory") return predictionFromScore(memoryScore(model.memory, episode.vector), config);
  return predictionFromScore(dot(model.weights, episode.vector), config);
}

function memoryScore(memory, vector) {
  if (!memory.length) return 0;
  const norm = Math.sqrt(dot(vector, vector)) || 1;
  const start = Math.max(0, memory.length - 520);
  let weighted = 0;
  let total = 0;
  for (let i = start; i < memory.length; i += 1) {
    const item = memory[i];
    const sim = dot(vector, item.vector) / (norm * (Math.sqrt(dot(item.vector, item.vector)) || 1));
    const recency = 0.65 + 0.35 * ((i - start) / Math.max(1, memory.length - start));
    const weight = Math.exp(clamp(sim * 3.2, -5, 5)) * recency;
    weighted += weight * item.futureReturn;
    total += weight;
  }
  return weighted / Math.max(1e-9, total);
}

function predictionFromScore(score, config) {
  const threshold = config.noise * Math.sqrt(config.predictionHorizon) * 0.09;
  const direction = Math.abs(score) < threshold ? 0 : Math.sign(score);
  const confidence = direction === 0 ? 0.28 : clamp(Math.abs(score) / Math.max(threshold * 4, 1e-6), 0.18, 1);
  return { direction, confidence, score };
}

function emptyMetric(agentKey) {
  return {
    agentKey,
    count: 0,
    correct: 0,
    confidenceTotal: 0,
    returns: [],
    equity: [1],
    prevPosition: 0,
    turnover: 0,
    upCorrect: 0,
    upTotal: 0,
    downCorrect: 0,
    downTotal: 0,
    bins: Array.from({ length: 5 }, () => ({ count: 0, confidence: 0, correct: 0 })),
  };
}

function applyOutcome(metric, prediction, episode, config, key) {
  const position = prediction.direction * prediction.confidence;
  const turnover = Math.abs(position - metric.prevPosition);
  const cost = config.useCosts && key !== "oracle" ? predictionExposure() * turnover * (config.transactionCost + config.marketImpact) * predictionFriction(config) : 0;
  const net = predictionExposure() * position * episode.futureReturn - cost;
  const correct = prediction.direction === episode.direction ? 1 : 0;
  const bin = Math.min(4, Math.max(0, Math.floor(prediction.confidence * 5)));
  metric.count += 1;
  metric.correct += correct;
  metric.confidenceTotal += prediction.confidence;
  metric.returns.push(net);
  metric.equity.push(Math.max(0.02, metric.equity[metric.equity.length - 1] + net));
  metric.turnover += turnover;
  metric.prevPosition = position;
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

function finalizeMetric(metric) {
  metric.accuracy = metric.correct / Math.max(1, metric.count);
  metric.pnl = metric.equity[metric.equity.length - 1] - 1;
  metric.sharpe = annualizedSharpe(metric.returns);
  metric.avgConfidence = metric.confidenceTotal / Math.max(1, metric.count);
  metric.calibrationError = metric.bins.reduce((sum, bin) => {
    if (!bin.count) return sum;
    return sum + Math.abs(bin.correct / bin.count - bin.confidence / bin.count) * (bin.count / Math.max(1, metric.count));
  }, 0);
  metric.upAccuracy = metric.upCorrect / Math.max(1, metric.upTotal);
  metric.downAccuracy = metric.downCorrect / Math.max(1, metric.downTotal);
}

function averageRuns(runs) {
  const avg = {};
  for (const [key] of ALL_AGENTS) {
    const rows = runs.map((run) => run[key]);
    const bins = Array.from({ length: 5 }, (_, i) => rows.reduce((acc, row) => {
      acc.count += row.bins[i].count;
      acc.confidence += row.bins[i].confidence;
      acc.correct += row.bins[i].correct;
      return acc;
    }, { count: 0, confidence: 0, correct: 0 }));
    avg[key] = {
      agentKey: key,
      pnl: mean(rows.map((r) => r.pnl)),
      accuracy: mean(rows.map((r) => r.accuracy)),
      sharpe: mean(rows.map((r) => r.sharpe)),
      calibrationError: mean(rows.map((r) => r.calibrationError)),
      oracleGap: mean(rows.map((r) => Math.max(0, runOraclePnl(rows, runs) - r.pnl))),
      upAccuracy: mean(rows.map((r) => r.upAccuracy)),
      downAccuracy: mean(rows.map((r) => r.downAccuracy)),
      bins,
    };
  }
  const oraclePnl = avg.oracle.pnl;
  for (const [key] of ALL_AGENTS) avg[key].oracleGap = Math.max(0, oraclePnl - avg[key].pnl);
  return avg;
}

function runOraclePnl() {
  return 0;
}

function buildSeedSeries(runs) {
  const out = {};
  for (const [key] of ALL_AGENTS) {
    out[key] = {
      pnl: runs.map((run) => run[key].pnl),
      accuracy: runs.map((run) => run[key].accuracy),
      sharpe: runs.map((run) => run[key].sharpe),
      oracleGap: runs.map((run) => Math.max(0, run.oracle.pnl - run[key].pnl)),
    };
  }
  return out;
}

function buildAverageEquitySeries(runs) {
  const out = {};
  for (const [key] of ALL_AGENTS) {
    const length = Math.max(...runs.map((run) => run[key].equity.length));
    out[key] = Array.from({ length }, (_, index) => {
      const values = runs.map((run) => {
        const equity = run[key].equity;
        return (equity[Math.min(index, equity.length - 1)] || 1) - 1;
      });
      return mean(values);
    });
  }
  return out;
}

function runCrowdingEcologyStudy() {
  const runs = Array.from({ length: 24 }, (_, i) => runCrowdingEcologySeed(1009 + i * 211));
  const length = Math.max(...runs.map((run) => run.alphaStrength.length));
  const averageSeries = (getter) =>
    Array.from({ length }, (_, index) => mean(runs.map((run) => getter(run)[Math.min(index, getter(run).length - 1)])));
  const equitySeries = {};
  const phaseReturns = {};
  for (const [key] of AGENTS) {
    equitySeries[key] = averageSeries((run) => run.equity[key]);
    phaseReturns[key] = [0, 1, 2, 3].map((phase) => mean(runs.map((run) => run.phaseReturns[key][phase])));
  }
  return {
    alphaStrength: averageSeries((run) => run.alphaStrength),
    crowding: averageSeries((run) => run.crowding),
    exploitation: averageSeries((run) => run.exploitation),
    abandonment: averageSeries((run) => run.abandonment),
    opportunity: averageSeries((run) => run.opportunity),
    equitySeries,
    phaseReturns,
  };
}

function runCrowdingEcologySeed(seed) {
  const rand = rng(hashSeed(`ecology-${seed}`));
  const steps = 360;
  let signal = 0;
  let alphaStrength = 0.78;
  let crowding = 0.18;
  let abandonment = 0.04;
  let recentPain = 0;
  const adaptiveBias = {
    online: 0.2,
    hybrid: 0.55,
    transformer: 0.78,
    evolutionary: 0.35,
    swarm: 0.38,
  };
  const skill = { pretrained: 0.55, online: 0.5, hybrid: 0.53, transformer: 0.54, evolutionary: 0.53 };
  const equity = Object.fromEntries(AGENTS.map(([key]) => [key, [0]]));
  const phaseReturns = Object.fromEntries(AGENTS.map(([key]) => [key, [0, 0, 0, 0]]));
  const arrays = {
    alphaStrength: [],
    crowding: [],
    exploitation: [],
    abandonment: [],
    opportunity: [],
  };

  for (let t = 0; t < steps; t += 1) {
    const phase = Math.min(3, Math.floor((t / steps) * 4));
    const target = ecologyPhaseTarget(phase);
    signal = 0.86 * signal + 0.38 * normal(rand);
    const trendSign = Math.sign(signal) || 1;
    const signalMagnitude = clamp(Math.abs(signal), 0.25, 2.2);
    alphaStrength = clamp(alphaStrength + 0.06 * (target.alpha - alphaStrength) + 0.012 * normal(rand), 0.02, 1.15);
    crowding = clamp(
      crowding + 0.07 * (target.crowding - crowding) - 0.045 * abandonment + 0.012 * normal(rand),
      0,
      1,
    );
    abandonment = clamp(abandonment + 0.08 * (target.abandonment - abandonment) + recentPain * 0.025, 0, 1);

    const trendEdge = 0.018 * alphaStrength * Math.max(-0.65, 1 - 1.35 * crowding);
    const contrarianEdge = 0.014 * Math.max(0, crowding - 0.48) + 0.008 * abandonment;
    const reentryEdge = 0.012 * Math.max(0, alphaStrength - 0.58) * Math.max(0, 1 - crowding);
    const trueReturn =
      trendSign * (trendEdge - contrarianEdge + reentryEdge) * signalMagnitude + 0.006 * normal(rand);

    const laggedBias = clamp(adaptiveBias.transformer + 0.12 * crowding - 0.08 * abandonment, -1, 1);
    const positions = {
      pretrained: trendSign * 0.82,
      online: trendSign * adaptiveBias.online,
      hybrid: trendSign * adaptiveBias.hybrid,
      transformer: trendSign * laggedBias,
      evolutionary: trendSign * adaptiveBias.evolutionary,
    };
    let swarmVote = 0;
    let swarmWeight = 0;
    for (const key of Object.keys(positions)) {
      const weight = 0.15 + Math.max(0, skill[key] - 0.45) * 2.4;
      swarmVote += positions[key] * weight;
      swarmWeight += weight;
    }
    positions.swarm = clamp(swarmVote / Math.max(1e-9, swarmWeight), -1, 1);
    const exploitation = mean(Object.values(positions).map(Math.abs));
    crowding = clamp(crowding + exploitation * 0.014, 0, 1);

    const stepRewards = [];
    for (const [key] of AGENTS) {
      const position = positions[key];
      const prev = equity[key].position || 0;
      const cost = Math.abs(position - prev) * 0.00032;
      const reward = 0.08 * position * trueReturn - cost;
      equity[key].push(equity[key][equity[key].length - 1] + reward);
      equity[key].position = position;
      phaseReturns[key][phase] += reward;
      stepRewards.push(reward);
      if (key in skill) skill[key] = 0.94 * skill[key] + 0.06 * (reward > 0 ? 1 : 0);
      if (key in adaptiveBias) {
        const alignment = Math.sign(position || trendSign) * trendSign;
        const learningRate = key === "transformer" ? 5 : key === "evolutionary" ? 18 : key === "online" ? 15 : 9;
        adaptiveBias[key] = clamp(adaptiveBias[key] + learningRate * reward * alignment - 0.012 * abandonment, -0.92, 0.95);
      }
    }

    recentPain = clamp(0.92 * recentPain + Math.max(0, -mean(stepRewards)) * 18, 0, 1);
    if (phase === 3) {
      adaptiveBias.online = clamp(adaptiveBias.online + 0.012, -0.5, 0.95);
      adaptiveBias.hybrid = clamp(adaptiveBias.hybrid + 0.007, -0.4, 0.9);
      adaptiveBias.evolutionary = clamp(adaptiveBias.evolutionary + 0.01, -0.55, 0.92);
    }

    arrays.alphaStrength.push(alphaStrength);
    arrays.crowding.push(crowding);
    arrays.exploitation.push(exploitation);
    arrays.abandonment.push(abandonment);
    arrays.opportunity.push(alphaStrength * (1 - crowding));
  }

  for (const [key] of AGENTS) {
    delete equity[key].position;
  }
  return { ...arrays, equity, phaseReturns };
}

function ecologyPhaseTarget(phase) {
  return [
    { alpha: 0.86, crowding: 0.16, abandonment: 0.04 },
    { alpha: 0.36, crowding: 0.86, abandonment: 0.14 },
    { alpha: 0.28, crowding: 0.32, abandonment: 0.82 },
    { alpha: 0.82, crowding: 0.24, abandonment: 0.18 },
  ][phase];
}

function renderSlides(data) {
  const slides = buildSlideDefinitions(data).map(enrichSlideAnalysis);
  const grid = document.getElementById("slideGrid");
  activeDrawFns.length = 0;
  grid.innerHTML = slides.map((slide, i) => `
    <article class="slide-card deck-slide ${slide.full ? "full" : ""}" data-slide-label="${escapeHtml(slide.kicker)}">
      <header>
        <div>
          <p class="eyebrow">${slide.kicker}</p>
          <h2>${slide.title}</h2>
          <p>${slide.insight}</p>
        </div>
        <span class="slide-number">${String(i + 1).padStart(2, "0")}/${slides.length}</span>
      </header>
      <canvas id="slideChart${i}" data-draw-index="${i}" height="${slide.full ? 360 : 315}"></canvas>
      <div class="chart-label-row">
        <span class="chart-chip">Y: ${slide.yLabel}</span>
        <span class="chart-chip">X: ${slide.xLabel}</span>
        <span class="chart-chip">Data: ${slide.dataLabel}</span>
      </div>
      <ul class="analysis-list">
        ${slide.analysis.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </article>
  `).join("");
  slides.forEach((slide) => activeDrawFns.push(slide.draw));
  initPresentation();
}

function buildSlideDefinitions(data) {
  return [
    ...trainingRegimeSlides(),
    metricByRegimeSlide(data, "pnl", "Average Net PnL By Regime", "Outcome", "Alpha capture concentrates in historically and locally learnable markets; efficient and unlearnable regimes punish non-oracle search.", pct, true),
    metricByRegimeSlide(data, "accuracy", "Directional Accuracy By Regime", "Prediction", "Accuracy alone is not enough, but it reveals where each training regime can infer future excess returns.", pct, false),
    metricByRegimeSlide(data, "sharpe", "Prediction Sharpe By Regime", "Risk", "Sharpe separates noisy hit rates from economically useful forecasts after cost and horizon friction.", num, false),
    metricByRegimeSlide(data, "calibrationError", "Calibration Error By Regime", "Calibration", "Overconfident agents show up as high calibration error, especially in efficient and rapidly shifting markets.", pct, false),
    metricByRegimeSlide(data, "oracleGap", "Oracle Gap By Regime", "Upper Bound", "The gap to the privileged future-label oracle measures uncaptured theoretical inefficiency.", pct, false),
    equityCurveSlide(data.regimes.efficient, "Efficient Null: Cumulative PnL", "Null Test", "Through the test market, non-oracle predictors should drift around or below zero after costs.", pct),
    equityCurveSlide(data.regimes.historical, "Historical Alpha: Cumulative PnL", "Stability", "Stable historical alpha produces compounding forecast value as pretrained, evolutionary, and swarm policies keep harvesting the same structure.", pct),
    equityCurveSlide(data.regimes.local, "Local Alpha: Cumulative PnL", "Adaptation", "Locally persistent alpha rewards agents that can keep updating as the current market structure unfolds.", pct),
    equityCurveSlide(data.regimes.rapid, "Rapid Shift: Cumulative PnL", "Failure Mode", "When alpha decays quickly, the curve shows whether learners adapt before the edge disappears.", pct),
    equityCurveSlide(data.regimes.crowded, "Crowded Alpha: Cumulative PnL", "Crowding", "Crowded markets reveal whether stale priors fade while adaptive or diversified swarms preserve capacity.", pct),
    equityCurveSlide(data.regimes.unlearnable, "Unlearnable Alpha: Cumulative PnL", "Information Set", "Hidden alpha may exist, but cumulative curves should not show durable non-oracle extraction without the hidden variable.", pct),
    distributionSlide(data, "Agent PnL Distribution Across Regimes", "Dispersion", "Box-style ranges show which predictors are robust versus dependent on one lucky world.", pct),
    directionBalanceSlide(data.regimes.historical, "Historical Alpha: Up/Down Skill", "Direction", "A strong predictor should not only ride one side; this graph checks whether up and down calls both work.", pct),
    directionBalanceSlide(data.regimes.crowded, "Crowded Alpha: Up/Down Skill", "Direction", "Crowding can invert or decay one side of the signal, creating directional imbalance.", pct),
    sweepSlide(data.horizonHistorical, "predictionHorizon", "Historical Alpha: Horizon Sensitivity", "Horizon", "Stable alpha remains forecastable across moderate horizons, but very long horizons dilute signal.", pct),
    sweepSlide(data.horizonLocal, "predictionHorizon", "Local Alpha: Horizon Sensitivity", "Horizon", "Local alpha favors short-to-medium horizons before the current structure fades.", pct),
    sweepSlide(data.lookbackHistorical, "predictionLookback", "Historical Alpha: Lookback Sensitivity", "Lookback", "Stable markets can benefit from longer past windows because old data remains relevant.", pct),
    sweepSlide(data.lookbackRapid, "predictionLookback", "Rapid Shift: Lookback Sensitivity", "Lookback", "Rapidly changing markets punish long windows that mix stale and current regimes.", pct),
    costSlide(data.costCrowded, "Crowded Alpha: Cost Sensitivity", "Costs", "Once costs and impact rise, high-turnover adaptive policies lose capacity first.", pct),
    sweepSlide(data.swarmLocal, "predictionSwarmSize", "Local Alpha: Swarm Size Sensitivity", "Swarm", "More candidates help until validation search starts harvesting noise instead of stable structure.", pct, true),
    ecologyStateSlide(data.ecology),
    ecologyPnlSlide(data.ecology),
    ecologyPhaseSlide(data.ecology),
    ecologyLoopSlide(data.ecology),
  ];
}

function trainingRegimeSlides() {
  return TRAINING_REGIMES.map((regime) => ({
    title: regime.title,
    kicker: regime.kicker,
    insight: regime.insight,
    full: true,
    xLabel: "Training pipeline",
    yLabel: "Information access",
    dataLabel: "Toy model specification",
    analysis: regime.analysis,
    draw: (canvas) => trainingRegimePanel(canvas, regime),
  }));
}

function metricByRegimeSlide(data, metric, title, kicker, insight, formatter, full) {
  return {
    title,
    kicker,
    insight,
    full,
    xLabel: "Market regime",
    yLabel: metricLabel(metric),
    dataLabel: "24 seeds per regime",
    draw: (canvas) => groupedBarChart(canvas, Object.keys(REGIMES).map((key) => REGIMES[key].label), AGENTS.map(([key, label]) => ({
      key,
      label,
      color: COLORS[key],
      values: Object.keys(REGIMES).map((regime) => data.regimes[regime].avg[key][metric]),
    })), formatter, metricLabel(metric), "Market regime"),
  };
}

function seedLineSlide(result, metric, title, kicker, insight, formatter) {
  return {
    title,
    kicker,
    insight,
    xLabel: "Seed index",
    yLabel: metricLabel(metric),
    dataLabel: "24 deterministic seeds",
    draw: (canvas) => lineChart(canvas, AGENTS.map(([key, label]) => ({
      label,
      color: COLORS[key],
      values: result.series[key][metric],
    })), formatter, "Seed index", undefined, metricLabel(metric)),
  };
}

function equityCurveSlide(result, title, kicker, insight, formatter) {
  return {
    title,
    kicker,
    insight,
    xLabel: "Prediction episode",
    yLabel: "Net PnL",
    dataLabel: "Mean cumulative curve across 24 seeds",
    draw: (canvas) => lineChart(canvas, AGENTS.map(([key, label]) => ({
      label,
      color: COLORS[key],
      values: result.equitySeries[key],
    })), formatter, "Prediction episode", undefined, "Net PnL"),
  };
}

function distributionSlide(data, title, kicker, insight, formatter) {
  const valuesByAgent = AGENTS.map(([key, label]) => {
    const values = Object.values(data.regimes).flatMap((regime) => regime.series[key].pnl);
    return { key, label, color: COLORS[key], values };
  });
  return {
    title,
    kicker,
    insight,
    full: true,
    xLabel: "Agent family",
    yLabel: "Net PnL",
    dataLabel: "All regimes x 24 seeds",
    draw: (canvas) => rangeChart(canvas, valuesByAgent, formatter, "Net PnL", "Agent family"),
  };
}

function directionBalanceSlide(result, title, kicker, insight, formatter) {
  return {
    title,
    kicker,
    insight,
    xLabel: "Agent family",
    yLabel: "Directional accuracy",
    dataLabel: "Average up vs down hit rate",
    draw: (canvas) => pairedBarChart(canvas, AGENTS.map(([key, label]) => ({
      label,
      color: COLORS[key],
      a: result.avg[key].upAccuracy,
      b: result.avg[key].downAccuracy,
    })), "Up", "Down", formatter, "Directional accuracy", "Agent family"),
  };
}

function sweepSlide(rows, field, title, kicker, insight, formatter, full) {
  return {
    title,
    kicker,
    insight,
    full,
    xLabel: fieldLabel(field),
    yLabel: "Net PnL",
    dataLabel: "10 seeds per setting",
    draw: (canvas) => lineChart(canvas, ["pretrained", "online", "hybrid", "transformer", "evolutionary", "swarm"].map((key) => ({
      label: shortLabel(key),
      color: COLORS[key],
      values: rows.map((row) => row.result.avg[key].pnl),
    })), formatter, fieldLabel(field), rows.map((row) => String(row.value)), "Net PnL"),
  };
}

function costSlide(rows, title, kicker, insight, formatter) {
  return sweepSlide(rows, "cost", title, kicker, insight, formatter, false);
}

function enrichSlideAnalysis(slide) {
  if (slide.analysis?.length) return slide;
  const defaults = {
    Outcome: [
      "Read this as economic extraction, not just classification quality.",
      "Bars below the red zero line indicate that costs and friction overwhelmed the forecast.",
      "Compare agent families within each regime before comparing across regimes.",
    ],
    Prediction: [
      "The red 50% line is the rough no-skill reference for directional calls.",
      "Accuracy can be misleading when confidence, costs, or direction imbalance are poor.",
      "Use this together with PnL and calibration, not as a standalone winner chart.",
    ],
    Risk: [
      "Sharpe rewards stable, repeatable prediction-derived returns.",
      "High PnL with weak Sharpe suggests a fragile or lumpy strategy.",
      "Efficient and rapidly shifting regimes should suppress durable Sharpe.",
    ],
    Calibration: [
      "Lower calibration error means confidence better matches realized hit rate.",
      "Overconfident agents can look good briefly while being dangerous live.",
      "Crowding and rapid shifts often create miscalibration because old confidence is stale.",
    ],
    "Upper Bound": [
      "The oracle is not tradable; it is a privileged benchmark.",
      "Large oracle gaps mean alpha exists but the agent class cannot capture it well.",
      "Small gaps in inefficient regimes indicate effective extraction of available structure.",
    ],
    "Null Test": [
      "The efficient null should keep normal agents at or below zero after costs.",
      "Persistent positive PnL here would imply leakage, drift harvesting, or overfit selection.",
      "The cumulative curve is averaged across seeds, so one lucky run should not dominate.",
    ],
    Stability: [
      "Stable alpha should create a smooth upward cumulative curve for historical learners.",
      "Pretrained and evolutionary agents tend to benefit when train and test structure match.",
      "The red zero line marks whether the edge remains economically useful.",
    ],
    Adaptation: [
      "Local alpha rewards agents that learn from recent feedback.",
      "A strong adaptive curve should improve or hold up as the test market unfolds.",
      "Compare online, hybrid, and swarm against frozen pretrained behavior.",
    ],
    "Failure Mode": [
      "Rapid shifts test whether the agent learns faster than alpha decays.",
      "Downward curves are evidence that the model is chasing stale structure.",
      "Flat or defensive curves can be better than aggressive over-trading.",
    ],
    Crowding: [
      "Crowded markets initially reward the common signal, then punish stale exposure.",
      "Late drawdowns show alpha decay or partial reversal.",
      "Adaptive policies should fade exposure or find less crowded structure.",
    ],
    "Information Set": [
      "Hidden alpha is not enough; the agent must observe something predictive before trade time.",
      "If non-oracle curves stay near zero, the simulation is efficient relative to the agent.",
      "This distinguishes theoretical inefficiency from tradable inefficiency.",
    ],
    Dispersion: [
      "Wide ranges mean performance depends heavily on market draw.",
      "Robust agents have better medians and tighter downside tails.",
      "Use dispersion to avoid over-reading one attractive average.",
    ],
    Direction: [
      "Balanced skill matters because one-sided agents fail when the market changes direction.",
      "Up/down asymmetry can reveal hidden bias toward momentum or reversal.",
      "A model with high average accuracy may still be brittle if one side is weak.",
    ],
    Horizon: [
      "Short horizons can be noisy; long horizons can dilute local alpha.",
      "The best horizon is where learnability and signal lifetime overlap.",
      "A collapsing line indicates that the edge does not persist that far ahead.",
    ],
    Lookback: [
      "Longer lookbacks help when history remains relevant.",
      "Shorter lookbacks help when stale data contaminates the current regime.",
      "This is a direct test of historical memory versus adaptation.",
    ],
    Costs: [
      "Cost sensitivity measures whether an edge has capacity.",
      "High-turnover strategies should degrade fastest as friction rises.",
      "A robust predictor survives more than just the zero-cost toy world.",
    ],
    Swarm: [
      "Bigger swarms increase search breadth but can also select noise.",
      "Look for a plateau rather than assuming more candidates always help.",
      "The best swarm size balances diversity, validation risk, and adaptability.",
    ],
  };
  return {
    ...slide,
    analysis: defaults[slide.kicker] || [
      "Compare curves relative to the red reference line.",
      "Focus on robustness across regimes, not one isolated winner.",
      "Interpret the graph through the agent's information access and training regime.",
    ],
  };
}

function ecologyStateSlide(ecology) {
  return {
    title: "Adaptive Crowding Cycle: Alpha, Crowding, And Abandonment",
    kicker: "Ecology",
    insight:
      "This simulation adds feedback: agents crowd into a working edge, the edge decays, losses trigger abandonment, and lower crowding lets alpha strength rebuild.",
    xLabel: "Prediction episode",
    yLabel: "Alpha / crowding index",
    dataLabel: "Mean ecology state across 24 seeds",
    analysis: [
      "Alpha strength and crowding are state variables, not agent PnL.",
      "When crowding rises, alpha strength tends to compress; when abandonment rises, crowding falls.",
      "This is the first place in the deck where alpha can reappear rather than only decay.",
    ],
    draw: (canvas) =>
      lineChart(
        canvas,
        [
          { label: "Alpha strength", color: COLORS.evolutionary, values: ecology.alphaStrength },
          { label: "Crowding", color: COLORS.random, values: ecology.crowding },
          { label: "Abandonment", color: COLORS.transformer, values: ecology.abandonment },
          { label: "Opportunity", color: COLORS.swarm, values: ecology.opportunity },
        ],
        pct,
        "Prediction episode",
        undefined,
        "Alpha / crowding index",
      ),
  };
}

function ecologyPnlSlide(ecology) {
  return {
    title: "Adaptive Crowding Cycle: Agent Cumulative PnL",
    kicker: "Ecology",
    insight:
      "Agent curves show who survives the crowding cycle: stale priors should suffer during decay, while adaptive and diversified policies can participate in re-emergence.",
    xLabel: "Prediction episode",
    yLabel: "Net PnL",
    dataLabel: "Mean cumulative curve across 24 ecology seeds",
    analysis: [
      "Early profits come from exploiting a real edge before the market gets crowded.",
      "Mid-cycle drawdowns show the cost of staying in after the edge has decayed.",
      "Late-cycle recovery indicates whether the agent can re-enter after abandonment restores opportunity.",
    ],
    draw: (canvas) =>
      lineChart(
        canvas,
        AGENTS.map(([key, label]) => ({
          label,
          color: COLORS[key],
          values: ecology.equitySeries[key],
        })),
        pct,
        "Prediction episode",
        undefined,
        "Net PnL",
      ),
  };
}

function ecologyPhaseSlide(ecology) {
  const phases = ["Harvest", "Crowding", "Abandon", "Re-entry"];
  return {
    title: "Adaptive Crowding Cycle: Returns By Phase",
    kicker: "Ecology",
    insight:
      "The same agent can be profitable in one phase and harmful in another. This chart decomposes performance by the ecology's rough lifecycle.",
    xLabel: "Cycle phase",
    yLabel: "Net PnL",
    dataLabel: "Quarter-phase returns across 24 ecology seeds",
    analysis: [
      "Harvest is the initial edge-discovery period.",
      "Crowding is when too many agents lean into the same signal.",
      "Re-entry is where adaptive policies can benefit from alpha rebuilding after abandonment.",
    ],
    draw: (canvas) =>
      groupedBarChart(
        canvas,
        phases,
        AGENTS.map(([key]) => ({
          key,
          label: shortLabel(key),
          color: COLORS[key],
          values: ecology.phaseReturns[key],
        })),
        pct,
        "Net PnL",
        "Cycle phase",
      ),
  };
}

function ecologyLoopSlide(ecology) {
  return {
    title: "Adaptive Crowding Cycle: Crowding Versus Alpha",
    kicker: "Ecology",
    insight:
      "The loop view shows the negative feedback relationship: as crowding increases, opportunity tends to compress; after abandonment, crowding falls and alpha can rebuild.",
    xLabel: "Crowding",
    yLabel: "Alpha strength",
    dataLabel: "Mean state trajectory across 24 ecology seeds",
    analysis: [
      "Dots move through simulated time rather than through different seeds.",
      "Upper-left regions mean alpha is available but not yet crowded.",
      "Lower-right regions mean the trade is crowded and the edge has been mostly consumed.",
    ],
    draw: (canvas) => scatterPathChart(canvas, ecology.crowding, ecology.alphaStrength, "Crowding", "Alpha strength"),
  };
}

function initPresentation() {
  const slides = [...document.querySelectorAll(".deck-slide")].filter((slide) => !slide.classList.contains("done"));
  const dots = document.getElementById("slideDots");
  const prev = document.getElementById("prevSlide");
  const next = document.getElementById("nextSlide");
  const counter = document.getElementById("slideCounter");
  const progress = document.getElementById("progressBar");
  let active = Math.max(0, slides.findIndex((slide) => slide.classList.contains("active")));

  dots.innerHTML = slides
    .map((slide, i) => `<button class="slide-dot" type="button" aria-label="Go to slide ${i + 1}: ${slide.dataset.slideLabel || "Graph"}"></button>`)
    .join("");
  const dotButtons = [...dots.querySelectorAll(".slide-dot")];

  const show = (index) => {
    active = clamp(index, 0, slides.length - 1);
    slides.forEach((slide, i) => slide.classList.toggle("active", i === active));
    dotButtons.forEach((dot, i) => dot.classList.toggle("active", i === active));
    prev.disabled = active === 0;
    next.disabled = active === slides.length - 1;
    counter.textContent = `${String(active + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
    progress.style.width = `${((active + 1) / slides.length) * 100}%`;
    requestAnimationFrame(() => redrawVisibleSlide(slides[active]));
  };

  prev.onclick = () => show(active - 1);
  next.onclick = () => show(active + 1);
  dotButtons.forEach((dot, i) => {
    dot.onclick = () => show(i);
  });
  window.onkeydown = (event) => {
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") show(active + 1);
    if (event.key === "ArrowLeft" || event.key === "PageUp") show(active - 1);
    if (event.key === "Home") show(0);
    if (event.key === "End") show(slides.length - 1);
  };
  window.onresize = () => redrawVisibleSlide(slides[active]);
  show(active);
}

function redrawVisibleSlide(slide) {
  const canvas = slide?.querySelector("canvas");
  if (!canvas?.dataset.drawIndex) return;
  const draw = activeDrawFns[Number(canvas.dataset.drawIndex)];
  if (draw) draw(canvas);
}

const activeDrawFns = [];

function trainingRegimePanel(canvas, regime) {
  const ctx = setup(canvas);
  const rect = canvas.getBoundingClientRect();
  const pad = 32;
  const headerH = 62;
  const gap = 14;
  const cardW = (rect.width - pad * 2 - gap) / 2;
  const cardH = (rect.height - headerH - pad - gap - 24) / 2;
  const cards = [
    ["Information", regime.data],
    ["Training rule", regime.training],
    ["During test", regime.testUpdate],
    ["Failure mode", regime.failureMode],
  ];

  ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
  roundedRect(ctx, pad, 24, rect.width - pad * 2, headerH, 8, true, false);
  ctx.fillStyle = regime.color;
  roundedRect(ctx, pad, 24, 8, headerH, 4, true, false);
  ctx.fillStyle = "#eef4f8";
  ctx.font = "700 18px Inter, ui-sans-serif, system-ui";
  ctx.fillText(regime.title.replace("Training Regime: ", ""), pad + 22, 49);
  ctx.font = "12px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillStyle = "#9caab5";
  ctx.fillText("What the chart line is allowed to know, how it is fit, and where it tends to break.", pad + 22, 72);

  cards.forEach(([label, body], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = pad + col * (cardW + gap);
    const y = 24 + headerH + 18 + row * (cardH + gap);
    ctx.fillStyle = "rgba(12, 17, 23, 0.92)";
    roundedRect(ctx, x, y, cardW, cardH, 8, true, true);
    ctx.fillStyle = regime.color;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(x + 16, y + 18, 22, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#eef4f8";
    ctx.font = "700 14px Inter, ui-sans-serif, system-ui";
    ctx.fillText(label, x + 16, y + 42);
    ctx.font = "12px Inter, ui-sans-serif, system-ui";
    ctx.fillStyle = "#b7c2cc";
    wrapCanvasText(ctx, body, x + 16, y + 66, cardW - 32, 17, 4);
  });
}

function groupedBarChart(canvas, labels, series, formatter, yLabel, xLabel) {
  const ctx = setup(canvas);
  const area = chartArea(canvas);
  const all = series.flatMap((s) => s.values);
  const min = Math.min(0, ...all);
  const max = Math.max(0.01, ...all);
  axes(ctx, canvas, formatter, min, max, xLabel, undefined, yLabel);
  const groupW = area.w / labels.length;
  const barW = Math.max(3, groupW / (series.length + 1));
  labels.forEach((label, i) => {
    series.forEach((s, j) => {
      const yValue = area.y + area.h - ((s.values[i] - min) / Math.max(1e-9, max - min)) * area.h;
      const zero = area.y + area.h - ((0 - min) / Math.max(1e-9, max - min)) * area.h;
      const x = area.x + i * groupW + j * barW + 3;
      ctx.fillStyle = s.color;
      ctx.fillRect(x, Math.min(zero, yValue), barW - 2, Math.abs(zero - yValue));
    });
    rotatedLabel(ctx, label, area.x + i * groupW + 8, area.y + area.h + 15);
  });
  legend(ctx, series.map((s) => [shortLabel(s.key), s.color]));
}

function lineChart(canvas, series, formatter, xLabel, customLabels, yLabel) {
  const ctx = setup(canvas);
  const all = series.flatMap((s) => s.values);
  const min = Math.min(0, ...all);
  const max = Math.max(0.01, ...all);
  axes(ctx, canvas, formatter, min, max, xLabel, customLabels, yLabel);
  for (const s of series) drawLine(ctx, canvas, s.values, s.color, min, max);
  legend(ctx, series.map((s) => [s.label, s.color]));
}

function pairedBarChart(canvas, rows, labelA, labelB, formatter, yLabel, xLabel) {
  const ctx = setup(canvas);
  const area = chartArea(canvas);
  axes(ctx, canvas, formatter, 0, 1, xLabel, undefined, yLabel);
  const groupW = area.w / rows.length;
  const barW = Math.max(8, groupW / 3);
  rows.forEach((row, i) => {
    const x = area.x + i * groupW + 5;
    const ah = row.a * area.h;
    const bh = row.b * area.h;
    ctx.fillStyle = row.color;
    ctx.fillRect(x, area.y + area.h - ah, barW, ah);
    ctx.fillStyle = "rgba(255, 113, 141, 0.82)";
    ctx.fillRect(x + barW + 4, area.y + area.h - bh, barW, bh);
    rotatedLabel(ctx, shortLabel(row.label), x, area.y + area.h + 15);
  });
  legend(ctx, [[labelA, COLORS.online], [labelB, COLORS.random]]);
}

function rangeChart(canvas, rows, formatter, yLabel, xLabel) {
  const ctx = setup(canvas);
  const area = chartArea(canvas);
  const all = rows.flatMap((r) => r.values);
  const min = Math.min(0, ...all);
  const max = Math.max(0.01, ...all);
  axes(ctx, canvas, formatter, min, max, xLabel, undefined, yLabel);
  const gap = area.w / rows.length;
  rows.forEach((row, i) => {
    const values = row.values.slice().sort((a, b) => a - b);
    const q1 = quantile(values, 0.25);
    const med = quantile(values, 0.5);
    const q3 = quantile(values, 0.75);
    const lo = values[0];
    const hi = values[values.length - 1];
    const x = area.x + i * gap + gap * 0.42;
    const y = (v) => area.y + area.h - ((v - min) / Math.max(1e-9, max - min)) * area.h;
    ctx.strokeStyle = row.color;
    ctx.fillStyle = row.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y(lo));
    ctx.lineTo(x, y(hi));
    ctx.stroke();
    ctx.globalAlpha = 0.72;
    ctx.fillRect(x - 18, y(q3), 36, Math.max(3, y(q1) - y(q3)));
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#eef4f8";
    ctx.beginPath();
    ctx.moveTo(x - 20, y(med));
    ctx.lineTo(x + 20, y(med));
    ctx.stroke();
    rotatedLabel(ctx, shortLabel(row.key), area.x + i * gap + 8, area.y + area.h + 15);
  });
}

function scatterPathChart(canvas, xs, ys, xLabel, yLabel) {
  const ctx = setup(canvas);
  const area = chartArea(canvas);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(1, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(1, ...ys);
  axes(ctx, canvas, pct, minY, maxY, xLabel, undefined, yLabel);
  ctx.strokeStyle = "rgba(86, 207, 232, 0.85)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  xs.forEach((xValue, i) => {
    const x = area.x + ((xValue - minX) / Math.max(1e-9, maxX - minX)) * area.w;
    const y = area.y + area.h - ((ys[i] - minY) / Math.max(1e-9, maxY - minY)) * area.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  const markers = [
    ["start", 0, COLORS.online],
    ["mid", Math.floor(xs.length / 2), COLORS.transformer],
    ["end", xs.length - 1, COLORS.random],
  ];
  for (const [label, index, color] of markers) {
    const x = area.x + ((xs[index] - minX) / Math.max(1e-9, maxX - minX)) * area.w;
    const y = area.y + area.h - ((ys[index] - minY) / Math.max(1e-9, maxY - minY)) * area.h;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#eef4f8";
    ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.fillText(label, x + 7, y - 7);
  }
  legend(ctx, [
    ["trajectory", COLORS.evolutionary],
    ["start", COLORS.online],
    ["mid", COLORS.transformer],
    ["end", COLORS.random],
  ]);
}

function setup(canvas) {
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * scale));
  canvas.height = Math.max(1, Math.floor(rect.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "rgba(5, 7, 9, 0.5)";
  ctx.fillRect(0, 0, rect.width, rect.height);
  return ctx;
}

function roundedRect(ctx, x, y, w, h, r, fill, stroke) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) {
    ctx.strokeStyle = "rgba(188, 204, 216, 0.14)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth) {
      line = test;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.forEach((value, index) => {
    const suffix = index === maxLines - 1 && words.join(" ").length > lines.join(" ").length ? "..." : "";
    ctx.fillText(`${value}${suffix}`, x, y + index * lineHeight);
  });
}

function chartArea(canvas) {
  const rect = canvas.getBoundingClientRect();
  return { x: 68, y: 34, w: rect.width - 98, h: rect.height - 88 };
}

function axes(ctx, canvas, formatter, min, max, xLabel, customLabels, yLabel) {
  const area = chartArea(canvas);
  ctx.strokeStyle = "rgba(188, 204, 216, 0.15)";
  ctx.lineWidth = 1;
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillStyle = "#9caab5";
  for (let i = 0; i <= 4; i += 1) {
    const y = area.y + (area.h * i) / 4;
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
    ctx.stroke();
  }
  drawThresholdLine(ctx, area, min, max, yLabel);
  ctx.fillText(formatter(max), 9, area.y + 4);
  ctx.fillText(formatter((min + max) / 2), 9, area.y + area.h / 2 + 4);
  ctx.fillText(formatter(min), 9, area.y + area.h);
  if (xLabel) {
    ctx.fillStyle = "#eef4f8";
    ctx.fillText(xLabel, area.x, area.y + area.h + 54);
  }
  if (yLabel) {
    ctx.save();
    ctx.translate(18, area.y + area.h / 2 + 42);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = "#eef4f8";
    ctx.fillText(yLabel, 0, 0);
    ctx.restore();
  }
  if (customLabels) {
    ctx.fillStyle = "#9caab5";
    const step = area.w / Math.max(1, customLabels.length - 1);
    customLabels.forEach((label, i) => ctx.fillText(label, area.x + i * step - 4, area.y + area.h + 17));
  }
}

function drawThresholdLine(ctx, area, min, max, yLabel) {
  const label = String(yLabel || "").toLowerCase();
  const threshold = label.includes("accuracy") ? 0.5 : label.includes("pnl") || label.includes("alpha") ? 0 : null;
  if (threshold == null || threshold < min || threshold > max) return;
  const y = area.y + area.h - ((threshold - min) / Math.max(1e-9, max - min)) * area.h;
  ctx.save();
  ctx.strokeStyle = "#ff2f4f";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(area.x, y);
  ctx.lineTo(area.x + area.w, y);
  ctx.stroke();
  ctx.fillStyle = "#ff718d";
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillText(label.includes("accuracy") ? "50%" : "0%", area.x + area.w - 28, y - 5);
  ctx.restore();
}

function drawLine(ctx, canvas, values, color, min, max) {
  const area = chartArea(canvas);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = area.x + (area.w * i) / Math.max(1, values.length - 1);
    const y = area.y + area.h - ((v - min) / Math.max(1e-9, max - min)) * area.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function legend(ctx, items) {
  let x = 58;
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  items.slice(0, 7).forEach(([label, color]) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, 15, 10, 10);
    ctx.fillStyle = "#c7d2da";
    ctx.fillText(label, x + 14, 25);
    x += Math.min(138, label.length * 7 + 30);
  });
}

function rotatedLabel(ctx, label, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-Math.PI / 7);
  ctx.fillStyle = "#c7d2da";
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function updateOnline(model, score, episode) {
  const error = episode.futureReturn - score;
  const denom = 1 + dot(episode.vector, episode.vector);
  model.weights = model.weights.map((weight, i) => clamp(weight + model.rate * error * episode.vector[i] / denom, -0.05, 0.05));
}

function ridgeFitN(xs, ys, lambda) {
  const dim = xs[0]?.length || 0;
  if (!dim) return [];
  const xtx = Array.from({ length: dim }, (_, i) => Array.from({ length: dim }, (_, j) => (i === j ? lambda : 0)));
  const xty = new Array(dim).fill(0);
  xs.forEach((x, i) => {
    for (let a = 0; a < dim; a += 1) {
      xty[a] += x[a] * ys[i];
      for (let b = 0; b < dim; b += 1) xtx[a][b] += x[a] * x[b];
    }
  });
  return solveLinear(xtx, xty).map((v) => clamp(v, -0.05, 0.05));
}

function solveLinear(a, b) {
  const n = b.length;
  const m = a.map((row, i) => row.concat(b[i]));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
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

function predictionExposure() {
  return 0.08;
}

function predictionFriction(config) {
  return Math.max(1, Math.sqrt(Math.max(1, config.predictionHorizon)) * 6);
}

function annualizedSharpe(values) {
  const s = std(values);
  return s > 1e-9 ? (mean(values) / s) * Math.sqrt(252) : 0;
}

function directionFromReturn(value, threshold) {
  if (Math.abs(value) < threshold) return 0;
  return value > 0 ? 1 : -1;
}

function sumSlice(values, start, end) {
  let total = 0;
  for (let i = start; i < end; i += 1) total += values[i] || 0;
  return total;
}

function dot(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += a[i] * b[i];
  return total;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function std(values) {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) * (v - m))));
}

function quantile(values, q) {
  const idx = (values.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return values[lo] + (values[hi] - values[lo]) * (idx - lo);
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

function shortLabel(key) {
  const labels = {
    pretrained: "Pre",
    online: "RL",
    hybrid: "P+P",
    transformer: "Attn",
    evolutionary: "Evo",
    swarm: "Swm",
    oracle: "Orc",
    random: "Rnd",
  };
  return labels[key] || key;
}

function metricLabel(metric) {
  const labels = {
    pnl: "Net PnL",
    accuracy: "Directional accuracy",
    sharpe: "Annualized Sharpe",
    calibrationError: "Calibration error",
    oracleGap: "Oracle PnL gap",
  };
  return labels[metric] || metric;
}

function fieldLabel(field) {
  const labels = {
    predictionHorizon: "Prediction horizon",
    predictionLookback: "Past window length",
    predictionSwarmSize: "Swarm population",
    cost: "Cost + impact setting",
  };
  return labels[field] || field;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pct(value) {
  return `${(value * 100).toFixed(0)}%`;
}

function num(value) {
  return Number(value).toFixed(1);
}

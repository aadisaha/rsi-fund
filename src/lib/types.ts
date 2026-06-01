export type AccountMode = "paper" | "live" | "unconfigured";

export type ServiceStatus = {
  name: string;
  configured: boolean;
  ok: boolean;
  mode?: AccountMode | "demo" | "production" | "local";
  message: string;
};

export type AlpacaPosition = {
  symbol: string;
  qty: string;
  side?: "long" | "short";
  market_value?: string;
  unrealized_pl?: string;
  avg_entry_price?: string;
  current_price?: string;
};

export type KalshiPosition = {
  ticker: string;
  position_fp?: string;
  market_exposure_dollars?: string;
  realized_pnl_dollars?: string;
  fees_paid_dollars?: string;
  last_updated_ts?: number;
};

export type ObservationEvent = {
  type: "observation";
  source: "alpaca" | "kalshi" | "system";
  payload: Record<string, unknown>;
};

export type ForecastEvent = {
  type: "forecast";
  modelId: string;
  target: string;
  mean: number;
  sigma: number;
  payload: Record<string, unknown>;
};

export type PaperActionEvent = {
  type: "paper_action";
  action: "proposal" | "simulated_fill" | "rejected";
  channel: ChannelId | "portfolio" | "pretrained-rl-shadow";
  notionalUsd: number;
  reason: string;
  payload: Record<string, unknown>;
};

export type ModelVersionEvent = {
  type: "model_version";
  modelId: string;
  dataCutoff: string;
  score: number;
  payload: Record<string, unknown>;
};

export type CertificateEvent = {
  type: "certificate";
  approved: boolean;
  tRsi: number;
  threshold: number;
  reason: string;
  payload: Record<string, unknown>;
};

export type ResearchDecisionEvent = {
  type: "research_decision";
  decisionId: string;
  accepted: boolean;
  experimentId: string | null;
  reason: string;
  payload: Record<string, unknown>;
};

export type LedgerEvent =
  | ObservationEvent
  | ForecastEvent
  | PaperActionEvent
  | ModelVersionEvent
  | CertificateEvent
  | ResearchDecisionEvent;

export type LedgerRecord = LedgerEvent & {
  id: string;
  at: string;
};

export type ChannelId = "I" | "S" | "U" | "Z" | "Theta";

export type ChannelEstimate = {
  id: ChannelId;
  name: string;
  description: string;
  meanReturn: number;
  sigma: number;
  readiness: number;
  source: string;
};

export type AllocationProposal = {
  generatedAt: string;
  mode: "paper";
  deployableCapitalUsd: number;
  shadowPrice: number;
  riskAversion: number;
  killSwitch: boolean;
  channels: Array<
    ChannelEstimate & {
      riskAdjustedScore: number;
      proposedUsd: number;
    }
  >;
  constraints: Array<{ name: string; ok: boolean; message: string }>;
  summary: string;
};

export type InvestmentChannelDiagnostics = {
  sampleSize: number;
  evidenceWeight: number;
  hitRate: number | null;
  avgForecastScore: number;
  realizedReturn: number;
  alphaVsBenchmark: number | null;
  evidenceMean: number;
  drawdownProxy: number;
  priorMeanReturn: number;
  priorSigma: number;
  priorReadiness: number;
  blendedMeanReturn: number;
  blendedSigma: number;
  blendedReadiness: number;
};

export type InvestmentChannelCalibration = {
  channel: ChannelEstimate;
  diagnostics: InvestmentChannelDiagnostics;
};

export type TRsiResult = {
  generatedAt: string;
  status: "experimental_not_audit_ready";
  engine?: "synthetic-prior" | "kalshi-empirical";
  horizonDays: number;
  tRsi: number;
  alphaCreateMean: number;
  alphaDecayMean: number;
  standardError: number;
  threshold: number;
  approved: boolean;
  reason: string;
  samples: Array<{ bucket: string; create: number; decay: number }>;
  evidence?: {
    source: string;
    sampleSize: number;
    minSamples: number;
    horizonMinutes: number;
  };
};

export type DashboardPayload = {
  generatedAt: string;
  services: ServiceStatus[];
  accounts: {
    alpaca: {
      mode: AccountMode;
      equityUsd: number | null;
      cashUsd: number | null;
      buyingPowerUsd: number | null;
      positions: AlpacaPosition[];
    };
    kalshi: {
      mode: "demo" | "production" | "unconfigured";
      balanceUsd: number | null;
      portfolioValueUsd: number | null;
      positions: KalshiPosition[];
    };
  };
  ledger: LedgerRecord[];
  proposal: AllocationProposal;
  investmentCalibration: InvestmentChannelCalibration;
  outcomeEvaluation: OutcomeEvaluationSummary;
  experimentRegistry: ExperimentRegistry;
  tRsi: TRsiResult;
  paperBook: PaperBookSummary;
  ops: {
    capabilities: OpsCapabilityGroup[];
    secrets: SecretStatus[];
    storage: {
      mode: "local" | "postgres";
      durable: boolean;
      message: string;
    };
    localCommands: Array<{ name: string; command: string; purpose: string }>;
    recursion?: RecursionState;
  };
  research: {
    runs: LedgerRecord[];
    models: LedgerRecord[];
    cycles: LedgerRecord[];
    cache: MarketCacheSummary;
    marketSeries: MarketLiveSeries[];
    kalshiRl?: KalshiRlSummary;
    kalshiPretrainedRl?: KalshiPretrainedRlSummary;
    notes: string[];
  };
};

export type CachedBar = {
  at: string;
  close: number;
};

export type MarketCacheEntry = {
  symbol: string;
  fetchedAt: string;
  source: "alpaca_iex" | "alpaca_crypto_us";
  assetClass: "stock" | "crypto";
  timeframe: "1Day" | "15Min";
  bars: CachedBar[];
};

export type MarketCacheSummary = {
  symbols: string[];
  entries: Array<{
    symbol: string;
    assetClass: "stock" | "crypto";
    timeframe: "1Day" | "15Min";
    bars: number;
    fetchedAt: string;
    source: MarketCacheEntry["source"];
    start: string | null;
    end: string | null;
  }>;
};

export type MarketLiveSeries = {
  symbol: string;
  timeframe: "1Day" | "15Min";
  source: MarketCacheEntry["source"];
  fetchedAt: string;
  bars: number;
  start: string | null;
  end: string | null;
  points: Array<{
    at: string;
    close: number;
  }>;
  forecast: {
    modelId: string;
    generatedAt: string;
    expectedReturn: number;
    annualizedVol: number;
    confidence: number;
    score: number;
    startPrice: number;
    targetPrice: number;
    horizonBars: number;
  } | null;
};

export type KalshiOrderbookEventType =
  | "ticker"
  | "trade"
  | "orderbook_snapshot"
  | "orderbook_delta"
  | "market_lifecycle"
  | "settlement"
  | "rest_snapshot";

export type KalshiOrderbookEvent = {
  receivedAt: string;
  marketTicker: string;
  seriesTicker: string | null;
  eventType: KalshiOrderbookEventType;
  windowOpenTime: string | null;
  windowCloseTime: string | null;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  spread: number | null;
  yesDepth: number | null;
  noDepth: number | null;
  tradedPrice: number | null;
  tradedQuantity: number | null;
  settlementValue: number | null;
  raw?: Record<string, unknown>;
};

export type KalshiPaperRlTrade = {
  tradeId: string;
  marketTicker: string;
  side: "yes" | "no";
  openedAt: string;
  closedAt: string | null;
  entryPrice: number;
  exitPrice: number | null;
  contracts: number;
  notionalUsd: number;
  pnlUsd: number;
  reason: string;
};

export type KalshiPaperRlOpenPosition = {
  marketTicker: string;
  side: "yes" | "no" | "flat";
  yesContracts: number;
  noContracts: number;
  netContracts: number;
  costBasisUsd: number;
  markValueUsd: number;
  unrealizedPnlUsd: number;
  averageEntryPrice: number;
  markPrice: number;
  openedAt: string;
  markedAt: string;
  secondsToClose: number | null;
};

export type KalshiPaperRlPerformance = {
  bankrollUsd: number;
  riskedUsd: number;
  netPnlUsd: number;
  grossGainedUsd: number;
  grossLostUsd: number;
  returnOnBankroll: number;
  returnOnRisk: number;
  betsWon: number;
  betsLost: number;
};

export type GeneticPolicyGenome = {
  genomeId: string;
  parentGenomeIds?: string[];
  generation?: number;
  entryThreshold: number;
  exitThreshold: number;
  maxHoldSeconds: number;
  momentumWindow: number;
  spreadCap: number;
  depthFloor: number;
  minSecondsToClose: number;
  maxSecondsToClose: number;
  stopLoss: number;
  takeProfit: number;
  positionSizeFraction: number;
};

export type KalshiRlChampion = {
  genome: GeneticPolicyGenome;
  promotedAt: string;
  generation: number;
  reward: number;
  pnlUsd: number;
  trades: number;
  drawdownUsd: number;
  sampleMarkets: string[];
};

export type KalshiRlEliteTag =
  | "validated"
  | "profit-20"
  | "profitable"
  | "interesting"
  | "champion"
  | "historical-top";

export type KalshiRlAgentTier = "testing" | "validated";

export type KalshiRlEliteArchiveEntry = {
  genome: GeneticPolicyGenome;
  tags: KalshiRlEliteTag[];
  firstSeenAt: string;
  firstTaggedAt: string;
  firstValidatedAt?: string;
  firstValidatedRunId?: string;
  validationPnlUsd?: number;
  lastScoredAt: string;
  firstRunId: string;
  lastRunId: string;
  bestRunId: string;
  bestPnlUsd: number;
  latestPnlUsd: number;
  bestReward: number;
  latestReward: number;
  trades: number;
  generationsTracked: number;
  lastStatus: "champion" | "candidate" | "exploring" | "deprecated" | "archived";
  archivedReason: string;
  tier: KalshiRlAgentTier;
};

export type KalshiRlGenerationStats = {
  runId: string | null;
  generatedAt: string | null;
  agents: number;
  totalPnlUsd: number;
  averagePnlUsd: number;
  bestPnlUsd: number | null;
  worstPnlUsd: number | null;
  totalTrades: number;
  returnOnRisk: number | null;
  betsWon: number;
  betsLost: number;
  winRate: number | null;
};

export type KalshiRlGenerationComparison = {
  current: KalshiRlGenerationStats;
  previous: KalshiRlGenerationStats | null;
  delta: {
    totalPnlUsd: number | null;
    averagePnlUsd: number | null;
    returnOnRisk: number | null;
    winRate: number | null;
    agents: number | null;
  };
  eliteArchive: {
    total: number;
    validated: number;
    profit20: number;
    champions: number;
    scoredLatest: number;
    averageLatestPnlUsd: number | null;
    bestLatestPnlUsd: number | null;
  };
  topElites: Array<{
    genomeId: string;
    tier: KalshiRlAgentTier;
    tags: KalshiRlEliteTag[];
    bestPnlUsd: number;
    latestPnlUsd: number;
    latestReward: number;
    trades: number;
    generationsTracked: number;
    lastScoredAt: string;
  }>;
  sameGenomeDeltas: Array<{
    genomeId: string;
    currentPnlUsd: number;
    previousPnlUsd: number;
    deltaPnlUsd: number;
    currentTrades: number;
    previousTrades: number;
  }>;
};

export type GeneticTrainingRun = {
  runId: string;
  generatedAt: string;
  seriesTicker: string;
  populationSize: number;
  evaluatedMarkets: string[];
  eventCount: number;
  best: KalshiRlChampion | null;
  previousChampion: KalshiRlChampion | null;
  champion: KalshiRlChampion | null;
  promoted: boolean;
  baselineReward: number;
  leaderboard: Array<{
    genome: GeneticPolicyGenome;
    status: "champion" | "candidate" | "exploring" | "deprecated" | "archived";
    parentGenomeIds: string[];
    tier?: KalshiRlAgentTier;
    contributesToPerformance?: boolean;
    validationAt?: string;
    validationRunId?: string;
    validationPnlUsd?: number;
    isValidationRun?: boolean;
    eliteTags?: KalshiRlEliteTag[];
    archivedReason?: string;
    reward: number;
    pnlUsd: number;
    trades: number;
    drawdownUsd: number;
    pnlLast4?: number;
    pnlLast10?: number;
    pnlLast20m?: number;
    pnlLast50m?: number;
    generationsSeen?: number;
    deprecatedReason?: string;
    recentTrades?: KalshiPaperRlTrade[];
    openPositions?: KalshiPaperRlOpenPosition[];
    performance?: KalshiPaperRlPerformance;
  }>;
  paper: {
    bankrollUsd: number;
    maxMarketUsd: number;
    maxOpenUsd: number;
  };
  notes: string[];
};

export type KalshiRlSummary = {
  enabled: boolean;
  seriesTicker: string;
  bankrollUsd: number;
  maxMarketUsd: number;
  maxOpenUsd: number;
  recentEvents: number;
  latestEventAt: string | null;
  latestEvent: KalshiOrderbookEvent | null;
  recentQuoteEvents: KalshiOrderbookEvent[];
  latestMarketUrl: string | null;
  liveLeaderboard?: GeneticTrainingRun["leaderboard"];
  eliteArchive?: KalshiRlEliteArchiveEntry[];
  generationComparison?: KalshiRlGenerationComparison;
  champion: KalshiRlChampion | null;
  lastRun: GeneticTrainingRun | null;
  runHistory: GeneticTrainingRun[];
};

export type PreTrainingAgentGenome = {
  genomeId: string;
  generation: number;
  parentGenomeIds: string[];
  family: "momentum" | "reversal" | "breakout" | "risk-scout";
  lookbackMinutes: number;
  entryEdge: number;
  exitEdge: number;
  maxHoldMinutes: number;
  maxSpread: number;
  minVolume: number;
  stopLoss: number;
  takeProfit: number;
  allocationPct: number;
  riskPenalty: number;
};

export type PreTrainingPaperTrade = {
  tradeId: string;
  marketTicker: string;
  side: "yes" | "no";
  openedAt: string;
  closedAt: string;
  entryPrice: number;
  exitPrice: number;
  contracts: number;
  notionalUsd: number;
  pnlUsd: number;
  reason: string;
};

export type PreTrainingAgentScore = {
  genome: PreTrainingAgentGenome;
  reward: number;
  pnlUsd: number;
  trades: number;
  winRate: number | null;
  maxDrawdownUsd: number;
  returnOnRisk: number | null;
  familyRank: number;
  trainReward?: number;
  validationReward?: number;
  recentTrades?: PreTrainingPaperTrade[];
};

export type PreTrainingCycleSummary = {
  cycle: number;
  populationSize: number;
  bestGenomeId: string | null;
  bestReward: number | null;
  averageReward: number;
  averagePnlUsd: number;
  tradedAgents: number;
  mutationRate: number;
  eliteCount: number;
  diversity: number;
};

export type PreTrainingRun = {
  runId: string;
  generatedAt: string;
  seriesTicker: string;
  mode: "historical-genetic";
  cyclesRequested: number;
  populationSize: number;
  candleCount: number;
  trainMarkets: string[];
  validationMarkets: string[];
  champion: PreTrainingAgentScore | null;
  previousChampion: PreTrainingAgentScore | null;
  promoted: boolean;
  cycles: PreTrainingCycleSummary[];
  leaderboard: PreTrainingAgentScore[];
  notes: string[];
};

export type PreTrainingSummary = {
  enabled: boolean;
  seriesTicker: string;
  availableMarkets: number;
  availableCandles: number;
  lastRun: PreTrainingRun | null;
  champion: PreTrainingAgentScore | null;
  runHistory: PreTrainingRun[];
};

export type KalshiPretrainedRlMetrics = {
  samples: number;
  avgReward: number;
  totalReward: number;
  trades: number;
  actionCounts: Record<string, number>;
};

export type KalshiPretrainedRlSignal = {
  ok: boolean;
  modelId?: string;
  generatedAt: string;
  seriesTicker?: string;
  marketTicker?: string;
  observedAt?: string;
  mode?: "paper-shadow";
  lineage?: string;
  action?: string;
  side?: "yes" | "no" | "flat";
  size?: "small" | "full" | "none";
  confidence?: number;
  logits?: Record<string, number>;
  inputWindowHash?: string;
  entryMark?: number;
  futureMarkForBacktest?: number;
  reason?: string;
};

export type KalshiMollyAgentSignal = {
  agentId: string;
  displayName: string;
  familyName: "Molly";
  lineage: "molly";
  parentAgentId?: string | null;
  generation?: number;
  generatedAt: string;
  marketTicker: string | null;
  modelId: string | null;
  action: string;
  side: "yes" | "no" | "flat";
  size: "small" | "full" | "none";
  confidence: number;
  minConfidence: number;
  status: "paper_live_trade" | "paper_hold" | "waiting";
  notionalUsd: number;
  reward?: number;
  pnlUsd?: number;
  trades?: number;
  openPositions?: KalshiPaperRlOpenPosition[];
  recentTrades?: KalshiPaperRlTrade[];
  performance?: KalshiPaperRlPerformance;
  reason: string;
};

export type KalshiMollyLineRun = {
  runId: string;
  generatedAt: string;
  mode: "paper-live-shadow";
  lineage: "molly";
  seriesTicker: string;
  recentEvents: number;
  baseSignal: KalshiPretrainedRlSignal | null;
  agents: KalshiMollyAgentSignal[];
  notes: string[];
};

export type KalshiPretrainedRlTrainingRun = {
  runId: string;
  generatedAt: string;
  seriesTicker: string;
  device: "cpu";
  enabled: boolean;
  artifactDir: string;
  historyDir: string;
  candles: number;
  samples: Record<"train" | "validation" | "test", number>;
  markets: Record<"train" | "validation" | "test", number>;
  featureNames: string[];
  actionNames: string[];
  model: {
    dModel: number;
    heads: number;
    layers: number;
    sequenceMinutes: number;
  };
  metrics: Record<"train" | "validation" | "test", KalshiPretrainedRlMetrics>;
  promoted: boolean;
  previousRunId?: string;
  latestSignal?: KalshiPretrainedRlSignal;
  notes: string[];
};

export type KalshiPretrainedRlModelCard = {
  modelId: string;
  generatedAt: string;
  seriesTicker: string;
  stage: "pretrained" | "rl-candidate" | "champion";
  metrics?: Record<"train" | "validation" | "test", KalshiPretrainedRlMetrics>;
  pretrainLossLast?: number | null;
  rlLossLast?: number | null;
  promotedAt?: string;
};

export type KalshiPretrainedRlSummary = {
  enabled: boolean;
  seriesTicker: string;
  artifactDir: string;
  lastRun: KalshiPretrainedRlTrainingRun | null;
  champion: KalshiPretrainedRlModelCard | null;
  latestSignal: KalshiPretrainedRlSignal | null;
  mollyLine?: KalshiMollyLineRun | null;
  runHistory: KalshiPretrainedRlTrainingRun[];
};

export type PaperCycleForecast = {
  symbol: string;
  assetClass: "stock" | "crypto";
  timeframe: "1Day" | "15Min";
  lastClose: number;
  shortMomentum: number;
  longMomentum: number;
  shortLookbackLabel: string;
  longLookbackLabel: string;
  annualizedVol: number;
  expectedReturn: number;
  confidence: number;
  score: number;
};

export type PaperCycleRun = {
  cycleId: string;
  generatedAt: string;
  mode: "paper";
  experimentId?: string;
  modelId?: string;
  researchDecisionId?: string | null;
  recursion?: RecursionState;
  symbols: string[];
  timeframe: "1Day" | "15Min";
  cadence: "market-hours" | "24/7";
  market: "equities" | "crypto";
  cache: MarketCacheSummary;
  proposal: AllocationProposal;
  tRsi: TRsiResult;
  risk?: PaperCycleRiskResult;
  forecasts: PaperCycleForecast[];
  simulatedFills: Array<{
    symbol: string;
    notionalUsd: number;
    referencePrice: number;
    quantity: number;
    reason: string;
  }>;
  rejected: boolean;
  reason: string;
};

export type BacktestModelResult = {
  modelId: string;
  label: string;
  observations: number;
  trainWindowBars: number;
  horizonBars: number;
  directionalAccuracy: number | null;
  rmseBps: number | null;
  maeBps: number | null;
  strategyReturnPct: number | null;
  buyHoldReturnPct: number | null;
  maxDrawdownPct: number | null;
  sharpeProxy: number | null;
  lastPredictionPct: number | null;
  lastTargetPrice: number | null;
  note: string;
};

export type ModelComparisonBacktest = {
  symbol: string;
  timeframe: "1Day" | "15Min";
  generatedAt: string;
  start: string | null;
  end: string | null;
  observations: number;
  horizonBars: number;
  bestModelId: string | null;
  results: BacktestModelResult[];
  note: string;
};

export type PaperCycleRiskLimitName =
  | "kill-switch"
  | "capital"
  | "cache-freshness"
  | "max-symbols"
  | "max-notional"
  | "max-per-symbol-notional"
  | "max-open-exposure";

export type PaperCycleRiskLimit = {
  name: PaperCycleRiskLimitName;
  ok: boolean;
  actual: number | string | boolean | null;
  limit: number | string | boolean | null;
  message: string;
};

export type PaperCycleRiskResult = {
  generatedAt: string;
  ok: boolean;
  limits: PaperCycleRiskLimit[];
  summary: string;
};

export type PaperBookPosition = {
  id: string;
  cycleId: string;
  symbol: string;
  assetClass: "stock" | "crypto";
  timeframe: "1Day" | "15Min";
  openedAt: string;
  entryPrice: number;
  quantity: number;
  notionalUsd: number;
  forecastScore: number;
  expectedReturn: number;
  benchmarkSymbol: string;
  status: "open";
};

export type MarkedPaperPosition = PaperBookPosition & {
  markPrice: number | null;
  markAt: string | null;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  returnPct: number;
  ageHours: number;
  benchmarkReturnPct: number | null;
  alphaVsBenchmarkPct: number | null;
};

export type PaperCycleOutcome = {
  cycleId: string;
  openedAt: string;
  positions: number;
  notionalUsd: number;
  currentValueUsd: number;
  unrealizedPnlUsd: number;
  returnPct: number;
  avgForecastScore: number;
  benchmarkReturnPct: number | null;
  alphaVsBenchmarkPct: number | null;
};

export type PaperBookSummary = {
  generatedAt: string;
  openPositions: MarkedPaperPosition[];
  cycleOutcomes: PaperCycleOutcome[];
  totals: {
    openCount: number;
    notionalUsd: number;
    currentValueUsd: number;
    unrealizedPnlUsd: number;
    returnPct: number;
    benchmarkReturnPct: number | null;
    alphaVsBenchmarkPct: number | null;
  };
};

export type OpsCapabilityGroup = {
  name: string;
  status: "ready" | "blocked";
  items: string[];
};

export type SecretStatus = {
  name: string;
  configured: boolean;
  variables: string[];
  purpose: string;
};

export type OutcomeHorizon = "1h" | "6h" | "24h" | "7d";

export type CycleOutcomeEvaluation = {
  cycleId: string;
  horizon: OutcomeHorizon;
  status: "pending" | "ready";
  openedAt: string;
  evaluatedAt: string;
  ageHours: number;
  positions: number;
  notionalUsd: number;
  returnPct: number;
  benchmarkReturnPct: number | null;
  alphaVsBenchmarkPct: number | null;
  hitRate: number | null;
  avgForecastScore: number;
  avgExpectedReturn: number;
  calibrationErrorPct: number | null;
  maxDrawdownProxyPct: number;
};

export type OutcomeEvaluationSummary = {
  generatedAt: string;
  horizons: Array<{
    horizon: OutcomeHorizon;
    readyCycles: number;
    pendingCycles: number;
    avgReturnPct: number | null;
    avgAlphaPct: number | null;
    hitRate: number | null;
    avgCalibrationErrorPct: number | null;
  }>;
  evaluations: CycleOutcomeEvaluation[];
};

export type ResearchDecisionParameterSet = {
  timeframe: "15Min";
  shortLookbackBars: number;
  longLookbackBars: number;
  maxPositiveForecasts: number;
  executionMode: "paper";
};

export type ResearchDecisionDraft = {
  decisionId?: string;
  createdAt?: string;
  modelId?: string;
  hypothesis: string;
  universe: string[];
  parameters: {
    shortLookbackBars: number;
    longLookbackBars: number;
    maxPositiveForecasts: number;
  };
  reason?: string;
  confidence?: number;
  risks?: string[];
  notes?: string[];
};

export type ResearchDecisionValidationIssue = {
  field: string;
  message: string;
};

export type ResearchDecision = {
  decisionId: string;
  createdAt: string;
  status: "accepted" | "rejected";
  provider: "openai" | "openrouter" | "local";
  providerModel: string | null;
  modelId: string;
  hypothesis: string;
  universe: string[];
  parameters: ResearchDecisionParameterSet;
  reason: string;
  confidence: number | null;
  risks: string[];
  notes: string[];
  parentDecisionId: string | null;
  parentExperimentId: string | null;
  experimentId: string | null;
  validationErrors: ResearchDecisionValidationIssue[];
};

export type ResearchDecisionValidationResult =
  | {
      ok: true;
      decision: ResearchDecision;
      errors: [];
    }
  | {
      ok: false;
      decision: ResearchDecision;
      errors: ResearchDecisionValidationIssue[];
    };

export type RecursionState = {
  generatedAt: string;
  enabled: boolean;
  provider: "openai" | "openrouter" | "local" | null;
  providerModel: string | null;
  activeDecisionId: string | null;
  activeExperimentId: string | null;
  lastDecision: ResearchDecision | null;
  decisions: ResearchDecision[];
};

export type ExperimentSpec = {
  experimentId: string;
  createdAt: string;
  status: "active" | "paused" | "retired";
  modelId: string;
  hypothesis: string;
  universe: string[];
  features: string[];
  parameters: Record<string, string | number | boolean>;
  notes: string[];
  researchDecision?: {
    decisionId: string;
    parentDecisionId: string | null;
    parentExperimentId: string | null;
    reason: string;
  };
};

export type ExperimentRegistry = {
  generatedAt: string;
  activeExperimentId: string;
  experiments: ExperimentSpec[];
};

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
  channel: ChannelId | "portfolio";
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

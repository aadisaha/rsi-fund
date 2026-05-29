import "server-only";

import {
  activateExperimentFromDecision,
  activeExperiment,
} from "@/lib/experiments";
import { appendLedger } from "@/lib/ledger";
import {
  requestLlmResearchDecision,
  selectLlmProvider,
  type LlmProvider,
} from "@/lib/llm-research";
import { normalizeCycleSymbol } from "@/lib/market-cache";
import { readDocument, writeDocument } from "@/lib/storage";
import type {
  AllocationProposal,
  ExperimentSpec,
  MarketCacheSummary,
  OutcomeEvaluationSummary,
  PaperBookSummary,
  ResearchDecision,
  ResearchDecisionDraft,
  ResearchDecisionParameterSet,
  ResearchDecisionValidationIssue,
  ResearchDecisionValidationResult,
  RecursionState,
} from "@/lib/types";

const DECISIONS_FILE = "research-decisions.json";
const DECISIONS_NAMESPACE = "research-decisions";

type ResearchDecisionsFile = {
  version: 1;
  decisions: ResearchDecision[];
};

type RecursionDecisionInput = {
  cycleId: string;
  activeExperiment: ExperimentSpec;
  paperBook: PaperBookSummary;
  outcomeEvaluation: OutcomeEvaluationSummary;
  cache: MarketCacheSummary;
  proposal: AllocationProposal;
};

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return !["0", "false", "no", "off"].includes(raw);
}

export function paperRecursionEnabled(): boolean {
  return envFlag("PAPER_RECURSION_ENABLED", true);
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readDecisionFile(): Promise<ResearchDecisionsFile> {
  return readDocument(
    DECISIONS_NAMESPACE,
    DECISIONS_FILE,
    { version: 1, decisions: [] },
    (value) => {
      const parsed = value as Partial<ResearchDecisionsFile>;
      return { version: 1, decisions: parsed.decisions ?? [] };
    },
  );
}

async function writeDecisionFile(file: ResearchDecisionsFile): Promise<void> {
  await writeDocument(DECISIONS_NAMESPACE, DECISIONS_FILE, file);
}

function numberFrom(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && Boolean(v.trim()));
}

function normalizedCryptoSymbols(symbols: string[]): string[] {
  return [
    ...new Set(
      symbols
        .map((raw) => {
          const symbol = normalizeCycleSymbol(raw);
          return symbol?.includes("/") ? symbol : null;
        })
        .filter((symbol): symbol is string => Boolean(symbol)),
    ),
  ];
}

function defaultParameters(active: ExperimentSpec): ResearchDecisionParameterSet {
  return {
    timeframe: "15Min",
    shortLookbackBars: numberFrom(active.parameters.shortLookbackBars, 96),
    longLookbackBars: numberFrom(active.parameters.longLookbackBars, 672),
    maxPositiveForecasts: numberFrom(active.parameters.maxPositiveForecasts, 5),
    executionMode: "paper",
  };
}

function coerceDraft(raw: Record<string, unknown>, active: ExperimentSpec): ResearchDecisionDraft {
  const parameters = (raw.parameters ?? {}) as Record<string, unknown>;
  const defaults = defaultParameters(active);
  const suggestedTrades = Array.isArray(raw.suggestedPaperTrades)
    ? raw.suggestedPaperTrades
        .map((trade) =>
          trade && typeof trade === "object"
            ? String((trade as Record<string, unknown>).symbol ?? "")
            : "",
        )
        .filter(Boolean)
    : [];
  const universe =
    stringArray(raw.universe).length ? stringArray(raw.universe) : stringArray(raw.symbols);

  return {
    decisionId: typeof raw.decisionId === "string" ? raw.decisionId : undefined,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    modelId: typeof raw.modelId === "string" ? raw.modelId : active.modelId,
    hypothesis:
      typeof raw.hypothesis === "string"
        ? raw.hypothesis
        : typeof raw.rationale === "string"
          ? raw.rationale
          : active.hypothesis,
    universe: universe.length ? universe : suggestedTrades.length ? suggestedTrades : active.universe,
    parameters: {
      shortLookbackBars: numberFrom(parameters.shortLookbackBars, defaults.shortLookbackBars),
      longLookbackBars: numberFrom(parameters.longLookbackBars, defaults.longLookbackBars),
      maxPositiveForecasts: numberFrom(
        parameters.maxPositiveForecasts,
        defaults.maxPositiveForecasts,
      ),
    },
    reason:
      typeof raw.reason === "string"
        ? raw.reason
        : typeof raw.rationale === "string"
          ? raw.rationale
          : "LLM paper research decision.",
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    risks: stringArray(raw.risks),
    notes: stringArray(raw.notes),
  };
}

export function validateResearchDecisionDraft(args: {
  draft: ResearchDecisionDraft;
  activeExperiment: ExperimentSpec;
  parentDecisionId: string | null;
  provider: LlmProvider | "local";
  providerModel: string | null;
}): ResearchDecisionValidationResult {
  const errors: ResearchDecisionValidationIssue[] = [];
  const now = new Date().toISOString();
  const normalizedUniverse = normalizedCryptoSymbols(args.draft.universe);
  const universe = normalizedUniverse.slice(0, 12);
  const shortLookbackBars = Math.round(args.draft.parameters.shortLookbackBars);
  const longLookbackBars = Math.round(args.draft.parameters.longLookbackBars);
  const maxPositiveForecasts = Math.round(args.draft.parameters.maxPositiveForecasts);

  if (!universe.length) {
    errors.push({ field: "universe", message: "At least one crypto symbol is required." });
  }
  args.draft.universe.forEach((raw, index) => {
    const symbol = normalizeCycleSymbol(raw);
    if (!symbol?.includes("/")) {
      errors.push({
        field: `universe.${index}`,
        message: "Only crypto slash-pair symbols are allowed.",
      });
    }
  });
  if (normalizedUniverse.length > 12) {
    errors.push({ field: "universe", message: "Universe is capped at 12 crypto symbols." });
  }
  if (shortLookbackBars < 24 || shortLookbackBars > 192) {
    errors.push({ field: "parameters.shortLookbackBars", message: "Must be between 24 and 192." });
  }
  if (longLookbackBars < 288 || longLookbackBars > 1344) {
    errors.push({ field: "parameters.longLookbackBars", message: "Must be between 288 and 1344." });
  }
  if (longLookbackBars <= shortLookbackBars) {
    errors.push({
      field: "parameters.longLookbackBars",
      message: "Must be greater than shortLookbackBars.",
    });
  }
  if (maxPositiveForecasts < 1 || maxPositiveForecasts > 5) {
    errors.push({
      field: "parameters.maxPositiveForecasts",
      message: "Must be between 1 and 5.",
    });
  }

  const decisionId = args.draft.decisionId?.trim() || nowId("rd");
  const accepted = errors.length === 0;
  const decision: ResearchDecision = {
    decisionId,
    createdAt: args.draft.createdAt || now,
    status: accepted ? "accepted" : "rejected",
    provider: args.provider,
    providerModel: args.providerModel,
    modelId: args.draft.modelId?.trim() || args.activeExperiment.modelId,
    hypothesis: args.draft.hypothesis.trim() || args.activeExperiment.hypothesis,
    universe,
    parameters: {
      timeframe: "15Min",
      shortLookbackBars,
      longLookbackBars,
      maxPositiveForecasts,
      executionMode: "paper",
    },
    reason: args.draft.reason?.trim() || (accepted ? "Accepted." : "Rejected by validation."),
    confidence:
      typeof args.draft.confidence === "number" && Number.isFinite(args.draft.confidence)
        ? Math.max(0, Math.min(1, args.draft.confidence))
        : null,
    risks: args.draft.risks ?? [],
    notes: args.draft.notes ?? [],
    parentDecisionId: args.parentDecisionId,
    parentExperimentId: args.activeExperiment.experimentId,
    experimentId: accepted ? `exp-${decisionId.toLowerCase().replace(/[^a-z0-9-]/g, "-")}` : null,
    validationErrors: errors,
  };

  return accepted ? { ok: true, decision, errors: [] } : { ok: false, decision, errors };
}

export async function appendResearchDecision(decision: ResearchDecision): Promise<void> {
  const file = await readDecisionFile();
  await writeDecisionFile({
    version: 1,
    decisions: [
      decision,
      ...file.decisions.filter((d) => d.decisionId !== decision.decisionId),
    ].slice(0, 100),
  });
}

export async function validateResearchDecision(
  draft: ResearchDecisionDraft,
): Promise<ResearchDecisionValidationResult> {
  const [state, active] = await Promise.all([readRecursionState(), activeExperiment()]);
  return validateResearchDecisionDraft({
    draft,
    activeExperiment: active,
    parentDecisionId: state.activeDecisionId ?? state.lastDecision?.decisionId ?? null,
    provider: "local",
    providerModel: null,
  });
}

export async function applyResearchDecision(
  draft: ResearchDecisionDraft,
): Promise<ResearchDecisionValidationResult> {
  const validation = await validateResearchDecision(draft);
  let decision = validation.decision;
  let activated: ExperimentSpec | null = null;

  if (decision.status === "accepted") {
    activated = await activateExperimentFromDecision(decision);
    decision = { ...decision, experimentId: activated.experimentId };
  }

  await appendResearchDecision(decision);
  await appendLedger({
    type: "research_decision",
    decisionId: decision.decisionId,
    accepted: decision.status === "accepted",
    experimentId: activated?.experimentId ?? null,
    reason: decision.reason,
    payload: { decision, activatedExperimentId: activated?.experimentId ?? null },
  });

  return decision.status === "accepted"
    ? { ok: true, decision, errors: [] }
    : { ok: false, decision, errors: decision.validationErrors };
}

export async function readRecursionState(): Promise<RecursionState> {
  const [file, active] = await Promise.all([readDecisionFile(), activeExperiment()]);
  const lastDecision = file.decisions[0] ?? null;
  return {
    generatedAt: new Date().toISOString(),
    enabled: paperRecursionEnabled(),
    provider: lastDecision?.provider ?? null,
    providerModel: lastDecision?.providerModel ?? null,
    activeDecisionId: active.researchDecision?.decisionId ?? null,
    activeExperimentId: active.experimentId,
    lastDecision,
    decisions: file.decisions,
  };
}

export function buildResearchContext(input: RecursionDecisionInput): Record<string, unknown> {
  return {
    cycleId: input.cycleId,
    activeExperiment: {
      experimentId: input.activeExperiment.experimentId,
      modelId: input.activeExperiment.modelId,
      hypothesis: input.activeExperiment.hypothesis,
      universe: input.activeExperiment.universe,
      parameters: input.activeExperiment.parameters,
    },
    outcomes: {
      totals: input.paperBook.totals,
      latestCycles: input.paperBook.cycleOutcomes.slice(0, 12),
      horizons: input.outcomeEvaluation.horizons,
      latestEvaluations: input.outcomeEvaluation.evaluations.slice(0, 20),
    },
    marketCache: input.cache.entries,
    allocation: {
      deployableCapitalUsd: input.proposal.deployableCapitalUsd,
      investmentChannel: input.proposal.channels.find((c) => c.id === "I"),
      constraints: input.proposal.constraints,
    },
    allowedOutput: {
      universe: "crypto slash-pair symbols only, maximum 12",
      shortLookbackBars: "integer 24..192",
      longLookbackBars: "integer 288..1344 and greater than shortLookbackBars",
      maxPositiveForecasts: "integer 1..5",
      executionMode: "paper only",
    },
  };
}

export async function runRecursiveResearchDecision(
  input: RecursionDecisionInput,
): Promise<RecursionState> {
  if (!paperRecursionEnabled()) return readRecursionState();

  const priorState = await readRecursionState();
  let provider: LlmProvider | "local" = "local";
  let providerModel: string | null = null;
  let draft: ResearchDecisionDraft | null = null;
  let failure: string | null = null;

  try {
    provider = selectLlmProvider();
    const result = await requestLlmResearchDecision(buildResearchContext(input), {
      provider,
      objective:
        "Choose the next active paper-only crypto momentum experiment. Return only JSON with hypothesis, universe, parameters.shortLookbackBars, parameters.longLookbackBars, parameters.maxPositiveForecasts, reason, confidence, risks, and notes.",
      maxArrayItems: 24,
      maxStringLength: 2_000,
    });
    providerModel = result.model;
    draft = coerceDraft(result.decision, input.activeExperiment);
  } catch (error) {
    failure = error instanceof Error ? error.message : "Unknown LLM research failure.";
    draft = {
      modelId: input.activeExperiment.modelId,
      hypothesis: input.activeExperiment.hypothesis,
      universe: input.activeExperiment.universe,
      parameters: {
        shortLookbackBars: numberFrom(input.activeExperiment.parameters.shortLookbackBars, 96),
        longLookbackBars: numberFrom(input.activeExperiment.parameters.longLookbackBars, 672),
        maxPositiveForecasts: numberFrom(input.activeExperiment.parameters.maxPositiveForecasts, 5),
      },
      reason: `LLM unavailable; keeping current experiment. ${failure}`,
      notes: ["Fallback decision was produced locally and should not change the active experiment."],
    };
  }

  const validation = validateResearchDecisionDraft({
    draft,
    activeExperiment: input.activeExperiment,
    parentDecisionId: priorState.lastDecision?.decisionId ?? null,
    provider,
    providerModel,
  });
  const decision =
    failure == null
      ? validation.decision
      : {
          ...validation.decision,
          status: "rejected" as const,
          experimentId: null,
          validationErrors: [
            ...validation.decision.validationErrors,
            { field: "llm", message: failure },
          ],
        };

  await appendResearchDecision(decision);
  let activated: ExperimentSpec | null = null;
  if (decision.status === "accepted") {
    activated = await activateExperimentFromDecision(decision);
  }

  await appendLedger({
    type: "research_decision",
    decisionId: decision.decisionId,
    accepted: decision.status === "accepted",
    experimentId: activated?.experimentId ?? null,
    reason: decision.reason,
    payload: { decision, activatedExperimentId: activated?.experimentId ?? null },
  });

  return readRecursionState();
}

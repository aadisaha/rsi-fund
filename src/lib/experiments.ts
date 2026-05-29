import "server-only";

import { readDocument, writeDocument } from "@/lib/storage";
import type { ExperimentRegistry, ExperimentSpec, ResearchDecision } from "@/lib/types";

const EXPERIMENTS_FILE = "experiments.json";
const EXPERIMENTS_NAMESPACE = "experiments";

type ActivatableResearchDecision = ResearchDecision | (Omit<
  ResearchDecision,
  "confidence" | "provider" | "providerModel" | "risks"
> &
  Partial<Pick<ResearchDecision, "confidence" | "provider" | "providerModel" | "risks">>);

function defaultExperiment(now = new Date()): ExperimentSpec {
  return {
    experimentId: "exp-ewm-v0-momentum-crypto",
    createdAt: now.toISOString(),
    status: "active",
    modelId: "ewm-v0-paper-cycle",
    hypothesis:
      "Short-horizon crypto momentum, gated by paper t-RSI and risk constraints, can produce positive alpha versus BTC benchmark after friction proxies.",
    universe: ["BTC/USD", "ETH/USD", "SOL/USD"],
    features: ["24h momentum", "7d momentum", "annualized volatility", "confidence from bar count"],
    parameters: {
      timeframe: "15Min",
      shortLookbackBars: 96,
      longLookbackBars: 672,
      maxPositiveForecasts: 5,
      executionMode: "paper",
    },
    notes: [
      "Bootstrap experiment seeded locally.",
      "Retire or revise once 24h and 7d outcome samples are available.",
    ],
  };
}

async function writeRegistry(registry: ExperimentRegistry): Promise<void> {
  await writeDocument(EXPERIMENTS_NAMESPACE, EXPERIMENTS_FILE, registry);
}

function experimentIdForDecision(decision: Pick<ResearchDecision, "decisionId" | "experimentId">): string {
  if (decision.experimentId) return decision.experimentId;
  const safeId = decision.decisionId.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 72);
  return `exp-${safeId || Date.now().toString(36)}`;
}

export async function readExperimentRegistry(): Promise<ExperimentRegistry> {
  const registry = await readDocument<ExperimentRegistry | null>(
    EXPERIMENTS_NAMESPACE,
    EXPERIMENTS_FILE,
    null,
    (value) => {
      const parsed = value as Partial<ExperimentRegistry>;
      if (parsed.experiments?.length && parsed.activeExperimentId) {
        return {
          generatedAt: new Date().toISOString(),
          activeExperimentId: parsed.activeExperimentId,
          experiments: parsed.experiments,
        };
      }
      return null;
    },
  );
  if (registry) return registry;

  const experiment = defaultExperiment();
  const seeded: ExperimentRegistry = {
    generatedAt: new Date().toISOString(),
    activeExperimentId: experiment.experimentId,
    experiments: [experiment],
  };
  await writeRegistry(seeded);
  return seeded;
}

export async function activeExperiment(): Promise<ExperimentSpec> {
  const registry = await readExperimentRegistry();
  return (
    registry.experiments.find((e) => e.experimentId === registry.activeExperimentId) ??
    registry.experiments[0] ??
    defaultExperiment()
  );
}

export async function activateExperimentFromDecision(
  decision: ActivatableResearchDecision,
): Promise<ExperimentSpec> {
  if (decision.status !== "accepted") {
    throw new Error("Only accepted research decisions can activate experiments.");
  }

  const registry = await readExperimentRegistry();
  const parentExperimentId = decision.parentExperimentId ?? registry.activeExperimentId;
  const experimentId = experimentIdForDecision(decision);
  const now = new Date().toISOString();
  const experiment: ExperimentSpec = {
    experimentId,
    createdAt: decision.createdAt || now,
    status: "active",
    modelId: decision.modelId,
    hypothesis: decision.hypothesis,
    universe: decision.universe,
    features: [
      "15-minute crypto momentum",
      "short/long lookback momentum blend",
      "annualized volatility",
      "confidence from bar count",
    ],
    parameters: decision.parameters,
    notes: [
      ...decision.notes,
      `Activated from research decision ${decision.decisionId}.`,
      parentExperimentId ? `Parent experiment: ${parentExperimentId}.` : "No parent experiment.",
    ],
    researchDecision: {
      decisionId: decision.decisionId,
      parentDecisionId: decision.parentDecisionId,
      parentExperimentId,
      reason: decision.reason,
    },
  };

  const experiments = registry.experiments
    .filter((e) => e.experimentId !== experimentId)
    .map((e) =>
      e.experimentId === registry.activeExperimentId && e.experimentId !== experimentId
        ? { ...e, status: "paused" as const }
        : e,
    );
  const nextRegistry: ExperimentRegistry = {
    generatedAt: now,
    activeExperimentId: experimentId,
    experiments: [...experiments, experiment],
  };
  await writeRegistry(nextRegistry);
  return experiment;
}

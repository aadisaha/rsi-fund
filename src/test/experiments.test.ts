import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let tmp: string;
let originalDataDir: string | undefined;

async function importExperiments() {
  vi.resetModules();
  return import("../lib/experiments");
}

beforeEach(async () => {
  originalDataDir = process.env.QUANT_DATA_DIR;
  tmp = await mkdtemp(path.join(tmpdir(), "quant-experiments-"));
  process.env.QUANT_DATA_DIR = path.join(tmp, ".data");
});

afterEach(async () => {
  if (originalDataDir == null) {
    delete process.env.QUANT_DATA_DIR;
  } else {
    process.env.QUANT_DATA_DIR = originalDataDir;
  }
  await rm(tmp, { recursive: true, force: true });
});

describe("experiment registry", () => {
  it("seeds a local active experiment", async () => {
    const { activeExperiment, readExperimentRegistry } = await importExperiments();

    const registry = await readExperimentRegistry();
    const active = await activeExperiment();

    expect(registry.experiments).toHaveLength(1);
    expect(active.experimentId).toBe(registry.activeExperimentId);
    expect(active.modelId).toBe("ewm-v0-paper-cycle");
  });

  it("activates an accepted decision as the next experiment", async () => {
    const { activateExperimentFromDecision, activeExperiment, readExperimentRegistry } =
      await importExperiments();

    const previous = await activeExperiment();
    const activated = await activateExperimentFromDecision({
      decisionId: "decision-test-1",
      createdAt: "2026-05-28T00:00:00.000Z",
      status: "accepted",
      provider: "local",
      providerModel: null,
      modelId: "ewm-v1-paper-cycle",
      hypothesis: "A tighter crypto momentum universe should improve paper calibration.",
      universe: ["BTC/USD", "ETH/USD"],
      parameters: {
        timeframe: "15Min",
        shortLookbackBars: 72,
        longLookbackBars: 576,
        maxPositiveForecasts: 3,
        executionMode: "paper",
      },
      reason: "Promote research decision for the next paper cycle.",
      confidence: null,
      risks: [],
      notes: ["Test activation."],
      parentDecisionId: null,
      parentExperimentId: previous.experimentId,
      experimentId: null,
      validationErrors: [],
    });
    const active = await activeExperiment();
    const registry = await readExperimentRegistry();

    expect(active.experimentId).toBe(activated.experimentId);
    expect(registry.activeExperimentId).toBe(activated.experimentId);
    expect(registry.experiments.find((e) => e.experimentId === previous.experimentId)?.status).toBe(
      "paused",
    );
    expect(active.researchDecision).toEqual({
      decisionId: "decision-test-1",
      parentDecisionId: null,
      parentExperimentId: previous.experimentId,
      reason: "Promote research decision for the next paper cycle.",
    });
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let tmp: string;
let originalDataDir: string | undefined;

async function importRecursion() {
  vi.resetModules();
  return import("../lib/recursion");
}

async function importExperiments() {
  return import("../lib/experiments");
}

async function importLedger() {
  return import("../lib/ledger");
}

beforeEach(async () => {
  originalDataDir = process.env.QUANT_DATA_DIR;
  tmp = await mkdtemp(path.join(tmpdir(), "quant-recursion-"));
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

describe("research recursion decisions", () => {
  it("persists an accepted decision and activates its experiment", async () => {
    const { applyResearchDecision, readRecursionState } = await importRecursion();

    const result = await applyResearchDecision({
      decisionId: "decision-accepted-1",
      hypothesis: "Alias-normalized crypto momentum can improve next-cycle paper selection.",
      universe: [" btc ", "eth", "BTC/USD"],
      parameters: {
        shortLookbackBars: 96,
        longLookbackBars: 672,
        maxPositiveForecasts: 3,
      },
      reason: "Accept normalized crypto-only research decision.",
      notes: ["Use for the next cycle only."],
    });
    const state = await readRecursionState();
    const { activeExperiment } = await importExperiments();
    const { readLedger } = await importLedger();
    const active = await activeExperiment();
    const ledger = await readLedger();
    const raw = await readFile(path.join(tmp, ".data", "research-decisions.json"), "utf8");

    expect(result.ok).toBe(true);
    expect(result.decision.status).toBe("accepted");
    expect(result.decision.universe).toEqual(["BTC/USD", "ETH/USD"]);
    expect(state.activeDecisionId).toBe("decision-accepted-1");
    expect(JSON.parse(raw).decisions).toHaveLength(1);
    expect(active.experimentId).toBe(result.decision.experimentId);
    expect(active.universe).toEqual(["BTC/USD", "ETH/USD"]);
    expect(active.parameters.maxPositiveForecasts).toBe(3);
    expect(active.researchDecision?.decisionId).toBe("decision-accepted-1");
    expect(active.researchDecision?.parentExperimentId).toBe("exp-ewm-v0-momentum-crypto");
    expect(ledger[0]).toMatchObject({
      type: "research_decision",
      decisionId: "decision-accepted-1",
      accepted: true,
      experimentId: result.decision.experimentId,
    });
  });

  it("rejects invalid decisions without changing the active experiment", async () => {
    const { applyResearchDecision, readRecursionState } = await importRecursion();
    const accepted = await applyResearchDecision({
      decisionId: "decision-valid-parent",
      hypothesis: "Seed an active decision before testing rejection.",
      universe: ["BTC/USD"],
      parameters: {
        shortLookbackBars: 96,
        longLookbackBars: 672,
        maxPositiveForecasts: 2,
      },
    });
    const { activeExperiment } = await importExperiments();
    const activeBefore = await activeExperiment();

    const rejected = await applyResearchDecision({
      decisionId: "decision-rejected-1",
      hypothesis: "Invalid equity and out-of-bounds parameters should be rejected.",
      universe: ["SPY"],
      parameters: {
        shortLookbackBars: 12,
        longLookbackBars: 96,
        maxPositiveForecasts: 9,
      },
    });
    const state = await readRecursionState();
    const activeAfter = await activeExperiment();

    expect(accepted.ok).toBe(true);
    expect(rejected.ok).toBe(false);
    expect(rejected.decision.status).toBe("rejected");
    expect(rejected.errors.map((error) => error.field)).toEqual(
      expect.arrayContaining([
        "universe",
        "parameters.shortLookbackBars",
        "parameters.longLookbackBars",
        "parameters.maxPositiveForecasts",
      ]),
    );
    expect(state.activeDecisionId).toBe("decision-valid-parent");
    expect(state.decisions.find((decision) => decision.decisionId === "decision-rejected-1")).toBeTruthy();
    expect(activeAfter.experimentId).toBe(activeBefore.experimentId);
  });

  it("rejects universes above the 12-symbol cap", async () => {
    const { validateResearchDecision } = await importRecursion();

    const result = await validateResearchDecision({
      decisionId: "decision-too-wide",
      hypothesis: "Too many crypto pairs should not activate implicitly.",
      universe: [
        "BTC/USD",
        "ETH/USD",
        "SOL/USD",
        "ADA/USD",
        "DOGE/USD",
        "XRP/USD",
        "AVAX/USD",
        "LINK/USD",
        "LTC/USD",
        "BCH/USD",
        "DOT/USD",
        "MATIC/USD",
        "UNI/USD",
      ],
      parameters: {
        shortLookbackBars: 96,
        longLookbackBars: 672,
        maxPositiveForecasts: 5,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({
      field: "universe",
      message: "Universe is capped at 12 crypto symbols.",
    });
  });
});

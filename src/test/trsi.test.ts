import { describe, expect, it } from "vitest";

import { buildAllocationProposal } from "../lib/optimizer";
import { computeTRsi } from "../lib/trsi";

describe("t-rsi", () => {
  it("returns deterministic experimental certificate output", () => {
    const proposal = buildAllocationProposal({
      equityUsd: 50_000,
      cashUsd: 15_000,
      kalshiPortfolioUsd: null,
      recentLedgerCount: 3,
    });
    const a = computeTRsi(proposal);
    const b = computeTRsi(proposal);
    expect(a.status).toBe("experimental_not_audit_ready");
    expect(a.engine).toBe("synthetic-prior");
    expect(a.tRsi).toBeCloseTo(b.tRsi, 8);
    expect(a.samples).toHaveLength(3);
  });

  it("can use empirical evidence when the sample floor is met", () => {
    const proposal = buildAllocationProposal({
      equityUsd: 50_000,
      cashUsd: 15_000,
      kalshiPortfolioUsd: null,
      recentLedgerCount: 3,
    });
    const certificate = computeTRsi(proposal, {
      source: "test-history",
      sampleSize: 4,
      minSamples: 4,
      horizonMinutes: 15,
      createSamples: [0.09, 0.08, 0.07, 0.1],
      decaySamples: [0.01, 0.02, 0.01, 0.015],
    });

    expect(certificate.engine).toBe("kalshi-empirical");
    expect(certificate.evidence?.source).toBe("test-history");
    expect(certificate.evidence?.sampleSize).toBe(4);
  });
});

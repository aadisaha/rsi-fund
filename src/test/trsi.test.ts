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
    expect(a.tRsi).toBeCloseTo(b.tRsi, 8);
    expect(a.samples).toHaveLength(3);
  });
});

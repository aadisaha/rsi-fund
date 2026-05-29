import { describe, expect, it } from "vitest";

import { buildAllocationProposal } from "../lib/optimizer";

describe("optimizer", () => {
  it("stays paper-only and inside deployable budget", () => {
    const p = buildAllocationProposal({
      equityUsd: 100_000,
      cashUsd: 20_000,
      kalshiPortfolioUsd: 1_000,
      recentLedgerCount: 10,
    });
    expect(p.mode).toBe("paper");
    expect(p.constraints.find((c) => c.name === "paper-only execution")?.ok).toBe(true);
    expect(p.channels.reduce((sum, c) => sum + c.proposedUsd, 0)).toBeLessThanOrEqual(
      p.deployableCapitalUsd,
    );
  });

  it("withholds deployable capital when no account or explicit paper capital exists", () => {
    const original = process.env.PAPER_STARTING_EQUITY_USD;
    delete process.env.PAPER_STARTING_EQUITY_USD;
    const p = buildAllocationProposal({
      equityUsd: null,
      cashUsd: null,
      kalshiPortfolioUsd: null,
      recentLedgerCount: 0,
    });
    if (original == null) {
      delete process.env.PAPER_STARTING_EQUITY_USD;
    } else {
      process.env.PAPER_STARTING_EQUITY_USD = original;
    }

    expect(p.deployableCapitalUsd).toBe(0);
    expect(p.channels.every((c) => c.proposedUsd === 0)).toBe(true);
    expect(p.constraints.find((c) => c.name === "capital source")?.ok).toBe(false);
  });
});

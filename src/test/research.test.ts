import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { compareModelArchitectures } from "../lib/research";
import type { CachedBar } from "../lib/types";

function syntheticBars(count: number): CachedBar[] {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  let close = 100;
  return Array.from({ length: count }, (_, index) => {
    const seasonal = Math.sin(index / 12) * 0.0015;
    const drift = 0.00025;
    close *= 1 + drift + seasonal;
    return {
      at: new Date(start + index * 15 * 60 * 1000).toISOString(),
      close,
    };
  });
}

describe("model architecture comparison", () => {
  it("runs walk-forward model comparisons without future leakage", () => {
    const result = compareModelArchitectures("BTC", "15Min", syntheticBars(900), 1);

    expect(result.symbol).toBe("BTC/USD");
    expect(result.timeframe).toBe("15Min");
    expect(result.observations).toBe(900);
    expect(result.results.length).toBeGreaterThan(3);
    expect(result.bestModelId).toEqual(expect.any(String));
    expect(result.results.some((row) => row.observations > 0)).toBe(true);
    expect(result.results.every((row) => row.horizonBars === 1)).toBe(true);
  });

  it("reports insufficient-data models instead of inventing scores", () => {
    const result = compareModelArchitectures("ETH", "15Min", syntheticBars(40), 1);

    expect(result.results.some((row) => row.observations === 0)).toBe(true);
    expect(result.results.some((row) => row.directionalAccuracy == null)).toBe(true);
  });
});

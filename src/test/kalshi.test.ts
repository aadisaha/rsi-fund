import { afterEach, describe, expect, it } from "vitest";

import { kalshiMode } from "@/lib/kalshi";

const originalProduction = process.env.KALSHI_PRODUCTION;
const originalDemo = process.env.KALSHI_DEMO;

function resetKalshiEnv() {
  if (originalProduction === undefined) {
    delete process.env.KALSHI_PRODUCTION;
  } else {
    process.env.KALSHI_PRODUCTION = originalProduction;
  }

  if (originalDemo === undefined) {
    delete process.env.KALSHI_DEMO;
  } else {
    process.env.KALSHI_DEMO = originalDemo;
  }
}

describe("kalshi mode", () => {
  afterEach(resetKalshiEnv);

  it("defaults to demo", () => {
    delete process.env.KALSHI_PRODUCTION;
    delete process.env.KALSHI_DEMO;

    expect(kalshiMode()).toBe("demo");
  });

  it("treats KALSHI_PRODUCTION as the canonical mode flag", () => {
    process.env.KALSHI_PRODUCTION = "true";
    process.env.KALSHI_DEMO = "true";

    expect(kalshiMode()).toBe("production");
  });

  it("supports the legacy KALSHI_DEMO=false flag", () => {
    delete process.env.KALSHI_PRODUCTION;
    process.env.KALSHI_DEMO = "false";

    expect(kalshiMode()).toBe("production");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { defaultCycleSymbols, normalizeCycleSymbol } from "../lib/market-cache";

const originalCycleSymbols = process.env.CYCLE_SYMBOLS;

afterEach(() => {
  if (originalCycleSymbols == null) {
    delete process.env.CYCLE_SYMBOLS;
  } else {
    process.env.CYCLE_SYMBOLS = originalCycleSymbols;
  }
});

describe("market cache symbols", () => {
  it("normalizes crypto aliases and strips unsupported characters", () => {
    expect(normalizeCycleSymbol(" btc ")).toBe("BTC/USD");
    expect(normalizeCycleSymbol("BITCOIN")).toBe("BTC/USD");
    expect(normalizeCycleSymbol("ethereum")).toBe("ETH/USD");
    expect(normalizeCycleSymbol("solana")).toBe("SOL/USD");
    expect(normalizeCycleSymbol(" spy!!! ")).toBe("SPY");
    expect(normalizeCycleSymbol("   ")).toBeNull();
  });

  it("parses configured cycle symbols with dedupe and a 12 symbol cap", () => {
    process.env.CYCLE_SYMBOLS =
      "btc, BTC/USD, eth, sol, spy, qqq, dia, iwm, gld, tlt, uso, xle, xlf, xlk";

    expect(defaultCycleSymbols()).toEqual([
      "BTC/USD",
      "ETH/USD",
      "SOL/USD",
      "SPY",
      "QQQ",
      "DIA",
      "IWM",
      "GLD",
      "TLT",
      "USO",
      "XLE",
      "XLF",
    ]);
  });
});

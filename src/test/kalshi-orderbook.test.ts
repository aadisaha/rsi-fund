import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  appendKalshiOrderbookEvents,
  normalizeKalshiOrderbookEvent,
  normalizeKalshiScreenTick,
  normalizeOrderbookSnapshot,
  readKalshiOrderbookEvents,
} from "@/lib/kalshi-orderbook";

const originalDataDir = process.env.QUANT_DATA_DIR;
let tmpDir = "";

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "kalshi-orderbook-"));
  process.env.QUANT_DATA_DIR = tmpDir;
});

afterEach(async () => {
  if (originalDataDir === undefined) {
    delete process.env.QUANT_DATA_DIR;
  } else {
    process.env.QUANT_DATA_DIR = originalDataDir;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

describe("kalshi orderbook ingestion normalization", () => {
  it("derives binary-market asks from yes/no bid books", () => {
    const summary = normalizeOrderbookSnapshot({
      orderbook_fp: {
        yes_dollars: [["0.5500", "20.00"], ["0.5200", "10.00"]],
        no_dollars: [["0.4000", "15.00"], ["0.3500", "5.00"]],
      },
    });

    expect(summary.yesBid).toBe(0.55);
    expect(summary.noBid).toBe(0.4);
    expect(summary.yesAsk).toBeCloseTo(0.6);
    expect(summary.noAsk).toBeCloseTo(0.45);
    expect(summary.spread).toBeCloseTo(0.05);
    expect(summary.yesDepth).toBe(30);
  });

  it("normalizes websocket-like ticker records", () => {
    const event = normalizeKalshiOrderbookEvent({
      type: "ticker",
      msg: {
        market_ticker: "KXBTC15M-TEST",
        series_ticker: "KXBTC15M",
        yes_bid_dollars: "0.4800",
        yes_ask_dollars: "0.5200",
        no_bid_dollars: "0.4700",
        no_ask_dollars: "0.5300",
        close_time: "2026-05-29T12:15:00Z",
      },
    });

    expect(event?.marketTicker).toBe("KXBTC15M-TEST");
    expect(event?.seriesTicker).toBe("KXBTC15M");
    expect(event?.spread).toBeCloseTo(0.04);
    expect(event?.windowCloseTime).toBe("2026-05-29T12:15:00.000Z");
  });

  it("appends and reads normalized JSONL events", async () => {
    await appendKalshiOrderbookEvents([
      {
        receivedAt: "2026-05-29T12:00:00.000Z",
        marketTicker: "KXBTC15M-TEST",
        seriesTicker: "KXBTC15M",
        eventType: "ticker",
        windowOpenTime: "2026-05-29T12:00:00.000Z",
        windowCloseTime: "2026-05-29T12:15:00.000Z",
        yesBid: 0.48,
        yesAsk: 0.52,
        noBid: 0.47,
        noAsk: 0.53,
        spread: 0.04,
        yesDepth: 10,
        noDepth: 11,
        tradedPrice: null,
        tradedQuantity: null,
        settlementValue: null,
      },
    ]);

    const events = await readKalshiOrderbookEvents({ seriesTicker: "KXBTC15M" });
    expect(events).toHaveLength(1);
    expect(events[0].marketTicker).toBe("KXBTC15M-TEST");
  });

  it("normalizes visible Kalshi screen ticks into bid/ask events", () => {
    const event = normalizeKalshiScreenTick({
      marketTicker: "KXBTC15M-SCREEN-TEST",
      seriesTicker: "KXBTC15M",
      windowOpenTime: "2026-05-29T17:30:00Z",
      windowCloseTime: "2026-05-29T17:45:00Z",
      targetPrice: "$74,144.42",
      currentPrice: "$74,181.23",
      chance: "70%",
      upPrice: "75¢",
      downPrice: "26¢",
      tape: ["+ $12", "+ $39"],
    });

    expect(event?.marketTicker).toBe("KXBTC15M-SCREEN-TEST");
    expect(event?.yesAsk).toBe(0.75);
    expect(event?.noAsk).toBe(0.26);
    expect(event?.yesBid).toBeCloseTo(0.74);
    expect(event?.noBid).toBeCloseTo(0.25);
    expect(event?.spread).toBeCloseTo(0.01);
    expect(event?.tradedPrice).toBe(0.7);
    expect(event?.raw?.currentPrice).toBe(74181.23);
  });
});

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadEnvConfig } from "@next/env";

import { readKalshiCandles, readKalshiHistoryManifest } from "@/lib/kalshi-history";

loadEnvConfig(process.cwd());

type Stats = {
  count: number;
  mean: number | null;
  min: number | null;
  p05: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
};

type ParsedTicker = {
  closeTs: number | null;
  threshold: number | null;
  kind: "range-suffix" | "threshold" | "unknown";
};

type Row = {
  marketTicker: string;
  source: string;
  ts: number;
  closeTs: number | null;
  minutesToClose: number | null;
  mark: number;
  mid: number;
  tradeClose: number | null;
  spread: number;
  volume: number;
  openInterest: number;
};

const MONTHS: Record<string, number> = {
  JAN: 0,
  FEB: 1,
  MAR: 2,
  APR: 3,
  MAY: 4,
  JUN: 5,
  JUL: 6,
  AUG: 7,
  SEP: 8,
  OCT: 9,
  NOV: 10,
  DEC: 11,
};

function zonedTimeToUtcSeconds(args: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  timeZone: string;
}): number {
  const guess = Date.UTC(args.year, args.month, args.day, args.hour, args.minute, 0);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: args.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  function wallUtc(ms: number): number {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]));
    return Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
  }

  const first = guess - (wallUtc(guess) - guess);
  const second = first - (wallUtc(first) - guess);
  return Math.floor(second / 1000);
}

function pct(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function stats(values: Array<number | null | undefined>): Stats {
  const clean = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return {
    count: clean.length,
    mean: clean.length ? clean.reduce((sum, v) => sum + v, 0) / clean.length : null,
    min: pct(clean, 0),
    p05: pct(clean, 0.05),
    p25: pct(clean, 0.25),
    median: pct(clean, 0.5),
    p75: pct(clean, 0.75),
    p95: pct(clean, 0.95),
    p99: pct(clean, 0.99),
    max: pct(clean, 1),
  };
}

function fmt(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function table(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function inc(map: Map<string, number>, key: string, amount = 1) {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function sortedEntries(map: Map<string, number>): Array<{ key: string; value: number }> {
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, value]) => ({ key, value }));
}

function topEntries(map: Map<string, number>, n = 12): Array<{ key: string; value: number }> {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key, value]) => ({ key, value }));
}

function parseTicker(ticker: string): ParsedTicker {
  const match = ticker.match(/^KXBTC15M-(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})-(.+)$/);
  if (!match) return { closeTs: null, threshold: null, kind: "unknown" };
  const [, yy, mon, dd, hh, mm, suffix] = match;
  const month = MONTHS[mon];
  if (month == null) return { closeTs: null, threshold: null, kind: "unknown" };
  const year = 2000 + Number(yy);
  const closeTs = zonedTimeToUtcSeconds({
    year,
    month,
    day: Number(dd),
    hour: Number(hh),
    minute: Number(mm),
    timeZone: "America/New_York",
  });
  const threshold = suffix.startsWith("T") ? Number(suffix.slice(1)) : null;
  return {
    closeTs,
    threshold: Number.isFinite(threshold) ? threshold : null,
    kind: suffix.startsWith("T") ? "threshold" : "range-suffix",
  };
}

function bucketMinutesToClose(minutes: number | null): string {
  if (minutes == null) return "unknown";
  if (minutes < -1) return "after close";
  if (minutes <= 0) return "0 close";
  if (minutes <= 1) return "1";
  if (minutes <= 3) return "2-3";
  if (minutes <= 5) return "4-5";
  if (minutes <= 10) return "6-10";
  if (minutes <= 15) return "11-15";
  if (minutes <= 30) return "16-30";
  if (minutes <= 60) return "31-60";
  if (minutes <= 240) return "1-4h";
  if (minutes <= 1440) return "4-24h";
  return ">24h";
}

function priceBucket(mark: number): string {
  if (mark < 0.05) return "00-05";
  if (mark < 0.15) return "05-15";
  if (mark < 0.35) return "15-35";
  if (mark < 0.65) return "35-65";
  if (mark < 0.85) return "65-85";
  if (mark < 0.95) return "85-95";
  return "95-100";
}

function movementBucket(delta: number): string {
  const abs = Math.abs(delta);
  if (abs < 0.01) return "flat <1c";
  if (abs < 0.03) return "1-3c";
  if (abs < 0.05) return "3-5c";
  if (abs < 0.1) return "5-10c";
  if (abs < 0.2) return "10-20c";
  return ">=20c";
}

function corr(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx > 0 && vy > 0 ? num / Math.sqrt(vx * vy) : null;
}

function summarizeRows(rows: Row[]) {
  return {
    candles: rows.length,
    mark: stats(rows.map((r) => r.mark)),
    spread: stats(rows.map((r) => r.spread)),
    volume: stats(rows.map((r) => r.volume)),
    openInterest: stats(rows.map((r) => r.openInterest)),
    tradeCloseShare: rows.length ? rows.filter((r) => r.tradeClose != null).length / rows.length : null,
  };
}

async function main() {
  const manifest = await readKalshiHistoryManifest();
  const candles = await readKalshiCandles({ periodInterval: 1 });
  const parsedByTicker = new Map(Object.keys(manifest.markets).map((ticker) => [ticker, parseTicker(ticker)]));
  const rows: Row[] = [];
  const parseKinds = new Map<string, number>();
  const timeToCloseBuckets = new Map<string, number>();
  const afterCloseRows: Row[] = [];
  const weirdSpreadRows: Row[] = [];

  for (const candle of candles) {
    const bid = candle.yesBid.close;
    const ask = candle.yesAsk.close;
    if (bid == null || ask == null) continue;
    const mid = (bid + ask) / 2;
    const tradeClose = candle.price.close;
    const mark = tradeClose ?? mid;
    const parsed = parsedByTicker.get(candle.marketTicker) ?? parseTicker(candle.marketTicker);
    const minutesToClose = parsed.closeTs == null ? null : (parsed.closeTs - candle.endPeriodTs) / 60;
    const row: Row = {
      marketTicker: candle.marketTicker,
      source: candle.source,
      ts: candle.endPeriodTs,
      closeTs: parsed.closeTs,
      minutesToClose,
      mark,
      mid,
      tradeClose,
      spread: Math.max(0, ask - bid),
      volume: candle.volume ?? 0,
      openInterest: candle.openInterest ?? 0,
    };
    rows.push(row);
    inc(parseKinds, parsed.kind);
    inc(timeToCloseBuckets, bucketMinutesToClose(minutesToClose));
    if (minutesToClose != null && minutesToClose < -1) afterCloseRows.push(row);
    if (bid > ask || row.spread > 0.95) weirdSpreadRows.push(row);
  }

  const byMarket = new Map<string, Row[]>();
  for (const row of rows) byMarket.set(row.marketTicker, [...(byMarket.get(row.marketTicker) ?? []), row]);

  const oneMinuteMoves: number[] = [];
  const movePairsX: number[] = [];
  const movePairsY: number[] = [];
  const reversals = new Map<string, number>();
  const continuations = new Map<string, number>();
  const jumps = new Map<string, number>();
  const terminalMoves: number[] = [];
  const terminalAbsMoves: number[] = [];
  const terminalFinalMarks: number[] = [];
  const endpointDistances: number[] = [];
  const rangePerMarket: number[] = [];
  const signByPriceBucket = new Map<string, { up: number; down: number; flat: number }>();
  const marketPathExamples: Array<{
    marketTicker: string;
    candles: number;
    firstMark: number;
    lastMark: number;
    minMark: number;
    maxMark: number;
    range: number;
    totalVolume: number;
    maxAbsMove: number;
    maxGapMinutes: number;
  }> = [];
  const gapSizes: number[] = [];

  for (const [marketTicker, marketRows] of byMarket) {
    const sorted = [...marketRows].sort((a, b) => a.ts - b.ts);
    if (sorted.length < 2) continue;
    const marks = sorted.map((r) => r.mark);
    const deltas: number[] = [];
    let maxGapMinutes = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = (sorted[i].ts - sorted[i - 1].ts) / 60;
      maxGapMinutes = Math.max(maxGapMinutes, gap);
      if (gap > 1) gapSizes.push(gap);
      const delta = sorted[i].mark - sorted[i - 1].mark;
      deltas.push(delta);
      oneMinuteMoves.push(delta);
      inc(jumps, movementBucket(delta));
      const bucket = priceBucket(sorted[i - 1].mark);
      const signed = signByPriceBucket.get(bucket) ?? { up: 0, down: 0, flat: 0 };
      if (delta > 0.005) signed.up += 1;
      else if (delta < -0.005) signed.down += 1;
      else signed.flat += 1;
      signByPriceBucket.set(bucket, signed);
    }
    for (let i = 1; i < deltas.length; i += 1) {
      movePairsX.push(deltas[i - 1]);
      movePairsY.push(deltas[i]);
      const prev = Math.sign(deltas[i - 1]);
      const next = Math.sign(deltas[i]);
      if (prev === 0 || next === 0) continue;
      if (prev === next) inc(continuations, movementBucket(deltas[i - 1]));
      if (prev === -next) inc(reversals, movementBucket(deltas[i - 1]));
    }

    const first = sorted[0].mark;
    const last = sorted.at(-1)!.mark;
    const minMark = Math.min(...marks);
    const maxMark = Math.max(...marks);
    const terminal = last - first;
    terminalMoves.push(terminal);
    terminalAbsMoves.push(Math.abs(terminal));
    terminalFinalMarks.push(last);
    endpointDistances.push(Math.min(last, 1 - last));
    rangePerMarket.push(maxMark - minMark);
    marketPathExamples.push({
      marketTicker,
      candles: sorted.length,
      firstMark: first,
      lastMark: last,
      minMark,
      maxMark,
      range: maxMark - minMark,
      totalVolume: sorted.reduce((sum, r) => sum + r.volume, 0),
      maxAbsMove: Math.max(...deltas.map((d) => Math.abs(d))),
      maxGapMinutes,
    });
  }

  const lifecycleRows = new Map<string, Row[]>();
  for (const row of rows) lifecycleRows.set(bucketMinutesToClose(row.minutesToClose), [...(lifecycleRows.get(bucketMinutesToClose(row.minutesToClose)) ?? []), row]);
  const lifecycleOrder = ["4-24h", "1-4h", "31-60", "16-30", "11-15", "6-10", "4-5", "2-3", "1", "0 close", "after close", "unknown"];
  const lifecycle = lifecycleOrder
    .filter((bucket) => lifecycleRows.has(bucket))
    .map((bucket) => ({ bucket, ...summarizeRows(lifecycleRows.get(bucket)!) }));

  const moveReversalBySize = [...new Set([...reversals.keys(), ...continuations.keys()])].sort().map((bucket) => {
    const reversal = reversals.get(bucket) ?? 0;
    const continuation = continuations.get(bucket) ?? 0;
    const total = reversal + continuation;
    return {
      bucket,
      reversal,
      continuation,
      reversalShare: total ? reversal / total : null,
    };
  });

  const priceBucketMovement = [...signByPriceBucket.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, value]) => {
      const total = value.up + value.down + value.flat;
      return {
        bucket,
        ...value,
        upShare: total ? value.up / total : null,
        downShare: total ? value.down / total : null,
        flatShare: total ? value.flat / total : null,
      };
    });

  const totalSignedMoves = oneMinuteMoves.filter((m) => Math.abs(m) > 0.005).length;
  const positiveMoves = oneMinuteMoves.filter((m) => m > 0.005).length;
  const negativeMoves = oneMinuteMoves.filter((m) => m < -0.005).length;
  const nearTerminalShare = terminalFinalMarks.length
    ? terminalFinalMarks.filter((m) => m <= 0.05 || m >= 0.95).length / terminalFinalMarks.length
    : null;

  const summary = {
    generatedAt: new Date().toISOString(),
    coverage: {
      manifestMarkets: Object.keys(manifest.markets).length,
      candlesRead: candles.length,
      rowsWithBidAsk: rows.length,
      marketsWithRows: byMarket.size,
      parseKinds: sortedEntries(parseKinds),
      timeToCloseBuckets: sortedEntries(timeToCloseBuckets),
    },
    generalizedMechanics: {
      markDefinition: "trade close when present, otherwise yes bid/ask midpoint",
      overall: summarizeRows(rows),
      lifecycle,
      oneMinuteMoves: stats(oneMinuteMoves),
      absoluteOneMinuteMoves: stats(oneMinuteMoves.map(Math.abs)),
      terminalMoves: stats(terminalMoves),
      terminalAbsMoves: stats(terminalAbsMoves),
      endpointDistance: stats(endpointDistances),
      rangePerMarket: stats(rangePerMarket),
      nearTerminalShare,
      signedMoveBalance: {
        signedMoves: totalSignedMoves,
        positiveMoves,
        negativeMoves,
        positiveShare: totalSignedMoves ? positiveMoves / totalSignedMoves : null,
        negativeShare: totalSignedMoves ? negativeMoves / totalSignedMoves : null,
      },
      oneMinuteAutocorrelation: corr(movePairsX, movePairsY),
      moveSizeBuckets: sortedEntries(jumps),
      moveReversalBySize,
      priceBucketMovement,
    },
    irregularities: {
      afterCloseRows: afterCloseRows.length,
      weirdSpreadRows: weirdSpreadRows.length,
      gapSizes: stats(gapSizes),
      largestGaps: [...marketPathExamples].sort((a, b) => b.maxGapMinutes - a.maxGapMinutes).slice(0, 12),
      largestPathRanges: [...marketPathExamples].sort((a, b) => b.range - a.range).slice(0, 12),
      largestSingleStepMoves: [...marketPathExamples].sort((a, b) => b.maxAbsMove - a.maxAbsMove).slice(0, 12),
      highestVolumePaths: [...marketPathExamples].sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 12),
    },
  };

  const outDir = path.join(process.cwd(), ".data", "kalshi-history");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "market-mechanics-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  const lifecycleTable = table(
    ["Minutes To Close", "Candles", "Mark Median", "Spread Median", "Volume Median", "Trade Close Share"],
    summary.generalizedMechanics.lifecycle.map((bucket) => [
      bucket.bucket,
      fmt(bucket.candles, 0),
      fmt(bucket.mark.median),
      fmt(bucket.spread.median),
      fmt(bucket.volume.median, 0),
      `${fmt((bucket.tradeCloseShare ?? 0) * 100, 1)}%`,
    ]),
  );
  const movementTable = table(
    ["Metric", "Value"],
    [
      ["1m move median", fmt(summary.generalizedMechanics.oneMinuteMoves.median)],
      ["1m move P05/P95", `${fmt(summary.generalizedMechanics.oneMinuteMoves.p05)} / ${fmt(summary.generalizedMechanics.oneMinuteMoves.p95)}`],
      ["Abs 1m move median", fmt(summary.generalizedMechanics.absoluteOneMinuteMoves.median)],
      ["Abs 1m move P95", fmt(summary.generalizedMechanics.absoluteOneMinuteMoves.p95)],
      ["Path first-to-last median", fmt(summary.generalizedMechanics.terminalMoves.median)],
      ["Path absolute move median", fmt(summary.generalizedMechanics.terminalAbsMoves.median)],
      ["Path range median", fmt(summary.generalizedMechanics.rangePerMarket.median)],
      ["Final mark within 5c of 0/1", `${fmt((summary.generalizedMechanics.nearTerminalShare ?? 0) * 100, 1)}%`],
      ["1m autocorrelation", fmt(summary.generalizedMechanics.oneMinuteAutocorrelation)],
      ["Positive signed move share", `${fmt((summary.generalizedMechanics.signedMoveBalance.positiveShare ?? 0) * 100, 1)}%`],
    ],
  );
  const reversalTable = table(
    ["Previous Move Size", "Reversal Share", "Reversals", "Continuations"],
    summary.generalizedMechanics.moveReversalBySize.map((row) => [
      row.bucket,
      `${fmt((row.reversalShare ?? 0) * 100, 1)}%`,
      fmt(row.reversal, 0),
      fmt(row.continuation, 0),
    ]),
  );
  const priceBucketTable = table(
    ["Starting Mark", "Up", "Down", "Flat", "Up Share", "Down Share"],
    summary.generalizedMechanics.priceBucketMovement.map((row) => [
      row.bucket,
      fmt(row.up, 0),
      fmt(row.down, 0),
      fmt(row.flat, 0),
      `${fmt((row.upShare ?? 0) * 100, 1)}%`,
      `${fmt((row.downShare ?? 0) * 100, 1)}%`,
    ]),
  );
  const irregularityTable = table(
    ["Check", "Value"],
    [
      ["Rows after parsed market close", fmt(summary.irregularities.afterCloseRows, 0)],
      ["Rows with crossed or >95c spread", fmt(summary.irregularities.weirdSpreadRows, 0)],
      ["Gap count >1 minute", fmt(summary.irregularities.gapSizes.count, 0)],
      ["Gap median minutes", fmt(summary.irregularities.gapSizes.median)],
      ["Gap P95 minutes", fmt(summary.irregularities.gapSizes.p95)],
      ["Gap max minutes", fmt(summary.irregularities.gapSizes.max)],
    ],
  );
  const largestRangeTable = table(
    ["Market", "Candles", "Range", "First", "Last", "Max Step", "Max Gap", "Volume"],
    summary.irregularities.largestPathRanges.slice(0, 8).map((m) => [
      m.marketTicker,
      fmt(m.candles, 0),
      fmt(m.range),
      fmt(m.firstMark),
      fmt(m.lastMark),
      fmt(m.maxAbsMove),
      fmt(m.maxGapMinutes),
      fmt(m.totalVolume, 0),
    ]),
  );

  const markdown = [
    "# Kalshi BTC 15M Market Mechanics",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "This report uses a mark price equal to trade close when Kalshi provides it, otherwise the yes bid/ask midpoint. That lets us study quote movement across the full local candle cache instead of only the subset with trade-close candles.",
    "",
    "## Headline Mechanics",
    "",
    movementTable,
    "",
    "## Lifecycle Shape",
    "",
    lifecycleTable,
    "",
    "## Mean Reversion And Continuation",
    "",
    reversalTable,
    "",
    "## Movement By Price Region",
    "",
    priceBucketTable,
    "",
    "## Irregularities",
    "",
    irregularityTable,
    "",
    "## Largest Path Ranges",
    "",
    largestRangeTable,
    "",
    "## Interpretation",
    "",
    "- The generalized mark is centered near 50c, but individual paths are jumpy: median path range is materially larger than the median one-minute move.",
    "- One-minute movement has near-zero median, so most raw candle-to-candle changes are noise or unchanged quotes.",
    "- Reversal shares above 50% after non-flat moves are evidence of microstructure bounce, especially when spreads are wide.",
    "- Wide spreads and sparse paths mean naive trend following on all candles would mostly model liquidity/friction, not clean directional edge.",
    "- Dense, low-spread, nonzero-volume paths should be the first research subset for any predictive study.",
  ].join("\n");

  await mkdir(path.join(process.cwd(), "docs"), { recursive: true });
  await writeFile(path.join(process.cwd(), "docs", "kalshi-market-mechanics.md"), markdown);

  console.log(
    JSON.stringify(
      {
        ok: true,
        report: "docs/kalshi-market-mechanics.md",
        summary: ".data/kalshi-history/market-mechanics-summary.json",
        headline: {
          rows: rows.length,
          markets: byMarket.size,
          oneMinuteAutocorrelation: summary.generalizedMechanics.oneMinuteAutocorrelation,
          medianAbsOneMinuteMove: summary.generalizedMechanics.absoluteOneMinuteMoves.median,
          medianPathRange: summary.generalizedMechanics.rangePerMarket.median,
          nearTerminalShare: summary.generalizedMechanics.nearTerminalShare,
          afterCloseRows: summary.irregularities.afterCloseRows,
          weirdSpreadRows: summary.irregularities.weirdSpreadRows,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});

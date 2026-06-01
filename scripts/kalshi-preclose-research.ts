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
  max: number | null;
};

type Row = {
  marketTicker: string;
  ts: number;
  minutesToClose: number;
  mark: number;
  mid: number;
  tradeClose: number | null;
  spread: number;
  volume: number;
  openInterest: number;
};

type ForwardSample = {
  marketTicker: string;
  horizon: number;
  minutesToClose: number;
  startMark: number;
  endMark: number;
  delta: number;
  absDelta: number;
  spread: number;
  volume: number;
  openInterest: number;
  bucket: string;
  priceBucket: string;
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

function parseCloseTs(ticker: string): number | null {
  const match = ticker.match(/^KXBTC15M-(\d{2})([A-Z]{3})(\d{2})(\d{2})(\d{2})-/);
  if (!match) return null;
  const [, yy, mon, dd, hh, mm] = match;
  const month = MONTHS[mon];
  if (month == null) return null;
  return zonedTimeToUtcSeconds({
    year: 2000 + Number(yy),
    month,
    day: Number(dd),
    hour: Number(hh),
    minute: Number(mm),
    timeZone: "America/New_York",
  });
}

function minuteBucket(minutesToClose: number): string {
  if (minutesToClose <= 0) return "00 close";
  if (minutesToClose <= 1) return "01";
  if (minutesToClose <= 3) return "02-03";
  if (minutesToClose <= 5) return "04-05";
  if (minutesToClose <= 10) return "06-10";
  if (minutesToClose <= 15) return "11-15";
  if (minutesToClose <= 30) return "16-30";
  return "31-60";
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

function spreadBucket(spread: number): string {
  if (spread <= 0.02) return "<=02c";
  if (spread <= 0.05) return "02-05c";
  if (spread <= 0.1) return "05-10c";
  if (spread <= 0.25) return "10-25c";
  if (spread <= 0.5) return "25-50c";
  return ">50c";
}

function summarizeForward(samples: ForwardSample[]) {
  const signed = samples.filter((s) => Math.abs(s.delta) > 0.005);
  const up = signed.filter((s) => s.delta > 0).length;
  const down = signed.filter((s) => s.delta < 0).length;
  return {
    samples: samples.length,
    delta: stats(samples.map((s) => s.delta)),
    absDelta: stats(samples.map((s) => s.absDelta)),
    up,
    down,
    upShare: signed.length ? up / signed.length : null,
    downShare: signed.length ? down / signed.length : null,
    meanStartSpread: samples.length ? samples.reduce((sum, s) => sum + s.spread, 0) / samples.length : null,
  };
}

function groupForward(samples: ForwardSample[], keyFn: (sample: ForwardSample) => string) {
  const groups = new Map<string, ForwardSample[]>();
  for (const sample of samples) groups.set(keyFn(sample), [...(groups.get(keyFn(sample)) ?? []), sample]);
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, group]) => ({ key, ...summarizeForward(group) }));
}

async function main() {
  const manifest = await readKalshiHistoryManifest();
  const candles = await readKalshiCandles({ periodInterval: 1 });
  const closeByTicker = new Map(Object.keys(manifest.markets).map((ticker) => [ticker, parseCloseTs(ticker)]));
  const rows: Row[] = [];

  for (const candle of candles) {
    const bid = candle.yesBid.close;
    const ask = candle.yesAsk.close;
    const closeTs = closeByTicker.get(candle.marketTicker) ?? null;
    if (bid == null || ask == null || closeTs == null) continue;
    const minutesToClose = (closeTs - candle.endPeriodTs) / 60;
    if (minutesToClose < 0 || minutesToClose > 60) continue;
    const mid = (bid + ask) / 2;
    rows.push({
      marketTicker: candle.marketTicker,
      ts: candle.endPeriodTs,
      minutesToClose,
      mark: candle.price.close ?? mid,
      mid,
      tradeClose: candle.price.close,
      spread: Math.max(0, ask - bid),
      volume: candle.volume ?? 0,
      openInterest: candle.openInterest ?? 0,
    });
  }

  const byMarket = new Map<string, Row[]>();
  for (const row of rows) byMarket.set(row.marketTicker, [...(byMarket.get(row.marketTicker) ?? []), row]);

  const horizons = [1, 3, 5, 10, 15];
  const forwardSamples: ForwardSample[] = [];
  const gapMinutes: number[] = [];
  const marketSummaries: Array<{
    marketTicker: string;
    candles: number;
    firstMinutesToClose: number;
    lastMinutesToClose: number;
    firstMark: number;
    lastMark: number;
    range: number;
    totalVolume: number;
    medianSpread: number | null;
    maxGap: number;
  }> = [];

  for (const [marketTicker, marketRows] of byMarket) {
    const sorted = [...marketRows].sort((a, b) => a.ts - b.ts);
    const byTs = new Map(sorted.map((row) => [row.ts, row]));
    const marks = sorted.map((row) => row.mark);
    const spreads = sorted.map((row) => row.spread);
    let maxGap = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = (sorted[i].ts - sorted[i - 1].ts) / 60;
      if (gap > 1) gapMinutes.push(gap);
      maxGap = Math.max(maxGap, gap);
    }

    for (const row of sorted) {
      for (const horizon of horizons) {
        const future = byTs.get(row.ts + horizon * 60);
        if (!future) continue;
        forwardSamples.push({
          marketTicker,
          horizon,
          minutesToClose: row.minutesToClose,
          startMark: row.mark,
          endMark: future.mark,
          delta: future.mark - row.mark,
          absDelta: Math.abs(future.mark - row.mark),
          spread: row.spread,
          volume: row.volume,
          openInterest: row.openInterest,
          bucket: minuteBucket(row.minutesToClose),
          priceBucket: priceBucket(row.mark),
        });
      }
    }

    marketSummaries.push({
      marketTicker,
      candles: sorted.length,
      firstMinutesToClose: sorted[0].minutesToClose,
      lastMinutesToClose: sorted.at(-1)!.minutesToClose,
      firstMark: sorted[0].mark,
      lastMark: sorted.at(-1)!.mark,
      range: Math.max(...marks) - Math.min(...marks),
      totalVolume: sorted.reduce((sum, row) => sum + row.volume, 0),
      medianSpread: stats(spreads).median,
      maxGap,
    });
  }

  const cleanRows = rows.filter((row) => row.spread <= 0.05 && row.minutesToClose > 0 && row.minutesToClose <= 60);
  const liquidRows = rows.filter((row) => row.volume > 0 || row.openInterest > 0);
  const cleanForward = forwardSamples.filter((sample) => sample.spread <= 0.05);
  const liquidForward = forwardSamples.filter((sample) => sample.volume > 0 || sample.openInterest > 0);
  const cleanLiquidForward = forwardSamples.filter(
    (sample) => sample.spread <= 0.05 && (sample.volume > 0 || sample.openInterest > 0),
  );

  const byBucket = new Map<string, Row[]>();
  const bySpreadBucket = new Map<string, Row[]>();
  for (const row of rows) {
    byBucket.set(minuteBucket(row.minutesToClose), [...(byBucket.get(minuteBucket(row.minutesToClose)) ?? []), row]);
    bySpreadBucket.set(spreadBucket(row.spread), [...(bySpreadBucket.get(spreadBucket(row.spread)) ?? []), row]);
  }

  const bucketOrder = ["31-60", "16-30", "11-15", "06-10", "04-05", "02-03", "01", "00 close"];
  const lifecycle = bucketOrder
    .filter((bucket) => byBucket.has(bucket))
    .map((bucket) => {
      const group = byBucket.get(bucket)!;
      return {
        bucket,
        rows: group.length,
        mark: stats(group.map((row) => row.mark)),
        spread: stats(group.map((row) => row.spread)),
        volume: stats(group.map((row) => row.volume)),
        openInterest: stats(group.map((row) => row.openInterest)),
        cleanShare: group.filter((row) => row.spread <= 0.05).length / group.length,
        tradeCloseShare: group.filter((row) => row.tradeClose != null).length / group.length,
      };
    });

  const summary = {
    generatedAt: new Date().toISOString(),
    scope: {
      rows: rows.length,
      markets: byMarket.size,
      cleanRows: cleanRows.length,
      cleanRowShare: rows.length ? cleanRows.length / rows.length : null,
      liquidRows: liquidRows.length,
      liquidRowShare: rows.length ? liquidRows.length / rows.length : null,
      markDefinition: "trade close when present, otherwise yes bid/ask midpoint",
    },
    lifecycle,
    rowDistributions: {
      mark: stats(rows.map((row) => row.mark)),
      spread: stats(rows.map((row) => row.spread)),
      volume: stats(rows.map((row) => row.volume)),
      openInterest: stats(rows.map((row) => row.openInterest)),
      gapMinutes: stats(gapMinutes),
      marketCandles: stats(marketSummaries.map((m) => m.candles)),
      marketRange: stats(marketSummaries.map((m) => m.range)),
      marketMedianSpread: stats(marketSummaries.map((m) => m.medianSpread)),
    },
    forward: {
      all: groupForward(forwardSamples, (sample) => String(sample.horizon)),
      cleanSpread: groupForward(cleanForward, (sample) => String(sample.horizon)),
      liquid: groupForward(liquidForward, (sample) => String(sample.horizon)),
      cleanLiquid: groupForward(cleanLiquidForward, (sample) => String(sample.horizon)),
      horizon5ByMinuteBucket: groupForward(
        forwardSamples.filter((sample) => sample.horizon === 5),
        (sample) => sample.bucket,
      ),
      horizon5ByPriceBucket: groupForward(
        forwardSamples.filter((sample) => sample.horizon === 5),
        (sample) => sample.priceBucket,
      ),
      horizon5CleanByPriceBucket: groupForward(
        cleanForward.filter((sample) => sample.horizon === 5),
        (sample) => sample.priceBucket,
      ),
    },
    spreadBuckets: [...bySpreadBucket.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([bucket, group]) => ({
        bucket,
        rows: group.length,
        share: rows.length ? group.length / rows.length : null,
        mark: stats(group.map((row) => row.mark)),
        volume: stats(group.map((row) => row.volume)),
      })),
    examples: {
      largestRanges: [...marketSummaries].sort((a, b) => b.range - a.range).slice(0, 12),
      highestVolume: [...marketSummaries].sort((a, b) => b.totalVolume - a.totalVolume).slice(0, 12),
      largestGaps: [...marketSummaries].sort((a, b) => b.maxGap - a.maxGap).slice(0, 12),
    },
  };

  const outDir = path.join(process.cwd(), ".data", "kalshi-history");
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "preclose-research-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

  const lifecycleTable = table(
    ["Bucket", "Rows", "Mark Med", "Spread Med", "Vol Med", "Clean Share", "Trade Close Share"],
    summary.lifecycle.map((row) => [
      row.bucket,
      fmt(row.rows, 0),
      fmt(row.mark.median),
      fmt(row.spread.median),
      fmt(row.volume.median, 0),
      `${fmt(row.cleanShare * 100, 1)}%`,
      `${fmt(row.tradeCloseShare * 100, 1)}%`,
    ]),
  );

  const forwardTable = table(
    ["Subset", "Horizon", "Samples", "Mean Delta", "Median Delta", "Abs Med", "Up Share", "Mean Spread"],
    [
      ...summary.forward.all.map((row) => ["All", row]),
      ...summary.forward.cleanSpread.map((row) => ["Spread <=5c", row]),
      ...summary.forward.cleanLiquid.map((row) => ["Clean + liquid", row]),
    ].map(([label, raw]) => {
      const row = raw as ReturnType<typeof groupForward>[number];
      return [
        label as string,
        `${row.key}m`,
        fmt(row.samples, 0),
        fmt(row.delta.mean),
        fmt(row.delta.median),
        fmt(row.absDelta.median),
        `${fmt((row.upShare ?? 0) * 100, 1)}%`,
        fmt(row.meanStartSpread),
      ];
    }),
  );

  const bucketForwardTable = table(
    ["5m Start Bucket", "Samples", "Mean Delta", "Median Delta", "Abs Med", "Up Share", "Mean Spread"],
    summary.forward.horizon5ByMinuteBucket.map((row) => [
      row.key,
      fmt(row.samples, 0),
      fmt(row.delta.mean),
      fmt(row.delta.median),
      fmt(row.absDelta.median),
      `${fmt((row.upShare ?? 0) * 100, 1)}%`,
      fmt(row.meanStartSpread),
    ]),
  );

  const priceForwardTable = table(
    ["5m Start Price", "Samples", "All Mean", "All Up", "Clean Samples", "Clean Mean", "Clean Up"],
    summary.forward.horizon5ByPriceBucket.map((row) => {
      const clean = summary.forward.horizon5CleanByPriceBucket.find((candidate) => candidate.key === row.key);
      return [
        row.key,
        fmt(row.samples, 0),
        fmt(row.delta.mean),
        `${fmt((row.upShare ?? 0) * 100, 1)}%`,
        fmt(clean?.samples ?? 0, 0),
        fmt(clean?.delta.mean),
        `${fmt(((clean?.upShare ?? 0) as number) * 100, 1)}%`,
      ];
    }),
  );

  const spreadTable = table(
    ["Spread Bucket", "Rows", "Share", "Mark Median", "Volume Median"],
    summary.spreadBuckets.map((row) => [
      row.bucket,
      fmt(row.rows, 0),
      `${fmt((row.share ?? 0) * 100, 1)}%`,
      fmt(row.mark.median),
      fmt(row.volume.median, 0),
    ]),
  );

  const markdown = [
    "# Kalshi BTC 0-60 Minute Pre-Close Research",
    "",
    `Generated: ${summary.generatedAt}`,
    "",
    "This report studies only rows from 0 to 60 minutes before the parsed Kalshi market close. Mark price is trade close when present, otherwise yes bid/ask midpoint.",
    "",
    "## Scope",
    "",
    table(
      ["Metric", "Value"],
      [
        ["Rows", fmt(summary.scope.rows, 0)],
        ["Markets", fmt(summary.scope.markets, 0)],
        ["Clean rows, spread <= 5c", fmt(summary.scope.cleanRows, 0)],
        ["Clean row share", `${fmt((summary.scope.cleanRowShare ?? 0) * 100, 1)}%`],
        ["Rows with volume or OI", fmt(summary.scope.liquidRows, 0)],
        ["Liquid row share", `${fmt((summary.scope.liquidRowShare ?? 0) * 100, 1)}%`],
      ],
    ),
    "",
    "## Lifecycle Inside 60 Minutes",
    "",
    lifecycleTable,
    "",
    "## Forward Movement",
    "",
    forwardTable,
    "",
    "## 5-Minute Forward Movement By Start Time",
    "",
    bucketForwardTable,
    "",
    "## 5-Minute Forward Movement By Starting Price",
    "",
    priceForwardTable,
    "",
    "## Spread Regimes",
    "",
    spreadTable,
    "",
    "## Irregularities",
    "",
    table(
      ["Metric", "Value"],
      [
        ["Gap count >1 minute", fmt(summary.rowDistributions.gapMinutes.count, 0)],
        ["Gap median minutes", fmt(summary.rowDistributions.gapMinutes.median)],
        ["Gap P95 minutes", fmt(summary.rowDistributions.gapMinutes.p95)],
        ["Market range median", fmt(summary.rowDistributions.marketRange.median)],
        ["Market range P95", fmt(summary.rowDistributions.marketRange.p95)],
        ["Market median-spread median", fmt(summary.rowDistributions.marketMedianSpread.median)],
      ],
    ),
    "",
    "## High-Range Examples",
    "",
    table(
      ["Market", "Candles", "Range", "First", "Last", "Vol", "Med Spread", "Max Gap"],
      summary.examples.largestRanges.slice(0, 8).map((row) => [
        row.marketTicker,
        fmt(row.candles, 0),
        fmt(row.range),
        fmt(row.firstMark),
        fmt(row.lastMark),
        fmt(row.totalVolume, 0),
        fmt(row.medianSpread),
        fmt(row.maxGap),
      ]),
    ),
    "",
    "## Initial Read",
    "",
    "- The 0-60 minute window is not homogeneous: 31-60 and 16-30 minute rows are much cleaner than close/settlement rows.",
    "- Raw all-row forward deltas are close to balanced, which argues against a simple unconditional drift edge.",
    "- Spread filtering matters more than horizon choice. The clean subset has far fewer samples but much lower friction.",
    "- Starting price region has visible boundary effects: low marks more often move up, high marks more often move down, consistent with quote bounce and bounded [0,1] pricing.",
    "- The best next predictive research should model conditional movement only on clean rows and should treat close-bucket rows as settlement artifacts unless independently verified.",
  ].join("\n");

  await mkdir(path.join(process.cwd(), "docs"), { recursive: true });
  await writeFile(path.join(process.cwd(), "docs", "kalshi-preclose-research.md"), markdown);

  console.log(
    JSON.stringify(
      {
        ok: true,
        report: "docs/kalshi-preclose-research.md",
        summary: ".data/kalshi-history/preclose-research-summary.json",
        scope: summary.scope,
        forwardAll: summary.forward.all,
        cleanForward: summary.forward.cleanSpread,
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

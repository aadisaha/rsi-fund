import "server-only";

import { fetchAlpacaCryptoBars, fetchAlpacaDailyBars } from "@/lib/alpaca";
import { normalizeCycleSymbol } from "@/lib/market-cache";

export type BacktestResult = {
  symbol: string;
  observations: number;
  start: string | null;
  end: string | null;
  totalReturnPct: number | null;
  annualizedVolPct: number | null;
  sharpeProxy: number | null;
  note: string;
};

export async function runBaselineBacktest(symbol: string): Promise<BacktestResult> {
  const safeSymbol = normalizeCycleSymbol(symbol);
  if (!safeSymbol) throw new Error("A market symbol is required.");
  const isCrypto = safeSymbol.includes("/");
  const bars = isCrypto
    ? await fetchAlpacaCryptoBars(safeSymbol, 21, "15Min")
    : await fetchAlpacaDailyBars(safeSymbol, 120);
  if (bars.length < 5) {
    return {
      symbol: safeSymbol,
      observations: bars.length,
      start: bars[0]?.at ?? null,
      end: bars.at(-1)?.at ?? null,
      totalReturnPct: null,
      annualizedVolPct: null,
      sharpeProxy: null,
      note: `Not enough ${isCrypto ? "15-minute crypto" : "daily"} bars for a baseline run.`,
    };
  }

  const returns = bars.slice(1).map((b, i) => b.close / bars[i].close - 1);
  const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
  const vol = Math.sqrt(
    returns.reduce((s, r) => s + (r - avg) ** 2, 0) / Math.max(returns.length - 1, 1),
  );
  const total = bars.at(-1)!.close / bars[0].close - 1;
  return {
    symbol: safeSymbol,
    observations: bars.length,
    start: bars[0].at,
    end: bars.at(-1)!.at,
    totalReturnPct: total * 100,
    annualizedVolPct: vol * Math.sqrt(isCrypto ? 365 * 24 * 4 : 252) * 100,
    sharpeProxy: vol > 0 ? (avg / vol) * Math.sqrt(isCrypto ? 365 * 24 * 4 : 252) : null,
    note: isCrypto
      ? "Baseline 15-minute crypto diagnostic; not an alpha model."
      : "Baseline buy-and-hold diagnostic; not an alpha model.",
  };
}

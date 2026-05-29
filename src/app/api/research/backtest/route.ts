import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { appendLedger } from "@/lib/ledger";
import { runBaselineBacktest } from "@/lib/research";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as { symbol?: unknown };
    const symbol = typeof body.symbol === "string" ? body.symbol : "SPY";
    const result = await runBaselineBacktest(symbol);
    const score = result.sharpeProxy ?? 0;
    const record = await appendLedger({
      type: "forecast",
      modelId: "baseline-buy-hold-diagnostic",
      target: result.symbol,
      mean: result.totalReturnPct ?? 0,
      sigma: result.annualizedVolPct ?? 0,
      payload: result,
    });
    await appendLedger({
      type: "model_version",
      modelId: `baseline-${result.symbol}-${Date.now().toString(36)}`,
      dataCutoff: result.end ?? new Date().toISOString(),
      score,
      payload: result,
    });
    return NextResponse.json({ ok: true, result, record });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown backtest error.",
      },
      { status: 200 },
    );
  }
}

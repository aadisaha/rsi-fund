import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { appendLedger } from "@/lib/ledger";
import { runModelComparisonBacktest } from "@/lib/research";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      symbol?: unknown;
      horizonBars?: unknown;
    };
    const symbol = typeof body.symbol === "string" ? body.symbol : "SPY";
    const horizonBars = Number(body.horizonBars);
    const result = await runModelComparisonBacktest(
      symbol,
      Number.isFinite(horizonBars) ? horizonBars : 1,
    );
    const best = result.results.find((row) => row.modelId === result.bestModelId);
    const record = await appendLedger({
      type: "forecast",
      modelId: "model-comparison-backtest",
      target: result.symbol,
      mean: best?.lastPredictionPct ?? 0,
      sigma: best?.rmseBps ?? 0,
      payload: result,
    });
    for (const model of result.results) {
      await appendLedger({
        type: "model_version",
        modelId: `${model.modelId}-${result.symbol}-${Date.now().toString(36)}`,
        dataCutoff: result.end ?? new Date().toISOString(),
        score: model.sharpeProxy ?? model.directionalAccuracy ?? 0,
        payload: { ...result, results: [model] },
      });
    }
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

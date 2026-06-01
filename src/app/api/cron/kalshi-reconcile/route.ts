import { NextResponse } from "next/server";

import { runKalshiLiveReconciliation } from "@/lib/kalshi-live";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const actual = req.headers.get("authorization") ?? "";
  if (!expected || actual !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  try {
    const reconciliation = await runKalshiLiveReconciliation();
    return NextResponse.json({ ok: reconciliation.ok, reconciliation });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Kalshi cron reconciliation error.",
      },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { backfillKalshiHistory, type KalshiBackfillRequest } from "@/lib/kalshi-history";

export async function POST(req: Request) {
  const denied = requireOperatorAccess(req, { mutation: true });
  if (denied) return denied;

  try {
    const body = (await req.json()) as KalshiBackfillRequest;
    const result = await backfillKalshiHistory(body);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Kalshi backfill failed.",
      },
      { status: 400 },
    );
  }
}

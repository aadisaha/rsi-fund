import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { readKalshiRlSummary } from "@/lib/kalshi-rl";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const denied = requireOperatorAccess(req);
    if (denied) return denied;
    const summary = await readKalshiRlSummary();
    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      summary,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Kalshi RL summary error.",
      },
      { status: 200 },
    );
  }
}

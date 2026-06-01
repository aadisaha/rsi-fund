import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { runKalshiLiveReconciliation } from "@/lib/kalshi-live";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;

    const reconciliation = await runKalshiLiveReconciliation();
    return NextResponse.json({ ok: reconciliation.ok, reconciliation });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Kalshi reconciliation error.",
      },
      { status: 500 },
    );
  }
}

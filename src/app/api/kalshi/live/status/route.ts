import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { readKalshiLiveStatus } from "@/lib/kalshi-live";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const denied = requireOperatorAccess(req);
    if (denied) return denied;

    return NextResponse.json({
      ok: true,
      status: await readKalshiLiveStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Kalshi live status error.",
      },
      { status: 500 },
    );
  }
}

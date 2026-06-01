import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { setKalshiLiveKillSwitch } from "@/lib/kalshi-live";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;

    const body = (await req.json().catch(() => ({}))) as {
      active?: unknown;
      reason?: unknown;
    };
    const state = await setKalshiLiveKillSwitch({
      active: body.active !== false,
      reason: typeof body.reason === "string" ? body.reason : "",
      source: "operator",
    });
    return NextResponse.json({ ok: true, killSwitch: state });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Kalshi kill switch error.",
      },
      { status: 500 },
    );
  }
}

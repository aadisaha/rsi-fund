import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { runKalshiRlOnce, waitForKalshiRlEvents } from "@/lib/kalshi-rl";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      waitForDataMs?: unknown;
      pollMs?: unknown;
    };
    const waitForDataMs = Number(body.waitForDataMs ?? 0);
    const pollMs = Number(body.pollMs ?? 5_000);
    if (Number.isFinite(waitForDataMs) && waitForDataMs > 0) {
      await waitForKalshiRlEvents(waitForDataMs, Number.isFinite(pollMs) ? pollMs : 5_000);
    }
    const result = await runKalshiRlOnce();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Kalshi RL training error.",
      },
      { status: 200 },
    );
  }
}

import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { runKalshiMollyLineOnce } from "@/lib/kalshi-pretrained-rl";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const result = await runKalshiMollyLineOnce();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown Molly pretrained RL error.",
      },
      { status: 200 },
    );
  }
}

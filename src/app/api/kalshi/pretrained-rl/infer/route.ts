import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { runKalshiPretrainedRlInference } from "@/lib/kalshi-pretrained-rl";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const result = await runKalshiPretrainedRlInference();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown pretrained RL inference error.",
      },
      { status: 200 },
    );
  }
}

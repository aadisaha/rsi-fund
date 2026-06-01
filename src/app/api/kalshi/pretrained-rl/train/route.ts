import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { runKalshiPretrainedRlTrain } from "@/lib/kalshi-pretrained-rl";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const result = await runKalshiPretrainedRlTrain();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown pretrained RL training error.",
      },
      { status: 200 },
    );
  }
}

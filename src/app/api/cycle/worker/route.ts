import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { runNextQueuedPaperCycleJob } from "@/lib/cycle-queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;

    const result = await runNextQueuedPaperCycleJob();
    return NextResponse.json({
      ok: !("error" in result),
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown cycle worker error.",
      },
      { status: 200 },
    );
  }
}

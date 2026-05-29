import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { enqueuePaperCycleJob } from "@/lib/cycle-queue";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;

    const body = await req.json().catch(() => ({}));
    const job = await enqueuePaperCycleJob(body);

    return NextResponse.json(
      {
        ok: true,
        queued: job.status === "queued",
        job,
      },
      { status: job.status === "queued" ? 202 : 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown cycle enqueue error.",
      },
      { status: 200 },
    );
  }
}

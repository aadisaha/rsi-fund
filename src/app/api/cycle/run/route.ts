import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { beginJob, createRunId, failJob, finishJob } from "@/lib/jobs";
import { runPaperCycleLocked } from "@/lib/paper-cycle";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let runId: string | null = null;
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      symbols?: unknown;
      runId?: unknown;
      idempotencyKey?: unknown;
    };
    const symbols =
      typeof body.symbols === "string"
        ? body.symbols
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 12)
        : undefined;
    const idempotencyKey =
      typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : `${new Date().toISOString().slice(0, 16)}:${symbols?.join(",") ?? "active-experiment"}`;
    runId =
      typeof body.runId === "string" && body.runId.trim()
        ? body.runId.trim()
        : createRunId("paper-cycle", idempotencyKey);
    const job = await beginJob({
      runId,
      jobName: "paper-cycle",
      idempotencyKey,
      input: { symbols: symbols ?? "active-experiment" },
    });
    if (job.finishedAt) {
      return NextResponse.json({ ok: job.status === "succeeded", job, cycle: job.output?.cycle });
    }
    const cycle = await runPaperCycleLocked(symbols);
    const finished = await finishJob(runId, {
      cycle: {
        cycleId: cycle.cycleId,
        generatedAt: cycle.generatedAt,
        rejected: cycle.rejected,
        simulatedFills: cycle.simulatedFills.length,
        reason: cycle.reason,
      },
    });
    return NextResponse.json({ ok: true, cycle, job: finished });
  } catch (error) {
    if (runId) {
      await failJob(runId, error instanceof Error ? error : "Unknown paper cycle error.").catch(
        () => undefined,
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown paper cycle error.",
      },
      { status: 200 },
    );
  }
}

import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { runGeneticPreTraining } from "@/lib/pre-training";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const denied = requireOperatorAccess(req, { mutation: true });
    if (denied) return denied;
    const body = (await req.json().catch(() => ({}))) as {
      cycles?: unknown;
      populationSize?: unknown;
      marketLimit?: unknown;
    };
    const result = await runGeneticPreTraining({
      cycles: Number(body.cycles),
      populationSize: Number(body.populationSize),
      marketLimit: Number(body.marketLimit),
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown pre-training error.",
      },
      { status: 200 },
    );
  }
}

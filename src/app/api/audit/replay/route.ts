import { NextResponse } from "next/server";

import { requireOperatorAccess } from "@/lib/access";
import { buildHistoricalReplayBundle } from "@/lib/audit";

export const dynamic = "force-dynamic";

function parseLimit(value: unknown): number {
  if (value == null || value === "") return 5_000;
  const n = Number(value);
  if (!Number.isFinite(n)) return 5_000;
  return Math.max(1, Math.min(50_000, Math.floor(n)));
}

function missingCycleId() {
  return NextResponse.json(
    { ok: false, error: "cycleId is required to replay an audit bundle." },
    { status: 400 },
  );
}

export async function GET(req: Request) {
  const denied = requireOperatorAccess(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const cycleId = url.searchParams.get("cycleId")?.trim();
  if (!cycleId) return missingCycleId();

  const bundle = await buildHistoricalReplayBundle(
    cycleId,
    parseLimit(url.searchParams.get("limit")),
  );
  return NextResponse.json({ ok: true, bundle });
}

export async function POST(req: Request) {
  const denied = requireOperatorAccess(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    cycleId?: unknown;
    limit?: unknown;
  };
  const cycleId = typeof body.cycleId === "string" ? body.cycleId.trim() : "";
  if (!cycleId) return missingCycleId();

  const bundle = await buildHistoricalReplayBundle(cycleId, parseLimit(body.limit));
  return NextResponse.json({ ok: true, bundle });
}

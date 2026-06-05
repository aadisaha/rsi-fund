import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    skipped: true,
    reason: "Kalshi live reconciliation cron is disabled on this paper-only host.",
  });
}

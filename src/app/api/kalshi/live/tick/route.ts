import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Kalshi live trading is disabled on this paper-only host.",
      submitted: [],
      skipped: [],
      blockers: ["paper-only-host"],
    },
    { status: 410 },
  );
}

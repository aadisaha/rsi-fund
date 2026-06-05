import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error: "Kalshi live reconciliation is disabled on this paper-only host.",
      blockers: ["paper-only-host"],
    },
    { status: 410 },
  );
}

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    status: {
      tradingEnabled: false,
      killSwitch: {
        active: false,
        effectiveActive: false,
        reason: "Paper-only host; live trading route is not deployed.",
        source: "system",
        updatedAt: new Date(0).toISOString(),
        envActive: false,
      },
      safetyHalt: null,
      blockers: ["paper-only-host"],
      exposure: {
        openUsd: 0,
        pendingOrderUsd: 0,
        remotePositionUsd: 0,
        maxOpenUsd: 0,
        maxOrderUsd: 0,
      },
    },
  });
}

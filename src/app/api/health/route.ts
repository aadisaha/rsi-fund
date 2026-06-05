import { NextResponse } from "next/server";

import { alpacaStatus } from "@/lib/alpaca";
import { buildOpsCapabilityGroups } from "@/lib/capabilities";
import { kalshiStatus } from "@/lib/kalshi";
import { storageStatus } from "@/lib/storage-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const alpaca = alpacaStatus();
  const kalshi = kalshiStatus();
  const capabilities = buildOpsCapabilityGroups();

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: "paper",
    liveOrders: false,
    storage: storageStatus(),
    services: { alpaca, kalshi },
    kalshiLive: {
      tradingEnabled: false,
      killSwitchActive: false,
      feedStale: false,
      reconciliationStale: false,
      blockers: ["paper-only-host"],
    },
    blockedCapabilities: capabilities
      .filter((group) => group.status === "blocked")
      .map((group) => group.name),
  });
}

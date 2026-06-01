import { NextResponse } from "next/server";

import { alpacaStatus } from "@/lib/alpaca";
import { buildOpsCapabilityGroups } from "@/lib/capabilities";
import { kalshiStatus } from "@/lib/kalshi";
import { readKalshiLiveStatus } from "@/lib/kalshi-live";
import { storageStatus } from "@/lib/storage-status";

export const dynamic = "force-dynamic";

export async function GET() {
  const alpaca = alpacaStatus();
  const kalshi = kalshiStatus();
  const capabilities = buildOpsCapabilityGroups();
  const kalshiLive = await readKalshiLiveStatus();

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: "paper",
    liveOrders: kalshiLive.tradingEnabled && !kalshiLive.killSwitch.effectiveActive,
    storage: storageStatus(),
    services: { alpaca, kalshi },
    kalshiLive: {
      tradingEnabled: kalshiLive.tradingEnabled,
      killSwitchActive: kalshiLive.killSwitch.effectiveActive,
      feedStale: kalshiLive.feed.stale,
      reconciliationStale: kalshiLive.reconciliation.stale,
      blockers: kalshiLive.blockers,
    },
    blockedCapabilities: capabilities
      .filter((group) => group.status === "blocked")
      .map((group) => group.name),
  });
}

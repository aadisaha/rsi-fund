import { NextResponse } from "next/server";

import { alpacaStatus } from "@/lib/alpaca";
import { buildOpsCapabilityGroups } from "@/lib/capabilities";
import { kalshiStatus } from "@/lib/kalshi";
import { readKalshiLiveStatus } from "@/lib/kalshi-live";
import { storageStatus } from "@/lib/storage-status";

export const dynamic = "force-dynamic";

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function GET() {
  const alpaca = alpacaStatus();
  const kalshi = kalshiStatus();
  const capabilities = buildOpsCapabilityGroups();
  const kalshiLive = await withTimeout(readKalshiLiveStatus(), 5_000);

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    mode: "paper",
    liveOrders: Boolean(kalshiLive?.tradingEnabled && !kalshiLive.killSwitch.effectiveActive),
    storage: storageStatus(),
    services: { alpaca, kalshi },
    kalshiLive: kalshiLive
      ? {
          tradingEnabled: kalshiLive.tradingEnabled,
          killSwitchActive: kalshiLive.killSwitch.effectiveActive,
          feedStale: kalshiLive.feed.stale,
          reconciliationStale: kalshiLive.reconciliation.stale,
          blockers: kalshiLive.blockers,
        }
      : {
          tradingEnabled: false,
          killSwitchActive: true,
          feedStale: true,
          reconciliationStale: true,
          blockers: ["live-status-timeout"],
        },
    blockedCapabilities: capabilities
      .filter((group) => group.status === "blocked")
      .map((group) => group.name),
  });
}
